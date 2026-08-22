import { expect, test } from '@playwright/test'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await closeApp(launched)
})

test('product shell boots with the full navigation', async () => {
  const { page } = launched
  await expect(page.locator('.product-brand')).toContainText('ND-DSH')
  for (const label of ['Company', 'Agent', 'Design', 'QA', 'Settings']) {
    await expect(page.locator(`.product-nav button[title="${label}"]`)).toBeVisible()
  }
})

test('QA opens the test-runner panel', async () => {
  const { page } = launched
  await page.locator('.product-nav button[title="QA"]').click()
  await expect(page.locator('.product-view.active .qa-shell')).toBeVisible()
  await expect(page.locator('.qa-shell h1')).toHaveText('QA')
  await expect(page.locator('.qa-shell .settings-row')).toHaveCount(2)
})
