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

test('plugin catalog settings expose search, installed, built-in, and all seven surfaces', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Plugins', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
  await expect(page.getByLabel('Search plugins')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Installed', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Built-in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Plugin', exact: true })).toBeVisible()

  for (const surface of ['Plugins', 'MCP Servers', 'Skills', 'Commands', 'Hooks', 'Subagents', 'Memory']) {
    await expect(page.getByRole('button', { name: surface, exact: true })).toBeVisible()
  }

  await page.getByLabel('Search plugins').fill('counter')
  await expect(page.getByRole('button', { name: /Counter Plugin Demo/ })).toBeVisible()
  await page.getByLabel('Search plugins').fill('not-a-real-capability')
  await expect(page.getByText('No plugins installed', { exact: true })).toBeVisible()
  await page.getByLabel('Search plugins').fill('')
  expect(rendererErrors).toEqual([])
})

test('all seven agent capability surfaces ship an executable Counter demo', async () => {
  const { page } = launched
  await expect(page).toHaveURL(/#\/settings\?tab=extensions$/)

  const surfaces = [
    ['Memory', 'Counter Memory Demo'],
    ['Subagents', 'Counter Subagent Demo'],
    ['Plugins', 'Counter Plugin Demo'],
    ['MCP Servers', 'Counter MCP Demo'],
    ['Skills', 'Counter Skill Demo'],
    ['Commands', 'Counter Command Demo'],
    ['Hooks', 'Counter Hook Demo'],
  ] as const

  for (const [surface, demoName] of surfaces) {
    await page.getByRole('button', { name: surface, exact: true }).click()
    await page.getByRole('button', { name: new RegExp(demoName) }).click()
    await expect(page.getByText('Counter route smoke test', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Run demo', exact: true }).click()
    await expect(page.getByText(new RegExp(`${demoName} .*counter=`))).toBeVisible()
  }

  expect(rendererErrors).toEqual([])
})

test('custom extension settings persist through the trusted desktop bridge', async () => {
  const { page } = launched
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'Add Plugin', exact: true }).click()
  await expect(page.getByText('Custom', { exact: true }).last()).toBeVisible()

  const name = page.getByPlaceholder('Name', { exact: true })
  await name.fill('E2E Routed Plugin')
  await page.getByPlaceholder('Description', { exact: true }).fill('Persisted universal routing test.')
  await page.getByPlaceholder('Portable instructions delivered when this extension route is active.', { exact: true }).fill('Use the E2E plugin instructions.')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByText('E2E Routed Plugin', { exact: true })).toBeVisible()

  const enabled = page.getByLabel('Enabled for real runs')
  await enabled.click()
  await expect(enabled).toHaveAttribute('aria-checked', 'true')

  // Navigate away and back so ExtensionSettings remounts and reloads the
  // catalog through the trusted main-process bridge instead of React state.
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await expect(page.getByText('E2E Routed Plugin', { exact: true })).toBeVisible()
  expect(rendererErrors).toEqual([])
})
