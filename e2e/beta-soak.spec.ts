/// <reference lib="dom" />

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { OrganizationDesktopApi, OrganizationSnapshot } from '../src/shared/organization.js'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

type OrganizationWindow = typeof globalThis & {
  ndDshOrganization: OrganizationDesktopApi
}

const SOAK_MINUTES = boundedNumber(process.env.ND_DSH_SOAK_MINUTES, 5, 1, 24 * 60)
const SAMPLE_SECONDS = boundedNumber(process.env.ND_DSH_SOAK_SAMPLE_SECONDS, 30, 5, 10 * 60)
const MAX_GROWTH_MB = boundedNumber(process.env.ND_DSH_SOAK_MAX_GROWTH_MB, 512, 64, 4096)
const SOAK_MS = SOAK_MINUTES * 60_000
const SAMPLE_MS = SAMPLE_SECONDS * 1_000

const MATRIX = [
  { company: 'Soak Taxi Co', projects: ['Soak Dispatch', 'Soak Driver'] },
  { company: 'Soak Commerce Co', projects: ['Soak Catalog', 'Soak Checkout'] },
  { company: 'Soak Tools Co', projects: ['Soak Console', 'Soak Docs'] },
] as const

let launched: LaunchedApp

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

test.afterAll(async () => {
  await closeApp(launched).catch(() => undefined)
})

test('beta soak keeps one Electron lifetime stable while switching a 3x2 portfolio', async () => {
  test.setTimeout(SOAK_MS + 180_000)
  launched = await launchApp()

  const created: Array<{ companyId: string; projectId: string; project: string }> = []
  for (const row of MATRIX) {
    let snapshot = await mutate({ type: 'company.create', name: row.company, mission: 'Beta soak validation.' })
    const company = snapshot.companies.find((item) => item.name === row.company)!
    for (const projectName of row.projects) {
      const workspacePath = await createWorkspaceDir()
      snapshot = await mutate({
        type: 'project.create',
        companyId: company.id,
        name: projectName,
        objective: 'Stay stable during the release soak.',
        workspacePath,
      })
      const project = snapshot.projects.find((item) => item.companyId === company.id && item.name === projectName)!
      await mutate({
        type: 'task.create',
        companyId: company.id,
        projectId: project.id,
        title: `${projectName} soak task`,
        description: 'Persistent state used by the soak.',
      })
      created.push({ companyId: company.id, projectId: project.id, project: projectName })
    }
  }

  const samples: Array<{
    at: string
    elapsedSeconds: number
    totalWorkingSetMb: number
    processCount: number
    activeCompanyId?: string
    activeProjectId?: string
  }> = []

  const started = Date.now()
  let cursor = 0
  while (Date.now() - started < SOAK_MS) {
    const selected = created[cursor % created.length]!
    const snapshot = await mutate({ type: 'project.activate', id: selected.projectId })

    expect(snapshot.companies.filter((item) => MATRIX.some((row) => row.company === item.name))).toHaveLength(3)
    expect(snapshot.projects.filter((item) => created.some((candidate) => candidate.projectId === item.id))).toHaveLength(6)
    expect(new Set(snapshot.projects.map((item) => item.id)).size).toBe(snapshot.projects.length)
    expect(new Set(snapshot.tasks.map((item) => item.id)).size).toBe(snapshot.tasks.length)
    expect(snapshot.activeCompanyId).toBe(selected.companyId)
    expect(snapshot.activeProjectId).toBe(selected.projectId)

    for (const item of created) {
      const project = snapshot.projects.find((candidate) => candidate.id === item.projectId)
      expect(project?.companyId).toBe(item.companyId)
      const task = snapshot.tasks.find((candidate) => candidate.projectId === item.projectId)
      expect(task?.companyId).toBe(item.companyId)
    }

    // Exercise a renderer round-trip too; an event-loop/UI freeze must make the
    // bounded Playwright interaction fail rather than merely inflate memory.
    await launched.page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()
    await expect(launched.page.getByRole('combobox', { name: 'Switch company' })).toBeVisible()

    const metrics = await launched.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      workingSetSize: metric.memory.workingSetSize,
    })))
    const totalWorkingSetMb = metrics.reduce((sum, metric) => sum + metric.workingSetSize, 0) / 1024
    samples.push({
      at: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      totalWorkingSetMb: Math.round(totalWorkingSetMb * 10) / 10,
      processCount: metrics.length,
      ...(snapshot.activeCompanyId ? { activeCompanyId: snapshot.activeCompanyId } : {}),
      ...(snapshot.activeProjectId ? { activeProjectId: snapshot.activeProjectId } : {}),
    })

    cursor += 1
    const remaining = SOAK_MS - (Date.now() - started)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(SAMPLE_MS, remaining)))
  }

  expect(samples.length).toBeGreaterThan(0)
  const baseline = samples[0]!
  const peak = Math.max(...samples.map((sample) => sample.totalWorkingSetMb))
  const final = samples.at(-1)!
  const growthMb = Math.round((final.totalWorkingSetMb - baseline.totalWorkingSetMb) * 10) / 10
  const maxProcessCount = Math.max(...samples.map((sample) => sample.processCount))
  const suspiciousGrowth = growthMb > MAX_GROWTH_MB

  const finalState = await state()
  const report = {
    schemaVersion: 1,
    kind: 'nd-beta-soak',
    status: suspiciousGrowth ? 'fail' : 'pass',
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    requestedMinutes: SOAK_MINUTES,
    sampleSeconds: SAMPLE_SECONDS,
    samples: samples.length,
    baselineWorkingSetMb: baseline.totalWorkingSetMb,
    finalWorkingSetMb: final.totalWorkingSetMb,
    peakWorkingSetMb: peak,
    growthMb,
    maxAllowedGrowthMb: MAX_GROWTH_MB,
    baselineProcessCount: baseline.processCount,
    maxProcessCount,
    companies: finalState.companies.filter((item) => MATRIX.some((row) => row.company === item.name)).length,
    projects: finalState.projects.filter((item) => created.some((candidate) => candidate.projectId === item.id)).length,
    tasks: finalState.tasks.filter((item) => created.some((candidate) => candidate.projectId === item.projectId)).length,
    samplesDetail: samples,
  }
  const outputDir = join(process.cwd(), 'e2e-results', 'beta-soak')
  await mkdir(outputDir, { recursive: true })
  const outputPath = join(outputDir, `beta-soak-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`[beta-soak] receipt: ${outputPath}`)
  console.log(`[beta-soak] working-set baseline=${baseline.totalWorkingSetMb}MB final=${final.totalWorkingSetMb}MB peak=${peak}MB growth=${growthMb}MB`)

  expect(suspiciousGrowth, `working set grew ${growthMb}MB; limit is ${MAX_GROWTH_MB}MB`).toBe(false)
  expect(maxProcessCount).toBeLessThanOrEqual(baseline.processCount + 4)
  expect(report.companies).toBe(3)
  expect(report.projects).toBe(6)
  expect(report.tasks).toBe(6)
})

function boundedNumber(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}
