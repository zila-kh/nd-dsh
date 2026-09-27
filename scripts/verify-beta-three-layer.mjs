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

if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1')
requireText(evidence.release?.version, 'release.version')
requireText(evidence.release?.commit, 'release.commit')
requireText(evidence.release?.artifact, 'release.artifact')
requireText(evidence.release?.recordedAt, 'release.recordedAt')

requireZero(evidence.summary?.p0Open, 'summary.p0Open')
requireZero(evidence.summary?.p1CoreOpen, 'summary.p1CoreOpen')

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

const passed = evidence.scenarioRuns?.passed
const total = evidence.scenarioRuns?.total
const target = evidence.scenarioRuns?.targetPassRate ?? 0.95
if (!Number.isInteger(passed) || passed < 0) errors.push('scenarioRuns.passed must be a non-negative integer')
if (!Number.isInteger(total) || total <= 0) errors.push('scenarioRuns.total must be a positive integer')
if (typeof target !== 'number' || target <= 0 || target > 1) errors.push('scenarioRuns.targetPassRate must be > 0 and <= 1')
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
console.log(`- repeated scenario pass rate: ${formatPercent(passRate)} (${passed}/${total})`)
console.log(`- P0 open: 0; core P1 open: 0`)
console.log(`- human release owner: ${evidence.humanDecision.owner}`)

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
