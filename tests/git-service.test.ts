import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { GitSpawnFunction } from '../src/main/git/git-cli.js'
import { GitService } from '../src/main/git/git-service.js'
import type { WorkspaceState } from '../src/shared/contracts.js'

const ROOT = 'C:/workspaces/demo'
const REPO_ROOT = 'C:/workspaces/demo'
const NESTED_ROOT = 'C:/workspaces/demo/examples'
const LOCAL_SHA = '2222222222222222222222222222222222222222'
const REMOTE_SHA = '3333333333333333333333333333333333333333'

const COMMIT_LOG = [
  '1111111111111111111111111111111111111111',
  'Jane Doe',
  'jane@example.com',
  '1700000000',
  '1700000000',
  '',
  'main',
  'Latest commit',
  '\x00',
].join('\n')

const DIRTY_STATUS = [
  'A  staged.txt',
  ' M modified.txt',
  '?? untracked.txt',
  'UU conflict.txt',
  'R  renamed-new.txt\0renamed-old.txt',
].join('\0') + '\0'

type FakeGitResponse = {
  match: string[]
  exitCode?: number
  stdout?: string
  stderr?: string
  stdoutSequence?: string[]
  delayMs?: number
}

/** Scripted stand-in for the git binary: each spawn records its argv and answers from `script`. */
class FakeGit {
  readonly calls: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined; cwd: string | undefined }> = []
  script: FakeGitResponse[] = []

  spawn: GitSpawnFunction = (_path, args, options) => {
    const record = { args, env: options.env, cwd: options.cwd }
    this.calls.push(record)
    const response = this.script.find((candidate) => candidate.match.every((token) => args.includes(token)))
      ?? { match: [], stdout: '' }
    const emitter = new EventEmitter()
    const child = emitter as unknown as Record<string, unknown>
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = new PassThrough()
    const complete = () => {
      const sequenceOutput = response.stdoutSequence?.shift()
      if (response.stderr !== undefined) stderr.write(response.stderr)
      if (sequenceOutput !== undefined) stdout.write(sequenceOutput)
      else if (response.stdout !== undefined) stdout.write(response.stdout)
      stdout.end()
      stderr.end()
      emitter.emit('exit', response.exitCode ?? 0, null)
    }
    if (response.delayMs) setTimeout(complete, response.delayMs)
    else process.nextTick(complete)
    return child as unknown as ChildProcess
  }

  argsOf(...tokens: string[]): string[] | undefined {
    return this.calls.find((call) => tokens.every((token) => call.args.includes(token)))?.args
  }

  lastArgsOf(...tokens: string[]): string[] | undefined {
    const matching = this.calls.filter((call) => tokens.every((token) => call.args.includes(token)))
    return matching.at(-1)?.args
  }
}

function createService(fake: FakeGit, root = ROOT): GitService {
  const workspace = {
    state(): WorkspaceState {
      return { root, name: 'demo' }
    },
  }
  return new GitService(workspace, { gitPath: '/fake/git', spawnProcess: fake.spawn })
}

function repositoryScript(): FakeGitResponse[] {
  return [
    { match: ['rev-parse', '--show-toplevel'], stdout: `${REPO_ROOT}\n` },
    { match: ['status'], stdout: DIRTY_STATUS },
    { match: ['symbolic-ref'], stdout: 'main\n' },
    { match: ['for-each-ref'], stdout: 'main\x00origin/main\x00[ahead 2]\nfeature\x00\x00\n' },
    { match: ['log'], stdout: COMMIT_LOG },
    { match: ['remote'], stdout: 'origin\r\n' },
  ]
}

function cleanSessionBranchScript(branch = 'nd/chat-test'): FakeGitResponse[] {
  return [
    { match: ['status'], stdout: '' },
    { match: ['symbolic-ref'], stdout: `${branch}\n` },
    { match: ['rev-parse', 'HEAD'], stdout: `${LOCAL_SHA}\n` },
    { match: ['ls-remote'], stdout: `${LOCAL_SHA}\trefs/heads/${branch}\n` },
    ...repositoryScript(),
  ]
}

let fake: FakeGit

beforeEach(() => {
  fake = new FakeGit()
})

describe('GitService snapshot', () => {
  it('reads remote names directly from Git, including Windows line endings', async () => {
    fake.script = [{ match: ['remote'], stdout: 'origin\r\nupstream\r\n' }, ...repositoryScript()]
    expect((await createService(fake).refresh()).remotes).toEqual(['origin', 'upstream'])
    expect(fake.argsOf('config', '--list')).toBeUndefined()
  })
  it('configures a named remote without pushing and rejects a stale project', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.configureRemote(ROOT, 'origin', 'https://example.com/new.git')
    expect(fake.argsOf('remote', 'set-url')).toContain('https://example.com/new.git')
    expect(fake.argsOf('push')).toBeUndefined()
    const count = fake.calls.length
    await expect(service.configureRemote('C:/another', 'origin', 'https://example.com/new.git')).rejects.toThrow('active project changed')
    await expect(service.configureRemote(ROOT, '-bad', 'https://example.com/new.git')).rejects.toThrow('valid Git remote')
    await expect(service.configureRemote(ROOT, 'origin', 'file:///secret')).rejects.toThrow('HTTPS or SSH')
    expect(fake.calls).toHaveLength(count)
  })
  it('authenticates GitHub with Git Credential Manager OAuth before configuring the remote', async () => {
    fake.script = [
      { match: ['credential-manager', '--version'], stdout: '2.6.1\n' },
      { match: ['credential-manager', 'github', 'login'], stdout: 'Logged in\n' },
      { match: ['ls-remote'], stdout: `${LOCAL_SHA}\tHEAD\n` },
      ...repositoryScript(),
    ]
    const service = createService(fake)

    await service.connectGitHub(ROOT, 'origin', 'https://github.com/acme/demo.git')

    expect(fake.argsOf('credential-manager', 'github', 'login')).toEqual(expect.arrayContaining(['--browser']))
    expect(fake.argsOf('ls-remote')).toEqual(expect.arrayContaining(['https://github.com/acme/demo.git']))
    expect(fake.argsOf('config', '--local', 'credential.helper', 'manager')).toBeDefined()
    expect(fake.argsOf('push')).toBeUndefined()
  })
  it('does not expose or mutate the previous repository for an unlinked project', async () => {
    fake.script = repositoryScript()
    const workspace = {
      state(): WorkspaceState {
        return { root: ROOT, name: 'demo', binding: 'unlinked', projectId: 'project-without-folder' }
      },
    }
    const service = new GitService(workspace, { gitPath: '/fake/git', spawnProcess: fake.spawn })

    const state = await service.refresh()

    expect(state.repoRoot).toBeNull()
    expect(state.branch).toBeNull()
    expect(state.remotes).toEqual([])
    expect(fake.calls).toHaveLength(0)
    await expect(service.configureRemote(ROOT, 'origin', 'https://example.com/new.git')).rejects.toThrow(/no workspace linked/i)
    expect(fake.calls).toHaveLength(0)
  })
  it('ignores a slow Git refresh from the previous project when the context changes', async () => {
    let context: WorkspaceState = { root: ROOT, name: 'demo', binding: 'project', projectId: 'first-project' }
    fake.script = [
      { match: ['rev-parse', '--show-toplevel'], stdout: `${ROOT}\n` },
      { match: ['status'], stdout: DIRTY_STATUS, delayMs: 25 },
      { match: ['symbolic-ref'], stdout: 'main\n' },
      { match: ['for-each-ref'], stdout: 'main\x00\x00\n' },
      { match: ['log'], stdout: COMMIT_LOG },
      { match: ['remote'], stdout: 'origin\n' },
    ]
    const workspace = { state: (): WorkspaceState => context }
    const service = new GitService(workspace, { gitPath: '/fake/git', spawnProcess: fake.spawn })

    const previous = service.refresh()
    context = { ...context, binding: 'unlinked', projectId: 'second-project' }
    const active = await service.refresh()

    expect(active.repoRoot).toBeNull()
    await previous
    expect(service.current.repoRoot).toBeNull()
  })
  it('groups porcelain entries into staged/unstaged/untracked/conflict sets', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    const state = await service.refresh()

    expect(state.repoRoot).toBe(REPO_ROOT)
    expect(state.branch).toBe('main')
    expect(state.ahead).toBe(2)
    expect(state.behind).toBe(0)
    expect(state.staged.map((change) => change.path)).toEqual(['staged.txt', 'renamed-new.txt'])
    expect(state.staged.find((change) => change.path === 'renamed-new.txt')?.originalPath).toBe('renamed-old.txt')
    expect(state.unstaged.map((change) => change.path)).toEqual(['modified.txt'])
    expect(state.untracked.map((change) => change.path)).toEqual(['untracked.txt'])
    expect(state.conflicts.map((change) => change.path)).toEqual(['conflict.txt'])
    expect(state.remotes).toEqual(['origin'])
    expect(state.heads).toHaveLength(1)
    expect(state.heads[0]).toMatchObject({ hash: '1111111111111111111111111111111111111111', message: 'Latest commit' })
    expect(state.branches[0]).toMatchObject({ name: 'main', ahead: 2, upstream: 'origin/main' })
  })

  it('does not expose a parent repository as project Git', async () => {
    fake.script = repositoryScript()
    const state = await createService(fake, NESTED_ROOT).refresh()

    expect(state.root).toBe(NESTED_ROOT)
    expect(state.repoRoot).toBe(REPO_ROOT)
    expect(state.branch).toBeNull()
    expect(state.remotes).toEqual([])
    expect(state.staged).toEqual([])
    expect(fake.argsOf('status')).toBeUndefined()
  })

  it('initializes project-local Git instead of configuring the parent repository', async () => {
    fake.script = repositoryScript()
    const service = createService(fake, NESTED_ROOT)

    await service.configureRemote(NESTED_ROOT, 'origin', 'https://example.com/new.git')
    expect(fake.argsOf('init')).toEqual(['init'])
    expect(fake.argsOf('remote', 'set-url')).toContain('https://example.com/new.git')
    expect(fake.calls.find((call) => call.args.includes('init'))?.cwd).toBe(NESTED_ROOT)
    expect(fake.calls.find((call) => call.args.includes('set-url'))?.cwd).toBe(NESTED_ROOT)
  })

  it('reports an empty snapshot outside a repository', async () => {
    fake.script = [
      { match: ['rev-parse'], exitCode: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' },
    ]
    const service = createService(fake)
    const state = await service.refresh()

    expect(state.repoRoot).toBeNull()
    expect(state.branch).toBeNull()
    expect(state.staged).toEqual([])
    expect(service.current.repoRoot).toBeNull()
  })

  it('tolerates an unborn repository with no commits', async () => {
    fake.script = [
      ...repositoryScript().filter((entry) => entry.match[0] !== 'log'),
      { match: ['log'], exitCode: 128, stderr: "fatal: your current branch 'main' does not have any commits yet" },
    ]
    const service = createService(fake)
    const state = await service.refresh()

    expect(state.heads).toEqual([])
    expect(state.branch).toBe('main')
  })
})

describe('GitService actions', () => {
  it('stages paths through chunked add commands and refreshes afterwards', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    const state = await service.stage(['a.txt', 'b.txt'])
    expect(fake.lastArgsOf('add')).toEqual(['add', '--', 'a.txt', 'b.txt'])
    expect(state.timestamp).toBeGreaterThan(0)
  })

  it('discards tracked changes via checkout and untracked via clean', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    await service.discard(['modified.txt', 'untracked.txt'])
    expect(fake.argsOf('checkout')).toEqual(['checkout', '-q', '--', 'modified.txt'])
    expect(fake.argsOf('clean')).toEqual(['clean', '-q', '-f', '--', 'untracked.txt'])
  })

  it('unstages through rm --cached before the first commit exists', async () => {
    fake.script = [
      ...repositoryScript(),
      { match: ['reset'], exitCode: 128, stderr: "fatal: ambiguous argument 'HEAD'" },
    ]
    const service = createService(fake)
    await service.refresh()

    await service.unstage(['staged.txt'])
    expect(fake.argsOf('rm')).toEqual(['rm', '-q', '--cached', '-r', '--', 'staged.txt'])
  })

  it('refuses to commit without staged changes', async () => {
    fake.script = [
      ...repositoryScript().filter((entry) => entry.match[0] !== 'status'),
      { match: ['status'], stdout: ' M modified.txt\0' },
    ]
    const service = createService(fake)
    await service.refresh()

    await expect(service.commit('nothing here')).rejects.toThrow(/no staged changes/i)
  })

  it('commits the staged index with -m and refreshes', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    await service.commit('Add feature')
    expect(fake.argsOf('commit')).toEqual(['commit', '-m', 'Add feature'])
  })

  it('creates branches via checkout -b and rejects invalid names', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    await service.createBranch('feature/next')
    expect(fake.argsOf('checkout', '-b')).toEqual(['checkout', '-b', 'feature/next'])

    await expect(service.createBranch('-evil')).rejects.toThrow(/not a valid branch name/)
    expect(fake.calls.some((call) => call.args.includes('-evil'))).toBe(false)
  })

  it('refuses to create or switch a chat branch while the worktree is dirty', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    await expect(service.ensureBranch('nd/chat-safe')).rejects.toThrow(/uncommitted changes/i)
    expect(fake.argsOf('checkout', '-b')).toBeUndefined()
  })

  it('pushes a clean chat branch and verifies the remote head', async () => {
    fake.script = cleanSessionBranchScript()
    const service = createService(fake)
    await service.refresh()

    await service.pushBranch('origin', 'nd/chat-test')

    expect(fake.argsOf('push', '--set-upstream')).toEqual(['push', '--set-upstream', 'origin', 'nd/chat-test'])
    expect(fake.calls.filter((call) => call.args.includes('ls-remote'))).toHaveLength(2)
  })

  it('fast-forwards a stale local chat branch before pushing', async () => {
    fake.script = [
      { match: ['status'], stdout: '' },
      { match: ['symbolic-ref'], stdout: 'nd/chat-test\n' },
      { match: ['rev-parse', 'HEAD'], stdoutSequence: [`${LOCAL_SHA}\n`, `${REMOTE_SHA}\n`] },
      { match: ['ls-remote'], stdoutSequence: [
        `${REMOTE_SHA}\trefs/heads/nd/chat-test\n`,
        `${REMOTE_SHA}\trefs/heads/nd/chat-test\n`,
      ] },
      ...repositoryScript(),
    ]
    const service = createService(fake)

    await service.pushBranch('origin', 'nd/chat-test')

    const fetchIndex = fake.calls.findIndex((call) => call.args[0] === 'fetch')
    const mergeIndex = fake.calls.findIndex((call) => call.args[0] === 'merge')
    const pushIndex = fake.calls.findIndex((call) => call.args[0] === 'push')
    expect(fake.argsOf('fetch')).toEqual(['fetch', 'origin', 'nd/chat-test'])
    expect(fake.argsOf('merge')).toEqual(['merge', '--ff-only', 'FETCH_HEAD'])
    expect(fetchIndex).toBeGreaterThanOrEqual(0)
    expect(mergeIndex).toBeGreaterThan(fetchIndex)
    expect(pushIndex).toBeGreaterThan(mergeIndex)
  })

  it('refuses a diverged chat branch before any push', async () => {
    fake.script = [
      { match: ['status'], stdout: '' },
      { match: ['symbolic-ref'], stdout: 'nd/chat-test\n' },
      { match: ['rev-parse', 'HEAD'], stdout: `${LOCAL_SHA}\n` },
      { match: ['ls-remote'], stdout: `${REMOTE_SHA}\trefs/heads/nd/chat-test\n` },
      { match: ['merge'], exitCode: 1, stderr: 'fatal: Not possible to fast-forward, aborting.\n' },
      ...repositoryScript(),
    ]
    const service = createService(fake)

    await expect(service.pushBranch('origin', 'nd/chat-test')).rejects.toThrow(/fast-forward/i)
    expect(fake.argsOf('fetch')).toEqual(['fetch', 'origin', 'nd/chat-test'])
    expect(fake.argsOf('push', '--set-upstream')).toBeUndefined()
  })

  it('refuses to push a chat branch with uncommitted changes', async () => {
    fake.script = [
      { match: ['symbolic-ref'], stdout: 'nd/chat-test\n' },
      ...repositoryScript(),
    ]
    const service = createService(fake)

    await expect(service.pushBranch('origin', 'nd/chat-test')).rejects.toThrow(/uncommitted changes/i)
    expect(fake.argsOf('push', '--set-upstream')).toBeUndefined()
  })

  it('fast-forwards a clean chat branch using fetch plus merge --ff-only', async () => {
    fake.script = cleanSessionBranchScript()
    const service = createService(fake)
    await service.refresh()

    await service.fastForwardBranch('origin', 'nd/chat-test')

    expect(fake.argsOf('fetch')).toEqual(['fetch', 'origin', 'nd/chat-test'])
    expect(fake.argsOf('merge')).toEqual(['merge', '--ff-only', 'FETCH_HEAD'])
  })

  it('reads an exact remote branch head without mutating the repository', async () => {
    fake.script = cleanSessionBranchScript()
    const service = createService(fake)

    await expect(service.remoteBranchHead('origin', 'nd/chat-test')).resolves.toBe(LOCAL_SHA)
    expect(fake.argsOf('fetch')).toBeUndefined()
    expect(fake.argsOf('merge')).toBeUndefined()
  })

  it('pushes and pulls through the repository root', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    await service.push()
    expect(fake.argsOf('push')).toEqual(['push'])

    await service.pull()
    expect(fake.argsOf('pull')).toEqual(['pull', '--ff-only'])
  })

  it('returns unified diff text for a path', async () => {
    fake.script = [
      ...repositoryScript(),
      { match: ['diff'], stdout: 'diff --git a/modified.txt b/modified.txt\n' },
    ]
    const service = createService(fake)
    await service.refresh()

    expect(await service.diff('modified.txt')).toContain('diff --git')
    expect(await service.diff('staged.txt', true)).toContain('diff --git')
  })
})

describe('GitService environment', () => {
  it('runs git with fail-closed credential settings', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    await service.refresh()

    const statusCall = fake.calls.find((call) => call.args.includes('status'))
    expect(statusCall?.env?.GIT_ASKPASS).toBe('echo')
    expect(statusCall?.env?.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('emits snapshots to the registered listener on refresh', async () => {
    fake.script = repositoryScript()
    const service = createService(fake)
    const seen: string[] = []
    service.setStateListener((state) => seen.push(state.branch ?? 'null'))

    await service.refresh()
    expect(seen).toEqual(['main'])

    fake.script = [
      ...repositoryScript().filter((entry) => entry.match[0] !== 'symbolic-ref'),
      { match: ['symbolic-ref'], stdout: 'feature\n' },
    ]
    await service.handleWorkspaceChanged()
    expect(seen).toEqual(['main', 'feature'])
  })
})
