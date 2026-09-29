import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEngineCliSetupAdapters,
  REVIEWED_ENGINE_PACKAGES,
  type ReviewedEnginePackage,
} from '../src/main/capabilities/engine-cli-setup.js'
import {
  ND_CLAUDE_CODE_CAPABILITY_ID,
  ND_PI_CODING_CAPABILITY_ID,
  type CapabilityPackageSetupDescriptor,
} from '../src/shared/capabilities.js'

/**
 * The approved-package installer downloads the reviewed registry tarball,
 * re-checks its recorded sha256, and installs exactly that artifact with npm
 * into ND's own prefix. Every test here drives injected runners and
 * downloaders, so nothing touches the network or the user's npm global state.
 */
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'nd-dsh-engine-cli-setup-userdata') },
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const FIXTURE_BYTES = Buffer.from('nd-dsh reviewed engine tarball fixture\n')
const FIXTURE_INTEGRITY: `sha256-${string}` = `sha256-${createHash('sha256').update(FIXTURE_BYTES).digest('hex')}`

function fixturePackage(overrides: Partial<ReviewedEnginePackage> = {}): ReviewedEnginePackage {
  return {
    capabilityId: 'fixture-engine',
    name: 'Fixture Engine CLI',
    packageId: '@nd-dsh/fixture-engine',
    version: '9.9.9',
    integrity: FIXTURE_INTEGRITY,
    tarball: 'https://registry.npmjs.org/@nd-dsh/fixture-engine/-/fixture-engine-9.9.9.tgz',
    nodeRequirement: { major: 20, minor: 6 },
    bin: 'fixture-engine',
    ...overrides,
  }
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function artifactPath(binRoot: string, reviewed: ReviewedEnginePackage): string {
  return join(binRoot, `.reviewed-${reviewed.bin}-${reviewed.version}.tgz`)
}

/** npm links a `.cmd` shim beside the bare name on Windows; the adapter accepts either. */
async function fakeInstalledBin(binRoot: string, bin: string): Promise<void> {
  await Promise.all([writeFile(join(binRoot, `${bin}.cmd`), ''), writeFile(join(binRoot, bin), '')])
}

describe('engine CLI approved-package setup', () => {
  it('pins both npm-published engine CLIs to exact reviewed registry tarballs', async () => {
    const binRoot = await temporaryDirectory('nd-dsh-engine-cli-')
    const adapters = createEngineCliSetupAdapters({ binRoot })
    expect(Object.keys(adapters).sort()).toEqual([ND_CLAUDE_CODE_CAPABILITY_ID, ND_PI_CODING_CAPABILITY_ID].sort())
    expect(REVIEWED_ENGINE_PACKAGES.map((item) => item.capabilityId).sort()).toEqual([ND_CLAUDE_CODE_CAPABILITY_ID, ND_PI_CODING_CAPABILITY_ID].sort())

    for (const reviewed of REVIEWED_ENGINE_PACKAGES) {
      const descriptor = adapters[reviewed.capabilityId]!.descriptor as CapabilityPackageSetupDescriptor
      expect(descriptor).toMatchObject({
        mode: 'approved-package',
        sourceUrl: reviewed.tarball,
        packageId: reviewed.packageId,
        version: reviewed.version,
        integrity: reviewed.integrity,
        fields: [],
      })
      expect(new URL(descriptor.sourceUrl).protocol).toBe('https:')
      expect(reviewed.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(reviewed.integrity).toMatch(/^sha256-[0-9a-f]{64}$/)
      expect(reviewed.tarball.endsWith(`${reviewed.version}.tgz`)).toBe(true)
      expect(descriptor.prerequisites.length).toBeGreaterThan(0)
    }
  })

  it('gates on Node and npm prerequisites with the CLI\'s own version floor', async () => {
    const binRoot = await temporaryDirectory('nd-dsh-engine-cli-')
    const packages = [fixturePackage()]
    const unsatisfied = createEngineCliSetupAdapters({
      binRoot,
      packages,
      nodeVersion: 'v18.4.0',
      runCommand: async () => { throw new Error('not found') },
    })
    await expect(unsatisfied['fixture-engine']!.checkPrerequisites()).resolves.toMatchObject([
      { id: 'node', met: false, detail: 'v18.4.0' },
      { id: 'npm', met: false },
    ])

    const satisfied = createEngineCliSetupAdapters({
      binRoot,
      packages,
      nodeVersion: 'v24.10.0',
      runCommand: async () => '10.9.0\n',
    })
    await expect(satisfied['fixture-engine']!.checkPrerequisites()).resolves.toMatchObject([
      { id: 'node', met: true, detail: 'v24.10.0' },
      { id: 'npm', met: true, detail: '10.9.0' },
    ])
  })

  it('downloads the reviewed tarball, verifies its digest, and installs it into ND\'s own prefix', async () => {
    const binRoot = await temporaryDirectory('nd-dsh-engine-cli-')
    const reviewed = fixturePackage()
    const commands: Array<{ command: string; args: string[]; cwd: string }> = []
    const downloads: Array<{ url: string; target: string }> = []
    const adapters = createEngineCliSetupAdapters({
      binRoot,
      nodeVersion: 'v24.10.0',
      packages: [reviewed],
      downloadTarball: async (url, targetPath) => {
        downloads.push({ url, target: targetPath })
        await writeFile(targetPath, FIXTURE_BYTES)
        return FIXTURE_INTEGRITY
      },
      runCommand: async (command, args, cwd) => {
        commands.push({ command, args: [...args], cwd })
        if (args.includes('install')) await fakeInstalledBin(binRoot, reviewed.bin)
        return 'ok\n'
      },
    })

    const progress: Array<{ state: string; progress: number }> = []
    await expect(adapters[reviewed.capabilityId]!.install({}, async (report) => { progress.push(report) })).resolves.toEqual({
      installedVersion: reviewed.version,
      sourceUrl: reviewed.tarball,
      integrity: FIXTURE_INTEGRITY,
    })

    expect(downloads).toEqual([{ url: reviewed.tarball, target: artifactPath(binRoot, reviewed) }])
    expect(progress).toEqual([
      expect.objectContaining({ state: 'downloading', progress: 20 }),
      expect.objectContaining({ state: 'installing', progress: 60 }),
      expect.objectContaining({ state: 'configuring', progress: 90 }),
    ])
    const install = commands.find((entry) => entry.args.includes('install'))
    expect(install?.cwd).toBe(binRoot)
    const installArgs = install?.args ?? []
    expect(installArgs[installArgs.indexOf('--prefix') + 1]).toBe(binRoot)
    expect(installArgs).toContain('--global')
    expect(installArgs.at(-1)).toBe(artifactPath(binRoot, reviewed))
    expect(existsSync(artifactPath(binRoot, reviewed))).toBe(false)

    await expect(adapters[reviewed.capabilityId]!.verify()).resolves.toBeUndefined()
  })

  it('discards a download whose digest does not match the reviewed pin and never runs npm', async () => {
    const binRoot = await temporaryDirectory('nd-dsh-engine-cli-')
    const reviewed = fixturePackage()
    const commands: string[][] = []
    const adapters = createEngineCliSetupAdapters({
      binRoot,
      nodeVersion: 'v24.10.0',
      packages: [reviewed],
      downloadTarball: async (_url, targetPath) => {
        await writeFile(targetPath, Buffer.from('tampered bytes\n'))
        return `sha256-${'0'.repeat(64)}`
      },
      runCommand: async (_command, args) => {
        commands.push([...args])
        return 'ok\n'
      },
    })

    await expect(adapters[reviewed.capabilityId]!.install({}, async () => undefined)).rejects.toThrow(/integrity verification/)
    expect(commands).toEqual([])
    expect(existsSync(artifactPath(binRoot, reviewed))).toBe(false)
    await expect(adapters[reviewed.capabilityId]!.verify()).rejects.toThrow(/not installed/)
  })

  it('serializes installs that share ND\'s npm prefix', async () => {
    const binRoot = await temporaryDirectory('nd-dsh-engine-cli-')
    const packages = [
      fixturePackage(),
      fixturePackage({ capabilityId: 'fixture-second', bin: 'fixture-second' }),
    ]
    let activeDownloads = 0
    let maxActiveDownloads = 0
    const adapters = createEngineCliSetupAdapters({
      binRoot,
      nodeVersion: 'v24.10.0',
      packages,
      downloadTarball: async (_url, targetPath) => {
        activeDownloads += 1
        maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
        await writeFile(targetPath, FIXTURE_BYTES)
        activeDownloads -= 1
        return FIXTURE_INTEGRITY
      },
      runCommand: async (_command, args) => {
        if (args.includes('install')) {
          for (const reviewed of packages) await fakeInstalledBin(binRoot, reviewed.bin)
        }
        return 'ok\n'
      },
    })

    await Promise.all(packages.map((reviewed) => adapters[reviewed.capabilityId]!.install({}, async () => undefined)))
    expect(maxActiveDownloads).toBe(1)
  })
})
