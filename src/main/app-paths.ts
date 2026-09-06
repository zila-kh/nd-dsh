import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

function candidateProjectRoots(): string[] {
  const values = [
    process.env.ND_DSH_PROJECT_ROOT,
    app.isPackaged ? process.resourcesPath : undefined,
    app.getAppPath(),
    resolve(currentDirectory, '../../..'),
    process.cwd(),
  ]
  return values.filter((value): value is string => Boolean(value))
}

export function projectRoot(): string {
  for (const root of candidateProjectRoots()) {
    if (existsSync(join(root, 'package.json'))) return root
  }
  return app.getAppPath()
}

/** User-managed published DSH package installation owned by ND. */
export function managedHarnessRoot(): string {
  return resolve(process.env.ND_DSH_MANAGED_RUNTIME_ROOT ?? join(app.getPath('userData'), 'runtimes/dsh'))
}

export function harnessRoot(): string {
  if (process.env.ND_DSH_HARNESS_ROOT) return resolve(process.env.ND_DSH_HARNESS_ROOT)
  const publishedRuntimeCandidates = [
    managedHarnessRoot(),
    join(projectRoot(), '.nd-dsh/runtime/dsh'),
  ]
  for (const managed of publishedRuntimeCandidates) {
    if (existsSync(join(managed, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) return managed
  }
  return resolve(join(projectRoot(), 'vendor/deepseek-harness'))
}

/** The dsh CLI launcher bin: boots the `web` profile the desktop shells. */
export function harnessCliBinPath(): string {
  const root = harnessRoot()
  const sourceEntry = join(root, 'apps/cli/lib/bin.js')
  if (existsSync(sourceEntry)) return sourceEntry
  const deployedEntry = join(root, 'lib/bin.js')
  if (existsSync(deployedEntry)) return deployedEntry
  return join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
}

/** ND-DSH's patch overlay applied on top of the web profile. */
export function dshPatchPath(): string {
  return resolve(process.env.ND_DSH_PATCH ?? join(projectRoot(), 'configs/dsh/nd-dsh.patch.yml'))
}

/** Shipped ND-DSH agent presets (installed into the harness home at launch). */
export function presetSourceDir(): string {
  return resolve(process.env.ND_DSH_PRESET_DIR ?? join(projectRoot(), 'configs/dsh/agent-presets'))
}

interface CodexPackageManifest {
  bin?: { codex?: string }
}

/**
 * The pinned official Codex CLI wrapper shipped inside the vendored runtime.
 * Resolution mirrors the delegated adapter's package-local lookup so the
 * direct engine never depends on the host `PATH`. `ND_DSH_CODEX_BINARY`
 * remains a developer-only override.
 */
export function codexBinPath(): string | undefined {
  const override = process.env.ND_DSH_CODEX_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const root = harnessRoot()
  const sourceEntry = join(root, 'packages/subagent/subagent-codex/lib/index.js')
  const deployedEntry = join(root, 'node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js')
  const subagentEntry = existsSync(sourceEntry) ? sourceEntry : deployedEntry
  if (!existsSync(subagentEntry)) return undefined
  try {
    const requireFromSubagent = createRequire(subagentEntry)
    const manifestPath = requireFromSubagent.resolve('@openai/codex/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CodexPackageManifest
    const bin = manifest.bin?.codex
    if (!bin) return undefined
    const wrapper = resolve(dirname(manifestPath), bin)
    return existsSync(wrapper) ? wrapper : undefined
  } catch {
    return undefined
  }
}

/**
 * The Google Antigravity CLI binary. Antigravity is a user-installed
 * first-party product ND cannot redistribute, so discovery is the developer
 * override, then the official installer's documented per-OS location —
 * never a host `PATH` scan. `ND_DSH_ANTIGRAVITY_BINARY` remains a
 * developer-only override.
 */
export function antigravityBinPath(): string | undefined {
  const override = process.env.ND_DSH_ANTIGRAVITY_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const defaultLocations = process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA ?? '', 'agy', 'bin', 'agy.exe')]
    : [join(process.env.HOME ?? '', '.local', 'bin', 'agy')]
  return defaultLocations.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}

/**
 * The ZCode CLI entry script bundled inside the official ZCode desktop
 * installation. ZCode is a user-installed first-party product ND cannot
 * redistribute, so discovery is the developer override, then the official
 * installer's documented per-OS location — never a host `PATH` scan.
 * `ND_DSH_ZCODE_BINARY` remains a developer-only override. The entry is a
 * CommonJS bundle, so the engine runs it through the Electron Node runtime.
 */
export function zcodeBinPath(): string | undefined {
  const override = process.env.ND_DSH_ZCODE_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const defaultLocations = process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs')]
    : process.platform === 'darwin'
      ? ['/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs']
      : ['/opt/ZCode/resources/glm/zcode.cjs', '/usr/lib/zcode/resources/glm/zcode.cjs']
  return defaultLocations.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}

/**
 * The Claude Code CLI binary. Claude Code is a user-installed first-party
 * product ND cannot redistribute, so discovery is the developer override,
 * then the documented install locations (native installer and npm global
 * bin), never a host `PATH` scan. `ND_DSH_CLAUDE_BINARY` remains a
 * developer-only override.
 */
export function claudeBinPath(): string | undefined {
  const override = process.env.ND_DSH_CLAUDE_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : join(home, '.npm-global', 'bin')
  const defaultLocations = process.platform === 'win32'
    ? [
        join(home, '.local', 'bin', 'claude.exe'),
        join(npmBin, 'claude.cmd'),
        join(npmBin, 'claude'),
      ]
    : [join(home, '.local', 'bin', 'claude'), join(npmBin, 'claude')]
  return defaultLocations.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}

/**
 * The Cursor CLI binary (`cursor-agent`). Cursor is a user-installed
 * first-party product ND cannot redistribute, so discovery is the developer
 * override, then the documented install locations, never a host `PATH` scan.
 * `ND_DSH_CURSOR_BINARY` remains a developer-only override.
 */
export function cursorBinPath(): string | undefined {
  const override = process.env.ND_DSH_CURSOR_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : join(home, '.npm-global', 'bin')
  const defaultLocations = process.platform === 'win32'
    ? [
        join(home, '.local', 'bin', 'cursor-agent.exe'),
        join(home, '.local', 'bin', 'cursor-agent.cmd'),
        join(npmBin, 'cursor-agent.cmd'),
        join(npmBin, 'cursor-agent'),
      ]
    : [join(home, '.local', 'bin', 'cursor-agent'), '/usr/local/bin/cursor-agent', join(npmBin, 'cursor-agent')]
  return defaultLocations.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}

/**
 * The Pi coding agent CLI binary (`pi`, npm `@mariozechner/pi-coding-agent`
 * and compatible forks such as Oh My Pi). Pi ships through npm, so discovery
 * is the developer override, then the npm global bin locations, never a host
 * `PATH` scan. `ND_DSH_PI_BINARY` remains a developer-only override.
 */
export function piBinPath(): string | undefined {
  const override = process.env.ND_DSH_PI_BINARY
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : join(home, '.npm-global', 'bin')
  const defaultLocations = process.platform === 'win32'
    ? [join(npmBin, 'pi.cmd'), join(npmBin, 'pi'), join(home, '.local', 'bin', 'pi.exe'), join(home, '.local', 'bin', 'pi')]
    : [join(npmBin, 'pi'), join(home, '.local', 'bin', 'pi'), '/usr/local/bin/pi']
  return defaultLocations.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}
