/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Parser suites ported from microsoft/vscode extensions/git src/test/git.test.ts (MIT),
 *  adapted from mocha/assert to vitest for ND-DSH.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  GitCli,
  GitError,
  GitStatusParser,
  parseCoAuthors,
  parseGitCommits,
  parseGitRemotes,
  splitInChunks,
  type GitSpawnFunction,
} from '../src/main/git/git-cli.js'

describe('GitStatusParser', () => {
  it('empty parser', () => {
    const parser = new GitStatusParser()
    expect(parser.status).toEqual([])
  })

  it('empty parser 2', () => {
    const parser = new GitStatusParser()
    parser.update('')
    expect(parser.status).toEqual([])
  })

  it('simple', () => {
    const parser = new GitStatusParser()
    parser.update('?? file.txt\0')
    expect(parser.status).toEqual([
      { path: 'file.txt', rename: undefined, x: '?', y: '?' },
    ])
  })

  it('simple 2', () => {
    const parser = new GitStatusParser()
    parser.update('?? file.txt\0')
    parser.update('?? file2.txt\0')
    parser.update('?? file3.txt\0')
    expect(parser.status).toEqual([
      { path: 'file.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file2.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file3.txt', rename: undefined, x: '?', y: '?' },
    ])
  })

  it('empty lines', () => {
    const parser = new GitStatusParser()
    parser.update('')
    parser.update('?? file.txt\0')
    parser.update('')
    parser.update('')
    parser.update('?? file2.txt\0')
    parser.update('')
    parser.update('?? file3.txt\0')
    parser.update('')
    expect(parser.status).toEqual([
      { path: 'file.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file2.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file3.txt', rename: undefined, x: '?', y: '?' },
    ])
  })

  it('combined', () => {
    const parser = new GitStatusParser()
    parser.update('?? file.txt\0?? file2.txt\0?? file3.txt\0')
    expect(parser.status).toEqual([
      { path: 'file.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file2.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file3.txt', rename: undefined, x: '?', y: '?' },
    ])
  })

  it('split 1', () => {
    const parser = new GitStatusParser()
    parser.update('?? file.txt\0?? file2')
    parser.update('.txt\0?? file3.txt\0')
    expect(parser.status).toEqual([
      { path: 'file.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file2.txt', rename: undefined, x: '?', y: '?' },
      { path: 'file3.txt', rename: undefined, x: '?', y: '?' },
    ])
  })

  it('rename carries the original path', () => {
    // Upstream convention (extensions/git src/test/git.test.ts 'rename'):
    // for `R  NEW\0OLD\0` the parsed `rename` holds the NEW path and `path` the original.
    const parser = new GitStatusParser()
    parser.update('R  renamed.txt\0original.txt\0')
    expect(parser.status).toEqual([
      { path: 'original.txt', rename: 'renamed.txt', x: 'R', y: ' ' },
    ])
  })

  it('nested repository entries are skipped', () => {
    const parser = new GitStatusParser()
    parser.update('?? nested/\0')
    expect(parser.status).toEqual([])
  })
})

describe('parseGitCommits', () => {
  it('parses a commit in COMMIT_FORMAT order', () => {
    const sample = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Jane Doe',
      'jane@example.com',
      '1700000000',
      '1700000100',
      '',
      'main',
      'Initial commit',
      '\x00',
    ].join('\n')

    const commits = parseGitCommits(sample)
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      authorName: 'Jane Doe',
      authorEmail: 'jane@example.com',
      message: 'Initial commit',
      refNames: ['main'],
      parents: [],
    })
  })

  it('parses several NUL-separated commits', () => {
    const first = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nJane Doe\njane@example.com\n1700000000\n1700000000\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nmain\nFirst\n\x00'
    const second = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nJohn Roe\njohn@example.com\n1700000100\n1700000100\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\nSecond\n\x00'

    const commits = parseGitCommits(first + second)
    expect(commits.map((commit) => commit.message)).toEqual(['First', 'Second'])
    expect(commits[1]?.parents).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
  })
})

describe('parseCoAuthors', () => {
  it('finds co-author trailers', () => {
    const message = 'Done thing\n\nCo-authored-by: Jane Doe <jane@example.com>\nCo-authored-by: John Roe <john@example.com>'
    expect(parseCoAuthors(message)).toEqual([
      { name: 'Jane Doe', email: 'jane@example.com' },
      { name: 'John Roe', email: 'john@example.com' },
    ])
  })

  it('ignores malformed trailers', () => {
    expect(parseCoAuthors('Co-authored-by: just-a-name')).toEqual([])
  })
})

describe('parseGitRemotes', () => {
  it('parses remotes with push url fallback', () => {
    const config = [
      '[remote "origin"]',
      '\turl = https://example.com/repo.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '\tpushurl = https://push.example.com/repo.git',
      '[remote "upstream"]',
      '\turl = https://example.com/upstream.git',
      '',
    ].join('\n')

    expect(parseGitRemotes(config)).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/repo.git', pushUrl: 'https://push.example.com/repo.git', isReadOnly: false },
      { name: 'upstream', fetchUrl: 'https://example.com/upstream.git', pushUrl: 'https://example.com/upstream.git', isReadOnly: false },
    ])
  })
})

describe('splitInChunks', () => {
  it('splits arrays once the accumulated argv length would exceed the limit', () => {
    expect([...splitInChunks(['aa', 'bb', 'cc'], 5)]).toEqual([['aa', 'bb'], ['cc']])
    expect([...splitInChunks(['aaaaa', 'b'], 5)]).toEqual([['aaaaa'], ['b']])
    expect([...splitInChunks([], 10)]).toEqual([])
  })
})

describe('GitCli execution', () => {
  it('resolves stdout on exit code zero and trims repository roots', async () => {
    const cli = new GitCli({ gitPath: '/fake/git', spawnProcess: fakeSpawn([{ match: ['rev-parse'], stdout: '/repo/root\n' }]) })
    expect(await cli.getRepositoryRoot('/somewhere')).toBe('/repo/root')
  })

  it('rejects with a typed GitError carrying the mapped error code', async () => {
    const cli = new GitCli({
      gitPath: '/fake/git',
      spawnProcess: fakeSpawn([{ match: ['rev-parse'], exitCode: 128, stderr: 'fatal: Not a git repository (or any of the parent directories)' }]),
    })
    await expect(cli.getRepositoryRoot('/somewhere')).rejects.toMatchObject({
      exitCode: 128,
      gitErrorCode: 'NotAGitRepository',
    } satisfies Partial<GitError>)
  })

  it('suppresses credential prompts through the environment', async () => {
    let seenEnv: NodeJS.ProcessEnv | undefined
    const cli = new GitCli({
      gitPath: '/fake/git',
      spawnProcess: (_path, _args, options) => {
        seenEnv = options.env
        return immediateChild({ exitCode: 0, stdout: '', stderr: undefined })
      },
    })
    await cli.exec('/repo', ['status'])
    expect(seenEnv?.GIT_ASKPASS).toBe('echo')
    expect(seenEnv?.GIT_TERMINAL_PROMPT).toBe('0')
    expect(seenEnv?.GIT_PAGER).toBe('cat')
  })
})

interface ScriptedResponse {
  /** Match when every entry appears in the spawned argv (after the binary). */
  match: string[]
  exitCode?: number
  stdout?: string
  stderr?: string
}

function fakeSpawn(script: ScriptedResponse[]): GitSpawnFunction {
  return (_path, args) => {
    const response = script.find((candidate) => candidate.match.every((token) => args.includes(token)))
      ?? { match: [] }
    return immediateChild({ exitCode: response.exitCode, stdout: response.stdout, stderr: response.stderr })
  }
}
function immediateChild(result: { exitCode: number | undefined; stdout: string | undefined; stderr: string | undefined }): import('node:child_process').ChildProcess {
  const emitter = new EventEmitter()
  const child = emitter as unknown as Record<string, unknown>
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  child.stdout = stdout
  child.stderr = stderr
  child.stdin = new PassThrough()
  process.nextTick(() => {
    if (result.stderr !== undefined) stderr.write(result.stderr)
    if (result.stdout !== undefined) stdout.write(result.stdout)
    stdout.end()
    stderr.end()
    emitter.emit('exit', result.exitCode ?? 0, null)
  })
  return child as unknown as import('node:child_process').ChildProcess
}
