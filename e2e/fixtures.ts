import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

/**
 * Launch the built ND-DSH app (`pnpm build` first — the launcher runs the
 * package.json main entry). A throwaway user-data dir keeps the spec
 * instance independent of any production ND-DSH instance the developer has
 * running, since the single-instance lock is scoped to the userData path.
 */
export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'nd-dsh-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/**
 * Graceful quit with a bounded fallback. Capture the child-process handle
 * before `app.close()` starts: Playwright tears down its Electron wrapper as
 * part of close, so asking `app.process()` from a later timer can dereference
 * an already-disposed channel even though the OS process is still exiting.
 */
export async function closeApp({ app }: LaunchedApp): Promise<void> {
  const child = app.process()
  const close = app.close().catch(() => undefined)
  const settled = await settlesWithin(close, 8_000)
  if (!settled && child.exitCode === null) forceKillProcessTree(child.pid)
  await Promise.race([close, waitForExit(child, 5_000)])
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

async function waitForExit(child: ReturnType<ElectronApplication['process']>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function forceKillProcessTree(pid: number | undefined): void {
  if (pid == null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try { process.kill(pid, 'SIGKILL') } catch { /* the child may have exited during close */ }
}
