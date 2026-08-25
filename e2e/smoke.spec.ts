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
    const route = label === 'Settings'
      ? /#\/settings\?tab=general$/
      : new RegExp(`#/${label.toLowerCase()}$`)
    await expect(page).toHaveURL(route)
  }
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  expect(rendererErrors).toEqual([])
})

test('Company exposes the AI operations control center', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()
  await expect(page).toHaveURL(/#\/company$/)
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Needs You', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Verification', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signal Inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI Employee Performance', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Company Workspace', exact: true }).click()
  expect(rendererErrors).toEqual([])
})

test('Settings sub-tabs update their addressable route', async () => {
  const { page } = launched
  const navigation = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  await navigation.getByTitle('Settings').click()

  const sections = page.getByRole('tablist', { name: 'Settings sections' })
  await sections.getByRole('tab', { name: 'Capabilities', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\?tab=capabilities$/)

  const subTabs = page.getByRole('tablist', { name: 'Capabilities sub-tabs' })
  await subTabs.getByRole('tab', { name: 'Memory', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\?tab=capabilities&subtab=memory$/)
  await expect(page.getByRole('heading', { name: 'Memory providers', exact: true })).toBeVisible()
  await expect(page.getByText('OpenViking Memory', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set up' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download & Setup' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Not in this release' })).toHaveCount(0)

  await subTabs.getByRole('tab', { name: 'Lifecycle', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\?tab=capabilities&subtab=lifecycle$/)
  await expect(page.getByText('Approved setup only', { exact: true })).toBeVisible()
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

test('Design Live App keeps the workspace and inspector panes usable', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Design').click()

  const workspacePane = page.getByRole('complementary', { name: 'Design workspace' })
  const liveApp = page.getByRole('region', { name: 'Built-in browser' })
  const inspectorPane = page.getByRole('complementary', { name: 'Design inspector' })
  await expect(workspacePane).toBeVisible()
  await expect(liveApp).toBeVisible()
  await expect(inspectorPane).toBeVisible()

  const [workspaceBox, liveAppBox, inspectorBox] = await Promise.all([
    workspacePane.boundingBox(),
    liveApp.boundingBox(),
    inspectorPane.boundingBox(),
  ])
  expect(workspaceBox?.width).toBeGreaterThanOrEqual(200)
  expect(inspectorBox?.width).toBeGreaterThanOrEqual(220)
  expect(liveAppBox?.x).toBeGreaterThanOrEqual((workspaceBox?.x ?? 0) + (workspaceBox?.width ?? 0))
  expect(inspectorBox?.x).toBeGreaterThanOrEqual((liveAppBox?.x ?? 0) + (liveAppBox?.width ?? 0))
})

test('QA opens project checks', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('QA').click()
  await expect(page).toHaveURL(/#\/qa$/)
  await expect(page.getByRole('heading', { name: 'Project checks', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Checks', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(3)
})
