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
  parseGitRemotes,
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
  private readonly workspace: WorkspaceLike
  private stateListener?: (state: GitStatusSnapshot) => void
  private queue: Promise<unknown> = Promise.resolve()
  private snapshot: GitStatusSnapshot

  constructor(workspace: WorkspaceLike, options: GitServiceOptions = {}) {
    this.workspace = workspace
    this.cli = new GitCli(options)
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
    const root = this.workspace.state().root
    const snapshot = await this.buildSnapshot(root)
    this.snapshot = snapshot
    this.stateListener?.(snapshot)
    return snapshot
  }

  async stage(relativePaths: string[]): Promise<GitStatusSnapshot> {
    const repoRoot = await this.requireRepoRoot()
    const paths = relativePaths.map(sanitizeRelativePath)
    await this.runExclusive(async () => {
      for (const chunk of splitInChunks(paths, MAX_CLI_LENGTH)) {
        await this.cli.exec(repoRoot, ['add', '--', ...chunk])
      }
    })
    return await this.refresh()
  }

  async unstage(relativePaths: string[]): Promise<GitStatusSnapshot> {
    const repoRoot = await this.requireRepoRoot()
    const paths = relativePaths.map(sanitizeRelativePath)
    await this.runExclusive(async () => {
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
    const repoRoot = await this.requireRepoRoot()
    const untracked = new Set(this.snapshot.untracked.map((change) => change.path))
    const cleanPaths = relativePaths.filter((path) => untracked.has(sanitizeRelativePath(path))).map(sanitizeRelativePath)
    const trackedPaths = relativePaths.filter((path) => !untracked.has(sanitizeRelativePath(path))).map(sanitizeRelativePath)
    await this.runExclusive(async () => {
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
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['commit', '-m', message]))
    return await this.refresh()
  }

  async diff(relativePath: string, staged?: boolean): Promise<string> {
    const repoRoot = await this.requireRepoRoot()
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
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['checkout', branch]))
    return await this.refresh()
  }

  async createBranch(name: string): Promise<GitStatusSnapshot> {
    this.assertBranchName(name)
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['checkout', '-b', name]))
    return await this.refresh()
  }

  async push(): Promise<GitStatusSnapshot> {
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['push']))
    return await this.refresh()
  }

  async pull(): Promise<GitStatusSnapshot> {
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['pull', '--ff-only']))
    return await this.refresh()
  }

  async fetch(): Promise<GitStatusSnapshot> {
    const repoRoot = await this.requireRepoRoot()
    await this.runExclusive(() => this.cli.exec(repoRoot, ['fetch']))
    return await this.refresh()
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async requireRepoRoot(): Promise<string> {
    const root = this.workspace.state().root
    return await this.cli.getRepositoryRoot(root)
  }

  private async buildSnapshot(root: string): Promise<GitStatusSnapshot> {
    let repoRoot: string
    try {
      repoRoot = await this.cli.getRepositoryRoot(root)
    } catch {
      return this.emptySnapshot(root)
    }

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
      const result = await this.cli.exec(root, ['config', '--local', '--list'])
      const seen = new Set<string>()
      for (const remote of parseGitRemotes(result.stdout)) seen.add(remote.name)
      return [...seen]
    } catch {
      return []
    }
  }

  private assertBranchName(name: string): void {
    if (!/^[\w.\-/]{1,256}$/.test(name) || name.startsWith('-') || name.endsWith('.lock') || name.includes('..')) {
      throw new GitError({ message: `'${name}' is not a valid branch name.`, gitErrorCode: GitErrorCodes.InvalidBranchName })
    }
  }
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
