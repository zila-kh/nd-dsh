/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Parser suites ported from microsoft/vscode extensions/git src/test/git.test.ts (MIT),
 *  adapted from mocha/assert to vitest for ND-DSH.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest'
import {
  GitCli,
  GitError,
  splitInChunks,
} from '../src/main/git/git-cli.js'

describe('splitInChunks', () => {
  it('splits arrays once the accumulated argv length would exceed the limit', () => {
    expect([...splitInChunks(['aa', 'bb', 'cc'], 5)]).toEqual([['aa', 'bb'], ['cc']])
    expect([...splitInChunks(['aaaaa', 'b'], 5)]).toEqual([['aaaaa'], ['b']])
    expect([...splitInChunks([], 10)]).toEqual([])
  })
})

describe('GitCli execution', () => {
  it('resolves stdout on exit code zero and trims repository roots', async () => {
    const cli = new GitCli({ gitPath: '/fake/git', core: fakeCore([{ match: ['rev-parse'], stdout: '/repo/root\n' }]) })
    expect(await cli.getRepositoryRoot('/somewhere')).toBe('/repo/root')
  })

  it('rejects with a typed GitError carrying the mapped error code', async () => {
    const cli = new GitCli({
      gitPath: '/fake/git',
      core: fakeCore([{ match: ['rev-parse'], exitCode: 128, stderr: 'fatal: Not a git repository (or any of the parent directories)' }]),
    })
    await expect(cli.getRepositoryRoot('/somewhere')).rejects.toMatchObject({
      exitCode: 128,
      gitErrorCode: 'NotAGitRepository',
    } satisfies Partial<GitError>)
  })

  it('routes status and history parsing through typed ND Core methods', async () => {
    const methods: string[] = []
    const cli = new GitCli({
      gitPath: '/fake/git',
      core: {
        request: async <T>(method: string): Promise<T> => {
          methods.push(method)
          if (method === 'git.status') {
            return {
              exitCode: 0,
              stderr: '',
              durationMs: 1,
              truncated: false,
              entries: [
                { x: 'M', y: ' ', path: 'src/app.ts' },
                { x: 'R', y: ' ', path: 'src/old.ts', rename: 'src/new.ts' },
              ],
            } as T
          }
          if (method === 'git.log') {
            return {
              exitCode: 0,
              stderr: '',
              durationMs: 2,
              truncated: false,
              commits: [{
                hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                message: 'Typed history',
                authorName: 'Jane Doe',
                authorEmail: 'jane@example.test',
                authorTimestamp: 1_700_000_000,
              }],
            } as T
          }
          throw new Error('Unexpected core method: ' + method)
        },
      },
    })

    expect(await cli.statusEntries('/repo')).toEqual([
      { x: 'M', y: ' ', path: 'src/app.ts' },
      { x: 'R', y: ' ', path: 'src/old.ts', rename: 'src/new.ts' },
    ])
    expect(await cli.logEntries('/repo', 50)).toEqual([{
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      message: 'Typed history',
      authorName: 'Jane Doe',
      authorEmail: 'jane@example.test',
      authorTimestamp: 1_700_000_000,
    }])
    expect(methods).toEqual(['git.status', 'git.log'])
  })

  it('suppresses credential prompts through the environment', async () => {
    let seenEnv: Record<string, string> | undefined
    const cli = new GitCli({
      gitPath: '/fake/git',
      core: {
        request: async <T>(_method: string, params: unknown): Promise<T> => {
          seenEnv = (params as { env: Record<string, string> }).env
          return { exitCode: 0, stdout: '', stderr: '', truncated: false } as T
        },
      },
    })
    await cli.exec('/repo', ['status'])
    expect(seenEnv?.GIT_ASKPASS).toBe('echo')
    expect(seenEnv?.GIT_TERMINAL_PROMPT).toBe('0')
    expect(seenEnv?.GIT_PAGER).toBe('cat')
  })
})

interface ScriptedResponse {
  /** Match when every entry appears in the argv passed to `git.exec`. */
  match: string[]
  exitCode?: number
  stdout?: string
  stderr?: string
}

function fakeCore(script: ScriptedResponse[]): ConstructorParameters<typeof GitCli>[0]['core'] {
  return {
    request: async <T>(_method: string, params: unknown): Promise<T> => {
      const { args } = params as { args: string[] }
      const response = script.find((candidate) => candidate.match.every((token) => args.includes(token))) ?? { match: [] }
      return { exitCode: response.exitCode ?? 0, stdout: response.stdout ?? '', stderr: response.stderr ?? '', truncated: false } as T
    },
  }
}
