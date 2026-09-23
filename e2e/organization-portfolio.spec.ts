/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import type { OrganizationDesktopApi, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

type OrganizationWindow = typeof globalThis & {
  ndDshOrganization: OrganizationDesktopApi
}

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
let retainedUserData = ''
const rendererErrors: string[] = []

const COMPANY_A = {
  name: 'SwiftCab Labs',
  mission: 'Build small, reliable mobility products.',
}

const COMPANY_B = {
  name: 'TinyCart Studio',
  mission: 'Build focused commerce tools for small sellers.',
}

const PROJECTS = {
  dispatch: { name: 'Dispatch Lite', objective: 'Coordinate a tiny local taxi fleet.' },
  driver: { name: 'Driver Pocket', objective: 'Give drivers a minimal job queue.' },
  catalog: { name: 'Catalog Mini', objective: 'Manage a tiny product catalog.' },
}

function captureRendererErrors(app: LaunchedApp): void {
  app.page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  app.page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`)
  })
}

async function state(): Promise<OrganizationSnapshot> {
  return await launched.page.evaluate(async () => {
    return await (globalThis as OrganizationWindow).ndDshOrganization.state()
  })
}

async function mutate(input: Parameters<OrganizationDesktopApi['mutate']>[0]): Promise<OrganizationSnapshot> {
  return await launched.page.evaluate(async (mutation) => {
    return await (globalThis as OrganizationWindow).ndDshOrganization.mutate(mutation)
  }, input)
}

test.beforeAll(async () => {
  launched = await launchApp()
  retainedUserData = launched.userDataDir
  captureRendererErrors(launched)
})

test.afterAll(async () => {
  await closeApp(launched).catch(() => undefined)
})

test('creates two companies, three projects and four tiny tasks with hard ownership boundaries', async () => {
  const dispatchWorkspace = await createWorkspaceDir()
  const driverWorkspace = await createWorkspaceDir()
  const catalogWorkspace = await createWorkspaceDir()

  let snapshot = await mutate({ type: 'company.create', ...COMPANY_A })
  const companyA = snapshot.companies.find((item) => item.name === COMPANY_A.name)
  expect(companyA).toBeTruthy()

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyA!.id,
    name: PROJECTS.dispatch.name,
    objective: PROJECTS.dispatch.objective,
    workspacePath: dispatchWorkspace,
  })
  const dispatch = snapshot.projects.find((item) => item.name === PROJECTS.dispatch.name)
  expect(dispatch?.companyId).toBe(companyA!.id)

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyA!.id,
    name: PROJECTS.driver.name,
    objective: PROJECTS.driver.objective,
    workspacePath: driverWorkspace,
  })
  const driver = snapshot.projects.find((item) => item.name === PROJECTS.driver.name)
  expect(driver?.companyId).toBe(companyA!.id)

  await mutate({
    type: 'task.create',
    companyId: companyA!.id,
    projectId: dispatch!.id,
    title: 'Dispatch status badge',
    description: 'Show whether a taxi is available or busy.',
    acceptanceCriteria: ['Available and busy states are visible.'],
  })
  await mutate({
    type: 'task.create',
    companyId: companyA!.id,
    projectId: dispatch!.id,
    title: 'Dispatch search',
    description: 'Filter the tiny fleet by driver name.',
    acceptanceCriteria: ['Typing a driver name filters the list.'],
  })
  await mutate({
    type: 'task.create',
    companyId: companyA!.id,
    projectId: driver!.id,
    title: 'Driver job card',
    description: 'Show one assigned pickup as a compact card.',
    acceptanceCriteria: ['Pickup and destination are visible.'],
  })
  await mutate({
    type: 'memory.add',
    companyId: companyA!.id,
    projectId: dispatch!.id,
    title: 'Dispatch tone',
    content: 'Use short labels suitable for a small operations screen.',
    tags: ['ui'],
  })

  snapshot = await mutate({ type: 'company.create', ...COMPANY_B })
  const companyB = snapshot.companies.find((item) => item.name === COMPANY_B.name)
  expect(companyB).toBeTruthy()
  expect(companyB!.id).not.toBe(companyA!.id)

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyB!.id,
    name: PROJECTS.catalog.name,
    objective: PROJECTS.catalog.objective,
    workspacePath: catalogWorkspace,
  })
  const catalog = snapshot.projects.find((item) => item.name === PROJECTS.catalog.name)
  expect(catalog?.companyId).toBe(companyB!.id)

  await mutate({
    type: 'task.create',
    companyId: companyB!.id,
    projectId: catalog!.id,
    title: 'Catalog item row',
    description: 'Render one compact product row with price and stock.',
    acceptanceCriteria: ['Name, price and stock are visible.'],
  })
  await mutate({
    type: 'memory.add',
    companyId: companyB!.id,
    projectId: catalog!.id,
    title: 'Catalog rule',
    content: 'Prices always use two decimal places.',
    tags: ['commerce'],
  })

  snapshot = await state()

  expect(snapshot.companies).toHaveLength(2)
  expect(snapshot.projects.filter((item) => item.companyId === companyA!.id)).toHaveLength(2)
  expect(snapshot.projects.filter((item) => item.companyId === companyB!.id)).toHaveLength(1)
  expect(snapshot.tasks.filter((item) => item.companyId === companyA!.id)).toHaveLength(3)
  expect(snapshot.tasks.filter((item) => item.companyId === companyB!.id)).toHaveLength(1)

  // Every company must own a distinct seeded workforce instead of silently
  // sharing roles, teams or agents with the other tenant.
  const aRoles = snapshot.roles.filter((item) => item.companyId === companyA!.id)
  const bRoles = snapshot.roles.filter((item) => item.companyId === companyB!.id)
  const aTeams = snapshot.teams.filter((item) => item.companyId === companyA!.id)
  const bTeams = snapshot.teams.filter((item) => item.companyId === companyB!.id)
  const aAgents = snapshot.agents.filter((item) => item.companyId === companyA!.id)
  const bAgents = snapshot.agents.filter((item) => item.companyId === companyB!.id)

  expect(aRoles).toHaveLength(4)
  expect(bRoles).toHaveLength(4)
  expect(aTeams).toHaveLength(3)
  expect(bTeams).toHaveLength(3)
  expect(aAgents).toHaveLength(4)
  expect(bAgents).toHaveLength(4)
  expect(aRoles.some((left) => bRoles.some((right) => right.id === left.id))).toBe(false)
  expect(aTeams.some((left) => bTeams.some((right) => right.id === left.id))).toBe(false)
  expect(aAgents.some((left) => bAgents.some((right) => right.id === left.id))).toBe(false)

  expect(snapshot.memory.filter((item) => item.companyId === companyA!.id)).toHaveLength(1)
  expect(snapshot.memory.filter((item) => item.companyId === companyB!.id)).toHaveLength(1)
  expect(rendererErrors).toEqual([])
})

test('rejects forged cross-company task ownership and agent assignment', async () => {
  const snapshot = await state()
  const companyA = snapshot.companies.find((item) => item.name === COMPANY_A.name)!
  const companyB = snapshot.companies.find((item) => item.name === COMPANY_B.name)!
  const catalog = snapshot.projects.find((item) => item.name === PROJECTS.catalog.name)!
  const companyAAgent = snapshot.agents.find((item) => item.companyId === companyA.id)!

  const wrongProject = await launched.page.evaluate(async ({ companyId, projectId }) => {
    try {
      await (globalThis as OrganizationWindow).ndDshOrganization.mutate({
        type: 'task.create',
        companyId,
        projectId,
        title: 'FORGED cross-company task',
        description: 'This must never be accepted.',
      })
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { companyId: companyA.id, projectId: catalog.id })

  expect(wrongProject).toContain('Project does not belong to company')

  const wrongAgent = await launched.page.evaluate(async ({ companyId, projectId, assignedAgentId }) => {
    try {
      await (globalThis as OrganizationWindow).ndDshOrganization.mutate({
        type: 'task.create',
        companyId,
        projectId,
        title: 'FORGED cross-company agent',
        description: 'This must never be accepted.',
        assignedAgentId,
      })
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { companyId: companyB.id, projectId: catalog.id, assignedAgentId: companyAAgent.id })

  expect(wrongAgent).toContain('Assigned agent crosses company boundary')
  expect((await state()).tasks.some((item) => item.title.startsWith('FORGED'))).toBe(false)
})

test('top-level company and project switchers expose only the selected portfolio', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()

  const companySwitcher = page.getByRole('combobox', { name: 'Switch company' })
  const projectSwitcher = page.getByRole('combobox', { name: 'Switch project' })

  await companySwitcher.click()
  await page.getByRole('option', { name: COMPANY_A.name }).click()
  await expect(companySwitcher).toContainText(COMPANY_A.name)

  await projectSwitcher.click()
  await expect(page.getByRole('option', { name: PROJECTS.dispatch.name })).toBeVisible()
  await expect(page.getByRole('option', { name: PROJECTS.driver.name })).toBeVisible()
  await expect(page.getByRole('option', { name: PROJECTS.catalog.name })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await projectSwitcher.click()
  await page.getByRole('option', { name: PROJECTS.dispatch.name }).click()
  await expect(projectSwitcher).toContainText(PROJECTS.dispatch.name)

  // The active Company Workspace board must show only this project's work.
  await page.getByRole('button', { name: 'Company Workspace', exact: true }).click()
  await expect(page.getByText('Dispatch status badge', { exact: true })).toBeVisible()
  await expect(page.getByText('Dispatch search', { exact: true })).toBeVisible()
  await expect(page.getByText('Driver job card', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Catalog item row', { exact: true })).toHaveCount(0)

  await companySwitcher.click()
  await page.getByRole('option', { name: COMPANY_B.name }).click()
  await expect(companySwitcher).toContainText(COMPANY_B.name)
  await expect(projectSwitcher).toContainText(PROJECTS.catalog.name)

  await expect(page.getByText('Catalog item row', { exact: true })).toBeVisible()
  await expect(page.getByText('Dispatch status badge', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Driver job card', { exact: true })).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

test('organization portfolio survives a full Electron restart with the same profile', async () => {
  const before = await state()
  const companyA = before.companies.find((item) => item.name === COMPANY_A.name)!
  const dispatch = before.projects.find((item) => item.name === PROJECTS.dispatch.name)!

  await mutate({ type: 'project.activate', id: dispatch.id })
  const selected = await state()
  expect(selected.activeCompanyId).toBe(companyA.id)
  expect(selected.activeProjectId).toBe(dispatch.id)

  await closeApp(launched, { removeUserData: false })
  launched = await launchApp({ userDataDir: retainedUserData })
  captureRendererErrors(launched)

  const after = await state()
  expect(after.companies.map((item) => item.name).sort()).toEqual([COMPANY_A.name, COMPANY_B.name].sort())
  expect(after.projects.map((item) => item.name).sort()).toEqual([
    PROJECTS.dispatch.name,
    PROJECTS.driver.name,
    PROJECTS.catalog.name,
  ].sort())
  expect(after.tasks.map((item) => item.title).sort()).toEqual([
    'Dispatch status badge',
    'Dispatch search',
    'Driver job card',
    'Catalog item row',
  ].sort())
  expect(after.activeCompanyId).toBe(companyA.id)
  expect(after.activeProjectId).toBe(dispatch.id)

  const companyB = after.companies.find((item) => item.name === COMPANY_B.name)!
  const catalog = after.projects.find((item) => item.name === PROJECTS.catalog.name)!
  expect(after.tasks.filter((item) => item.companyId === companyA.id).every((item) => item.projectId !== catalog.id)).toBe(true)
  expect(after.tasks.filter((item) => item.companyId === companyB.id).every((item) => item.projectId === catalog.id)).toBe(true)
  expect(rendererErrors).toEqual([])
})
