/// <reference lib="dom" />

import 'dotenv/config'

import { expect, test } from '@playwright/test'
import type { OrganizationDesktopApi, OrganizationRun, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

type OrganizationWindow = typeof globalThis & {
  ndDshOrganization: OrganizationDesktopApi
}

const BASE_URL = process.env.E2E_MODEL_BASE_URL?.trim() ?? ''
const API_KEY = process.env.E2E_MODEL_API_KEY?.trim() ?? ''
const MODELS = [
  process.env.E2E_MODEL_1?.trim() ?? '',
  process.env.E2E_MODEL_2?.trim() ?? '',
  process.env.E2E_MODEL_3?.trim() ?? '',
]
const ANY_MODEL_ENV = Boolean(BASE_URL || API_KEY || MODELS.some(Boolean))
const MODEL_ENV_READY = Boolean(BASE_URL && API_KEY && MODELS.every(Boolean))

if (ANY_MODEL_ENV && !MODEL_ENV_READY) {
  throw new Error(
    'Incomplete E2E model configuration. Set E2E_MODEL_BASE_URL, E2E_MODEL_API_KEY, E2E_MODEL_1, E2E_MODEL_2 and E2E_MODEL_3 together.',
  )
}

const PROVIDER_ID = 'e2e-openai-compatible'
const COMPANY_A = 'SwiftCab Live'
const COMPANY_B = 'TinyCart Live'

let launched: LaunchedApp

test.describe.configure({ mode: 'serial' })
test.skip(!MODEL_ENV_READY, 'Set the shared OpenAI-compatible E2E_MODEL_* variables in .env to run live portfolio models.')

test.beforeAll(async () => {
  launched = await launchApp({ useConfiguredModels: true })
})

test.afterAll(async () => {
  await closeApp(launched)
})

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

async function terminalTaskState(taskId: string): Promise<{
  snapshot: OrganizationSnapshot
  run: OrganizationRun
}> {
  let last: OrganizationSnapshot | undefined
  await expect.poll(async () => {
    last = await state()
    const task = last.tasks.find((item) => item.id === taskId)
    return task?.status ?? 'missing'
  }, {
    timeout: 12 * 60_000,
    intervals: [1_000, 2_000, 5_000, 10_000],
    message: `task ${taskId} did not finish its current stage`,
  }).toMatch(/^(review|completed|blocked)$/)

  const snapshot = last ?? await state()
  const runs = snapshot.runs
    .filter((item) => item.taskId === taskId && item.kind === 'task-execution')
    .sort((left, right) => right.startedAt - left.startedAt)
  const run = runs[0]
  if (!run) throw new Error(`No execution run recorded for task ${taskId}`)
  return { snapshot, run }
}

async function completedTaskState(taskId: string): Promise<OrganizationSnapshot> {
  await expect.poll(async () => {
    const snapshot = await state()
    return snapshot.tasks.find((item) => item.id === taskId)?.status ?? 'missing'
  }, {
    timeout: 12 * 60_000,
    intervals: [1_000, 2_000, 5_000, 10_000],
    message: `task ${taskId} did not complete review/integration`,
  }).toMatch(/^(completed|blocked)$/)
  return await state()
}

function executionRoute(run: OrganizationRun): { provider?: string; model?: string } {
  const match = run.output?.match(/<nd-dsh-execution-route>(.*?)<\/nd-dsh-execution-route>/s)
  if (!match?.[1]) return {}
  try {
    return JSON.parse(match[1]) as { provider?: string; model?: string }
  } catch {
    return {}
  }
}

test('runs three tiny real tasks across two companies and three projects with isolated model routes', async () => {
  test.setTimeout(45 * 60_000)

  const [dispatchWs, driverWs, catalogWs] = await Promise.all([
    createWorkspaceDir(),
    createWorkspaceDir(),
    createWorkspaceDir(),
  ])

  // Company A: two projects use two distinct builder routes.
  let snapshot = await mutate({
    type: 'company.create',
    name: COMPANY_A,
    mission: 'Validate two small mobility projects with isolated real-model routes.',
  })
  const companyA = snapshot.companies.find((item) => item.name === COMPANY_A)!
  const engineerRoleA = snapshot.roles.find((item) => item.companyId === companyA.id && item.name === 'Software Engineer')!
  const reviewerA = snapshot.agents.find((item) => item.companyId === companyA.id && item.name === 'Reviewer')!
  const builderA = snapshot.agents.find((item) => item.companyId === companyA.id && item.name === 'Builder')!
  const engineeringA = snapshot.teams.find((item) => item.companyId === companyA.id && /engineering/i.test(item.name))!

  await mutate({ type: 'agent.update', id: builderA.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[0]! } })
  await mutate({ type: 'agent.update', id: reviewerA.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[2]! } })
  snapshot = await mutate({
    type: 'agent.create',
    companyId: companyA.id,
    name: 'Builder 2',
    roleId: engineerRoleA.id,
    teamId: engineeringA.id,
    providerId: PROVIDER_ID,
    modelId: MODELS[1]!,
  })
  const builderA2 = snapshot.agents.find((item) => item.companyId === companyA.id && item.name === 'Builder 2')!

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyA.id,
    name: 'Dispatch Live',
    objective: 'Create one tiny dispatch status artifact.',
    workspacePath: dispatchWs,
  })
  const dispatch = snapshot.projects.find((item) => item.name === 'Dispatch Live')!
  snapshot = await mutate({
    type: 'task.create',
    companyId: companyA.id,
    projectId: dispatch.id,
    assignedAgentId: builderA.id,
    title: 'Create dispatch status artifact',
    description: 'Create dispatch-status.txt only. It must contain two lines: AVAILABLE and BUSY. Do not add dependencies.',
    acceptanceCriteria: [
      'dispatch-status.txt exists.',
      'The file contains AVAILABLE.',
      'The file contains BUSY.',
    ],
  })
  const dispatchTask = snapshot.tasks.find((item) => item.projectId === dispatch.id)!

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyA.id,
    name: 'Driver Live',
    objective: 'Create one tiny driver job artifact.',
    workspacePath: driverWs,
  })
  const driver = snapshot.projects.find((item) => item.name === 'Driver Live')!
  snapshot = await mutate({
    type: 'task.create',
    companyId: companyA.id,
    projectId: driver.id,
    assignedAgentId: builderA2.id,
    title: 'Create driver job artifact',
    description: 'Create driver-job.txt only. It must contain the exact text Pickup -> Destination. Do not add dependencies.',
    acceptanceCriteria: [
      'driver-job.txt exists.',
      'The file contains Pickup -> Destination.',
    ],
  })
  const driverTask = snapshot.tasks.find((item) => item.projectId === driver.id)!

  // Company B: one independent project uses model 3, with model 1 reviewing it.
  snapshot = await mutate({
    type: 'company.create',
    name: COMPANY_B,
    mission: 'Validate one small commerce project without sharing Company A workforce or memory.',
  })
  const companyB = snapshot.companies.find((item) => item.name === COMPANY_B)!
  const builderB = snapshot.agents.find((item) => item.companyId === companyB.id && item.name === 'Builder')!
  const reviewerB = snapshot.agents.find((item) => item.companyId === companyB.id && item.name === 'Reviewer')!
  await mutate({ type: 'agent.update', id: builderB.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[2]! } })
  await mutate({ type: 'agent.update', id: reviewerB.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[0]! } })

  snapshot = await mutate({
    type: 'project.create',
    companyId: companyB.id,
    name: 'Catalog Live',
    objective: 'Create one tiny catalog artifact.',
    workspacePath: catalogWs,
  })
  const catalog = snapshot.projects.find((item) => item.name === 'Catalog Live')!
  snapshot = await mutate({
    type: 'task.create',
    companyId: companyB.id,
    projectId: catalog.id,
    assignedAgentId: builderB.id,
    title: 'Create catalog item artifact',
    description: 'Create catalog-item.txt only. It must contain the exact text Widget | 9.99 | 3. Do not add dependencies.',
    acceptanceCriteria: [
      'catalog-item.txt exists.',
      'The file contains Widget | 9.99 | 3.',
    ],
  })
  const catalogTask = snapshot.tasks.find((item) => item.projectId === catalog.id)!

  const cases = [
    { projectId: dispatch.id, taskId: dispatchTask.id, model: MODELS[0]!, companyId: companyA.id },
    { projectId: driver.id, taskId: driverTask.id, model: MODELS[1]!, companyId: companyA.id },
    { projectId: catalog.id, taskId: catalogTask.id, model: MODELS[2]!, companyId: companyB.id },
  ]

  for (const item of cases) {
    await mutate({ type: 'project.activate', id: item.projectId })
    const active = await state()
    expect(active.activeProjectId).toBe(item.projectId)
    expect(active.activeCompanyId).toBe(item.companyId)

    await launched.page.evaluate(async (taskId) => {
      await (globalThis as OrganizationWindow).ndDshOrganization.runTask(taskId)
    }, item.taskId)

    const execution = await terminalTaskState(item.taskId)
    const executionTask = execution.snapshot.tasks.find((task) => task.id === item.taskId)!
    expect(executionTask.status, execution.run.error ?? 'execution did not reach review').toBe('review')
    expect(execution.run.status, execution.run.error ?? 'execution run failed').toBe('completed')
    expect(execution.run.checkpointCommit).toBeTruthy()
    expect(execution.run.workspaceRoot).toBeTruthy()

    const route = executionRoute(execution.run)
    expect(route.provider).toBe(PROVIDER_ID)
    expect(route.model).toBe(item.model)

    await launched.page.evaluate(async (taskId) => {
      await (globalThis as OrganizationWindow).ndDshOrganization.reviewTask(taskId)
    }, item.taskId)

    const reviewed = await completedTaskState(item.taskId)
    const task = reviewed.tasks.find((candidate) => candidate.id === item.taskId)!
    expect(task.status, task.reviewSummary ?? 'review did not pass').toBe('completed')
    expect(task.integrationState).toBe('integrated')
  }

  const final = await state()
  expect(final.projects.filter((item) => item.companyId === companyA.id)).toHaveLength(2)
  expect(final.projects.filter((item) => item.companyId === companyB.id)).toHaveLength(1)
  expect(final.tasks.filter((item) => item.companyId === companyA.id).every((item) => item.projectId !== catalog.id)).toBe(true)
  expect(final.tasks.filter((item) => item.companyId === companyB.id).every((item) => item.projectId === catalog.id)).toBe(true)

  for (const projectId of [dispatch.id, driver.id, catalog.id]) {
    expect(final.projects.find((item) => item.id === projectId)?.progress).toBe(100)
  }
})
