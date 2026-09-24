import { config as loadDotenv } from 'dotenv'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// E2E credentials live in the gitignored .env.e2e; plain .env supplies the rest
// (for example ND_DSH_CDP_PORT). Load .env.e2e first so it wins.
loadDotenv({ path: '.env.e2e', quiet: true })
loadDotenv({ quiet: true })

/**
 * A real, writable project workspace for specs that create an ND project.
 *
 * The project form requires an existing folder, so a spec must never name a
 * machine-specific path: a hardcoded developer directory made the organization
 * bootstrap fail on every CI runner and silently skipped the rest of its file.
 * It is also a Git repository with one commit, because ND's Source Control
 * surface only renders for a repository — a bare temp directory would drop that
 * coverage without failing anything.
 */
export async function createWorkspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-e2e-workspace-'))
  git(dir, ['init', '--initial-branch=main'])
  await writeFile(join(dir, 'README.md'), '# ND-DSH e2e workspace\n', 'utf8')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'chore: seed the e2e workspace'])
  return dir
}

/** Git with an identity and no signing, so a runner's global config cannot matter. */
function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', [
    '-c', 'user.name=ND-DSH E2E',
    '-c', 'user.email=e2e@nd-dsh.invalid',
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr?.trim() || String(result.status)}`)
  }
}

export const E2E_PROVIDER_ID = 'e2e-openai-compatible'
export const E2E_PROVIDER_NAME = 'E2E OpenAI Compatible'

const DUMMY_MODEL_IDS = ['model-id-1', 'model-id-2', 'model-id-3']

export interface E2eModelConfig {
  /** True when all five E2E_MODEL_* variables are present. */
  configured: boolean
  baseUrl: string
  apiKey: string
  modelIds: string[]
  context: string
}

/**
 * The single OpenAI-compatible route every E2E layer uses, plus the dummy
 * placeholders deterministic specs see when no credentials are configured.
 */
export function e2eModelConfig(): E2eModelConfig {
  const baseUrl = process.env.E2E_MODEL_BASE_URL?.trim() ?? ''
  const apiKey = process.env.E2E_MODEL_API_KEY?.trim() ?? ''
  const configuredIds = [
    process.env.E2E_MODEL_1?.trim() ?? '',
    process.env.E2E_MODEL_2?.trim() ?? '',
    process.env.E2E_MODEL_3?.trim() ?? '',
  ]
  const configured = Boolean(baseUrl && apiKey && configuredIds.every(Boolean))
  return {
    configured,
    baseUrl: configured ? baseUrl : 'https://your-endpoint.example/v1',
    apiKey: configured ? apiKey : 'sk-test-placeholder',
    modelIds: configured ? configuredIds : [...DUMMY_MODEL_IDS],
    context: process.env.E2E_MODEL_CONTEXT?.trim() || '256000',
  }
}

/**
 * Pre-seed provider metadata into the throwaway E2E profile.
 *
 * Every E2E layer routes through one shared OpenAI-compatible provider exposing
 * exactly the three E2E_MODEL_* ids from .env.e2e (or .env). Deterministic specs
 * that never execute a model still need the provider record, so without
 * credentials it is seeded with explicit dummy placeholders and stays green
 * offline.
 *
 * The apiKey is written only into the throwaway profile. ProviderStore migrates
 * plaintext legacy input into Electron safeStorage on first persist; the env
 * file itself is gitignored and must never be committed.
 */
async function seedProviders(userDataDir: string, useConfiguredModels = false): Promise<void> {
  const config = e2eModelConfig()
  if (useConfiguredModels && !config.configured) {
    throw new Error(
      'Incomplete E2E model configuration. Set E2E_MODEL_BASE_URL, E2E_MODEL_API_KEY, E2E_MODEL_1, E2E_MODEL_2 and E2E_MODEL_3 together.',
    )
  }

  const providers = [{
    id: E2E_PROVIDER_ID,
    name: E2E_PROVIDER_NAME,
    enabled: true,
    baseUrl: config.baseUrl,
    apiFormat: 'OpenAI compatible (/v1/chat/completions)',
    apiKey: config.apiKey,
    models: config.modelIds.map((id) => ({ id, context: config.context })),
  }]

  await writeFile(join(userDataDir, 'providers.json'), JSON.stringify(providers, null, 2), 'utf8')
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

interface AppDiagnostics {
  stdout: string
  stderr: string
}

const appDiagnostics = new WeakMap<ElectronApplication, AppDiagnostics>()

/**
 * Launch the built ND-DSH app (`pnpm build` first — the launcher runs the
 * package.json main entry). A throwaway user-data dir keeps the spec
 * instance independent of any production ND-DSH instance the developer has
 * running, since the single-instance lock is scoped to the userData path.
 */
export interface LaunchAppOptions {
  /** Reuse an existing profile when a spec needs to prove restart persistence. */
  userDataDir?: string
  /** Require the .env.e2e E2E_MODEL_1/2/3 route and fail fast when it is incomplete. */
  useConfiguredModels?: boolean
}

export async function launchApp(options: LaunchAppOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? await mkdtemp(join(tmpdir(), 'nd-dsh-e2e-'))
  await seedProviders(userDataDir, options.useConfiguredModels ?? false)
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
  })
  const child = app.process()
  const diagnostics: AppDiagnostics = { stdout: '', stderr: '' }
  appDiagnostics.set(app, diagnostics)
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { diagnostics.stdout = tail(diagnostics.stdout + chunk) })
  child.stderr?.on('data', (chunk: string) => { diagnostics.stderr = tail(diagnostics.stderr + chunk) })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

/**
 * Shut the app down from inside Electron, then wait for the OS process.
 *
 * Playwright's ElectronApplication.close() owns a CDP/driver close handshake.
 * On Linux CI that promise could remain pending after ND had already reached
 * its own bounded before-quit path; starting it and then force-killing Electron
 * left the worker with a half-closed Playwright transport and the runner hit its
 * 120 s worker-teardown watchdog. Asking Electron to quit itself avoids that
 * circular ownership: ND closes its services, the process exits, and Playwright
 * observes the exit through its existing transport.
 *
 * If that graceful path ever regresses, print the exact process tree, command
 * lines, captured app stderr/stdout tail, and cleanup path before killing the
 * tree. Surviving descendants are treated as a test failure rather than hidden.
 */
export interface CloseAppOptions {
  /** Keep the throwaway profile on disk so the same spec can relaunch it. */
  removeUserData?: boolean
}

export async function closeApp(launched: LaunchedApp | undefined, options: CloseAppOptions = {}): Promise<void> {
  if (!launched) return
  const { app, userDataDir } = launched
  const child = app.process()
  const diagnostics = appDiagnostics.get(app)
  const initialTree = processTree(child.pid)

  let path: 'graceful' | 'force-kill' = 'graceful'
  let quitRequestSettled = false
  let exited = false
  try {
    // Schedule quit after the evaluate response is sent so the request itself
    // is not racing the destruction of Electron's main-process transport.
    quitRequestSettled = await settlesWithin(
      app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => undefined),
      2_000,
    )
    exited = await waitForExit(child, 8_000)

    if (!exited) {
      path = 'force-kill'
      logShutdownDiagnostics(child.pid, path, quitRequestSettled, initialTree, diagnostics)
      forceKillProcessTree(child.pid)
      exited = await waitForExit(child, 5_000)
    }

    const survivors = await waitForDescendantsToExit(initialTree, 2_000)
    if (survivors.length > 0) {
      console.error('[e2e-close] descendant process survived app exit:', formatRows(survivors))
      for (const line of survivorDiagnostics(survivors, userDataDir)) console.error(line)
      // The app's own shutdown narration is otherwise invisible here: it is
      // captured, and only printed when the force-kill path runs.
      if (diagnostics?.stdout) console.error(`[e2e-close] app stdout tail:\n${diagnostics.stdout}`)
      if (diagnostics?.stderr) console.error(`[e2e-close] app stderr tail:\n${diagnostics.stderr}`)
      for (const row of [...survivors].reverse()) {
        try { process.kill(row.pid, 'SIGKILL') } catch { /* already gone */ }
      }
      throw new Error(`Electron shutdown left descendant process(es): ${formatRows(survivors)}`)
    }

    console.log(`[e2e-close] path=${path} pid=${child.pid ?? 'unknown'} quitRequestSettled=${quitRequestSettled} exited=${exited} descendantsBefore=${initialTree.length}`)
    if (!exited) throw new Error('Electron process did not exit after bounded e2e shutdown cleanup.')

    // The worker keeps Playwright's own Electron child handle and its CDP
    // sockets alive until the ElectronApplication is disposed, which makes it
    // miss the 120 s teardown window even though every spec passed (task 0010).
    // Bounded, so a stuck dispose cannot reintroduce the hang this graceful
    // close path exists to avoid.
    await settlesWithin(app.close().catch(() => undefined), 15_000)
    if (process.env.ND_E2E_TEARDOWN_DIAG) logActiveHandles()
  } finally {
    appDiagnostics.delete(app)
    if (options.removeUserData !== false) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/**
 * Name what still keeps the worker's event loop alive. The worker-teardown
 * watchdog fires 120 s after the last spec has already passed, so the leaking
 * handle has to be printed rather than guessed at: the listing records whether
 * each handle still holds a ref, and enough of its identity (pid, fd, peer,
 * spawn args) to name the process or socket behind it.
 */
function logActiveHandles(): void {
  const internals = process as unknown as {
    _getActiveHandles?: () => unknown[]
    _getActiveRequests?: () => unknown[]
  }
  const describe = (item: unknown): string => {
    const record = item as Record<string, unknown>
    const ctor = (record?.constructor as { name?: string } | undefined)?.name ?? typeof item
    const bits: string[] = []
    if (typeof record.pid === 'number') bits.push(`pid=${record.pid}`)
    if (typeof record.fd === 'number') bits.push(`fd=${record.fd}`)
    if (typeof record.remoteAddress === 'string' && record.remoteAddress) {
      bits.push(`peer=${record.remoteAddress}:${String(record.remotePort ?? '')}`)
    }
    if (typeof record.spawnfile === 'string') bits.push(record.spawnfile)
    if (Array.isArray(record.spawnargs)) bits.push((record.spawnargs as unknown[]).slice(0, 2).join(' '))
    const hasRef = (item as { hasRef?: () => boolean })?.hasRef
    if (typeof hasRef === 'function') bits.push(hasRef.call(item) ? 'ref' : 'unref')
    return bits.length ? `${ctor}(${bits.join(' ')})` : ctor
  }
  const handles = internals._getActiveHandles?.() ?? []
  const requests = internals._getActiveRequests?.() ?? []
  console.log(`[e2e-teardown] handles=${handles.length}: ${handles.map(describe).join(' | ') || 'none'}`)
  console.log(`[e2e-teardown] requests=${requests.length}: ${requests.map(describe).join(' | ') || 'none'}`)
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForExit(child: ReturnType<ElectronApplication['process']>, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(child.exitCode !== null), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function forceKillProcessTree(pid: number | undefined): void {
  if (pid == null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.unref()
    return
  }
  const rows = processTree(pid)
  for (const row of [...rows].reverse()) {
    try { process.kill(row.pid, 'SIGKILL') } catch { /* the child may have exited during cleanup */ }
  }
  try { process.kill(pid, 'SIGKILL') } catch { /* the child may have exited during cleanup */ }
}

function processTree(rootPid: number | undefined): ProcessRow[] {
  if (rootPid == null || process.platform === 'win32') return []
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout) return []
  const rows = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ProcessRow | undefined => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return undefined
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }
    })
    .filter((row): row is ProcessRow => row !== undefined)

  const descendants: ProcessRow[] = []
  const queue = [rootPid]
  while (queue.length > 0) {
    const parent = queue.shift()!
    const children = rows.filter((row) => row.ppid === parent)
    descendants.push(...children)
    queue.push(...children.map((row) => row.pid))
  }
  return descendants
}

async function waitForDescendantsToExit(initial: ProcessRow[], timeoutMs: number): Promise<ProcessRow[]> {
  const deadline = Date.now() + timeoutMs
  let survivors = survivingRows(initial)
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    survivors = survivingRows(initial)
  }
  return survivors
}

function survivingRows(initial: ProcessRow[]): ProcessRow[] {
  if (initial.length === 0 || process.platform === 'win32') return []
  const result = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout) return []
  const current = new Map<number, string>()
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/)
    if (match) current.set(Number(match[1]), match[2] ?? '')
  }
  return initial.filter((row) => current.get(row.pid) === row.command)
}

function logShutdownDiagnostics(
  pid: number | undefined,
  path: 'graceful' | 'force-kill',
  quitRequestSettled: boolean,
  rows: ProcessRow[],
  diagnostics: AppDiagnostics | undefined,
): void {
  console.error(`[e2e-close] path=${path} pid=${pid ?? 'unknown'} quitRequestSettled=${quitRequestSettled}`)
  console.error(`[e2e-close] processTree=${formatRows(rows)}`)
  if (diagnostics?.stderr) console.error(`[e2e-close] stderrTail:\n${diagnostics.stderr}`)
  if (diagnostics?.stdout) console.error(`[e2e-close] stdoutTail:\n${diagnostics.stdout}`)
}

function formatRows(rows: ProcessRow[]): string {
  return rows.length === 0
    ? '[]'
    : rows.map((row) => `${row.pid}<-${row.ppid} ${row.command}`).join(' | ')
}

/**
 * How long a process has been alive, from `/proc/<pid>/stat` starttime against
 * the kernel's uptime. A survivor born while the app was already shutting down
 * is a different defect from one that predates the quit, so the run has to say
 * which it saw. Best effort; returns 'unknown' where `/proc` cannot answer.
 */
function processAgeSeconds(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const startTicks = Number(fields[19])
    const uptimeSeconds = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0])
    const ticksPerSecond = 100
    const age = uptimeSeconds - startTicks / ticksPerSecond
    return Number.isFinite(age) ? age.toFixed(1) : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Name the daemon that outlived the app: its command line, the daemon-relevant
 * environment it was started with, and the sidecar files that exist where a
 * daemon of this app should have left them.
 *
 * A survivor is only actionable once the run says which daemon space it resolved,
 * because `<socketDir>/namespaces/<namespace>/run` and
 * `~/.agent-browser/namespaces/<namespace>/run` are different answers with
 * different fixes. Best effort: a process can exit between listing and reading.
 */
function survivorDiagnostics(rows: ProcessRow[], userDataDir: string): string[] {
  if (process.platform === 'win32') return []
  const lines: string[] = []
  for (const row of rows) {
    try {
      const cmdline = readFileSync(`/proc/${row.pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ')
      const environment = readFileSync(`/proc/${row.pid}/environ`, 'utf8')
        .split('\0')
        .filter((entry) => /^(AGENT_BROWSER_|ND_DSH_AGENT_BROWSER_|HOME=|XDG_STATE_HOME=|XDG_RUNTIME_DIR=|TMPDIR=)/.test(entry))
      lines.push(`[e2e-close] survivor pid=${row.pid} ageSeconds=${processAgeSeconds(row.pid)} cmdline: ${cmdline}`)
      lines.push(`[e2e-close] survivor pid=${row.pid} env: ${environment.join(' ') || '(none of the daemon variables)'}`)
    } catch (error) {
      lines.push(`[e2e-close] survivor pid=${row.pid} inspect failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const roots = [
    join(userDataDir, 'agent-browser-runtime'),
    join(homedir(), '.agent-browser'),
    join(homedir(), '.agent-browser', 'namespaces', 'nd-dsh', 'run'),
  ]
  for (const root of roots) {
    try {
      lines.push(`[e2e-close] sidecars ${root}: ${readdirSync(root).join(', ') || '(empty)'}`)
    } catch {
      lines.push(`[e2e-close] sidecars ${root}: (absent)`)
    }
  }
  return lines
}

function tail(value: string, max = 8_000): string {
  return value.length <= max ? value : value.slice(-max)
}
