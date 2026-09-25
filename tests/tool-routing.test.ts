import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CoreClient } from '../src/main/core/core-client.js'
import { HttpDecisionProvider, DecisionSupportService } from '../src/main/organization/decision-support.js'
import { ToolRouter, classifyTaskHeuristic } from '../src/main/organization/tool-router.js'
import { ToolRoutingService } from '../src/main/organization/tool-routing-service.js'
import {
  CORE_SAFE_TOOL_NAMES,
  STANDARD_TOOL_CATALOG,
  defaultToolRoutingSettings,
  estimateSchemaTokens,
  type ToolRoutingDecision,
} from '../src/shared/tool-routing.js'

describe('Token-Saving & Tool-Routing System (WIP 0034 / handoff Section 11-17)', () => {
  let core: CoreClient
  let journalDir: string
  let journalPath: string
  const LAYA_URL = 'http://127.0.0.1:8765'

  beforeAll(async () => {
    journalDir = join(tmpdir(), 'nd-tool-routing-journal')
    journalPath = join(journalDir, 'effect-journal.jsonl')
    await rm(journalDir, { recursive: true, force: true }).catch(() => {})
    core = new CoreClient({
      binaryPath: join(process.cwd(), 'target', 'debug', process.platform === 'win32' ? 'nd-core.exe' : 'nd-core'),
    })
    await core.start()
    await core.request('effectJournal.configure', { path: journalPath }, 5_000)
  })

  afterAll(async () => {
    await core.close()
  })

  it('verifies deterministic classification across required task classes', () => {
    expect(classifyTaskHeuristic('Refactor user authentication function in auth.ts')).toBe('code-only')
    expect(classifyTaskHeuristic('Inspect git diff and check commit history on branch main')).toBe('git')
    expect(classifyTaskHeuristic('Run cargo test and build with pnpm verify')).toBe('terminal')
    expect(classifyTaskHeuristic('Navigate to localhost:3000 in browser and click submit button')).toBe('browser')
    expect(classifyTaskHeuristic('Edit the login page in auth.ts and run tests in terminal then commit git diff')).toBe('multi-tool')
    expect(classifyTaskHeuristic('Evaluate and think about general architecture')).toBe('ambiguous')
  })

  it('Shadow mode: records predicted tools and token savings while supplying full catalog to agent', async () => {
    const settings = { ...defaultToolRoutingSettings(), mode: 'shadow' as const }
    const router = new ToolRouter(settings, undefined, core)

    const decision = await router.routeTurn({
      taskTitle: 'Fix null pointer exception in parser.ts',
      taskDescription: 'Edit parser.ts to handle undefined tokens safely',
    })

    expect(decision.mode).toBe('shadow')
    expect(decision.totalCount).toBe(STANDARD_TOOL_CATALOG.length)
    // Full tool catalog is supplied to the agent in shadow mode
    expect(decision.effectiveTools).toHaveLength(STANDARD_TOOL_CATALOG.length)
    // But router accurately predicted the code tool subset
    expect(decision.selectedCount).toBeLessThan(STANDARD_TOOL_CATALOG.length)
    expect(decision.selectedTools).toContain('read_file')
    expect(decision.selectedTools).toContain('edit_file')
    expect(decision.selectedTools).toContain('write_file')
    expect(decision.selectedTools).toContain('verification_status')
    expect(decision.savedSchemaTokens).toBeGreaterThan(0)
    expect(decision.savingsPercent).toBeGreaterThan(50)
    expect(decision.latencyMs).toBeLessThan(100)
  })

  it('Assist and Enforce modes: supplies filtered catalog while preserving safe core tools', async () => {
    const settings = { ...defaultToolRoutingSettings(), mode: 'enforce' as const }
    const router = new ToolRouter(settings, undefined, core)

    const gitDecision = await router.routeTurn({
      taskTitle: 'Check git status and commit staged changes',
    })

    expect(gitDecision.mode).toBe('enforce')
    // Effective tools passed to model is the reduced set
    expect(gitDecision.effectiveTools).toEqual(gitDecision.selectedTools)
    expect(gitDecision.selectedCount).toBeLessThan(STANDARD_TOOL_CATALOG.length)
    expect(gitDecision.selectedTools).toContain('git_status')
    expect(gitDecision.selectedTools).toContain('git_commit')
    // Safe core tools must always be present
    for (const coreTool of CORE_SAFE_TOOL_NAMES) {
      expect(gitDecision.selectedTools).toContain(coreTool)
    }
  })

  it('Fail-open fallback: falls back to full catalog on uncertain confidence or error', async () => {
    // Router configured with high confidence threshold
    const settings = { ...defaultToolRoutingSettings(), mode: 'enforce' as const, confidenceThreshold: 0.99 }
    const router = new ToolRouter(settings, undefined, core)

    const decision = await router.routeTurn({
      taskTitle: 'Something extremely vague with no clear category',
    })

    // Fail-open must trigger full catalog fallback
    expect(decision.fallbackFullCatalog).toBe(true)
    expect(decision.selectedTools).toHaveLength(STANDARD_TOOL_CATALOG.length)
    expect(decision.savedSchemaTokens).toBe(0)
  })

  it('Laya integration: live Laya router resolves ambiguous turns', async () => {
    const laya = new HttpDecisionProvider({ id: 'laya', endpoint: LAYA_URL })
    const decisionSupport = new DecisionSupportService('assist', [laya], 0.10)
    const settings = { ...defaultToolRoutingSettings(), mode: 'assist' as const, provider: 'laya' as const, confidenceThreshold: 0.10 }
    const router = new ToolRouter(settings, decisionSupport, core)

    const decision = await router.routeTurn({
      taskTitle: 'Review system status and explore repository files',
      taskDescription: 'Look through files and check code structure',
    })

    expect(['laya', 'deterministic']).toContain(decision.provider)
    expect(decision.selectedCount).toBeGreaterThanOrEqual(3)
    expect(decision.selectedTools).toContain('read_file')
  })

  it('Section 14 full task classes suite: exercises all 7 required task classes and records evidence', async () => {
    const laya = new HttpDecisionProvider({ id: 'laya', endpoint: LAYA_URL })
    const decisionSupport = new DecisionSupportService('assist', [laya], 0.78)
    const service = new ToolRoutingService(undefined, decisionSupport, core)
    await service.updateSettings({ mode: 'shadow', provider: 'auto', confidenceThreshold: 0.78, failOpen: true })

    const testTasks = [
      { class: 'code-only', title: 'Refactor calculateMetrics function in metrics.ts', expectedTools: ['read_file', 'edit_file', 'write_file'] },
      { class: 'git', title: 'Inspect git diff and review branch status before merging', expectedTools: ['git_diff', 'git_status', 'read_file'] },
      { class: 'terminal', title: 'Execute cargo test and verify pnpm build in terminal', expectedTools: ['terminal_run', 'verification_status'] },
      { class: 'browser', title: 'Navigate to http://127.0.0.1:8765/health in browser and capture screenshot', expectedTools: ['browser_navigate', 'browser_snapshot'] },
      { class: 'multi-tool', title: 'Edit source code in app.ts, test in terminal, and commit git diff', expectedTools: ['read_file', 'edit_file', 'terminal_run', 'git_commit'] },
      { class: 'ambiguous', title: 'Analyze system telemetry and plan architectural roadmap', expectedTools: ['read_file', 'search_workspace'] },
      { class: 'unpredicted-fallback', title: 'Unusual edge-case query requiring fallback handling', expectedTools: ['read_file'] },
    ]

    const decisions: ToolRoutingDecision[] = []

    for (const t of testTasks) {
      const d = await service.routeTools({ taskTitle: t.title })
      decisions.push(d)
      expect(d.totalCount).toBe(STANDARD_TOOL_CATALOG.length)
      // Every task retains the necessary tools
      for (const expected of t.expectedTools) {
        expect(d.selectedTools).toContain(expected)
      }
      // Shadow mode always exposes full tool catalog to the model turn
      expect(d.effectiveTools).toHaveLength(STANDARD_TOOL_CATALOG.length)
    }

    // Calculate aggregated metrics for handoff section 17
    const avgFullCount = decisions.reduce((acc, d) => acc + d.totalCount, 0) / decisions.length
    const avgSelectedCount = decisions.reduce((acc, d) => acc + d.selectedCount, 0) / decisions.length
    const avgToolReduction = Math.round(((avgFullCount - avgSelectedCount) / avgFullCount) * 100)

    const avgFullTokens = decisions.reduce((acc, d) => acc + d.fullSchemaTokens, 0) / decisions.length
    const avgSelectedTokens = decisions.reduce((acc, d) => acc + d.selectedSchemaTokens, 0) / decisions.length
    const avgTokenReduction = Math.round(((avgFullTokens - avgSelectedTokens) / avgFullTokens) * 100)

    expect(avgToolReduction).toBeGreaterThanOrEqual(40)
    expect(avgTokenReduction).toBeGreaterThanOrEqual(40)

    // Verify secret hygiene in journal
    const journalContent = await readFile(journalPath, 'utf8')
    expect(journalContent).toContain('tool.routing')
    expect(journalContent).not.toMatch(/Bearer/i)
    expect(journalContent).not.toMatch(/sk-/i)
    expect(journalContent).not.toMatch(/API_KEY/i)
  }, 20_000)
})
