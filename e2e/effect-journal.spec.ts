// Durable effect-journal app smoke: drives one real organization task through
// worker -> machine verification -> independent review -> integration in the
// desktop app, then inspects <userData>/effect-journal.jsonl for the receipt
// set, identity fields, intent-before-outcome ordering, and secret absence.
// A restart leg relaunches on the same profile and proves the journal is
// replayed with monotonically continuing sequence numbers.
/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrganizationDesktopApi, OrganizationRun, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, E2E_PROVIDER_ID, launchApp, type LaunchedApp } from './fixtures.js'

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

const PROVIDER_ID = E2E_PROVIDER_ID
const COMPANY = 'Journal Live'
const EVIDENCE_DIR = join(process.cwd(), 'benchmark-results', 'effect-journal-smoke')

interface EffectRecordLine {
  seq: number
  recordId: string
  time: number
  kind: string
  state: 'intent' | 'complete' | 'failed' | 'uncertain'
  companyId?: string
  projectId?: string
  taskId?: string
  runId?: string
  resourceId?: string
  idempotencyKey?: string
  data?: unknown
}

let launched: LaunchedApp
let retainedUserData = ''

test.describe.configure({ mode: 'serial' })
test.skip(!MODEL_ENV_READY, 'Set the shared OpenAI-compatible E2E_MODEL_* variables in .env to run the live effect-journal smoke.')

test.beforeAll(async () => {
  launched = await launchApp({ useConfiguredModels: true })
  retainedUserData = launched.userDataDir
})

test.afterAll(async () => {
  await closeApp(launched).catch(() => undefined)
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

async function runTinyTask(input: {
  companyId: string
  projectId: string
  builderId: string
  title: string
  fileName: string
  content: string
}): Promise<{ taskId: string; run: OrganizationRun }> {
  let snapshot = await mutate({
    type: 'task.create',
    companyId: input.companyId,
    projectId: input.projectId,
    assignedAgentId: input.builderId,
    title: input.title,
    description: `Create ${input.fileName} only. It must contain the exact text ${input.content}. Do not add dependencies.`,
    acceptanceCriteria: [
      `${input.fileName} exists.`,
      `The file contains ${input.content}.`,
    ],
  })
  const task = snapshot.tasks.find((item) => item.projectId === input.projectId && item.title === input.title)!
  expect(task).toBeTruthy()

  await mutate({ type: 'project.activate', id: input.projectId })
  await launched.page.evaluate(async (taskId) => {
    await (globalThis as OrganizationWindow).ndDshOrganization.runTask(taskId)
  }, task.id)

  let last: OrganizationSnapshot | undefined
  await expect.poll(async () => {
    last = await state()
    const current = last?.tasks.find((item) => item.id === task.id)
    return current?.status ?? 'missing'
  }, {
    timeout: 12 * 60_000,
    intervals: [1_000, 2_000, 5_000, 10_000],
    message: `task ${input.title} did not reach review`,
  }).toBe('review')

  const execution = last ?? await state()
  const runs = execution.runs
    .filter((item) => item.taskId === task.id && item.kind === 'task-execution')
    .sort((left, right) => right.startedAt - left.startedAt)
  const run = runs[0]
  if (!run) throw new Error(`No execution run recorded for task ${input.title}`)
  expect(run.status, run.error ?? 'execution run failed').toBe('completed')
  expect(run.checkpointCommit).toBeTruthy()

  await launched.page.evaluate(async (taskId) => {
    await (globalThis as OrganizationWindow).ndDshOrganization.reviewTask(taskId)
  }, task.id)

  await expect.poll(async () => {
    const current = await state()
    const busy = current.runs.some((item) => item.status === 'running')
    const reviewed = current.tasks.find((item) => item.id === task.id)
    return busy ? 'settling' : reviewed?.status ?? 'missing'
  }, {
    timeout: 12 * 60_000,
    intervals: [1_000, 2_000, 5_000, 10_000],
    message: `task ${input.title} did not complete review/integration`,
  }).toBe('completed')

  const finished = await state()
  const reviewed = finished.tasks.find((item) => item.id === task.id)!
  expect(reviewed.integrationState).toBe('integrated')
  expect(finished.projects.find((item) => item.id === input.projectId)?.progress).toBe(100)
  return { taskId: task.id, run }
}

async function readJournal(userDataDir: string): Promise<{ records: EffectRecordLine[]; raw: string; bytes: number }> {
  const raw = await readFile(join(userDataDir, 'effect-journal.jsonl'), 'utf8')
  const records = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EffectRecordLine)
  return { records, raw, bytes: Buffer.byteLength(raw, 'utf8') }
}

function assertJournalWellFormed(records: EffectRecordLine[]): void {
  expect(records.length, 'journal must contain records').toBeGreaterThan(0)
  let previousSeq = 0
  for (const record of records) {
    expect(record.seq, 'seq must continue monotonically').toBeGreaterThan(previousSeq)
    previousSeq = record.seq
    expect(record.recordId).toBeTruthy()
    expect(record.kind).toBeTruthy()
    expect(['intent', 'complete', 'failed', 'uncertain']).toContain(record.state)
  }
}

function assertSecretFree(raw: string): void {
  expect(raw.includes(API_KEY), 'journal must not contain the provider API key').toBe(false)
  expect(raw, 'journal must not carry Authorization headers').not.toMatch(/authorization\s*[:=]/i)
  expect(raw, 'journal must not persist raw provider request payloads').not.toMatch(/"messages"\s*:/)
}

async function persistEvidence(name: string, payload: Record<string, unknown>, journalRaw: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await writeFile(join(EVIDENCE_DIR, name), JSON.stringify(payload, null, 2), 'utf8')
  await copyFile(
    join(retainedUserData, 'effect-journal.jsonl'),
    join(EVIDENCE_DIR, name.replace(/\.json$/, '.effect-journal.jsonl')),
  )
}

test('runs one real task to integration and journals the full receipt set', async () => {
  test.setTimeout(30 * 60_000)

  const workspaceDir = await createWorkspaceDir()
  let snapshot = await mutate({
    type: 'company.create',
    name: COMPANY,
    mission: 'Produce durable effect-journal receipts for one completed task.',
  })
  const company = snapshot.companies.find((item) => item.name === COMPANY)!
  const builder = snapshot.agents.find((item) => item.companyId === company.id && item.name === 'Builder')!
  const reviewer = snapshot.agents.find((item) => item.companyId === company.id && item.name === 'Reviewer')!
  await mutate({ type: 'agent.update', id: builder.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[0]! } })
  await mutate({ type: 'agent.update', id: reviewer.id, patch: { providerId: PROVIDER_ID, modelId: MODELS[2]! } })

  snapshot = await mutate({
    type: 'project.create',
    companyId: company.id,
    name: 'Journal Live Project',
    objective: 'Create one tiny journaled artifact.',
    workspacePath: workspaceDir,
  })
  const project = snapshot.projects.find((item) => item.name === 'Journal Live Project')!

  const first = await runTinyTask({
    companyId: company.id,
    projectId: project.id,
    builderId: builder.id,
    title: 'Create journaled status artifact',
    fileName: 'journal-status.txt',
    content: 'AVAILABLE',
  })

  const { records, raw, bytes } = await readJournal(retainedUserData)
  assertJournalWellFormed(records)
  assertSecretFree(raw)

  // The completed flow must produce the receipt set from the validation handoff.
  const kinds = new Set(records.map((record) => record.kind))
  for (const required of ['workspace.allocate', 'engine.session', 'verification.receipt', 'review.result', 'integration']) {
    expect(kinds.has(required), `journal must contain a ${required} record`).toBe(true)
  }

  // Records must carry company/project/task/run identity where applicable.
  const forTask = records.filter((record) => record.taskId === first.taskId)
  expect(forTask.length, 'task-scoped receipts must exist').toBeGreaterThan(0)
  for (const required of ['verification.receipt', 'review.result', 'integration']) {
    const scoped = records.filter((record) => record.kind === required)
    expect(scoped.some((record) => record.taskId && record.companyId === company.id), `${required} must carry task identity`).toBe(true)
  }
  const scopedProject = records.filter((record) => record.kind === 'workspace.allocate')
  expect(scopedProject.some((record) => record.projectId === project.id), 'workspace.allocate must carry project identity').toBe(true)

  // Integration intent is written before the integration outcome.
  const integrationIntents = records.filter((record) => record.kind === 'integration' && record.state === 'intent')
  const integrationOutcomes = records.filter((record) => record.kind === 'integration' && record.state !== 'intent')
  expect(integrationIntents.length).toBeGreaterThan(0)
  expect(integrationOutcomes.length).toBeGreaterThan(0)
  for (const outcome of integrationOutcomes) {
    const matchingIntent = integrationIntents.find(
      (intent) => intent.idempotencyKey && intent.idempotencyKey === outcome.idempotencyKey,
    )
    if (matchingIntent) {
      expect(outcome.seq, 'integration outcome must follow its intent').toBeGreaterThan(matchingIntent.seq)
    }
  }

  // Task completion is integrated, not merely reviewed: the outcome is 'complete'.
  expect(
    integrationOutcomes.some((record) => record.taskId === first.taskId && record.state === 'complete'),
    'the first task must journal a completed integration',
  ).toBe(true)

  const summary = {
    stage: 'first-task',
    commit: process.env.E2E_EVIDENCE_COMMIT ?? 'local',
    records: records.length,
    bytes,
    kinds: Object.entries(records.reduce<Record<string, number>>((acc, record) => {
      acc[record.kind] = (acc[record.kind] ?? 0) + 1
      return acc
    }, {})).sort(),
    maxSeq: records[records.length - 1]?.seq ?? 0,
    secretFree: true,
  }
  await persistEvidence('effect-journal-first-task.json', summary, raw)
})

test('journal replays after a full app restart and sequence numbers continue', async () => {
  test.setTimeout(30 * 60_000)

  const before = await readJournal(retainedUserData)
  assertJournalWellFormed(before.records)
  const beforeIds = new Set(before.records.map((record) => record.recordId))
  const beforeMaxSeq = before.records[before.records.length - 1]!.seq

  await closeApp(launched, { removeUserData: false })
  launched = await launchApp({ userDataDir: retainedUserData, useConfiguredModels: true })

  // Organization state survives the restart from the same profile.
  const snapshot = await state()
  const company = snapshot.companies.find((item) => item.name === COMPANY)!
  const builder = snapshot.agents.find((item) => item.companyId === company.id && item.name === 'Builder')!
  const project = snapshot.projects.find((item) => item.name === 'Journal Live Project')!
  expect(company).toBeTruthy()
  expect(project).toBeTruthy()

  const second = await runTinyTask({
    companyId: company.id,
    projectId: project.id,
    builderId: builder.id,
    title: 'Create second journaled artifact',
    fileName: 'journal-second.txt',
    content: 'BUSY',
  })

  const after = await readJournal(retainedUserData)
  assertJournalWellFormed(after.records)
  assertSecretFree(after.raw)

  // Known-complete history is still present; nothing was truncated or reset.
  for (const recordId of beforeIds) {
    expect(after.records.some((record) => record.recordId === recordId), `record ${recordId} must survive restart`).toBe(true)
  }
  // Sequence numbers continue monotonically across the restart boundary.
  const newRecords = after.records.filter((record) => record.seq > beforeMaxSeq)
  expect(newRecords.length, 'the second task must append new records').toBeGreaterThan(0)
  expect(
    after.records.some((record) => record.taskId === second.taskId && record.kind === 'integration' && record.state === 'complete'),
    'the second task must journal a completed integration after restart',
  ).toBe(true)

  const summary = {
    stage: 'restart-replay',
    recordsBefore: before.records.length,
    recordsAfter: after.records.length,
    bytesAfter: after.bytes,
    maxSeqBefore: beforeMaxSeq,
    maxSeqAfter: after.records[after.records.length - 1]!.seq,
    recordsSurvived: beforeIds.size,
    secretFree: true,
  }
  await persistEvidence('effect-journal-restart-replay.json', summary, after.raw)
})
