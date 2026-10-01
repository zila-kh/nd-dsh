import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronTargetIdentity, payloadFiles } from './e2e-electron-target.mjs'
import { releaseArtifact } from './release-artifact.mjs'

/** Launchable app bytes come directly from this portable, never from win-unpacked. */
export async function prepareReleaseTarget(root, outputDir, configured) {
  const portable = releaseArtifact(root, configured)
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
  const { getPath7za } = builderRequire('app-builder-lib/out/toolsets/7zip.js')
  // The ND launcher embeds one 7z archive without outer NSIS compression;
  // the builder's bundled extractor reads it directly from the executable.
  const configuredExtractor = process.env.ND_DSH_RELEASE_7ZIP?.trim()
  if (configuredExtractor && !existsSync(configuredExtractor)) throw new Error('Configured release 7-Zip executable does not exist.')
  const extractor = configuredExtractor || await getPath7za()
  await mkdir(outputDir, { recursive: true })
  const payloadRoot = await mkdtemp(join(outputDir, 'portable-payload-'))
  const extraction = spawnSync(extractor, ['x', '-y', '-bd', '-bso0', '-bsp0', `-o${payloadRoot}`, portable.executable], {
    encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024,
  })
  if (extraction.status !== 0) throw new Error('Could not extract the exact portable archive. ' + (extraction.stderr || extraction.error?.message || extraction.status))
  const executable = join(payloadRoot, 'ND-DSH.exe')
  const files = payloadFiles(payloadRoot)
  const receipt = join(outputDir, 'portable-extraction.json')
  const proof = { schemaVersion: 1, kind: 'nd-portable-extraction', portable, executable, payloadRoot,
    files, payloadSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') }
  await writeFile(receipt, JSON.stringify(proof, null, 2) + '\n')
  const env = { ND_DSH_E2E_EXECUTABLE: executable, ND_DSH_E2E_PACKAGE_RECEIPT: receipt }
  return { env, target: electronTargetIdentity(env) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = await prepareReleaseTarget(root, join(root, 'e2e-results', `packaged-target-${Date.now()}`), process.argv[2])
  console.log(JSON.stringify(result, null, 2))
}
