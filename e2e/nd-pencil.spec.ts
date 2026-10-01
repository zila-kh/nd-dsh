/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'
import { electronTargetIdentity } from '../scripts/e2e-electron-target.mjs'
import type { DesignDesktopApi } from '../src/shared/design.js'
import type { OrganizationDesktopApi } from '../src/shared/organization.js'
import type { WebContents, WebPreferences } from 'electron'

type DesignWindow = typeof globalThis & { ndDshDesign: DesignDesktopApi; ndDshOrganization: OrganizationDesktopApi }

test('bundled ND Pencil edits, saves and reopens a project design', async () => {
  const target = electronTargetIdentity()
  test.skip(target.kind !== 'packaged', 'Requires the bundled ND Pencil release runtime.')
  const output = join(process.cwd(), 'e2e-results', `nd-pencil-release-${Date.now()}`)
  await mkdir(output, { recursive: true })
  const workspace = await createWorkspaceDir()
  let launched: LaunchedApp | undefined
  const errors: string[] = []
  try {
    launched = await launchApp()
    const { page, app } = launched
    for (const child of app.context().pages()) child.on('pageerror', (error) => errors.push(error.message))
    app.context().on('page', (child) => child.on('pageerror', (error) => errors.push(error.message)))
    await page.evaluate(async (workspacePath) => {
      const organization = await (globalThis as DesignWindow).ndDshOrganization.mutate({ type: 'company.create', name: 'Pencil Release Check', mission: 'Verify the bundled design surface.' })
      const company = organization.companies.find((item) => item.name === 'Pencil Release Check')!
      const state = await (globalThis as DesignWindow).ndDshOrganization.mutate({ type: 'project.create', companyId: company.id, name: 'Pencil Check', objective: 'Create and save a design.', workspacePath })
      const project = state.projects.find((item) => item.companyId === company.id && item.name === 'Pencil Check')!
      await (globalThis as DesignWindow).ndDshOrganization.mutate({ type: 'project.activate', id: project.id })
    }, workspace)
    await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Design').click()
    await page.getByRole('button', { name: /^ND Pencil/ }).click()
    await page.getByTitle('Collapse left panel', { exact: true }).click()
    await page.getByTitle('Collapse right panel', { exact: true }).click()
    await page.getByRole('button', { name: 'New ND Pencil Canvas' }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).status, { timeout: 45_000 }).toBe('ready')
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).dirty).toBe(false)
    const opened = await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())
    expect(opened.available).toBe(true)
    expect(opened.engine).toBe('nd-pencil')
    expect(opened.documentPath).toMatch(/\.op$/)
    const documentFile = join(workspace, opened.documentPath!)
    const initial = await readFile(documentFile, 'utf8')
    expect(() => JSON.parse(initial)).not.toThrow()
    const prefs = await app.evaluate(({ webContents }) => {
      const view = webContents.getAllWebContents().find((item) => item.getURL().includes('?frame='))
      if (!view) throw new Error('ND Pencil child view is missing')
      const p = (view as WebContents & { getLastWebPreferences(): WebPreferences }).getLastWebPreferences()
      return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox }
    })
    expect(prefs).toEqual({ nodeIntegration: false, contextIsolation: true, sandbox: true })
    const editor = app.context().pages().flatMap((item) => item.frames()).find((frame) => frame.url().includes('embed=vscode'))
    if (!editor) throw new Error('ND Pencil editor frame is missing')
    await expect(editor.getByRole('application')).toHaveAttribute('aria-label', 'ND Pencil editor')
    const capture = async (name: string) => {
      const png = await app.evaluate(async ({ webContents }) => {
        const view = webContents.getAllWebContents().find((item) => item.getURL().includes('?frame='))!
        return (await view.capturePage()).toPNG().toString('base64')
      })
      await writeFile(join(output, name), Buffer.from(png, 'base64'))
    }
    await capture('01-editor-open.png')
    // Real input goes to ND's canonical child view. R selects Rectangle; the
    // visible shape slot opens a picker and does not itself select a tool.
    await app.evaluate(async ({ webContents }) => {
      const view = webContents.getAllWebContents().find((item) => item.getURL().includes('?frame='))!
      view.focus()
      view.sendInputEvent({ type: 'keyDown', keyCode: 'R' })
      view.sendInputEvent({ type: 'keyUp', keyCode: 'R' })
      await new Promise((done) => setTimeout(done, 100))
      const send = async (type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number) => {
        view.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 })
        await new Promise((done) => setTimeout(done, 40))
      }
      await send('mouseMove', 350, 180)
      await send('mouseDown', 350, 180)
      for (let step = 1; step <= 8; step++) await send('mouseMove', 350 + step * 12, 180 + step * 12)
      await send('mouseUp', 446, 276)
    })
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).dirty).toBe(true)
    await capture('02-rectangle.png')
    await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).dirty).toBe(false)
    const saved = await readFile(documentFile, 'utf8')
    expect(() => JSON.parse(saved)).not.toThrow()
    expect(saved).not.toBe(initial)
    expect(saved).toContain('Rectangle')
    await page.getByTitle('Close Canvas', { exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).documentPath).toBeUndefined()
    await page.getByRole('button', { name: /^ND Pencil/ }).click()
    await page.getByText(opened.documentPath!.split('/').at(-1)!, { exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())).status, { timeout: 45_000 }).toBe('ready')
    const reopened = await page.evaluate(() => (globalThis as DesignWindow).ndDshDesign.freeformState())
    expect(reopened.documentPath).toBe(opened.documentPath)
    expect(reopened.dirty).toBe(false)
    expect(await readFile(documentFile, 'utf8')).toBe(saved)
    await capture('03-reopened.png')
    expect(errors).toEqual([])
    await writeFile(join(output, 'functional-result.json'), JSON.stringify({ target, prefs, opened, reopened, savedSha256: createHash('sha256').update(saved).digest('hex'), errors }, null, 2))
  } finally {
    await closeApp(launched)
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'pass', target, cleanup: 'pass', finishedAt: new Date().toISOString() }, null, 2))
})
