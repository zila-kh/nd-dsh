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
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const fallback = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
      finish()
    }, 20_000)
    void app.close().finally(() => {
      clearTimeout(fallback)
      finish()
    })
  })
}
