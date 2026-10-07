/**
 * Smoke test for the ND YouTube Mini scaffold package.
 *
 * Runs under `npm run verify` / `node --test` with zero dependencies. The
 * assertions are written independently of `scripts/nd-contract.mjs` on purpose:
 * this file is the executable specification of what the package must declare,
 * so a bug in the shared contract module cannot hide a manifest regression.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readText = (relativePath) => readFile(join(root, relativePath), 'utf8')
const readJson = async (relativePath) => JSON.parse(await readText(relativePath))

const manifest = await readJson('nd-extension.json')
const pkg = await readJson('package.json')

/** Host methods this package is allowed to use, mapped to the permission ND requires. */
const HOST_PERMISSIONS = {
  'browser.openUrl': 'browser.navigate',
  'note.create': 'notes.write',
  'note.search': 'notes.read',
  'note.open': 'notes.read',
}
const CONTEXTS = ['personal', 'company', 'project']
const CONTRIBUTION_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/

test('manifest declares the nd.extension/1 identity for nd.youtube-mini', () => {
  assert.equal(manifest.protocol, 'nd.extension/1')
  assert.equal(manifest.apiVersion, 1)
  assert.equal(manifest.id, 'nd.youtube-mini')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.ok(manifest.name.trim().length > 0, 'name is required')
  assert.ok(manifest.description.trim().length > 0, 'description is required')
  assert.deepEqual(manifest.contexts.slice().sort(), ['company', 'personal', 'project'])
  assert.ok(Array.isArray(manifest.permissions), 'permissions must be declared')
  assert.equal('executable' in manifest, false, 'a declarative package ships no executable')
})

test('command and view contributions are declared and linked', () => {
  const commands = manifest.contributions.commands
  const views = manifest.contributions.views
  assert.ok(Array.isArray(commands) && commands.length >= 1, 'at least one command is required')
  assert.ok(Array.isArray(views) && views.length >= 1, 'at least one view is required')
  for (const [index, command] of commands.entries()) {
    assert.ok(command.id && command.title && command.host, `command[${index}] needs id, title, host`)
    if (command.openViewId !== undefined) {
      assert.ok(
        views.some((view) => view.id === command.openViewId),
        `command ${command.id} openViewId must name a view in this package`,
      )
    }
  }
  for (const [index, view] of views.entries()) {
    assert.ok(view.id && view.title && view.host, `view[${index}] needs id, title, host`)
    assert.ok(view.itemTitleKey, `view[${index}] needs itemTitleKey`)
    assert.ok(view.kind === 'list' || view.kind === 'detail', `view[${index}] kind must be list or detail`)
    assert.ok(Array.isArray(view.actions), `view[${index}] actions must be an array`)
  }
  assert.ok(
    commands.some((command) => command.openViewId !== undefined),
    'the launcher command must open the package view',
  )
})

test('contribution ids are well formed and unique package-wide', () => {
  const ids = [
    ...manifest.contributions.commands.map((command) => command.id),
    ...manifest.contributions.views.map((view) => view.id),
    ...manifest.contributions.views.flatMap((view) => view.actions.map((action) => action.id)),
  ]
  for (const id of ids) assert.match(id, CONTRIBUTION_ID)
  assert.equal(new Set(ids).size, ids.length, `contribution ids must be unique: ${ids.join(', ')}`)
})

test('every referenced host is allowlisted and its permission is declared', () => {
  const permissions = new Set(manifest.permissions)
  const hosts = [
    ...manifest.contributions.commands.map((command) => command.host),
    ...manifest.contributions.views.map((view) => view.host),
    ...manifest.contributions.views.flatMap((view) => view.actions.map((action) => action.host)),
  ]
  for (const host of hosts) {
    const permission = HOST_PERMISSIONS[host]
    assert.ok(permission, `host "${host}" is not in this package's allowlist`)
    assert.ok(permissions.has(permission), `contributions require the "${permission}" permission`)
  }
})

test('contexts are valid and no contribution widens the package contexts', () => {
  const packageContexts = manifest.contexts
  for (const kind of packageContexts) assert.ok(CONTEXTS.includes(kind), `unknown context: ${kind}`)
  const contributions = [
    ...manifest.contributions.commands,
    ...manifest.contributions.views,
  ]
  for (const contribution of contributions) {
    assert.ok(Array.isArray(contribution.contexts), `${contribution.id} must declare contexts explicitly`)
    for (const kind of contribution.contexts) {
      assert.ok(packageContexts.includes(kind), `${contribution.id} widens package context: ${kind}`)
    }
  }
  // View actions carry no contexts of their own; they inherit the view's.
  for (const view of manifest.contributions.views) {
    for (const action of view.actions) {
      assert.equal('contexts' in action, false, `${action.id} must not declare its own contexts`)
    }
  }
})

test('package.json exposes the verification chain', () => {
  for (const name of ['verify', 'typecheck', 'test', 'build']) {
    assert.equal(typeof pkg.scripts[name], 'string', `missing "${name}" script`)
    assert.ok(pkg.scripts[name].trim().length > 0, `"${name}" script must not be empty`)
  }
  const verify = pkg.scripts.verify
  assert.match(verify, /typecheck/)
  assert.match(verify, /--test/)
  assert.match(verify, /build/)
  assert.match(pkg.scripts.test, /node --test/)
  assert.equal(pkg.private, true, 'the package must stay private')
  assert.equal(pkg.type, 'module', 'scripts are ES modules')
})

test('no credential or secret values appear in any shipped file', async () => {
  const shapes = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bghp_[A-Za-z0-9]{20,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    /\bglpat-[A-Za-z0-9_-]{16,}/,
    /\bnpm_[A-Za-z0-9]{30,}/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    /(?:api[_-]?key|secret|password|passwd|credential|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  ]
  const textSuffixes = new Set(['.json', '.mjs', '.md', '.js', '.ts', '.txt'])
  const textNames = new Set(['.gitignore'])
  const skip = new Set(['node_modules', '.git'])
  const findings = []

  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const isText = textSuffixes.has(entry.name.toLowerCase()) || textNames.has(entry.name)
      if (!isText) continue
      const relative = full.slice(root.length + 1).replaceAll('\\', '/')
      const text = await readFile(full, 'utf8')
      for (const shape of shapes) {
        if (shape.test(text)) findings.push(`${relative} matches ${String(shape)}`)
      }
    }
  }
  await walk(root)
  assert.deepEqual(findings, [], `credential-shaped content found:\n${findings.join('\n')}`)
})
