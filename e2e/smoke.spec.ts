import { expect, test } from '@playwright/test'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

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

test('product shell boots with the full navigation', async () => {
  const { page } = launched
  await expect(page.getByRole('banner').getByText('ND-DSH', { exact: true })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  for (const label of ['Company', 'Agent', 'Design', 'QA', 'Settings']) {
    await expect(navigation.getByTitle(label)).toBeVisible()
  }
})

test('primary surfaces switch without renderer errors', async () => {
  const { page } = launched
  const navigation = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  for (const label of ['Company', 'Agent', 'Design', 'QA', 'Settings']) {
    await navigation.getByTitle(label).click()
    await expect(page).toHaveURL(new RegExp(`#/${label.toLowerCase()}$`))
  }
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  expect(rendererErrors).toEqual([])
})

test('theme persistence and embedded browser controls respond', async () => {
  const { page } = launched
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
  const panes = page.getByRole('tablist', { name: 'Agent workspace panes' })
  await panes.getByRole('button', { name: 'Browser' }).click()
  await expect(page.getByRole('region', { name: 'Built-in browser' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue('about:blank')
  await panes.getByRole('button', { name: 'Files' }).click()

  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'System' }).click()
  expect(rendererErrors).toEqual([])
})

test('QA opens the test-runner panel', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('QA').click()
  await expect(page).toHaveURL(/#\/qa$/)
  await expect(page.getByRole('heading', { name: 'QA', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Suites', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Live output', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(2)
})
