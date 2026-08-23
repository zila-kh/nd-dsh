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
 * Graceful quit with a bounded fallback: if the app's shutdown path wedges,
 * force-kill so a hung teardown stalls the suite for seconds, not minutes.
 */
export async function closeApp({ app }: LaunchedApp): Promise<void> {
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(() => {
      void app.process().kill('SIGKILL')
      resolve()
    }, 20_000)
    void app.close().finally(() => {
      clearTimeout(fallback)
      resolve()
    })
  })
}
