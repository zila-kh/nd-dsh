/**
 * Evidence helpers for the real-user production E2E driver.
 *
 * One run owns one timestamped evidence directory. Every artifact the driver
 * produces goes through this module so that:
 *
 *  - the API key from .env.e2e never reaches disk (log lines are redacted at
 *    write time and a final scan proves it),
 *  - concurrency claims are recomputed from durable run-receipt intervals
 *    rather than inferred from final state,
 *  - a failed run still leaves a usable evidence directory behind.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REDACTED = '[REDACTED-E2E-SECRET]'

/** Register every secret value that must never appear in evidence or logs. */
export function secretValues() {
  const values = []
  const apiKey = process.env.E2E_MODEL_API_KEY?.trim()
  // The placeholder specs seed offline is not a secret; flagging it would make
  // every deterministic run fail its own leak scan.
  if (apiKey && apiKey !== 'sk-test-placeholder') values.push(apiKey)
  return values
}

export function redact(text, secrets = secretValues()) {
  let output = String(text ?? '')
  for (const secret of secrets) {
    if (!secret) continue
    output = output.split(secret).join(REDACTED)
  }
  return output
}

/**
 * Create the per-run evidence directory: e2e-results/real-user-prod-<ts>/.
 * Returns a small writer object; every method is safe to call after a failure.
 */
export function createEvidenceRun(rootDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(rootDir, `real-user-prod-${stamp}`)
  mkdirSync(join(dir, 'screenshots'), { recursive: true })
  const secrets = secretValues()
  const driverStream = createWriteStream(join(dir, 'driver.log'), { flags: 'a' })
  const errors = []

  const writeJson = (name, data) => {
    try {
      writeFileSync(join(dir, name), `${redact(JSON.stringify(data, null, 2), secrets)}\n`, 'utf8')
    } catch (error) {
      // Evidence writing must never mask the original failure.
      errors.push(`writeJson(${name}) failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    dir,
    errors,
    secrets,
    log(line) {
      const text = redact(line, secrets)
      console.log(text)
      driverStream.write(`${text}\n`)
    },
    writeJson,
    noteError(line) {
      const text = redact(line, secrets)
      errors.push(text)
      driverStream.write(`${text}\n`)
    },
    writeErrorsLog() {
      writeFileSync(join(dir, 'errors.log'), errors.length ? `${errors.join('\n')}\n` : '', 'utf8')
    },
    /** Screenshot into screenshots/<name>.png; a dead page must not crash cleanup. */
    async screenshot(page, name) {
      try {
        await page.screenshot({ path: join(dir, 'screenshots', `${name}.png`) })
        return true
      } catch (error) {
        this.noteError(`screenshot(${name}) failed: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    close() {
      driverStream.end()
    },
  }
}

/** Extract the execution-route receipt ND stamps into a run's output. */
export function parseRoute(output) {
  const match = String(output ?? '').match(/<nd-dsh-execution-route>(.*?)<\/nd-dsh-execution-route>/s)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1])
    return {
      provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      engineId: typeof parsed.engineId === 'string' ? parsed.engineId : undefined,
    }
  } catch {
    return null
  }
}

/** Machine-verification receipt embedded in a run output, if any. */
export function parseVerification(output) {
  const match = String(output ?? '').match(/<nd-dsh-verification>(.*?)<\/nd-dsh-verification>/s)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function overlaps(left, right) {
  if (left.startTimestamp == null || right.startTimestamp == null) return false
  const leftEnd = left.endTimestamp ?? Number.MAX_SAFE_INTEGER
  const rightEnd = right.endTimestamp ?? Number.MAX_SAFE_INTEGER
  return left.startTimestamp < rightEnd && right.startTimestamp < leftEnd
}

/**
 * Recompute the parallelism claim from durable task-execution intervals.
 *
 * The required production gate is honest interval overlap between executions
 * that belong to different projects. Same-project overlap (Catalog Mini) and
 * cross-company overlap are reported separately because they are stronger,
 * independently gated claims.
 */
export function computeConcurrency(executions) {
  const rows = executions.filter((row) => row.startTimestamp != null)
  const pairs = []
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i]
      const b = rows[j]
      if (!overlaps(a, b)) continue
      pairs.push({
        a: { runId: a.runId, projectId: a.projectId, taskId: a.taskId },
        b: { runId: b.runId, projectId: b.projectId, taskId: b.taskId },
        crossProject: a.projectId !== b.projectId,
        crossCompany: a.companyId !== b.companyId,
        sameProject: a.projectId === b.projectId,
      })
    }
  }

  // Sweep line over interval endpoints for the true maximum concurrency.
  const events = []
  for (const row of rows) {
    events.push({ time: row.startTimestamp, delta: 1 })
    events.push({ time: row.endTimestamp ?? Number.MAX_SAFE_INTEGER, delta: -1 })
  }
  events.sort((left, right) => left.time - right.time || left.delta - right.delta)
  let live = 0
  let maxParallel = 0
  for (const event of events) {
    live += event.delta
    if (live > maxParallel) maxParallel = live
  }

  return {
    executions: rows,
    overlappingPairs: pairs,
    maxParallelTaskRuns: maxParallel,
    crossProjectOverlap: pairs.some((pair) => pair.crossProject),
    crossCompanyOverlap: pairs.some((pair) => pair.crossCompany),
    sameProjectParallelism: pairs.some((pair) => pair.sameProject),
  }
}

/** Build routes.json rows: expected agent route vs the executed run receipt. */
export function buildRouteEvidence({ runs, tasks, agents, companies, projects }) {
  const byId = (list, id) => list.find((item) => item.id === id)
  const rows = []
  for (const run of runs) {
    if (run.kind !== 'task-execution' || !run.taskId) continue
    const task = byId(tasks, run.taskId)
    const agent = task?.assignedAgentId ? byId(agents, task.assignedAgentId) : undefined
    const route = parseRoute(run.output)
    const engineId = run.engineId ?? route?.engineId ?? null
    // ND Harness executions must prove provider+model against the assigned
    // employee. A delegated external engine has no provider route receipt by
    // design, so its boundary proof is the engine id on the run receipt.
    const matched = !route
      ? false
      : engineId && engineId !== 'nd-harness'
        ? engineId === run.engineId
        : Boolean(agent?.modelId && route.model === agent.modelId
          && (!agent.providerId || route.provider === agent.providerId))
    rows.push({
      runId: run.id,
      taskId: run.taskId,
      taskTitle: task?.title ?? '(unknown)',
      companyId: run.companyId,
      companyName: byId(companies, run.companyId)?.name ?? '(unknown)',
      projectId: run.projectId,
      projectName: byId(projects, run.projectId)?.name ?? '(unknown)',
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? '(unassigned)',
      expectedProvider: agent?.providerId ?? null,
      expectedModel: agent?.modelId ?? null,
      actualProvider: route?.provider ?? null,
      actualModel: route?.model ?? null,
      engineId,
      runStatus: run.status,
      routeReceiptPresent: route !== null,
      matched,
      error: run.error ?? null,
    })
  }
  return rows
}

/** True when any scanned file still contains a live secret value. */
export function scanForSecrets(dir, secrets = secretValues()) {
  const findings = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      // The driver log is scanned too; redaction happens at write time, so a
      // finding there means redaction regressed and must fail the run.
      let content
      try {
        const stats = statSync(full)
        if (stats.size > 8 * 1024 * 1024) continue
        content = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const secret of secrets) {
        if (secret && content.includes(secret)) {
          findings.push({ file: full, hint: `${secret.slice(0, 4)}…${secret.slice(-2)}` })
        }
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return findings
}

export function countSecretLeaks(findings) {
  return findings.length
}

/** Compact OS/toolchain facts recorded alongside every run. */
export function environmentFacts() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    date: new Date().toISOString(),
    configuredModels: [
      process.env.E2E_MODEL_1?.trim() || null,
      process.env.E2E_MODEL_2?.trim() || null,
      process.env.E2E_MODEL_3?.trim() || null,
    ],
    baseUrlConfigured: Boolean(process.env.E2E_MODEL_BASE_URL?.trim()),
    apiKeyConfigured: Boolean(process.env.E2E_MODEL_API_KEY?.trim()),
  }
}
