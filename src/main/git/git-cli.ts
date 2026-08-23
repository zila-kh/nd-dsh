/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Derived from microsoft/vscode extensions/git (MIT), pinned in vendor/vscode-git.json.
 *  Adapted for ND-DSH: VS Code API dependencies removed, ND house style applied.
 *--------------------------------------------------------------------------------------------*/

import { spawn as processSpawn, type ChildProcess } from 'node:child_process'

export const GitErrorCodes = {
  BadConfigFile: 'BadConfigFile',
  AuthenticationFailed: 'AuthenticationFailed',
  NotAGitRepository: 'NotAGitRepository',
  CantCreatePipe: 'CantCreatePipe',
  RepositoryNotFound: 'RepositoryNotFound',
  CantAccessRemote: 'CantAccessRemote',
  BranchNotFullyMerged: 'BranchNotFullyMerged',
  NoRemoteReference: 'NoRemoteReference',
  BranchAlreadyExists: 'BranchAlreadyExists',
  InvalidBranchName: 'InvalidBranchName',
  DirtyWorkTree: 'DirtyWorkTree',
  NotASafeGitRepository: 'NotASafeGitRepository',
  WorktreeContainsChanges: 'WorktreeContainsChanges',
  WorktreeAlreadyExists: 'WorktreeAlreadyExists',
  WorktreeBranchAlreadyUsed: 'WorktreeBranchAlreadyUsed',
  RepositoryIsLocked: 'RepositoryIsLocked',
  NoStagedChanges: 'NoStagedChanges',
  NoUnstagedChanges: 'NoUnstagedChanges',
} as const

export interface IGitErrorData {
  error?: Error | undefined
  message?: string | undefined
  stdout?: string | undefined
  stderr?: string | undefined
  exitCode?: number | undefined
  gitErrorCode?: string | undefined
  gitCommand?: string | undefined
  gitArgs?: string[] | undefined
}

export class GitError extends Error {
  error: Error | undefined
  stdout: string | undefined
  stderr: string | undefined
  exitCode: number | undefined
  gitErrorCode: string | undefined
  gitCommand: string | undefined
  gitArgs: string[] | undefined

  constructor(data: IGitErrorData) {
    super(data.error?.message || data.message || 'Git error')

    this.error = data.error
    this.stdout = data.stdout
    this.stderr = data.stderr
    this.exitCode = data.exitCode
    this.gitErrorCode = data.gitErrorCode
    this.gitCommand = data.gitCommand
    this.gitArgs = data.gitArgs
  }

  override toString(): string {
    let result = this.message + ' ' + JSON.stringify({
      exitCode: this.exitCode,
      gitErrorCode: this.gitErrorCode,
      gitCommand: this.gitCommand,
      stdout: this.stdout,
      stderr: this.stderr,
    }, null, 2)

    if (this.error?.stack) {
      result += this.error.stack
    }

    return result
  }
}

export function getGitErrorCode(stderr: string): string | undefined {
  if (/Another git process seems to be running in this repository|If no other git process is currently running/.test(stderr)) {
    return GitErrorCodes.RepositoryIsLocked
  } else if (/Authentication failed/i.test(stderr)) {
    return GitErrorCodes.AuthenticationFailed
  } else if (/Not a git repository/i.test(stderr)) {
    return GitErrorCodes.NotAGitRepository
  } else if (/bad config file/.test(stderr)) {
    return GitErrorCodes.BadConfigFile
  } else if (/cannot make pipe for command substitution|cannot create standard input pipe/.test(stderr)) {
    return GitErrorCodes.CantCreatePipe
  } else if (/Repository not found/.test(stderr)) {
    return GitErrorCodes.RepositoryNotFound
  } else if (/unable to access/.test(stderr)) {
    return GitErrorCodes.CantAccessRemote
  } else if (/branch '.+' is not fully merged/.test(stderr)) {
    return GitErrorCodes.BranchNotFullyMerged
  } else if (/Couldn\'t find remote ref/.test(stderr)) {
    return GitErrorCodes.NoRemoteReference
  } else if (/A branch named '.+' already exists/.test(stderr)) {
    return GitErrorCodes.BranchAlreadyExists
  } else if (/'.+' is not a valid branch name/.test(stderr)) {
    return GitErrorCodes.InvalidBranchName
  } else if (/Please,? commit your changes or stash them/.test(stderr)) {
    return GitErrorCodes.DirtyWorkTree
  } else if (/detected dubious ownership in repository at/.test(stderr)) {
    return GitErrorCodes.NotASafeGitRepository
  } else if (/contains modified or untracked files|use --force to delete it/.test(stderr)) {
    return GitErrorCodes.WorktreeContainsChanges
  } else if (/fatal: '[^']+' already exists/.test(stderr)) {
    return GitErrorCodes.WorktreeAlreadyExists
  } else if (/is already used by worktree at/.test(stderr)) {
    return GitErrorCodes.WorktreeBranchAlreadyUsed
  }
  return undefined
}

// https://github.com/microsoft/vscode/issues/89373
// https://github.com/git-for-windows/git/issues/2478
function sanitizePath(path: string): string {
  return path.replace(/^([a-z]):\\/i, (_, letter) => `${letter.toUpperCase()}:\\`)
}

export function sanitizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Longest argv length git accepts before paths must be split into chunks (upstream MAX_CLI_LENGTH). */
export const MAX_CLI_LENGTH = 30000

export function* splitInChunks(array: string[], maxChunkLength: number): IterableIterator<string[]> {
  let current: string[] = []
  let length = 0

  for (const value of array) {
    let newLength = length + value.length

    if (newLength > maxChunkLength && current.length > 0) {
      yield current
      current = []
      newLength = value.length
    }

    current.push(value)
    length = newLength
  }

  if (current.length > 0) {
    yield current
  }
}

export interface CoAuthor {
  readonly name: string
  readonly email: string
}

export interface CommitShortStat {
  readonly files: number
  readonly insertions: number
  readonly deletions: number
}

export interface Commit {
  hash: string
  message: string
  parents: string[]
  authorDate?: Date | undefined
  authorName?: string | undefined
  authorEmail?: string | undefined
  commitDate?: Date | undefined
  refNames: string[]
  shortStat?: CommitShortStat | undefined
  coAuthors?: CoAuthor[] | undefined
}

const COMMIT_FORMAT = '%H%n%aN%n%aE%n%at%n%ct%n%P%n%D%n%B'

const commitRegex = /([0-9a-f]{40})\n(.*)\n(.*)\n(.*)\n(.*)\n(.*)\n(.*)(?:\n([^]*?))?(?:\x00)(?:\n((?:.*)files? changed(?:.*))$)?/gm

export function parseGitCommits(data: string): Commit[] {
  const commits: Commit[] = []

  let ref
  let authorName
  let authorEmail
  let authorDate
  let commitDate
  let parents
  let refNames
  let message
  let shortStat
  let match

  do {
    match = commitRegex.exec(data)
    if (match === null) {
      break
    }

    [, ref, authorName, authorEmail, authorDate, commitDate, parents, refNames, message, shortStat] = match

    if (ref === undefined || refNames === undefined || message === undefined) {
      break
    }

    if (message[message.length - 1] === '\n') {
      message = message.substr(0, message.length - 1)
    }

    // Stop excessive memory usage by using substr -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
    commits.push({
      hash: ` ${ref}`.substr(1),
      message: ` ${message}`.substr(1),
      parents: parents ? parents.split(' ') : [],
      authorDate: new Date(Number(authorDate) * 1000),
      authorName: ` ${authorName}`.substr(1),
      authorEmail: ` ${authorEmail}`.substr(1),
      commitDate: new Date(Number(commitDate) * 1000),
      refNames: refNames.split(',').map(s => s.trim()),
      shortStat: shortStat ? parseGitDiffShortStat(shortStat) : undefined,
      coAuthors: parseCoAuthors(message),
    })
  } while (true)

  return commits
}

const coAuthorRegex = /^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim

export function parseCoAuthors(message: string): CoAuthor[] {
  const coAuthors: CoAuthor[] = []
  let match

  coAuthorRegex.lastIndex = 0
  while ((match = coAuthorRegex.exec(message)) !== null) {
    const name = match[1]?.trim()
    const email = match[2]?.trim()
    if (name && email) {
      coAuthors.push({ name, email })
    }
  }

  return coAuthors
}

const diffShortStatRegex = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

function parseGitDiffShortStat(data: string): CommitShortStat {
  const matches = data.trim().match(diffShortStatRegex)

  if (!matches) {
    return { files: 0, insertions: 0, deletions: 0 }
  }

  const [, files, insertions = undefined, deletions = undefined] = matches
  return { files: parseInt(files ?? '0'), insertions: parseInt(insertions ?? '0'), deletions: parseInt(deletions ?? '0') }
}

export interface IFileStatus {
  x: string
  y: string
  path: string
  rename: string | undefined
}

export class GitStatusParser {
  private lastRaw = ''
  private result: IFileStatus[] = []

  get status(): IFileStatus[] {
    return this.result
  }

  update(raw: string): void {
    let i = 0
    let nextI: number | undefined

    raw = this.lastRaw + raw

    while ((nextI = this.parseEntry(raw, i)) !== undefined) {
      i = nextI
    }

    this.lastRaw = raw.substr(i)
  }

  private parseEntry(raw: string, i: number): number | undefined {
    if (i + 4 >= raw.length) {
      return
    }

    let lastIndex: number
    const entry: IFileStatus = {
      x: raw.charAt(i++),
      y: raw.charAt(i++),
      rename: undefined,
      path: '',
    }

    // space
    i++

    if (entry.x === 'R' || entry.y === 'R' || entry.x === 'C') {
      lastIndex = raw.indexOf('\0', i)

      if (lastIndex === -1) {
        return
      }

      entry.rename = raw.substring(i, lastIndex)
      i = lastIndex + 1
    }

    lastIndex = raw.indexOf('\0', i)

    if (lastIndex === -1) {
      return
    }

    entry.path = raw.substring(i, lastIndex)

    // If path ends with slash, it must be a nested git repo
    if (entry.path[entry.path.length - 1] !== '/') {
      this.result.push(entry)
    }

    return lastIndex + 1
  }
}

interface GitConfigSection {
  name: string
  subSectionName?: string | undefined
  properties: { [key: string]: string }
}

class GitConfigParser {
  private static readonly _lineSeparator = /\r?\n/

  private static readonly _propertyRegex = /^\s*(\w+)\s*=\s*"?([^"]+)"?$/
  private static readonly _sectionRegex = /^\s*\[\s*([^\]]+?)\s*("([^"]+)")?\]\s*$/

  static parse(raw: string): GitConfigSection[] {
    const config: { sections: GitConfigSection[] } = { sections: [] }
    let section: GitConfigSection = { name: 'DEFAULT', properties: {} }

    const addSection = (section?: GitConfigSection) => {
      if (!section) { return }
      config.sections.push(section)
    }

    for (const line of raw.split(GitConfigParser._lineSeparator)) {
      // Section
      const sectionName = line.match(GitConfigParser._sectionRegex)
      if (sectionName?.length === 4 && sectionName[1] !== undefined) {
        addSection(section)
        section = { name: sectionName[1], subSectionName: sectionName[3], properties: {} }

        continue
      }

      // Property
      const propertyMatch = line.match(GitConfigParser._propertyRegex)
      const propertyKey = propertyMatch?.[1]
      const propertyValue = propertyMatch?.[2]
      if (propertyKey !== undefined && propertyValue !== undefined && !Object.keys(section.properties).includes(propertyKey)) {
        section.properties[propertyKey] = propertyValue
      }
    }

    addSection(section)

    return config.sections
  }
}

export function parseGitmodules(raw: string): Submodule[] {
  const result: Submodule[] = []

  for (const submoduleSection of GitConfigParser.parse(raw).filter(s => s.name === 'submodule')) {
    const path = submoduleSection.properties['path']
    const url = submoduleSection.properties['url']
    if (submoduleSection.subSectionName && path !== undefined && url !== undefined) {
      result.push({
        name: submoduleSection.subSectionName,
        path,
        url,
      })
    }
  }

  return result
}

export interface Submodule {
  name: string
  path: string
  url: string
}

export interface MutableRemote {
  name: string
  fetchUrl: string
  pushUrl: string
  isReadOnly: boolean
}

export function parseGitRemotes(raw: string): MutableRemote[] {
  const remotes: MutableRemote[] = []

  for (const remoteSection of GitConfigParser.parse(raw).filter(s => s.name === 'remote')) {
    const url = remoteSection.subSectionName ? remoteSection.properties['url'] : undefined
    if (remoteSection.subSectionName && url !== undefined) {
      remotes.push({
        name: remoteSection.subSectionName,
        fetchUrl: url,
        pushUrl: remoteSection.properties['pushurl'] ?? url,
        isReadOnly: false,
      })
    }
  }

  return remotes
}

export interface GitExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GitExecOptions {
  input?: string
  env?: Record<string, string>
}

/**
 * Narrow injection seam for spawning the git binary. Intentionally looser than
 * node's overloaded `spawn` so tests can substitute scripted children.
 */
export type GitSpawnFunction = (
  gitPath: string,
  args: string[],
  options: GitProcessSpawnOptions,
) => ChildProcess

export interface GitProcessSpawnOptions {
  stdio: ['pipe', 'pipe', 'pipe']
  env: NodeJS.ProcessEnv
  windowsHide: boolean
  cwd?: string
}

export interface GitCliOptions {
  /** Absolute path or binary name; defaults to ND_DSH_GIT_BINARY or `git` on PATH. */
  gitPath?: string
  env?: Record<string, string>
  spawnProcess?: GitSpawnFunction
  onOutput?(output: string): void
}

export class GitCli {
  readonly path: string
  private readonly extraEnv: Record<string, string>
  private readonly spawnProcess: GitSpawnFunction
  private readonly onOutput: ((output: string) => void) | undefined

  constructor(options: GitCliOptions = {}) {
    this.path = options.gitPath ?? process.env.ND_DSH_GIT_BINARY ?? 'git'
    this.spawnProcess = options.spawnProcess ?? processSpawn
    this.onOutput = options.onOutput
    this.extraEnv = {
      LANGUAGE: 'en',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
      GIT_PAGER: 'cat',
      // Fail closed instead of hanging on credential prompts; upstream spawns an
      // askpass helper process, ND surfaces the authentication error instead.
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      SSH_ASKPASS: 'echo',
      ...options.env,
    }
  }

  async getRepositoryRoot(pathInsidePossibleRepository: string): Promise<string> {
    const result = await this.exec(pathInsidePossibleRepository, ['rev-parse', '--show-toplevel'])
    return result.stdout.trim()
  }

  async exec(cwd: string, args: string[], options: GitExecOptions = {}): Promise<GitExecutionResult> {
    const startedAt = Date.now()
    const child = this.spawn(args, cwd, options.env)

    if (options.input !== undefined) {
      child.stdin?.end(options.input, 'utf8')
    } else {
      child.stdin?.end()
    }

    const buffered = await this.buffer(child)

    if (this.onOutput) {
      this.onOutput(`> git ${args.join(' ')} [${Date.now() - startedAt}ms]\n`)
      if (buffered.stderr.length > 0) this.onOutput(`${buffered.stderr}\n`)
    }

    if (buffered.exitCode !== 0) {
      throw new GitError({
        message: 'Failed to execute git',
        stdout: buffered.stdout,
        stderr: buffered.stderr,
        exitCode: buffered.exitCode,
        gitErrorCode: getGitErrorCode(buffered.stderr),
        gitCommand: args[0],
        gitArgs: args.slice(1),
      })
    }

    return buffered
  }

  status(cwd: string): Promise<GitExecutionResult> {
    return this.exec(cwd, ['status', '-z', '-uall'], { env: { GIT_OPTIONAL_LOCKS: '0' } })
  }

  log(cwd: string, limit: number): Promise<GitExecutionResult> {
    return this.exec(cwd, ['log', `-n${limit}`, `--format=${COMMIT_FORMAT}`])
  }

  private spawn(args: string[], cwd: string | undefined, envOverride?: Record<string, string>): ChildProcess {
    if (!this.path) {
      throw new Error('git could not be found in the system.')
    }

    const spawnOptions: GitProcessSpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.extraEnv, ...envOverride },
      windowsHide: true,
    }
    if (cwd) spawnOptions.cwd = sanitizePath(cwd)

    return this.spawnProcess(this.path, args, spawnOptions)
  }

  private buffer(child: ChildProcess): Promise<GitExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', reject)
      child.on('exit', (exitCode) => {
        resolve({
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      })
    })
  }
}
