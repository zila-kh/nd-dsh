/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Repository-state service for ND Source Control. The git CLI plumbing and parsers are
 *  derived from microsoft/vscode extensions/git (MIT), pinned in vendor/vscode-git.json;
 *  the state model, grouping, and orchestration are ND implementation.
 *--------------------------------------------------------------------------------------------*/

import type { GitBranch, GitCommitInfo, GitFileChange, GitStatusSnapshot, WorkspaceState } from '../../shared/contracts.js'
import {
  GitCli,
  GitError,
  GitErrorCodes,
  GitStatusParser,
  MAX_CLI_LENGTH,
  parseGitCommits,
  sanitizeRelativePath,
  splitInChunks,
  type Commit,
  type GitSpawnFunction,
} from './git-cli.js'

interface WorkspaceLike {
  state(): WorkspaceState
}

export interface GitServiceOptions {
  gitPath?: string
  env?: Record<string, string>
  spawnProcess?: GitSpawnFunction
  onOutput?(output: string): void
}

const HEAD_LOG_LIMIT = 8

/** XY combinations git reports for unmerged paths (`git status --porcelain`). */
const UNMERGED_COMBINATIONS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export class GitService {
  private readonly cli: GitCli
  private readonly authCli: GitCli
  private readonly workspace: WorkspaceLike
  private stateListener?: (state: GitStatusSnapshot) => void
  private queue: Promise<unknown> = Promise.resolve()
  private snapshot: GitStatusSnapshot
  private refreshGeneration = 0

  constructor(workspace: WorkspaceLike, options: GitServiceOptions = {}) {
    this.workspace = workspace
    this.cli = new GitCli(options)
    // OAuth output must never enter the renderer's Git output stream.
    const authOptions = { ...options }
    delete authOptions.onOutput
    this.authCli = new GitCli(authOptions)
    this.snapshot = this.emptySnapshot(this.workspace.state().root)
  }

  get current(): GitStatusSnapshot {
    return this.snapshot
  }

  setStateListener(listener: (state: GitStatusSnapshot) => void): void {
    this.stateListener = listener
  }

  async handleWorkspaceChanged(): Promise<GitStatusSnapshot> {
    return await this.refresh()
  }

  async refresh(): Promise<GitStatusSnapshot> {
    const workspace = this.workspace.state()
    const generation = ++this.refreshGeneration
    const snapshot = await this.buildSnapshot(workspace)
    // Workspace/project context can change while Git commands are in flight.
    // Never let an older result replace the active project's snapshot.
    if (generation !== this.refreshGeneration || !sameWorkspaceContext(workspace, this.workspace.state())) {
      return this.snapshot
    }
    this.snapshot = snapshot
    this.stateListener?.(snapshot)
    return snapshot
  }

  async stage(relativePaths: string[]): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    const paths = relativePaths.map(sanitizeRelativePath)
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      for (const chunk of splitInChunks(paths, MAX_CLI_LENGTH)) {
        await this.cli.exec(repoRoot, ['add', '--', ...chunk])
      }
    })
    return await this.refresh()
  }

  async unstage(relativePaths: string[]): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    const paths = relativePaths.map(sanitizeRelativePath)
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      for (const chunk of splitInChunks(paths, MAX_CLI_LENGTH)) {
        try {
          await this.cli.exec(repoRoot, ['reset', '-q', 'HEAD', '--', ...chunk])
        } catch (error) {
          // Before the first commit there is no HEAD to reset against; unstage via the index instead.
          if (error instanceof GitError && /unknown revision|bad revision|ambiguous argument/.test(error.stderr ?? '')) {
            await this.cli.exec(repoRoot, ['rm', '-q', '--cached', '-r', '--', ...chunk])
          } else {
            throw error
          }
        }
      }
    })
    return await this.refresh()
  }

  async discard(relativePaths: string[]): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    const untracked = new Set(this.snapshot.untracked.map((change) => change.path))
    const cleanPaths = relativePaths.filter((path) => untracked.has(sanitizeRelativePath(path))).map(sanitizeRelativePath)
    const trackedPaths = relativePaths.filter((path) => !untracked.has(sanitizeRelativePath(path))).map(sanitizeRelativePath)
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      if (trackedPaths.length > 0) {
        await this.cli.exec(repoRoot, ['checkout', '-q', '--', ...trackedPaths])
      }
      for (const chunk of splitInChunks(cleanPaths, MAX_CLI_LENGTH)) {
        await this.cli.exec(repoRoot, ['clean', '-q', '-f', '--', ...chunk])
      }
    })
    return await this.refresh()
  }

  async commit(message: string): Promise<GitStatusSnapshot> {
    if (!message.trim()) {
      throw new GitError({ message: 'A commit message is required.' })
    }
    if (this.snapshot.staged.length === 0) {
      throw new GitError({ message: 'There are no staged changes to commit.', gitErrorCode: GitErrorCodes.NoStagedChanges })
    }
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['commit', '-m', message])
    })
    return await this.refresh()
  }

  async diff(relativePath: string, staged?: boolean): Promise<string> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    const path = sanitizeRelativePath(relativePath)
    if (staged) {
      return (await this.cli.exec(repoRoot, ['diff', '--cached', '--', path])).stdout
    }
    if (this.snapshot.untracked.some((change) => change.path === path)) {
      try {
        // `diff --no-index` exits 1 whenever the files differ; stdout still carries the patch.
        const result = await this.cli.exec(repoRoot, ['diff', '--no-index', '--', '/dev/null', path])
        return result.stdout
      } catch (error) {
        if (error instanceof GitError && typeof error.stdout === 'string') return error.stdout
        throw error
      }
    }
    return (await this.cli.exec(repoRoot, ['diff', '--', path])).stdout
  }

  async checkout(branch: string): Promise<GitStatusSnapshot> {
    this.assertBranchName(branch)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['checkout', branch])
    })
    return await this.refresh()
  }

  async configureRemote(root: string, name: string, url: string): Promise<GitStatusSnapshot> {
    return this.configureProjectRemote(root, name, url, false)
  }

  async connectGitHub(root: string, name: string, url: string): Promise<GitStatusSnapshot> {
    // Only credential-free GitHub.com HTTPS URLs are eligible for this flow.
    if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
      throw new Error('Enter a GitHub repository URL such as https://github.com/owner/repo.git.')
    }
    return this.configureProjectRemote(root, name, url, true)
  }

  private async configureProjectRemote(root: string, name: string, url: string, githubOAuth: boolean): Promise<GitStatusSnapshot> {
    this.assertRemoteName(name)
    if (!/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(url) || /[\s\x00-\x1f]/.test(url)) {
      throw new GitError({ message: 'Enter an HTTPS or SSH Git remote URL.' })
    }
    const context = this.captureWorkspaceContext()
    if (!sameWorkspacePath(context.root, root)) throw new GitError({ message: 'The active project changed. Reopen Git setup.' })
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      if (githubOAuth) {
        try {
          await this.authCli.exec(root, ['credential-manager', '--version'], { timeoutMs: 10_000 })
        } catch {
          throw new Error('GitHub sign-in requires Git Credential Manager. Install or update Git with Git Credential Manager enabled, then try again.')
        }
        try {
          await this.authCli.exec(root, ['credential-manager', 'github', 'login', '--url', 'https://github.com', '--browser'], {
            env: { GCM_INTERACTIVE: 'always' }, timeoutMs: 180_000,
          })
        } catch {
          throw new Error('GitHub sign-in was cancelled, failed, or timed out. Try connecting again and complete authorization in your browser.')
        }
        try {
          await this.authCli.exec(root, ['-c', 'credential.helper=manager', 'ls-remote', '--', url], {
            env: { GCM_INTERACTIVE: 'never' }, timeoutMs: 30_000,
          })
        } catch {
          throw new Error('GitHub sign-in completed, but this repository could not be read. Check its URL and your account or organization access, then retry.')
        }
        if (root !== this.workspace.state().root) throw new Error('The active project changed. Reopen Git setup.')
      }
      let repoRoot: string
      try {
        repoRoot = await this.cli.getRepositoryRoot(root)
      } catch {
        await this.cli.exec(root, ['init'])
        repoRoot = root
      }
      if (!sameWorkspacePath(repoRoot, root)) {
        // Git discovery walks up to a parent repository until this project is
        // initialized. Connect Git is the explicit opt-in that creates the
        // project-local repository, so the parent repository remains untouched.
        await this.cli.exec(root, ['init'])
        repoRoot = root
      }
      const remotes = await this.listRemotes(repoRoot)
      await this.cli.exec(repoRoot, ['remote', remotes.includes(name) ? 'set-url' : 'add', name, url])
      if (githubOAuth) {
        // Scope the helper to this project; never alter global Git configuration.
        await this.cli.exec(repoRoot, ['config', '--local', 'credential.helper', 'manager'])
      }
    })
    return await this.refresh()
  }

  async createBranch(name: string): Promise<GitStatusSnapshot> {
    this.assertBranchName(name)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['checkout', '-b', name])
    })
    return await this.refresh()
  }

  /**
   * Select the session-owned branch without ever carrying uncommitted work
   * across branches. ChatGPT Web must start from one exact committed Git state.
   */
  async ensureBranch(name: string): Promise<GitStatusSnapshot> {
    this.assertBranchName(name)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    if (await this.currentBranch(repoRoot) === name) return await this.refresh()
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      const status = await this.cli.status(repoRoot)
      if (status.stdout.length > 0) {
        throw new GitError({
          message: `Refusing to switch to ${name} while the worktree has uncommitted changes. Commit or stash them first.`,
          gitErrorCode: GitErrorCodes.DirtyWorkTree,
        })
      }
      const existing = (await this.cli.exec(repoRoot, ['branch', '--list', name])).stdout.trim().length > 0
      await this.cli.exec(repoRoot, existing ? ['checkout', name] : ['checkout', '-b', name])
    })
    return await this.refresh()
  }

  async head(): Promise<string | null> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    try {
      const value = (await this.cli.exec(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      return value || null
    } catch (error) {
      if (error instanceof GitError && /unknown revision|bad revision|ambiguous argument|does not have any commits yet/i.test(error.stderr ?? '')) return null
      throw error
    }
  }

  /** Renderer/prompt-safe remote metadata; actual Git commands continue using the remote name. */
  async remoteUrl(remote: string): Promise<string | null> {
    this.assertRemoteName(remote)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    try {
      const raw = (await this.cli.exec(repoRoot, ['remote', 'get-url', remote])).stdout.trim()
      return raw ? this.sanitizeRemoteUrl(raw) : null
    } catch (error) {
      if (error instanceof GitError) return null
      throw error
    }
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    return (await this.cli.status(repoRoot)).stdout.length > 0
  }

  /**
   * Publish a session branch only from a clean worktree. If the remote branch
   * already moved (for example ChatGPT pushed while ND was closed), fetch it
   * first and require a fast-forward merge. Divergence therefore fails before
   * any push instead of surfacing as a destructive recovery problem later.
   */
  async pushBranch(remote: string, branch: string): Promise<GitStatusSnapshot> {
    this.assertRemoteName(remote)
    this.assertBranchName(branch)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      const current = await this.currentBranch(repoRoot)
      if (current !== branch) {
        throw new GitError({ message: `Refusing to push ${branch}: the active branch is ${current ?? 'detached HEAD'}.` })
      }
      const status = await this.cli.status(repoRoot)
      if (status.stdout.length > 0) {
        throw new GitError({
          message: `Refusing to sync ${branch} while the worktree has uncommitted changes. Commit or stash them first.`,
          gitErrorCode: GitErrorCodes.DirtyWorkTree,
        })
      }
      let localHead = (await this.cli.exec(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      if (!localHead) throw new GitError({ message: `Cannot push ${branch}: the repository has no committed HEAD.` })

      const remoteHeadBefore = this.parseRemoteHead((await this.cli.exec(repoRoot, ['ls-remote', '--heads', remote, `refs/heads/${branch}`])).stdout)
      if (remoteHeadBefore && remoteHeadBefore !== localHead) {
        await this.cli.exec(repoRoot, ['fetch', remote, branch])
        try {
          await this.cli.exec(repoRoot, ['merge', '--ff-only', 'FETCH_HEAD'])
        } catch (error) {
          throw this.divergedBranchError(remote, branch, error)
        }
        localHead = (await this.cli.exec(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      }

      await this.cli.exec(repoRoot, ['push', '--set-upstream', remote, branch])
      const confirmedRemoteHead = this.parseRemoteHead((await this.cli.exec(repoRoot, ['ls-remote', '--heads', remote, `refs/heads/${branch}`])).stdout)
      if (!confirmedRemoteHead || confirmedRemoteHead !== localHead) {
        throw new GitError({ message: `Git reported a successful push, but ${remote}/${branch} does not match local HEAD.` })
      }
    })
    return await this.refresh()
  }

  async remoteBranchHead(remote: string, branch: string): Promise<string | null> {
    this.assertRemoteName(remote)
    this.assertBranchName(branch)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    this.assertWorkspaceContext(context)
    const result = await this.cli.exec(repoRoot, ['ls-remote', '--heads', remote, `refs/heads/${branch}`])
    return this.parseRemoteHead(result.stdout)
  }

  async fastForwardBranch(remote: string, branch: string): Promise<GitStatusSnapshot> {
    this.assertRemoteName(remote)
    this.assertBranchName(branch)
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(async () => {
      this.assertWorkspaceContext(context)
      const current = await this.currentBranch(repoRoot)
      if (current !== branch) throw new GitError({ message: `Refusing to sync ${branch}: the active branch is ${current ?? 'detached HEAD'}.` })
      const status = await this.cli.status(repoRoot)
      if (status.stdout.length > 0) {
        throw new GitError({
          message: `Refusing to fast-forward ${branch} while the worktree has uncommitted changes.`,
          gitErrorCode: GitErrorCodes.DirtyWorkTree,
        })
      }
      await this.cli.exec(repoRoot, ['fetch', remote, branch])
      try {
        await this.cli.exec(repoRoot, ['merge', '--ff-only', 'FETCH_HEAD'])
      } catch (error) {
        throw this.divergedBranchError(remote, branch, error)
      }
    })
    return await this.refresh()
  }

  async push(): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['push'])
    })
    return await this.refresh()
  }

  async pull(): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['pull', '--ff-only'])
    })
    return await this.refresh()
  }

  async fetch(): Promise<GitStatusSnapshot> {
    const context = this.captureWorkspaceContext()
    const repoRoot = await this.requireRepoRoot(context)
    await this.runExclusive(() => {
      this.assertWorkspaceContext(context)
      return this.cli.exec(repoRoot, ['fetch'])
    })
    return await this.refresh()
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async requireRepoRoot(expected?: WorkspaceState): Promise<string> {
    const state = this.workspace.state()
    this.assertWorkspaceUsableState(state)
    if (expected) this.assertWorkspaceContext(expected)
    const root = state.root
    const repoRoot = await this.cli.getRepositoryRoot(root)
    if (expected) this.assertWorkspaceContext(expected)
    if (!sameWorkspacePath(repoRoot, root)) {
      throw new GitError({ message: 'This project folder is inside another Git repository. Select a folder with its own Git repository for project Git.' })
    }
    return repoRoot
  }

  private async buildSnapshot(workspace: WorkspaceState): Promise<GitStatusSnapshot> {
    const root = workspace.root
    if (workspace.binding === 'unlinked' || workspace.binding === 'missing') return this.emptySnapshot(root)
    let repoRoot: string
    try {
      repoRoot = await this.cli.getRepositoryRoot(root)
    } catch {
      return this.emptySnapshot(root)
    }

    // A project may live below a repository that belongs to its parent project.
    // Do not leak that parent repository's branch, remotes, or changes into this
    // project's Git controls. Project Git is scoped to the exact workspace root.
    if (!sameWorkspacePath(repoRoot, root)) return this.emptySnapshot(root, repoRoot)

    const empty = this.emptySnapshot(root, repoRoot)
    try {
      const [branch, statuses, branches, heads, remotes] = await Promise.all([
        this.currentBranch(root),
        this.statusEntries(root),
        this.listBranches(root),
        this.headCommits(root),
        this.listRemotes(root),
      ])
      const current = branches.find((candidate) => candidate.name === branch)
      return {
        root,
        repoRoot,
        branch,
        ahead: current?.ahead ?? 0,
        behind: current?.behind ?? 0,
        heads,
        branches,
        staged: statuses.staged,
        unstaged: statuses.unstaged,
        untracked: statuses.untracked,
        conflicts: statuses.conflicts,
        remotes,
        timestamp: Date.now(),
      }
    } catch (error) {
      // A corrupt repository or missing git binary still renders the panel; the snapshot stays empty.
      console.warn('Git status snapshot failed:', error instanceof Error ? error.message : String(error))
      return empty
    }
  }

  private captureWorkspaceContext(): WorkspaceState {
    const state = this.workspace.state()
    this.assertWorkspaceUsableState(state)
    return state
  }

  private assertWorkspaceContext(expected: WorkspaceState): void {
    const current = this.workspace.state()
    if (!sameWorkspaceContext(expected, current)) {
      throw new GitError({ message: 'The active project changed. Reopen Git and try again.' })
    }
    this.assertWorkspaceUsableState(current)
  }

  private assertWorkspaceUsableState(state: WorkspaceState): void {
    const binding = state.binding
    if (binding === 'unlinked') throw new GitError({ message: 'The active project has no workspace linked. Select a workspace for this project first.' })
    if (binding === 'missing') throw new GitError({ message: 'The active project workspace is unavailable. Relocate the project workspace first.' })
  }

  private emptySnapshot(root: string, repoRoot: string | null = null): GitStatusSnapshot {
    return {
      root,
      repoRoot,
      branch: null,
      ahead: 0,
      behind: 0,
      heads: [],
      branches: [],
      staged: [],
      unstaged: [],
      untracked: [],
      conflicts: [],
      remotes: [],
      timestamp: Date.now(),
    }
  }

  private async currentBranch(root: string): Promise<string | null> {
    try {
      const result = await this.cli.exec(root, ['symbolic-ref', '--short', 'HEAD'])
      return result.stdout.trim() || null
    } catch {
      // Detached HEAD or an unborn branch.
      return null
    }
  }

  private async statusEntries(root: string): Promise<{ staged: GitFileChange[]; unstaged: GitFileChange[]; untracked: GitFileChange[]; conflicts: GitFileChange[] }> {
    const result = await this.cli.status(root)
    const parser = new GitStatusParser()
    parser.update(result.stdout)

    const staged: GitFileChange[] = []
    const unstaged: GitFileChange[] = []
    const untracked: GitFileChange[] = []
    const conflicts: GitFileChange[] = []

    for (const entry of parser.status) {
      // Upstream parser convention: for `R NEW\0OLD\0` entries, `rename` holds the
      // new path and `path` the original. ND contracts want path = current path.
      const change: GitFileChange = {
        path: entry.rename ?? entry.path,
        originalPath: entry.rename ? entry.path : undefined,
        x: entry.x,
        y: entry.y,
      }
      if (UNMERGED_COMBINATIONS.has(`${entry.x}${entry.y}`)) {
        conflicts.push(change)
      } else if (entry.x === '?' && entry.y === '?') {
        untracked.push(change)
      } else {
        if (entry.x !== ' ') staged.push(change)
        if (entry.y !== ' ') unstaged.push(change)
      }
    }

    return { staged, unstaged, untracked, conflicts }
  }

  private async listBranches(root: string): Promise<GitBranch[]> {
    const result = await this.cli.exec(root, ['for-each-ref', 'refs/heads', '--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)'])
    const branches: GitBranch[] = []
    for (const line of result.stdout.split('\n')) {
      const [name, upstream, track = ''] = line.split('\0')
      if (!name) continue
      const match = /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/.exec(track)
      branches.push({
        name,
        current: false,
        upstream: upstream || undefined,
        ahead: match ? Number(match[1] ?? 0) : 0,
        behind: match ? Number(match[2] ?? match[3] ?? 0) : 0,
      })
    }
    return branches
  }

  private async headCommits(root: string): Promise<GitCommitInfo[]> {
    try {
      const result = await this.cli.log(root, HEAD_LOG_LIMIT)
      return parseGitCommits(result.stdout).map(toCommitInfo)
    } catch (error) {
      // An unborn repository has no commits yet.
      if (error instanceof GitError && /does not have any commits yet|bad revision/.test(error.stderr ?? '')) return []
      throw error
    }
  }

  private async listRemotes(root: string): Promise<string[]> {
    try {
      // `git config --list` emits flat key=value records, not the INI sections
      // consumed by parseGitRemotes. Ask Git for names directly instead.
      const result = await this.cli.exec(root, ['remote'])
      return [...new Set(result.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))]
    } catch {
      return []
    }
  }

  private assertBranchName(name: string): void {
    if (!/^[\w.\-/]{1,256}$/.test(name) || name.startsWith('-') || name.endsWith('.lock') || name.includes('..')) {
      throw new GitError({ message: `'${name}' is not a valid branch name.`, gitErrorCode: GitErrorCodes.InvalidBranchName })
    }
  }

  private assertRemoteName(name: string): void {
    if (!/^[\w.-]{1,128}$/.test(name) || name.startsWith('-')) {
      throw new GitError({ message: `'${name}' is not a valid Git remote name.` })
    }
  }

  private parseRemoteHead(output: string): string | null {
    const sha = output.trim().split(/\s+/)[0]
    return sha && /^[0-9a-f]{40,64}$/i.test(sha) ? sha : null
  }

  private sanitizeRemoteUrl(raw: string): string {
    try {
      const parsed = new URL(raw)
      parsed.username = ''
      parsed.password = ''
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      // SCP-style SSH remotes such as git@github.com:owner/repo.git are not URLs.
      return raw
    }
  }

  private divergedBranchError(remote: string, branch: string, error: unknown): GitError {
    return new GitError({
      message: `Refusing to sync ${branch}: local history and ${remote}/${branch} cannot be fast-forwarded safely. Resolve the divergence locally before continuing ChatGPT Web sync.`,
      ...(error instanceof GitError && error.stderr ? { stderr: error.stderr } : {}),
    })
  }
}

function sameWorkspacePath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  return normalize(left) === normalize(right)
}

function sameWorkspaceContext(left: WorkspaceState, right: WorkspaceState): boolean {
  return sameWorkspacePath(left.root, right.root)
    && left.binding === right.binding
    && left.projectId === right.projectId
    && left.projectWorkspacePath === right.projectWorkspacePath
}

function toCommitInfo(commit: Commit): GitCommitInfo {
  return {
    hash: commit.hash,
    message: commit.message,
    authorName: commit.authorName ?? '',
    authorEmail: commit.authorEmail ?? '',
    date: (commit.authorDate ?? commit.commitDate ?? new Date(0)).toISOString(),
  }
}
