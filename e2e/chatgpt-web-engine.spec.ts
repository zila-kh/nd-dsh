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

test('interactive chat picker exposes ChatGPT Web without requiring DSH gateway readiness', async () => {
  const { page } = launched
  const enginePicker = page.getByRole('combobox', { name: 'Coding engine' })
  await expect(enginePicker).toBeVisible()
  await enginePicker.click()

  const chatGptOption = page.getByRole('option', { name: 'ChatGPT Web', exact: true })
  await expect(chatGptOption).toBeVisible()
  await expect(chatGptOption).toBeEnabled()
  expect(rendererErrors).toEqual([])
})
