/// <reference lib="dom" />

import { rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { OrganizationDesktopApi, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

type OrganizationWindow = typeof globalThis & {
  ndDshOrganization: OrganizationDesktopApi
}

const MATRIX = [
  { company: 'Beta Taxi Co', mission: 'Ship mobility software.', projects: ['Dispatch RC', 'Driver RC'] },
  { company: 'Beta Commerce Co', mission: 'Ship commerce software.', projects: ['Catalog RC', 'Checkout RC'] },
  { company: 'Beta Tools Co', mission: 'Ship developer tools.', projects: ['Console RC', 'Docs RC'] },
] as const

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
const workspaceDirs: string[] = []
let retainedUserData = ''
const rendererErrors: string[] = []

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
  await Promise.all(workspaceDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('release matrix keeps 3 companies x 2 projects isolated across switching and restart', async () => {
  const created: Array<{ companyId: string; projectId: string; company: string; project: string }> = []

  for (const row of MATRIX) {
    let snapshot = await mutate({ type: 'company.create', name: row.company, mission: row.mission })
    const company = snapshot.companies.find((item) => item.name === row.company)
    expect(company, `company ${row.company} was not created`).toBeTruthy()

    for (const projectName of row.projects) {
      const workspacePath = await createWorkspaceDir()
      workspaceDirs.push(workspacePath)
      snapshot = await mutate({
        type: 'project.create',
        companyId: company!.id,
        name: projectName,
        objective: `Release validation project for ${projectName}`,
        workspacePath,
      })
      const project = snapshot.projects.find((item) => item.companyId === company!.id && item.name === projectName)
      expect(project, `project ${projectName} was not created`).toBeTruthy()

      await mutate({
        type: 'task.create',
        companyId: company!.id,
        projectId: project!.id,
        title: `${projectName} beta smoke`,
        description: 'Prove this task remains inside its owning company and project.',
        acceptanceCriteria: ['Ownership remains exact after switching and restart.'],
      })
      await mutate({
        type: 'memory.add',
        companyId: company!.id,
        projectId: project!.id,
        title: `${projectName} release note`,
        content: `Private beta matrix memory for ${projectName}.`,
        tags: ['beta-matrix'],
      })
      created.push({ companyId: company!.id, projectId: project!.id, company: row.company, project: projectName })
    }
  }

  let snapshot = await state()
  expect(snapshot.companies.filter((item) => MATRIX.some((row) => row.company === item.name))).toHaveLength(3)
  expect(snapshot.projects.filter((item) => created.some((row) => row.projectId === item.id))).toHaveLength(6)
  expect(snapshot.tasks.filter((item) => created.some((row) => row.projectId === item.projectId))).toHaveLength(6)

  const companyIds = new Set(created.map((item) => item.companyId))
  expect(companyIds.size).toBe(3)
  for (const companyId of companyIds) {
    expect(snapshot.projects.filter((item) => item.companyId === companyId && created.some((row) => row.projectId === item.id))).toHaveLength(2)
    expect(snapshot.tasks.filter((item) => item.companyId === companyId && created.some((row) => row.projectId === item.projectId))).toHaveLength(2)
    expect(snapshot.memory.filter((item) => item.companyId === companyId && item.tags.includes('beta-matrix'))).toHaveLength(2)
  }

  const source = created[0]!
  const foreign = created.find((item) => item.companyId !== source.companyId)!
  const forged = await launched.page.evaluate(async ({ companyId, projectId }) => {
    try {
      await (globalThis as OrganizationWindow).ndDshOrganization.mutate({
        type: 'task.create',
        companyId,
        projectId,
        title: 'FORGED beta matrix task',
        description: 'Must be rejected.',
      })
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, { companyId: source.companyId, projectId: foreign.projectId })
  expect(forged).toContain('Project does not belong to company')

  // Repeated switching catches the common class of UI/global-selection bugs:
  // the active selection changes, but durable ownership must never change.
  for (let round = 0; round < 3; round += 1) {
    for (const item of created) {
      snapshot = await mutate({ type: 'project.activate', id: item.projectId })
      expect(snapshot.activeCompanyId).toBe(item.companyId)
      expect(snapshot.activeProjectId).toBe(item.projectId)
      const task = snapshot.tasks.find((candidate) => candidate.projectId === item.projectId)
      expect(task?.companyId).toBe(item.companyId)
      expect(task?.title).toBe(`${item.project} beta smoke`)
    }
  }

  const activeBeforeRestart = created.at(-1)!
  await mutate({ type: 'project.activate', id: activeBeforeRestart.projectId })
  await closeApp(launched, { removeUserData: false })
  launched = await launchApp({ userDataDir: retainedUserData })
  captureRendererErrors(launched)

  snapshot = await state()
  for (const item of created) {
    const project = snapshot.projects.find((candidate) => candidate.id === item.projectId)
    expect(project?.companyId).toBe(item.companyId)
    const tasks = snapshot.tasks.filter((candidate) => candidate.projectId === item.projectId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.companyId).toBe(item.companyId)
    const memory = snapshot.memory.filter((candidate) => candidate.projectId === item.projectId && candidate.tags.includes('beta-matrix'))
    expect(memory).toHaveLength(1)
    expect(memory[0]?.companyId).toBe(item.companyId)
  }
  expect(snapshot.activeCompanyId).toBe(activeBeforeRestart.companyId)
  expect(snapshot.activeProjectId).toBe(activeBeforeRestart.projectId)
  expect(snapshot.tasks.some((item) => item.title === 'FORGED beta matrix task')).toBe(false)
  expect(rendererErrors).toEqual([])
})
