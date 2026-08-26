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

test('custom MCP stdio transport persists command, args, and secret references', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: /^MCP Servers\b/ }).click()
  await page.getByRole('button', { name: 'Add MCP Server', exact: true }).click()

  await page.getByPlaceholder('Name').fill('E2E Custom MCP')
  await page.getByPlaceholder('Description').fill('Custom executable transport persistence test.')
  await page.getByPlaceholder('Portable instructions delivered when this extension route is active.').fill('Use the routed E2E MCP tools.')
  await page.getByPlaceholder('MCP command, e.g. npx').fill('node')
  await page.getByPlaceholder(/One argument per line/).fill('examples/extension-counter/mcp-server.mjs')
  await page.getByPlaceholder(/Environment references/).fill('TEST_TOKEN=E2E_PARENT_TEST_TOKEN')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()

  await expect(page.getByText('E2E Custom MCP', { exact: true })).toBeVisible()

  // Force the settings component to remount and read through IPC again.
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: /^MCP Servers\b/ }).click()
  await page.getByRole('button', { name: /E2E Custom MCP/ }).click()

  await expect(page.getByPlaceholder('MCP command, e.g. npx')).toHaveValue('node')
  await expect(page.getByPlaceholder(/One argument per line/)).toHaveValue('examples/extension-counter/mcp-server.mjs')
  await expect(page.getByPlaceholder(/Environment references/)).toHaveValue('TEST_TOKEN=E2E_PARENT_TEST_TOKEN')
})
