/// <reference lib="dom" />

// Throwaway visual-capture spec: screenshots the redesigned settings surfaces.
// Not part of the permanent suite; delete after review.
import { expect, test } from '@playwright/test'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

type RendererWindow = {
  ndDsh: {
    browserPlatform: {
      installCatalogExtension(catalogId: string): Promise<unknown>
    }
  }
}

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
const SHOT_DIR = 'test-results/settings-visual'

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await closeApp(launched)
})

test('capture redesigned settings surfaces', async () => {
  const { page } = launched

  // Enter the coding workspace and open the built-in browser pane.
  const coding = page.getByRole('group', { name: 'Workspace profile' }).getByRole('button', { name: 'CODING', exact: true })
  if (await coding.isVisible()) await coding.click()
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
  const panes = page.getByRole('tablist', { name: 'Agent workspace panes' })
  await panes.getByRole('button', { name: 'Browser' }).click()
  await expect(page.getByRole('region', { name: 'Built-in browser' })).toBeVisible()

  // Install the bundled catalog extension so the popover has a real row.
  await launched.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.evaluate(async () => {
    await (globalThis as unknown as RendererWindow).ndDsh.browserPlatform.installCatalogExtension('nd-browser-tools')
  })

  // Toolbar extensions popover.
  const puzzle = page.getByRole('button', { name: 'Built-in browser extensions' })
  await expect(puzzle).toBeVisible()
  await puzzle.click()
  await expect(page.getByRole('button', { name: 'Manage in Settings' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/popover.png` })
  await page.keyboard.press('Escape')

  // Settings → General → Browser.
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  const subTabs = page.getByRole('tablist', { name: 'General sub-tabs' })
  await subTabs.getByRole('tab', { name: 'Browser', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Built-in browser profile' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/browser-settings.png` })

  // Extension manager drawer.
  await page.getByLabel('Settings', { exact: true }).getByRole('button', { name: 'Manage', exact: true }).click()
  await expect(page.getByText('Built-in catalog')).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/extensions-drawer.png` })

  // Coding engines tab after the reorder.
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Coding engines', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Coding engines' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/engines.png` })
})
