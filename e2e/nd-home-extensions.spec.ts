/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import type { NdCommandView, NdExtensionsStateView, NdHomeStateView } from '../src/shared/nd-invocations.js'
import type { NdContext } from '../src/shared/nd-context.js'
import type { OrganizationDesktopApi, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

type NdPlatformWindow = typeof globalThis & {
  ndDshOrganization: OrganizationDesktopApi
  ndDsh: {
    home: {
      state(): Promise<NdHomeStateView>
    }
    ndExtensions: {
      state(): Promise<NdExtensionsStateView>
      commands(context: NdContext): Promise<NdCommandView[]>
      setActivation(extensionId: string, context: NdContext, enabled: boolean): Promise<NdExtensionsStateView>
    }
  }
}

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
let companyId = ''
let projectId = ''
const rendererErrors: string[] = []

const COMPANY = 'Home Labs'
const PROJECT = 'Personal Console'

async function homeState(): Promise<NdHomeStateView> {
  return await launched.page.evaluate(async () => await (globalThis as NdPlatformWindow).ndDsh.home.state())
}

async function extensionState(): Promise<NdExtensionsStateView> {
  return await launched.page.evaluate(async () => await (globalThis as NdPlatformWindow).ndDsh.ndExtensions.state())
}

async function commandsFor(context: NdContext): Promise<NdCommandView[]> {
  return await launched.page.evaluate(async (target) => await (globalThis as NdPlatformWindow).ndDsh.ndExtensions.commands(target), context)
}

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

test('ND Home saves a personal note before any company or project exists', async () => {
  const snapshot = await launched.page.evaluate(async () => await (globalThis as NdPlatformWindow).ndDshOrganization.state()) as OrganizationSnapshot
  expect(snapshot.companies).toEqual([])

  await launched.page.getByRole('button', { name: 'Home' }).click()
  await expect(launched.page.getByText('ND Home').first()).toBeVisible()

  await launched.page.getByPlaceholder('Write a note…').fill('Buy two monitors')
  await launched.page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(launched.page.getByText('Buy two monitors').first()).toBeVisible()

  const state = await homeState()
  expect(state.notes.some((note) => note.title === 'Buy two monitors')).toBe(true)
  expect(state.notes.every((note) => note.contextKey === 'personal')).toBe(true)
  expect(rendererErrors).toEqual([])
})

test('the launcher defaults to Personal and writes notes into ND Home', async () => {
  await launched.page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const dialog = launched.page.getByRole('dialog', { name: 'ND Quick Launcher' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Personal', { exact: true }).first()).toBeVisible()

  const input = dialog.getByPlaceholder('Search ND or type something to capture…')
  await input.fill('Launcher personal note')
  await dialog.getByText(/Quick note · Launcher personal note/).click()

  await expect.poll(async () => (await homeState()).notes.some((note) => note.title === 'Launcher personal note')).toBe(true)
  expect(rendererErrors).toEqual([])
})

test('extension packages install with Personal activation and project-only commands stay scoped', async () => {
  const workspace = await createWorkspaceDir()
  const ids = await launched.page.evaluate(async ({ workspacePath, companyName, projectName }) => {
    const api = (globalThis as NdPlatformWindow).ndDshOrganization
    let snapshot = await api.mutate({ type: 'company.create', name: companyName, mission: 'Exercise extension contexts.' })
    const company = snapshot.companies.find((item) => item.name === companyName)
    if (!company) throw new Error('Company was not created')
    snapshot = await api.mutate({ type: 'project.create', companyId: company.id, name: projectName, objective: 'Verify project-scoped extensions.', workspacePath })
    const project = snapshot.projects.find((item) => item.name === projectName)
    if (!project) throw new Error('Project was not created')
    return { companyId: company.id, projectId: project.id }
  }, { workspacePath: workspace, companyName: COMPANY, projectName: PROJECT })
  companyId = ids.companyId
  projectId = ids.projectId

  const state = await extensionState()
  expect(state.packages.map((item) => item.id)).toEqual(expect.arrayContaining(['nd.daily-essentials', 'nd.project-workflow']))
  expect(state.activations.some((record) => record.extensionId === 'nd.daily-essentials' && record.contextKey === 'personal' && record.enabled)).toBe(true)

  const personalCommands = await commandsFor({ kind: 'personal' })
  expect(personalCommands.map((command) => command.extensionId)).toContain('nd.daily-essentials')
  expect(personalCommands.map((command) => command.extensionId)).not.toContain('nd.project-workflow')

  const projectContext: NdContext = { kind: 'project', companyId, projectId }
  const beforeActivation = await commandsFor(projectContext)
  expect(beforeActivation.map((command) => command.extensionId)).not.toContain('nd.project-workflow')

  await launched.page.evaluate(async ({ extensionId, context }) => {
    await (globalThis as NdPlatformWindow).ndDsh.ndExtensions.setActivation(extensionId, context, true)
  }, { extensionId: 'nd.project-workflow', context: projectContext })

  await expect.poll(async () => (await commandsFor(projectContext)).map((command) => command.extensionId)).toContain('nd.project-workflow')
  const stillPersonal = await commandsFor({ kind: 'personal' })
  expect(stillPersonal.map((command) => command.extensionId)).not.toContain('nd.project-workflow')

  // The management surface mirrors the same records.
  await launched.page.getByLabel('ND-DSH navigation').getByRole('button', { name: 'Settings' }).click()
  await launched.page.getByRole('tab', { name: 'Extensions' }).click()
  await expect(launched.page.getByText('Extension packages')).toBeVisible()
  await expect(launched.page.getByText('Project Workflow', { exact: true })).toBeVisible()
  await expect(launched.page.getByRole('button', { name: new RegExp(`^${COMPANY} · ${PROJECT} ✓$`) })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

test('Quit Processes appears in Available and installs only on demand', async () => {
  const before = await extensionState()
  expect(before.available?.find((item) => item.id === 'nd.quit-process')).toMatchObject({ available: true, installed: false })

  await launched.page.getByLabel('ND-DSH navigation').getByRole('button', { name: 'Settings' }).click()
  await launched.page.getByRole('tab', { name: 'Extensions' }).click()
  await launched.page.getByRole('button', { name: 'Install', exact: true }).click()
  await expect.poll(async () => (await extensionState()).packages.some((item) => item.id === 'nd.quit-process')).toBe(true)

  await launched.page.evaluate(async () => {
    await (globalThis as NdPlatformWindow).ndDsh.ndExtensions.setActivation('nd.quit-process', { kind: 'personal' }, true)
  })
  const open = launched.page.getByRole('button', { name: 'Open Running processes' })
  await expect(open).toBeEnabled()
  await open.click()
  await expect(launched.page.getByRole('dialog', { name: 'Running processes' })).toBeVisible()
  await expect(launched.page.getByText(/PID \d+ · CPU/).first()).toBeVisible()
  expect(rendererErrors).toEqual([])
})
