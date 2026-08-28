import { expect, test } from '@playwright/test'
import type { TerminalDesktopApi } from '../src/shared/terminal.js'
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

test('dedicated terminal runs a real PTY command through the sandboxed bridge', async () => {
  const { page } = launched
  const result = await page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { ndDshTerminal: TerminalDesktopApi }).ndDshTerminal
    const sessionId = `terminal-e2e-${Date.now()}`
    const marker = 'ND_TERMINAL_E2E_OK'
    const created = await api.create({ sessionId, title: 'E2E terminal' })
    const terminal = created.terminals[0]
    if (!terminal) throw new Error('Terminal was not created')
    try {
      const streamed = await new Promise<string>((resolve, reject) => {
        let output = ''
        const timeout = setTimeout(() => { off(); reject(new Error('Timed out waiting for PTY output')) }, 15_000)
        const off = api.onOutput((event) => {
          if (event.sessionId !== sessionId || event.terminalId !== terminal.id) return
          output += event.data
          if (output.includes(marker)) { clearTimeout(timeout); off(); resolve(output) }
        })
        void api.write(sessionId, terminal.id, `node -e "console.log(Buffer.from('TkRfVEVSTUlOQUxfRTJFX09L','base64').toString())"\r`).catch((error) => { clearTimeout(timeout); off(); reject(error) })
      })
      const latest = await api.state(sessionId)
      const snapshot = latest.terminals.find((item) => item.id === terminal.id)
      if (!snapshot) throw new Error('Terminal disappeared after command execution')
      return { streamed, buffer: snapshot.buffer, status: snapshot.status, shell: snapshot.shell }
    } finally {
      await api.close(sessionId, terminal.id).catch(() => undefined)
    }
  })
  expect(result.streamed).toContain('ND_TERMINAL_E2E_OK')
  expect(result.buffer).toContain('ND_TERMINAL_E2E_OK')
  expect(result.status).toBe('running')
  expect(result.shell.length).toBeGreaterThan(0)
  expect(rendererErrors).toEqual([])
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

test('Company exposes operations and long-horizon strategy controls', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()
  await expect(page).toHaveURL(/#\/company$/)
  await page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      ndDshOrganization: {
        state(): Promise<{ companies: Array<{ id: string }> }>
        mutate(value: { type: 'company.create'; name: string; mission: string }): Promise<unknown>
      }
    }).ndDshOrganization
    const state = await api.state()
    if (state.companies.length === 0) {
      await api.mutate({
        type: 'company.create',
        name: 'E2E Company',
        mission: 'Verify the AI company operations surface',
      })
    }
  })
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Needs You', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Verification', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signal Inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI Employee Performance', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Strategy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Release Readiness', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Strategic Anchors', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Company Brain', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scheduled Company Work', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Human Review Feed', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Action Audit', exact: true })).toBeVisible()

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
  // Electron can report CSS layout widths on fractional device pixels even
  // when the resizable panel has enforced its integer-pixel minimum.
  expect(Math.round(workspaceBox?.width ?? 0)).toBeGreaterThanOrEqual(200)
  expect(Math.round(inspectorBox?.width ?? 0)).toBeGreaterThanOrEqual(220)
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
