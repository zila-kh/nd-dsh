import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(new URL('../scripts/verify-beta-three-layer.mjs', import.meta.url))
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('verify-beta-three-layer', () => {
  it('passes only when all three layers and release criteria pass', async () => {
    const evidencePath = await writeEvidence(makeEvidence())
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Beta 3-layer gate: PASS')
    expect(result.stdout).toContain('passed Unit + E2E + Human')
  })

  it('fails when the human layer is not actually completed', async () => {
    const evidence = makeEvidence()
    evidence.features[0]!.human.status = 'pending'
    evidence.features[0]!.human.tester = ''
    evidence.features[0]!.human.evidence = []

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('human.status must be "pass"')
    expect(result.stderr).toContain('human.tester must be a non-empty string')
  })

  it('fails when a mandatory release proof is missing or the soak is shorter than 24 hours', async () => {
    const evidence = makeEvidence()
    evidence.releaseChecks.automated.status = 'pending'
    evidence.releaseChecks.soak24h.durationMinutes = 60

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('releaseChecks.automated.status must be "pass"')
    expect(result.stderr).toContain('durationMinutes must be at least 1440')
  })

  it('requires a meaningful sample before accepting a 99 percent scenario target', async () => {
    const evidence = makeEvidence()
    evidence.scenarioRuns = { passed: 20, total: 20, targetPassRate: 0.99, minimumRuns: 20 }

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('99%+ scenario target requires at least 100 recorded runs')
  })

  it('fails when repeated scenario reliability is below the configured target', async () => {
    const evidence = makeEvidence()
    evidence.scenarioRuns = { passed: 94, total: 100, targetPassRate: 0.95, minimumRuns: 20 }

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('94.00% is below target 95.00%')
  })
})

async function writeEvidence(evidence: ReturnType<typeof makeEvidence>) {
  const directory = await mkdtemp(join(tmpdir(), 'nd-beta-gate-'))
  tempDirs.push(directory)
  const path = join(directory, 'evidence.json')
  await writeFile(path, JSON.stringify(evidence), 'utf8')
  return path
}

function makeEvidence() {
  return {
    schemaVersion: 1,
    release: {
      version: '0.1.0-beta.1',
      commit: '0123456789abcdef',
      artifact: 'ND-DSH-beta.exe#sha256:test',
      recordedAt: '2026-09-27T12:00:00+07:00',
    },
    summary: {
      p0Open: 0,
      p1CoreOpen: 0,
    },
    features: [
      {
        id: 'core-agent-flow',
        name: 'Core agent flow',
        severity: 'P0',
        betaExposed: true,
        unit: {
          status: 'pass',
          evidence: ['pnpm test: core tests pass'],
        },
        e2e: {
          status: 'pass',
          evidence: ['e2e:prod:user run 1'],
        },
        human: {
          status: 'pass',
          tester: 'release-owner',
          recordedAt: '2026-09-27T12:30:00+07:00',
          evidence: ['manual QA-01/QA-09 pass'],
        },
      },
    ],
    releaseChecks: {
      automated: {
        status: 'pass',
        evidence: ['e2e-results/beta-automated-test/beta-automated-summary.json'],
      },
      packagedCleanMachine: {
        status: 'pass',
        tester: 'release-owner',
        recordedAt: '2026-09-27T12:35:00+07:00',
        evidence: ['clean Windows VM packaged journey PASS'],
      },
      browserCompanionChrome: {
        status: 'pass',
        tester: 'release-owner',
        recordedAt: '2026-09-27T12:40:00+07:00',
        evidence: ['e2e:companion:chrome PASS'],
      },
      soak24h: {
        status: 'pass',
        durationMinutes: 1440,
        tester: 'release-owner',
        recordedAt: '2026-09-28T12:45:00+07:00',
        evidence: ['e2e-results/beta-soak/beta-soak-test.json'],
      },
    },
    scenarioRuns: {
      passed: 19,
      total: 20,
      targetPassRate: 0.95,
      minimumRuns: 20,
    },
    humanDecision: {
      status: 'go',
      owner: 'release-owner',
      recordedAt: '2026-09-27T13:00:00+07:00',
      notes: 'Reviewed all three layers.',
    },
  }
}
