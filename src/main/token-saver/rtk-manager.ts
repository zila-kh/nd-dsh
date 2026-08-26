import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import type { TokenSaverInstallerState } from '../../shared/token-saver.js'

const RTK_VERSION = '0.42.4'
const RTK_RELEASE_BASE = `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}`
const PROCESS_TIMEOUT_MS = 120_000

interface RtkAsset {
  name: string
  sha256: string
  archive: 'tar.gz' | 'zip'
}

interface ConfigBackupEntry {
  path: string
  existed: boolean
  contentBase64?: string
  managedHash?: string
}

interface CodexBackupState {
  version: 1
  enabled: boolean
  entries: ConfigBackupEntry[]
}

/**
 * App-owned installer for the optional external-app optimizer.
 *
 * ND downloads a pinned RTK release directly from the upstream GitHub release,
 * validates the published SHA-256 digest, disables RTK telemetry, and invokes
 * its idempotent global Codex setup/uninstall commands. The user never needs a shell.
 */
export class RtkManager {
  private readonly installDir: string
  private readonly downloadDir: string
  private readonly backupPath: string

  constructor(private readonly rootDir: string) {
    this.installDir = join(rootDir, 'rtk', `v${RTK_VERSION}`)
    this.downloadDir = join(rootDir, 'downloads')
    this.backupPath = join(rootDir, 'backups', 'codex.json')
  }

  state(): TokenSaverInstallerState {
    const asset = platformAsset()
    const installed = existsSync(this.binaryPath())
    const backup = this.readBackup()
    return {
      supported: asset !== undefined,
      installed,
      ...(installed ? { version: RTK_VERSION } : {}),
      codexManaged: backup?.enabled === true,
      detail: asset
        ? installed
          ? `External helper ${RTK_VERSION} is managed by ND.`
          : 'External helper installs automatically when an external app is enabled.'
        : 'External app optimization is not available for this operating system/CPU yet.',
    }
  }

  async enableCodex(): Promise<void> {
    const binary = await this.ensureInstalled()
    let backup = this.readBackup()
    if (!backup?.enabled) backup = this.captureCodexBackup()
    try {
      // RTK's Codex mode manages ~/.codex/AGENTS.md + RTK.md. It is already
      // non-interactive; --auto-patch is intentionally invalid for --codex.
      await this.runRtk(binary, ['init', '-g', '--codex'])
      // External Codex will not inherit ND's private install directory in PATH.
      // Replace RTK.md with an ND-owned guide that points Codex at the verified
      // absolute executable path, so external Codex works with zero PATH edits.
      this.writeManagedCodexGuide(binary)
      backup.enabled = true
      for (const entry of backup.entries) {
        const managedHash = hashFile(entry.path)
        if (managedHash) entry.managedHash = managedHash
        else delete entry.managedHash
      }
      this.writeBackup(backup)
    } catch (error) {
      this.restoreCodexBackup(backup)
      throw error
    }
  }

  async disableCodex(): Promise<void> {
    const backup = this.readBackup()
    if (!backup?.enabled) return
    let uninstallError: unknown
    const binary = this.binaryPath()
    if (existsSync(binary)) {
      try {
        // RTK requires global scope for Codex uninstall.
        await this.runRtk(binary, ['init', '-g', '--codex', '--uninstall'])
      } catch (error) {
        uninstallError = error
      }
    }
    this.restoreCodexBackup(backup)
    try { rmSync(this.backupPath, { force: true }) } catch { /* best effort */ }
    if (uninstallError) throw uninstallError
  }

  private async ensureInstalled(): Promise<string> {
    const asset = platformAsset()
    if (!asset) throw new Error('External app optimization is not supported on this operating system/CPU yet')
    const canonical = this.binaryPath()
    if (existsSync(canonical)) return canonical

    await mkdir(this.downloadDir, { recursive: true })
    await mkdir(this.installDir, { recursive: true })
    const archivePath = join(this.downloadDir, asset.name)
    const response = await fetch(`${RTK_RELEASE_BASE}/${asset.name}`, { redirect: 'follow' })
    if (!response.ok) throw new Error(`Could not download the external optimization helper (${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== asset.sha256) throw new Error('External optimization helper failed integrity verification')
    await writeFile(archivePath, bytes)

    await rm(this.installDir, { recursive: true, force: true })
    await mkdir(this.installDir, { recursive: true })
    if (asset.archive === 'zip') {
      await runProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath,
        this.installDir,
      ])
    } else {
      await runProcess('tar', ['-xzf', archivePath, '-C', this.installDir])
    }

    const extracted = await findFile(this.installDir, process.platform === 'win32' ? 'rtk.exe' : 'rtk')
    if (!extracted) throw new Error('External optimization helper archive did not contain the expected executable')
    if (extracted !== canonical) await rename(extracted, canonical)
    if (process.platform !== 'win32') {
      const { chmod } = await import('node:fs/promises')
      await chmod(canonical, 0o755)
    }
    await this.runRtk(canonical, ['--version'])
    return canonical
  }

  private binaryPath(): string {
    return join(this.installDir, process.platform === 'win32' ? 'rtk.exe' : 'rtk')
  }

  private codexHome(): string {
    const home = process.env.CODEX_HOME?.trim()
      || (process.env.HOME ? join(process.env.HOME, '.codex') : process.env.USERPROFILE ? join(process.env.USERPROFILE, '.codex') : '')
    if (!home) throw new Error('Could not resolve the Codex settings folder')
    return home
  }

  private writeManagedCodexGuide(binary: string): void {
    const path = join(this.codexHome(), 'RTK.md')
    mkdirSync(dirname(path), { recursive: true })
    const invocation = process.platform === 'win32'
      ? `& "${binary}"`
      : `"${binary}"`
    const content = `# ND Token Saver — Codex external integration\n\nND manages the token-saving executable for this Codex account. Do not use a bare \`rtk\` command and do not install anything manually.\n\nFor shell commands that can produce noisy output, prefix the command with this exact executable invocation:\n\n\`\`\`text\n${invocation} <command>\n\`\`\`\n\nExamples:\n\n\`\`\`text\n${invocation} git status\n${invocation} git diff\n${invocation} npm run build\n${invocation} vitest\n\`\`\`\n\nIf the helper does not recognize a command, it passes the command through. Keep Codex's normal approval and sandbox policy authoritative.\n`
    writeFileSync(path, content, 'utf8')
  }

  private runRtk(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return runProcess(binary, args, {
      ...process.env,
      RTK_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    })
  }

  private captureCodexBackup(): CodexBackupState {
    const home = this.codexHome()
    const paths = [join(home, 'AGENTS.md'), join(home, 'RTK.md')]
    const entries = paths.map((path): ConfigBackupEntry => {
      if (!existsSync(path)) return { path, existed: false }
      return { path, existed: true, contentBase64: readFileSync(path).toString('base64') }
    })
    const state: CodexBackupState = { version: 1, enabled: false, entries }
    this.writeBackup(state)
    return state
  }

  /**
   * Restore only when it is safe to do so. If the user edited a managed file
   * while Token Saver was enabled, preserve that edit rather than clobbering it.
   */
  private restoreCodexBackup(state: CodexBackupState): void {
    for (const entry of state.entries) {
      const currentHash = hashFile(entry.path)
      const original = entry.contentBase64 ? Buffer.from(entry.contentBase64, 'base64') : undefined
      const originalHash = original ? createHash('sha256').update(original).digest('hex') : undefined
      if (entry.existed) {
        if (currentHash === originalHash) continue
        if (currentHash === undefined || currentHash === entry.managedHash) {
          mkdirSync(dirname(entry.path), { recursive: true })
          if (original) writeFileSync(entry.path, original)
        }
        continue
      }
      if (currentHash !== undefined && currentHash === entry.managedHash) {
        try { rmSync(entry.path, { force: true }) } catch { /* best effort */ }
      }
    }
  }

  private readBackup(): CodexBackupState | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.backupPath, 'utf8')) as CodexBackupState
      return parsed?.version === 1 && Array.isArray(parsed.entries) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private writeBackup(state: CodexBackupState): void {
    mkdirSync(dirname(this.backupPath), { recursive: true })
    writeFileSync(this.backupPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}

function platformAsset(): RtkAsset | undefined {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { name: 'rtk-aarch64-apple-darwin.tar.gz', archive: 'tar.gz', sha256: 'f223ca074a0215af002679bc1d34ca92b93e25b3e8ae16aace6e84c06e586802' }
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return { name: 'rtk-x86_64-apple-darwin.tar.gz', archive: 'tar.gz', sha256: '84121316867613e61925c209607f033b2113bb0ce312c267a79d3e3e8f221e49' }
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return { name: 'rtk-aarch64-unknown-linux-gnu.tar.gz', archive: 'tar.gz', sha256: 'cc2b91c064eb670c097c184913c8fbcb1a943d53d7fe505375e96ba0c5b6459f' }
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { name: 'rtk-x86_64-unknown-linux-musl.tar.gz', archive: 'tar.gz', sha256: '34975116da11e09e502501daf758143e0b22ed3a42a10eb67fb693a6270d9e36' }
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { name: 'rtk-x86_64-pc-windows-msvc.zip', archive: 'zip', sha256: 'f0ec18963581657173bd6a51f5ba012b093823f844db749fec218581af30a568' }
  }
  return undefined
}

async function findFile(root: string, name: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findFile(path, name)
      if (found) return found
    }
  }
  return undefined
}

function hashFile(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finishReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already stopped */ }
      finishReject(new Error(`Timed out while running ${command}`))
    }, PROCESS_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', (error) => {
      clearTimeout(timer)
      finishReject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error((stderr || stdout || `${command} exited with code ${String(code)}`).trim()))
    })
  })
}
