#!/usr/bin/env node
/**
 * Validate nd.extension/1 packages with the exact rules the runtime installer
 * applies. The shared validator is transpiled in-process with the repository's
 * TypeScript dependency, so the CLI and the product cannot drift apart.
 *
 * Usage:
 *   node scripts/validate-nd-extension.mjs <package-dir|manifest.json> [...]
 *   node scripts/validate-nd-extension.mjs --builtins
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const sharedDir = join(projectRoot, 'src', 'shared')

/**
 * Bundle the shared validator with Vite — the same bundler and TS resolution
 * the app build uses — so this CLI executes the production validation rules
 * and never a second copy of them.
 */
async function loadSharedModules() {
  const outDir = await mkdtemp(join(tmpdir(), 'nd-ext-validate-'))
  const entry = join(outDir, 'entry.mjs')
  await writeFile(entry, [
    `export { validateNdExtensionManifest, manifestPermissionIssues } from ${JSON.stringify(join(sharedDir, 'extension-package.ts'))}`,
    `export { BUILTIN_EXTENSION_PACKAGES } from ${JSON.stringify(join(sharedDir, 'builtin-extension-packages.ts'))}`,
    '',
  ].join('\n'), 'utf8')
  const { build } = await import('vite')
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: true,
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'node20',
      rollupOptions: {
        input: { validate: entry },
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  })
  const bundle = await import(pathToFileURL(join(outDir, 'validate.mjs')).href)
  return { bundle, outDir }
}

function report(label, result, extensionPackage) {
  if (result.ok) {
    const manifest = result.manifest
    const permissionIssues = extensionPackage.manifestPermissionIssues(manifest)
    if (permissionIssues.length === 0) {
      const counts = manifest.contributions
      const total = counts.tools.length + counts.skills.length + counts.commands.length + counts.views.length + counts.workflows.length
      console.log(`PASS ${label} — ${manifest.id}@${manifest.version} (${total} contributions, contexts: ${manifest.contexts.join(', ')})`)
      return true
    }
    console.error(`FAIL ${label}`)
    for (const issue of permissionIssues) console.error(`  permissions: ${issue.message}`)
    return false
  }
  console.error(`FAIL ${label}`)
  for (const issue of result.issues) console.error(`  ${issue.path || 'manifest'}: ${issue.message}`)
  return false
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/validate-nd-extension.mjs <package-dir|manifest.json> [...] | --builtins')
  process.exit(2)
}

const { bundle, outDir } = await loadSharedModules()
let ok = true
try {
  if (args.includes('--builtins')) {
    for (const manifest of bundle.BUILTIN_EXTENSION_PACKAGES) {
      ok = report(manifest.id, bundle.validateNdExtensionManifest(manifest), bundle) && ok
    }
  }
  for (const target of args.filter((arg) => arg !== '--builtins')) {
    const manifestPath = target.endsWith('.json') ? resolve(target) : join(resolve(target), 'nd-extension.json')
    let parsed
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch (error) {
      console.error(`FAIL ${manifestPath}`)
      console.error(`  could not read manifest: ${error instanceof Error ? error.message : String(error)}`)
      ok = false
      continue
    }
    ok = report(manifestPath, bundle.validateNdExtensionManifest(parsed), bundle) && ok
  }
} finally {
  await rm(outDir, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
