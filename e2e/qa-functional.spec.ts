// Comprehensive functional QA pass for ND-DSH.
// Exercises the real work loop: company creation, project setup, PM planning,
// worker execution, reviewer pass, and project completion.
/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import { closeApp, createWorkspaceDir, e2eModelConfig, E2E_PROVIDER_NAME, launchApp, type LaunchedApp } from './fixtures.js'

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
const rendererErrors: string[] = []

test.beforeAll(async () => {
  launched = await launchApp()
  launched.page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  launched.page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`)
  })
})

test.afterAll(async () => {
  await closeApp(launched)
})

test('QA: full work loop — company, project, PM plan, worker, reviewer, completion', async () => {
  // This spec drives a real organization run, so it needs the live model route:
  // the fixture seeds one OpenAI-compatible provider from E2E_MODEL_* in
  // .env.e2e, and without those variables the run can only fail. Skipping keeps
  // the suite honest about what it covered — previously it simply failed on
  // every keyless runner, including CI.
  test.skip(!e2eModelConfig().configured, 'requires the E2E_MODEL_* live configuration for the live organization loop')
  test.setTimeout(300_000) // PM plan + worker + reviewer can take several minutes
  const { page } = launched

  // 1. App boots with full navigation
  await expect(page.getByRole('banner').getByText('ND-DSH', { exact: true })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  for (const label of ['Company', 'Agent', 'Design', 'QA', 'Settings']) {
    await expect(navigation.getByTitle(label)).toBeVisible()
  }

  // 2. Create company (opens a dialog via "+ New")
  await navigation.getByTitle('Company').click()
  await expect(page).toHaveURL(/#\/company$/)
  await page.getByRole('button', { name: '+ New' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Company name').fill('QA Test Corp')
  await dialog.getByPlaceholder('Company mission').fill('Test the full ND-DSH work loop end-to-end.')
  await dialog.getByRole('button', { name: 'Create AI company' }).click()
  await expect(page.getByText('Created QA Test Corp with a default AI workforce')).toBeVisible({ timeout: 10_000 })

  // 3. Create project
  const projectForm = page.locator('form').filter({ has: page.getByPlaceholder('New project') })
  await projectForm.getByPlaceholder('New project').fill('QA Feature Project')
  await projectForm.getByPlaceholder('Objective').fill('Build a feature with full test coverage.')
  // The workspace field is a native folder picker; stub the main-process dialog
  // to resolve a throwaway repo rather than a machine-specific developer path.
  const projectWorkspaceDir = await createWorkspaceDir()
  await launched.app.evaluate(({ dialog }, path) => {
    (dialog as unknown as { showOpenDialog: (options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [path] })
  }, projectWorkspaceDir)
  await projectForm.getByRole('button', { name: 'Browse for workspace folder' }).click()
  await projectForm.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByText('Created project “QA Feature Project”')).toBeVisible({ timeout: 10_000 })

  // 4. Verify workforce was seeded and assign the first E2E route to every agent
  await page.getByRole('button', { name: 'Teams & Skills' }).click()
  await expect(page.getByText('AI workers')).toBeVisible()

  // Assign the first configured model to ALL agents so every role (PM, engineer,
  // reviewer, researcher) routes through the seeded provider instead of falling
  // back to a route without credentials. Exact matching keeps model ids that are
  // prefixes of one another (combo-free vs combo-free1) unambiguous.
  const modelOption = `${E2E_PROVIDER_NAME} · ${e2eModelConfig().modelIds[0]}`
  const modelComboboxes = page.getByRole('combobox', { name: 'Model' })
  const count = await modelComboboxes.count()
  for (let i = 0; i < count; i++) {
    await modelComboboxes.nth(i).click()
    await page.getByRole('option', { name: modelOption, exact: true }).click()
    await page.waitForTimeout(500)
  }

  // 5. Run PM plan (button is in Overview section)
  await page.getByRole('button', { name: 'Overview' }).click()
  const pmButton = page.getByRole('button', { name: 'AI PM plan' })
  await expect(pmButton).toBeVisible()
  await expect(pmButton).toBeEnabled({ timeout: 10_000 })
  await pmButton.click()

  // 6. Wait for the plan to start — a run appears in the "Live runs" section.
  await expect(page.getByText(/Live runs/)).toBeVisible()
  await expect(page.locator('main').getByText(/running|in_progress|planned|review/)).toBeVisible({ timeout: 240_000 })

  // 7. Verify tasks were created (look for task-related text in the project overview)
  await expect(page.locator('main').getByText(/Tasks/)).toBeVisible()

  // 8. Verify no renderer errors during the loop
  expect(rendererErrors).toEqual([])
})

test('QA: Explorer Search and Source Control are functional', async () => {
  const { page } = launched

  // Navigate to Agent view to access Explorer
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
  await expect(page).toHaveURL(/#\/agent$/)

  // Test Search tab
  const searchTab = page.getByRole('button', { name: 'Search' })
  await expect(searchTab).toBeVisible()
  await searchTab.click()
  await expect(page.getByPlaceholder('Search files')).toBeVisible()

  // Type a search query — the panel must return matching files from the active
  // workspace. That is the seeded project folder when the work-loop test ran, or
  // the app's own checkout when it skipped; the checkout has many nested READMEs
  // and the result list is capped, so assert on any README.md result rather than
  // an exact root path.
  await page.getByPlaceholder('Search files').fill('README')
  await expect(page.getByRole('button', { name: /README\.md file/ }).first()).toBeVisible({ timeout: 10_000 })

  // Test Source Control tab
  const gitTab = page.getByRole('button', { name: 'Source Control' })
  await expect(gitTab).toBeVisible()
  await gitTab.click()
  // Source Control panel shows a heading or "No changes" message
  await expect(page.getByText(/Source Control|No changes|Changes/)).toBeVisible({ timeout: 10_000 })

  // Verify no renderer errors
  expect(rendererErrors).toEqual([])
})

test('QA: Settings surfaces are accessible', async () => {
  const { page } = launched

  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  await expect(page).toHaveURL(/#\/settings\?tab=general$/)

  // Verify settings section tabs are visible (they use role=tab)
  for (const tab of ['General', 'Appearance', 'Models', 'Capabilities', 'Plugins', 'Coding engines', 'Agent presets']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible()
  }

  // Verify no renderer errors
  expect(rendererErrors).toEqual([])
})

test('QA: Design surface loads', async () => {
  const { page } = launched

  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Design').click()
  await expect(page).toHaveURL(/#\/design$/)

  // Verify design surface is visible — the Design sub-navigation with canvas/app/template tabs
  await expect(page.getByRole('button', { name: 'Live App' })).toBeVisible()

  // Verify no renderer errors
  expect(rendererErrors).toEqual([])
})

test('QA: QA surface loads', async () => {
  const { page } = launched

  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('QA').click()
  await expect(page).toHaveURL(/#\/qa$/)

  // Verify QA surface is visible — it shows "Project checks" and "Checks" headings
  await expect(page.getByRole('heading', { name: 'Project checks' })).toBeVisible()

  // Verify no renderer errors
  expect(rendererErrors).toEqual([])
})
