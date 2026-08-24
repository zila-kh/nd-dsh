import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { Project, ProjectRuntimeStatus } from '../../shared/organization.js'
import { DEFAULT_PROJECT_PORT } from '../../shared/organization.js'
import { isAllowedBrowserUrl, normalizeBrowserUrl } from '../browser/browser-url.js'
import type { OrganizationStore } from '../organization/store.js'
import { detectProjectChecks } from '../qa/project-checks.js'

/** How long a spawned start command gets to answer its health check. */
const START_TIMEOUT_MS = 30_000
const START_POLL_MS = 600
/** Single-probe budget for check()/health polling. */
const PROBE_TIMEOUT_MS = 2_500
const LOG_TAIL_CHARS = 8_000

export interface ProjectRuntimeOptions {
  store: OrganizationStore
  now?: () => number
  spawnProcess?: typeof spawn
  fetchFn?: typeof fetch
  /**
   * ND-DSH's own renderer origin (dev server or packaged shell). Automatic
   * navigation must never target it or the preview loads recursively inside
   * the browser pane.
   */
  reservedOrigin?: () => string | undefined
  /** Fired whenever a project target answers its health check. */
  onTargetReady?: (projectId: string, url: string) => void
}

interface ResolvedTarget {
  url: string
  port: number
}

/**
 * Validate → Start server → Wait for health check → Open Browser, owned by the
 * trusted main process. One dev-server child runs at a time; switching
 * workspaces stops it. The built-in browser never launches anything itself.
 */
export class ProjectRuntimeService {
  private readonly now: () => number
  private readonly spawnProcess: typeof spawn
  private readonly fetchFn: typeof fetch
  private readonly reservedOrigin: (() => string | undefined) | undefined
  private readonly onTargetReady: ((projectId: string, url: string) => void) | undefined
  private readonly states = new Map<string, ProjectRuntimeStatus>()
  private readonly logs = new Map<string, string>()
  private child: ChildProcess | undefined
  private childProjectId: string | undefined
  private childCwd: string | undefined
  private listener: ((status: ProjectRuntimeStatus) => void) | undefined

  constructor(private readonly options: ProjectRuntimeOptions) {
    this.now = options.now ?? Date.now
    this.spawnProcess = options.spawnProcess ?? spawn
    this.fetchFn = options.fetchFn ?? fetch
    this.reservedOrigin = options.reservedOrigin
    this.onTargetReady = options.onTargetReady
  }

  setListener(listener: ((status: ProjectRuntimeStatus) => void) | undefined): void {
    this.listener = listener
  }

  async status(projectId: string): Promise<ProjectRuntimeStatus> {
    const project = await this.projectById(projectId)
    const target = this.resolveTarget(project)
    const cached = this.states.get(projectId)
    const runningHere = this.childProjectId === projectId && this.child !== undefined
    return {
      projectId,
      state: runningHere ? cached?.state ?? 'starting' : cached?.state ?? 'stopped',
      targetUrl: target.url,
      port: target.port,
      ...(runningHere && this.child?.pid ? { pid: this.child.pid } : {}),
      ...(cached?.startedAt !== undefined ? { startedAt: cached.startedAt } : {}),
      ...(cached?.checkedAt !== undefined ? { checkedAt: cached.checkedAt } : {}),
      ...(cached?.lastError !== undefined ? { lastError: cached.lastError } : {}),
      ...(cached?.validation !== undefined ? { validation: cached.validation } : {}),
    }
  }

  /**
   * Validate the workspace and probe the configured target without spawning
   * anything. Healthy targets fire onTargetReady so the browser opens the app.
   */
  async check(projectId: string): Promise<ProjectRuntimeStatus> {
    const project = await this.projectById(projectId)
    const target = this.resolveTarget(project)
    const validation = await this.validateWorkspace(project)
    const healthy = await this.probe(target.url, healthCheckPath(project))
    const status: ProjectRuntimeStatus = {
      projectId,
      state: healthy ? 'ready' : 'unreachable',
      targetUrl: target.url,
      port: target.port,
      checkedAt: this.now(),
      ...(healthy ? {} : { lastError: `Nothing answered at ${healthCheckUrl(target.url, healthCheckPath(project))}. Start the app or configure “Start command”.` }),
      ...(validation.length ? { validation } : {}),
    }
    this.states.set(projectId, status)
    this.emit(status)
    if (healthy) this.onTargetReady?.(projectId, target.url)
    return status
  }

  /**
   * Bring the project target up: with a start command the child is spawned in
   * the project workspace and polled until healthy; without one the target is
   * treated as externally managed and only validated/probed.
   */
  async start(projectId: string): Promise<ProjectRuntimeStatus> {
    const project = await this.projectById(projectId)
    const target = this.resolveTarget(project)
    const command = project.startCommand?.trim()

    if (!command) return this.check(projectId)

    await this.stopChild(`project ${project.name} requested a new run`)
    const validation = await this.validateWorkspace(project)
    const workspaceError = validation.find((line) => line.startsWith('Workspace unavailable') || line.startsWith('No workspace'))
    const base: ProjectRuntimeStatus = {
      projectId,
      state: workspaceError ? 'unreachable' : 'starting',
      targetUrl: target.url,
      port: target.port,
      checkedAt: this.now(),
      ...(workspaceError ? { lastError: workspaceError } : {}),
      ...(validation.length ? { validation } : {}),
    }
    this.states.set(projectId, base)
    this.emit(base)
    if (workspaceError) return base

    const logKey = projectId
    this.logs.set(logKey, '')
    this.appendLog(logKey, `$ ${command}\n`)
    const child = this.spawnProcess(command, {
      cwd: project.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
      env: runtimeEnvironment(target.port),
    })
    this.child = child
    this.childProjectId = projectId
    this.childCwd = project.workspacePath
    let exited = false
    let exitReason = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.appendLog(logKey, chunk))
    child.stderr?.on('data', (chunk: string) => this.appendLog(logKey, chunk))
    child.once('exit', (code, signal) => {
      exited = true
      exitReason = `Start command exited (${signal ?? String(code ?? 'unknown')}).`
      if (this.child === child) {
        this.child = undefined
        this.childProjectId = undefined
        this.childCwd = undefined
        const cached = this.states.get(projectId)
        if (!cached || cached.state !== 'ready') {
          const stopped: ProjectRuntimeStatus = {
            projectId,
            state: 'stopped',
            ...(base.targetUrl !== undefined ? { targetUrl: base.targetUrl } : {}),
            ...(base.port !== undefined ? { port: base.port } : {}),
            checkedAt: this.now(),
            lastError: `${exitReason}${this.logTail(projectId)}`,
          }
          this.states.set(projectId, stopped)
          this.emit(stopped)
        }
      }
    })

    const deadline = this.now() + START_TIMEOUT_MS
    while (this.now() < deadline) {
      if (exited) break
      if (await this.probe(target.url, healthCheckPath(project))) {
        const ready: ProjectRuntimeStatus = {
          ...base,
          state: 'ready',
          startedAt: this.now(),
          checkedAt: this.now(),
          ...(child.pid !== undefined ? { pid: child.pid } : {}),
        }
        this.states.set(projectId, ready)
        this.emit(ready)
        this.onTargetReady?.(projectId, target.url)
        return ready
      }
      await sleep(START_POLL_MS)
    }

    const failed: ProjectRuntimeStatus = {
      ...base,
      state: exited ? 'stopped' : 'unreachable',
      checkedAt: this.now(),
      lastError: exited
        ? `${exitReason}${this.logTail(projectId)}`
        : `The app did not become healthy within ${Math.round(START_TIMEOUT_MS / 1_000)}s.${this.logTail(projectId)}`,
    }
    this.states.set(projectId, failed)
    this.emit(failed)
    return failed
  }

  async stop(projectId: string): Promise<ProjectRuntimeStatus> {
    if (this.childProjectId !== projectId) return this.status(projectId)
    await this.stopChild('project runtime was stopped by hand')
    return this.status(projectId)
  }  async restart(projectId: string): Promise<ProjectRuntimeStatus> {
    await this.stop(projectId)
    return this.start(projectId)
  }

  logsFor(projectId: string): string {
    return this.logTail(projectId)
  }

  /** A changed workspace invalidates a running dev server spawned elsewhere. */
  async handleWorkspaceChanged(root: string): Promise<void> {
    if (!this.child || !this.childCwd) return
    if (samePath(this.childCwd, root)) return
    await this.stopChild('the active workspace changed')
  }

  async dispose(): Promise<void> {
    await this.stopChild('ND-DSH is shutting down')
    this.setListener(undefined)
  }

  /** Resolve the browser target for a project, refusing ND-DSH's own origin. */
  private resolveTarget(project: Project): ResolvedTarget {
    const explicit = project.targetUrl?.trim()
    if (explicit) {
      const candidate = normalizeBrowserUrl(explicit)
      if (!isAllowedBrowserUrl(candidate)) {
        throw new Error(`Project target URL uses an unsupported protocol: ${explicit}`)
      }
      this.assertNotSelfHosted(candidate)
      const parsed = Number(new URL(candidate).port)
      return { url: candidate, port: Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PROJECT_PORT }
    }
    const port = Number.isInteger(project.targetPort) && (project.targetPort as number) >= 1 && (project.targetPort as number) <= 65_535
      ? project.targetPort as number
      : DEFAULT_PROJECT_PORT
    const url = normalizeBrowserUrl(`localhost:${port}`)
    this.assertNotSelfHosted(url)
    return { url, port }
  }

  private assertNotSelfHosted(url: string): void {
    const reserved = this.reservedOrigin?.()
    if (!reserved) return
    let origin: string
    try { origin = new URL(url).origin } catch { return }
    if (origin !== reserved) return
    throw new Error(`Refusing to open ${origin}: that is ND-DSH's own control-plane preview. Point the project's Target URL or Target port at the app under development instead.`)
  }

  private async validateWorkspace(project: Project): Promise<string[]> {
    const path = project.workspacePath?.trim()
    if (!path) return ['No workspace linked. Open the project folder first.']
    try {
      const stats = await fs.stat(path)
      if (!stats.isDirectory()) return [`Workspace unavailable: ${path} is not a directory.`]
    } catch {
      return [`Workspace unavailable: ${path} does not exist on disk.`]
    }
    const findings: string[] = []
    if (!existsSync(join(path, 'package.json'))) {
      findings.push('No package.json found; checks and start commands may be limited.')
      return findings
    }
    const checks = detectProjectChecks(path)
    findings.push(checks.length
      ? `${checks.length} runnable check script(s): ${checks.map((check) => check.id.slice('script:'.length)).join(', ')}.`
      : 'package.json has none of the known test/lint/typecheck/build scripts.')
    return findings
  }

  private async probe(url: string, path: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(healthCheckUrl(url, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      return response.status < 500
    } catch {
      return false
    }
  }

  private async stopChild(reason: string): Promise<void> {
    const child = this.child
    const projectId = this.childProjectId
    this.child = undefined
    this.childProjectId = undefined
    this.childCwd = undefined
    if (!child) return
    if (projectId) {
      this.appendLog(projectId, `\n[ND] dev server stopped — ${reason}\n`)
      // Every teardown path (manual stop, restart, workspace switch) must land
      // the cached state on 'stopped'; a stale 'ready' would misreport a dead server.
      const cached = this.states.get(projectId)
      const stopped: ProjectRuntimeStatus = {
        projectId,
        state: 'stopped',
        ...(cached?.targetUrl !== undefined ? { targetUrl: cached.targetUrl } : {}),
        ...(cached?.port !== undefined ? { port: cached.port } : {}),
        checkedAt: this.now(),
      }
      this.states.set(projectId, stopped)
      this.emit(stopped)
    }
    await killProcessTree(child)
  }

  private appendLog(projectId: string, text: string): void {
    const next = `${this.logs.get(projectId) ?? ''}${text}`
    this.logs.set(projectId, next.length > LOG_TAIL_CHARS * 2 ? next.slice(-LOG_TAIL_CHARS) : next)
  }

  private logTail(projectId: string): string {
    const text = this.logs.get(projectId)?.trimEnd()
    return text ? `\nOutput:\n${text.slice(-LOG_TAIL_CHARS)}` : ''
  }

  private async projectById(projectId: string): Promise<Project> {
    const state = await this.options.store.state()
    const project = state.projects.find((item) => item.id === projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    return project
  }

  private emit(status: ProjectRuntimeStatus): void {
    this.listener?.(status)
  }
}

function healthCheckPath(project: Project): string {
  const path = project.healthCheckPath?.trim()
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

/** Join a target and its health path without producing a misleading `//`. */
function healthCheckUrl(targetUrl: string, path: string): string {
  return `${targetUrl.replace(/\/+$/, '')}${path}`
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, '') === right.replace(/[\\/]+$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Dev servers run as plain programs even when the host is Electron, and ND
 * keeps its env namespace out of spawned tooling. PORT advertises the resolved
 * target port for frameworks that honor it.
 */
function runtimeEnvironment(port: number): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
    environment[key] = value
  }
  environment.PORT = String(port)
  return environment
}

/** Terminate the whole dev-server tree; SIGTERM first, then hard teardown. */
async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid as number), '/T', '/F'], { stdio: 'ignore' })
        } else {
          try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      } catch {
        // Already gone.
      }
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}
