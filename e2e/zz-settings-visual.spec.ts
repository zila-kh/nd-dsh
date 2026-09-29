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

  // Open Settings for the sidebar + search captures.
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible()

  // Sidebar navigation + settings search (ChatGPT/Gemini-style).
  await page.screenshot({ path: `${SHOT_DIR}/settings-sidebar.png` })
  const searchBox = page.getByRole('textbox', { name: 'Search settings' })
  await searchBox.fill('extension')
  const searchResults = page.getByLabel('Settings search results')
  await expect(searchResults.getByRole('button', { name: 'Browser extensions' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/settings-search.png` })
  await searchResults.getByRole('button', { name: 'Browser extensions' }).click()

  // Settings → General → Browser (the search jump lands here; re-click is idempotent).
  const subTabs = page.getByRole('tablist', { name: 'General sub-tabs' })
  await subTabs.getByRole('tab', { name: 'Browser', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Built-in browser profile' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/browser-settings.png` })

  // Extension manager drawer (scoped: the app banner also has a Manage button).
  const settingsRegion = page.getByRole('region', { name: 'Settings' })
  await settingsRegion.getByRole('button', { name: 'Manage', exact: true }).click()
  await expect(page.getByText('Built-in catalog')).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/extensions-drawer.png` })

  // Coding engines tab after the reorder.
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Coding engines', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Coding engines' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/engines.png` })

  // Gateway sub-tab within Coding engines.
  await page.getByRole('tablist', { name: 'Coding engines sub-tabs' }).getByRole('tab', { name: 'Gateway', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ND Gateway' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/engines-gateway.png` })

  // Extensions tab (ND extension packages) must scroll (regression: grid wrapper clipped it).
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Extensions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ND extension packages' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/extensions-tab.png` })

  // Plugins tab (agent plugins manager).
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Plugins', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/plugins-tab.png` })
})
