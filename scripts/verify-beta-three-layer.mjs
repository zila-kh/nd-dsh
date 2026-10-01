#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const evidenceArg = process.argv.slice(2).find((value) => !value.startsWith('--'))
if (!evidenceArg) {
  console.error('Usage: corepack pnpm beta:gate -- <evidence.json>')
  process.exit(2)
}

const evidencePath = resolve(process.cwd(), evidenceArg)
let evidence
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
} catch (error) {
  console.error(`Unable to read beta evidence: ${evidencePath}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

const errors = []
const featureIds = new Set()
const REQUIRED_BETA_FEATURE_IDS = [
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
  'quick-launcher',
  'native-extensions',
  'nd-home',
  'workspace-profiles',
  'nd-pencil',
]

if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1')
requireText(evidence.release?.version, 'release.version')
requireText(evidence.release?.commit, 'release.commit')
requireText(evidence.release?.artifact, 'release.artifact')
requireText(evidence.release?.recordedAt, 'release.recordedAt')
if (String(evidence.release?.commit ?? '').includes('REPLACE_')) errors.push('release.commit still contains a template placeholder')
if (String(evidence.release?.artifact ?? '').includes('REPLACE_')) errors.push('release.artifact still contains a template placeholder')

requireZero(evidence.summary?.p0Open, 'summary.p0Open')
requireZero(evidence.summary?.p1CoreOpen, 'summary.p1CoreOpen')

requireReleaseCheck(evidence.releaseChecks?.automated, 'releaseChecks.automated')
requireHumanReleaseCheck(evidence.releaseChecks?.packagedCleanMachine, 'releaseChecks.packagedCleanMachine')
requireHumanReleaseCheck(evidence.releaseChecks?.browserCompanionChrome, 'releaseChecks.browserCompanionChrome')
requireHumanReleaseCheck(evidence.releaseChecks?.failureDrills, 'releaseChecks.failureDrills')
requireHumanReleaseCheck(evidence.releaseChecks?.soak24h, 'releaseChecks.soak24h')
if (evidence.releaseChecks?.packagedCleanMachine?.artifact !== evidence.release?.artifact) {
  errors.push('releaseChecks.packagedCleanMachine.artifact must match release.artifact')
}
const soakMinutes = evidence.releaseChecks?.soak24h?.durationMinutes
if (typeof soakMinutes !== 'number' || !Number.isFinite(soakMinutes) || soakMinutes < 24 * 60) {
  errors.push('releaseChecks.soak24h.durationMinutes must be at least 1440')
}

const automatedReceipt = readReceipt(evidence.releaseChecks?.automated?.summaryPath, 'releaseChecks.automated.summaryPath')
if (automatedReceipt) {
  if (automatedReceipt.kind !== 'nd-beta-automated-release-evidence') errors.push('automated receipt kind is invalid')
  if (automatedReceipt.status !== 'pass') errors.push('automated receipt status must be "pass"')
  if (automatedReceipt.release?.commit !== evidence.release?.commit) errors.push('automated receipt commit must match release.commit')
  const packagedArtifact = automatedReceipt.release?.artifact
  if (!isText(packagedArtifact?.file)) errors.push('automated receipt must name the packaged artifact file')
  if (!/^[0-9a-f]{64}$/i.test(String(packagedArtifact?.sha256 ?? ''))) errors.push('automated receipt artifact sha256 must be 64 hex characters')
  const expectedArtifactIdentity = isText(packagedArtifact?.file) && /^[0-9a-f]{64}$/i.test(String(packagedArtifact?.sha256 ?? ''))
    ? packagedArtifact.file + '#sha256:' + packagedArtifact.sha256
    : ''
  if (!isText(packagedArtifact?.identity)) errors.push('automated receipt must identify the packaged artifact')
  else if (packagedArtifact.identity !== expectedArtifactIdentity) errors.push('automated receipt artifact identity must match file + sha256')
  else if (packagedArtifact.identity !== evidence.release?.artifact) errors.push('automated receipt artifact must match release.artifact')
}
const soakReceipt = readReceipt(evidence.releaseChecks?.soak24h?.summaryPath, 'releaseChecks.soak24h.summaryPath')
if (soakReceipt) {
  if (soakReceipt.kind !== 'nd-beta-soak') errors.push('soak receipt kind is invalid')
  if (soakReceipt.status !== 'pass') errors.push('soak receipt status must be "pass"')
  if (typeof soakReceipt.requestedMinutes !== 'number' || soakReceipt.requestedMinutes < 24 * 60) {
    errors.push('soak receipt requestedMinutes must be at least 1440')
  }
  const elapsedMinutes = (Date.parse(soakReceipt.finishedAt) - Date.parse(soakReceipt.startedAt)) / 60_000
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 24 * 60) {
    errors.push('soak receipt must record at least 1440 minutes of actual elapsed time')
  }
  if (soakReceipt.target?.kind !== 'packaged' || soakReceipt.runtime?.isPackaged !== true) {
    errors.push('soak receipt must come from the packaged application')
  }
  if (soakReceipt.target?.artifact !== evidence.release?.artifact) {
    errors.push('soak receipt artifact must match release.artifact')
  }
}

if (!Array.isArray(evidence.features) || evidence.features.length === 0) {
  errors.push('features must contain the beta-exposed release matrix')
} else {
  const exposed = evidence.features.filter((feature) => feature?.betaExposed === true)
  if (exposed.length === 0) errors.push('at least one feature must be betaExposed=true')

  for (const [index, feature] of evidence.features.entries()) {
    const prefix = `features[${index}]`
    requireText(feature?.id, `${prefix}.id`)
    requireText(feature?.name, `${prefix}.name`)
    if (typeof feature?.id === 'string') {
      if (featureIds.has(feature.id)) errors.push(`${prefix}.id is duplicated: ${feature.id}`)
      featureIds.add(feature.id)
    }

    if (feature?.betaExposed !== true) continue

    for (const layerName of ['unit', 'e2e', 'human']) {
      const layer = feature?.[layerName]
      if (layer?.status !== 'pass') {
        errors.push(`${prefix}.${layerName}.status must be "pass" for beta-exposed features`)
      }
      if (!Array.isArray(layer?.evidence) || layer.evidence.length === 0 || layer.evidence.some((item) => !isText(item))) {
        errors.push(`${prefix}.${layerName}.evidence must contain at least one evidence reference`)
      }
    }

    requireText(feature?.human?.tester, `${prefix}.human.tester`)
    requireText(feature?.human?.recordedAt, `${prefix}.human.recordedAt`)
  }
}

for (const id of REQUIRED_BETA_FEATURE_IDS) {
  const feature = evidence.features?.find?.((item) => item?.id === id)
  if (!feature) errors.push(`required beta feature is missing: ${id}`)
  else if (feature.betaExposed !== true) errors.push(`required beta feature must remain betaExposed=true: ${id}`)
}

const passed = evidence.scenarioRuns?.passed
const total = evidence.scenarioRuns?.total
const target = evidence.scenarioRuns?.targetPassRate ?? 0.95
const minimumRuns = evidence.scenarioRuns?.minimumRuns ?? 20
if (!Number.isInteger(passed) || passed < 0) errors.push('scenarioRuns.passed must be a non-negative integer')
if (!Number.isInteger(total) || total <= 0) errors.push('scenarioRuns.total must be a positive integer')
if (typeof target !== 'number' || target <= 0 || target > 1) errors.push('scenarioRuns.targetPassRate must be > 0 and <= 1')
if (!Number.isInteger(minimumRuns) || minimumRuns < 1) errors.push('scenarioRuns.minimumRuns must be a positive integer')
if (Number.isInteger(total) && Number.isInteger(minimumRuns) && total < minimumRuns) {
  errors.push(`scenarioRuns.total ${total} is below minimumRuns ${minimumRuns}`)
}
if (typeof target === 'number' && target >= 0.99 && Number.isInteger(total) && total < 100) {
  errors.push('a 99%+ scenario target requires at least 100 recorded runs')
}
if (Number.isInteger(passed) && Number.isInteger(total) && total > 0 && passed > total) {
  errors.push('scenarioRuns.passed cannot exceed scenarioRuns.total')
}
const passRate = Number.isInteger(passed) && Number.isInteger(total) && total > 0 ? passed / total : 0
if (typeof target === 'number' && passRate < target) {
  errors.push(`scenario pass rate ${formatPercent(passRate)} is below target ${formatPercent(target)}`)
}

if (evidence.humanDecision?.status !== 'go') errors.push('humanDecision.status must be "go"')
requireText(evidence.humanDecision?.owner, 'humanDecision.owner')
requireText(evidence.humanDecision?.recordedAt, 'humanDecision.recordedAt')

if (errors.length > 0) {
  console.error('Beta 3-layer gate: FAIL')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const exposedCount = evidence.features.filter((feature) => feature?.betaExposed === true).length
console.log('Beta 3-layer gate: PASS')
console.log(`- release: ${evidence.release.version} @ ${evidence.release.commit}`)
console.log(`- beta-exposed features: ${exposedCount} / ${exposedCount} passed Unit + E2E + Human`)
console.log(`- repeated scenario pass rate: ${formatPercent(passRate)} (${passed}/${total}; minimum ${minimumRuns})`)
console.log(`- release checks: automated + clean-machine + Chrome + failure drills + 24h soak passed`)
console.log(`- P0 open: 0; core P1 open: 0`)
console.log(`- human release owner: ${evidence.humanDecision.owner}`)

function readReceipt(path, label) {
  if (!isText(path)) {
    errors.push(`${label} must be a non-empty path`)
    return null
  }
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))
  } catch (error) {
    errors.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function requireReleaseCheck(check, path) {
  if (check?.status !== 'pass') errors.push(`${path}.status must be "pass"`)
  if (!Array.isArray(check?.evidence) || check.evidence.length === 0 || check.evidence.some((item) => !isText(item))) {
    errors.push(`${path}.evidence must contain at least one evidence reference`)
  }
}

function requireHumanReleaseCheck(check, path) {
  requireReleaseCheck(check, path)
  requireText(check?.tester, `${path}.tester`)
  requireText(check?.recordedAt, `${path}.recordedAt`)
}

function requireZero(value, path) {
  if (!Number.isInteger(value) || value !== 0) errors.push(`${path} must be 0`)
}

function requireText(value, path) {
  if (!isText(value)) errors.push(`${path} must be a non-empty string`)
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`
}
