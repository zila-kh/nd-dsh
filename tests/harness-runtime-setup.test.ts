import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ND_CODEX_CLI_CAPABILITY_ID,
  ND_CODEX_DELEGATED_CAPABILITY_ID,
  ND_HARNESS_CAPABILITY_ID,
  ND_MEMORY_MCP_ID,
  ND_SESSION_RECALL_ID,
} from '../src/shared/capabilities.js'
import { createHarnessSourceSetupAdapters } from '../src/main/capabilities/harness-runtime-setup.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Harness runtime setup adapters', () => {
  it('builds the fixed source runtime and verifies every engine payload', async () => {
    const directory = await harnessFixture()
    const commands: string[][] = []
    const runCommand = async (_command: string, args: readonly string[]): Promise<string> => {
      commands.push([...args])
      if (args[0] === '--version') return '0.34.2\n'
      if (args.join(' ') === 'pnpm run build:lib:host') {
        await mkdir(join(directory, 'apps/cli/lib'), { recursive: true })
        await mkdir(join(directory, 'packages/subagent/subagent-codex/lib'), { recursive: true })
        await writeFile(join(directory, 'apps/cli/lib/bin.js'), 'export {}\n')
        await writeFile(join(directory, 'packages/subagent/subagent-codex/lib/index.js'), 'export {}\n')
      }
      return 'ok\n'
    }
    const configured = createHarnessSourceSetupAdapters({ harnessDirectory: directory, nodeVersion: 'v24.10.0', runCommand })
    expect(Object.keys(configured).sort()).toEqual([
      ND_CODEX_CLI_CAPABILITY_ID,
      ND_CODEX_DELEGATED_CAPABILITY_ID,
      ND_HARNESS_CAPABILITY_ID,
      ND_MEMORY_MCP_ID,
      ND_SESSION_RECALL_ID,
    ].sort())
    const adapter = configured[ND_CODEX_DELEGATED_CAPABILITY_ID]!
    expect(adapter.descriptor).toMatchObject({ mode: 'source-runtime', version: '0.2.0-test' })
    await expect(adapter.checkPrerequisites()).resolves.toMatchObject([
      { id: 'node', met: true },
      { id: 'corepack', met: true },
      { id: 'harness-source', met: true },
    ])

    const reports: Array<{ state: string; progress: number }> = []
    await expect(adapter.install({}, async (progress) => { reports.push(progress) })).resolves.toEqual({ installedVersion: '0.2.0-test' })
    expect(commands).toContainEqual(['pnpm', 'install', '--frozen-lockfile'])
    expect(commands).toContainEqual(['pnpm', 'run', 'build:lib:host'])
    expect(reports).toEqual([
      expect.objectContaining({ state: 'installing', progress: 10 }),
      expect.objectContaining({ state: 'installing', progress: 55 }),
      expect.objectContaining({ state: 'configuring', progress: 90 }),
    ])
    await expect(Promise.all(Object.values(configured).map((item) => item.verify()))).resolves.toBeDefined()
  })

  it('reports missing Node and Corepack prerequisites without starting setup', async () => {
    const directory = await harnessFixture()
    const adapters = createHarnessSourceSetupAdapters({
      harnessDirectory: directory,
      nodeVersion: 'v22.0.0',
      runCommand: async () => { throw new Error('not found') },
    })
    await expect(adapters[ND_HARNESS_CAPABILITY_ID]!.checkPrerequisites()).resolves.toMatchObject([
      { id: 'node', met: false },
      { id: 'corepack', met: false },
      { id: 'harness-source', met: true },
    ])
  })

  it('does not advertise setup when the source checkout is incomplete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nd-dsh-empty-harness-'))
    temporaryDirectories.push(directory)
    expect(createHarnessSourceSetupAdapters({ harnessDirectory: directory })).toEqual({})
  })
})

async function harnessFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nd-dsh-harness-setup-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.2.0-test' }))
  await writeFile(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return directory
}
