import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path'

interface RunResult {
  stdout: string
  stderr: string
  json?: unknown
}

export interface AgentBrowserStatus {
  state: 'binding' | 'ready' | 'unavailable'
  error?: string
}

const COMMAND_TIMEOUT_MS = 120_000
const MAX_CAPTURE_CHARS = 2_000_000
const BIND_RETRY_DELAY_MS = 2_500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AgentBrowserClient {
  readonly cdpPort: number
  readonly sessionName = 'nd-dsh-visible-browser'
  readonly configPath: string
  readonly binary: string
  readonly entryPath: string
  private statusValue: AgentBrowserStatus = { state: 'binding' }

  constructor(cdpPort: number, projectRoot: string) {
    this.cdpPort = cdpPort
    this.configPath = join(app.getPath('userData'), 'agent-browser.visible.json')
    this.binary = this.resolveBinary(projectRoot)
    this.entryPath = resolve(
      process.env.ND_DSH_AGENT_BROWSER_ENTRY
        ?? join(projectRoot, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js'),
    )
  }

  status(): AgentBrowserStatus {
    return { ...this.statusValue }
  }

  resetBinding(): void {
    this.statusValue = { state: 'binding' }
  }

  recordFailure(error: unknown): void {
    this.statusValue = {
      state: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  async prepareConfig(): Promise<void> {
    const artifactDirectory = join(app.getPath('userData'), 'browser-artifacts')
    await fs.mkdir(artifactDirectory, { recursive: true })
    const config = {
      $schema: 'https://agent-browser.dev/schema.json',
      cdp: String(this.cdpPort),
      session: this.sessionName,
      pinTab: true,
      json: true,
      contentBoundaries: true,
      screenshotDir: artifactDirectory,
      idleTimeout: '30m',
    }
    await fs.writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }

  async bindTarget(targetId: string): Promise<void> {
    this.statusValue = { state: 'binding' }
    try {
      await this.prepareConfig()
      if (!existsSync(this.entryPath)) {
        throw new Error(`agent-browser MCP entry is not installed at ${this.entryPath}. Run pnpm install.`)
      }
      // A brand-new pinned session may create a fresh tab before a target is
      // selected. Bind once without strict pinning, then turn strict pinning on
      // for every subsequent CLI and MCP command.
      //
      // A cold daemon's first CDP attach can fail or stall against the visible
      // pane; one transparent retry keeps that off the agent's tool path
      // instead of surfacing as an unavailable browser mid-session.
      try {
        await this.bindPinnedTab(targetId)
      } catch {
        this.statusValue = { state: 'binding' }
        await sleep(BIND_RETRY_DELAY_MS)
        await this.bindPinnedTab(targetId)
      }
      this.statusValue = { state: 'ready' }
    } catch (error) {
      this.recordFailure(error)
      throw error
    }
  }

  private async bindPinnedTab(targetId: string): Promise<void> {
    await this.run(['tab', targetId], ['--no-pin-tab'])
    await this.run(['get', 'url'], ['--pin-tab'])
  }

  async snapshot(): Promise<unknown> {
    const result = await this.run(['snapshot', '-i'])
    return result.json ?? result.stdout
  }

  environment(): NodeJS.ProcessEnv {
    return {
      ND_DSH_AGENT_BROWSER_BIN: this.binary,
      ND_DSH_AGENT_BROWSER_CONFIG: this.configPath,
      ND_DSH_AGENT_BROWSER_ENTRY: this.entryPath,
      ND_DSH_AGENT_BROWSER_SESSION: this.sessionName,
      AGENT_BROWSER_CONFIG: this.configPath,
      AGENT_BROWSER_SESSION: this.sessionName,
    }
  }

  private resolveBinary(projectRoot: string): string {
    const override = process.env.ND_DSH_AGENT_BROWSER_BIN?.trim()
    if (override) {
      if (isAbsolute(override) || override.includes('/') || override.includes('\\')) return resolve(override)
      return override
    }
    const executable = process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser'
    return join(projectRoot, 'node_modules', '.bin', executable)
  }

  private async run(command: string[], globalArguments: string[] = []): Promise<RunResult> {
    if (this.binary.includes(sep) && !existsSync(this.binary)) {
      throw new Error(`agent-browser is not installed at ${this.binary}. Run pnpm install.`)
    }

    const args = ['--config', this.configPath, '--json', ...globalArguments, ...command]
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.binary, args, {
        cwd: process.cwd(),
        windowsHide: true,
        shell: process.platform === 'win32' && this.binary.toLowerCase().endsWith('.cmd'),
        env: {
          ...process.env,
          PATH: process.env.PATH?.split(delimiter).filter(Boolean).join(delimiter),
          AGENT_BROWSER_CONFIG: this.configPath,
          AGENT_BROWSER_SESSION: this.sessionName,
        },
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`agent-browser command timed out after ${COMMAND_TIMEOUT_MS}ms`))
      }, COMMAND_TIMEOUT_MS)
      timer.unref()

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk.slice(0, MAX_CAPTURE_CHARS - stdout.length)
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk.slice(0, MAX_CAPTURE_CHARS - stderr.length)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `agent-browser exited with code ${String(code)}`))
          return
        }
        const trimmed = stdout.trim()
        let json: unknown
        if (trimmed) {
          try {
            json = JSON.parse(trimmed)
          } catch {
            json = undefined
          }
        }
        resolvePromise({ stdout: trimmed, stderr: stderr.trim(), ...(json === undefined ? {} : { json }) })
      })
    })
  }
}
