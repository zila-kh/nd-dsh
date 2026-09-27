import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = fileURLToPath(new URL('../scripts/verify-beta-three-layer.mjs', import.meta.url))
const tempDirs: string[] = []
const requiredFeatureIds = [
  'core-agent-flow',
  'company-project-isolation',
  'parallel-agent-worktree',
  'git-worktree-secret-safety',
  'credential-security-boundaries',
  'persistence-recovery',
  'provider-failure-handling',
  'browser-platform',
  'mcp-skills-failure-containment',
  'budget-entitlement',
  'terminal-filesystem',
  'diagnostics-observability',
] as const

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('verify-beta-three-layer', () => {
  it('passes only when all three layers and RC receipts pass', async () => {
    const evidencePath = await writeEvidence(makeEvidence())
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Beta 3-layer gate: PASS')
    expect(result.stdout).toContain('passed Unit + E2E + Human')
    expect(result.stdout).toContain('clean-machine + Chrome + failure drills + 24h soak passed')
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

  it('fails when a required core beta feature is omitted', async () => {
    const evidence = makeEvidence()
    evidence.features = evidence.features.filter((feature) => feature.id !== 'persistence-recovery')

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('required beta feature is missing: persistence-recovery')
  })

  it('fails when a mandatory release proof is missing or the soak is shorter than 24 hours', async () => {
    const evidence = makeEvidence()
    evidence.releaseChecks.automated.status = 'pending'
    evidence.releaseChecks.soak24h.durationMinutes = 60

    const evidencePath = await writeEvidence(evidence, { soakMinutes: 60 })
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('releaseChecks.automated.status must be "pass"')
    expect(result.stderr).toContain('durationMinutes must be at least 1440')
    expect(result.stderr).toContain('soak receipt requestedMinutes must be at least 1440')
  })

  it('fails when clean-machine evidence names a different artifact', async () => {
    const evidence = makeEvidence()
    evidence.releaseChecks.packagedCleanMachine.artifact = 'another-build.exe'

    const evidencePath = await writeEvidence(evidence)
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('packagedCleanMachine.artifact must match release.artifact')
  })

  it('fails if automated evidence belongs to another commit', async () => {
    const evidencePath = await writeEvidence(makeEvidence(), { automatedCommit: 'different-commit' })
    const result = spawnSync(process.execPath, [scriptPath, evidencePath], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('automated receipt commit must match release.commit')
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

async function writeEvidence(
  evidence: ReturnType<typeof makeEvidence>,
  options: { automatedCommit?: string; soakMinutes?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'nd-beta-gate-'))
  tempDirs.push(directory)
  const automated = join(directory, 'automated.json')
  const soak = join(directory, 'soak.json')
  await writeFile(automated, JSON.stringify({
    schemaVersion: 1,
    kind: 'nd-beta-automated-release-evidence',
    status: 'pass',
    release: { commit: options.automatedCommit ?? evidence.release.commit },
  }), 'utf8')
  await writeFile(soak, JSON.stringify({
    schemaVersion: 1,
    kind: 'nd-beta-soak',
    status: 'pass',
    requestedMinutes: options.soakMinutes ?? 1440,
  }), 'utf8')
  evidence.releaseChecks.automated.summaryPath = automated
  evidence.releaseChecks.soak24h.summaryPath = soak

  const path = join(directory, 'evidence.json')
  await writeFile(path, JSON.stringify(evidence), 'utf8')
  return path
}

function makeEvidence() {
  const feature = (id: typeof requiredFeatureIds[number]) => ({
    id,
    name: id,
    severity: id.includes('core') || id.includes('isolation') || id.includes('git') || id.includes('credential') || id.includes('recovery') ? 'P0' : 'P1',
    betaExposed: true,
    unit: { status: 'pass', evidence: [`unit evidence for ${id}`] },
    e2e: { status: 'pass', evidence: [`e2e evidence for ${id}`] },
    human: {
      status: 'pass',
      tester: 'release-owner',
      recordedAt: '2026-09-28T12:30:00+07:00',
      evidence: [`human evidence for ${id}`],
    },
  })

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
    releaseChecks: {
      automated: {
        status: 'pass',
        summaryPath: '',
        evidence: ['beta automated summary'],
      },
      packagedCleanMachine: {
        status: 'pass',
        artifact: 'ND-DSH-beta.exe#sha256:test',
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
      failureDrills: {
        status: 'pass',
        tester: 'release-owner',
        recordedAt: '2026-09-27T13:00:00+07:00',
        evidence: ['network/core-kill/data-path/disk-pressure drills PASS'],
      },
      soak24h: {
        status: 'pass',
        durationMinutes: 1440,
        summaryPath: '',
        tester: 'release-owner',
        recordedAt: '2026-09-28T12:45:00+07:00',
        evidence: ['beta soak summary'],
      },
    },
    features: requiredFeatureIds.map(feature),
    scenarioRuns: {
      passed: 19,
      total: 20,
      targetPassRate: 0.95,
      minimumRuns: 20,
    },
    humanDecision: {
      status: 'go',
      owner: 'release-owner',
      recordedAt: '2026-09-28T13:00:00+07:00',
      notes: 'Reviewed all three layers and all RC receipts.',
    },
  }
}
