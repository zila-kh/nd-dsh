import { performance } from 'node:perf_hooks'
import {
  CORE_SAFE_TOOL_NAMES,
  STANDARD_TOOL_CATALOG,
  estimateSchemaTokens,
  type ToolDomain,
  type ToolRoutingDecision,
  type ToolRoutingMode,
  type ToolRouterProvider,
  type ToolRoutingSettings,
  type ToolSchema,
} from '../../shared/tool-routing.js'
import type { DecisionSupportService } from './decision-support.js'
import type { CoreClient } from '../core/core-client.js'

export interface RouteTurnInput {
  taskTitle: string
  taskDescription?: string
  turn?: number
  availableTools?: ToolSchema[]
  projectOverride?: Partial<ToolRoutingSettings>
  agentOverride?: Partial<ToolRoutingSettings>
}

export class ToolRouter {
  private settings: ToolRoutingSettings

  constructor(
    settings: ToolRoutingSettings,
    private readonly decisionSupport?: DecisionSupportService,
    private readonly core?: Pick<CoreClient, 'request'>,
  ) {
    this.settings = { ...settings }
  }

  updateSettings(patch: Partial<ToolRoutingSettings>): void {
    this.settings = { ...this.settings, ...patch }
  }

  getSettings(): ToolRoutingSettings {
    return { ...this.settings }
  }

  async routeTurn(input: RouteTurnInput): Promise<ToolRoutingDecision> {
    const started = performance.now()
    const catalog = input.availableTools ?? STANDARD_TOOL_CATALOG
    const fullTokens = estimateSchemaTokens(catalog)

    // Resolve effective settings with potential overrides
    const effective = this.resolveEffectiveSettings(input)

    // Mode 'off': zero filtering
    if (effective.mode === 'off') {
      const allNames = catalog.map((t) => t.name)
      return {
        mode: 'off',
        provider: 'deterministic',
        confidence: 1.0,
        latencyMs: Math.round(performance.now() - started),
        totalCount: catalog.length,
        selectedCount: catalog.length,
        selectedTools: allNames,
        effectiveTools: allNames,
        fullSchemaTokens: fullTokens,
        selectedSchemaTokens: fullTokens,
        savedSchemaTokens: 0,
        savingsPercent: 0,
        fallbackFullCatalog: false,
        taskClass: 'off',
      }
    }

    const taskText = `${input.taskTitle} ${input.taskDescription ?? ''}`.trim()
    const taskClass = classifyTaskHeuristic(taskText)

    let providerUsed: string = 'deterministic'
    let confidence = 0.95
    let selectedDomain: ToolDomain | 'multi' | 'unknown' = 'unknown'
    let fallback = false
    let fallbackReason: string | undefined

    // 1. Deterministic Rule Matching
    if (taskClass === 'code-only') {
      selectedDomain = 'code'
      confidence = 0.96
    } else if (taskClass === 'git') {
      selectedDomain = 'git'
      confidence = 0.94
    } else if (taskClass === 'terminal') {
      selectedDomain = 'terminal'
      confidence = 0.92
    } else if (taskClass === 'browser') {
      selectedDomain = 'browser'
      confidence = 0.95
    } else if (taskClass === 'multi-tool') {
      selectedDomain = 'multi'
      confidence = 0.85
    } else {
      // Ambiguous or unclassified task: query decision provider (Laya/Jev) if configured
      selectedDomain = 'unknown'
      confidence = 0.50
    }

    // 2. Cascade through Laya / Jev when deterministic classification is uncertain
    if (selectedDomain === 'unknown' && effective.provider !== 'deterministic' && this.decisionSupport) {
      providerUsed = 'laya'
      try {
        const question = {
          tool_domain: {
            type: 'choice' as const,
            instructions: 'Select the primary tool domain needed to accomplish this task',
            criteria: {
              code: 'Editing files, refactoring, and code changes',
              git: 'Inspecting git history, commits, status, and diffs',
              terminal: 'Running shell commands, tests, or builds',
              browser: 'Browsing web pages or testing UI in the browser',
              all: 'Broad task requiring tools from multiple domains',
            },
          },
        }
        const state = { task: input.taskTitle, description: input.taskDescription }
        const receipt = await this.decisionSupport.evaluate('turn-decision', state, question)

        if (receipt.selectedProvider) {
          providerUsed = receipt.selectedProvider
          const attempt = receipt.attempts.find((a) => a.provider === receipt.selectedProvider)
          const answer = attempt?.result?.answers?.tool_domain
          if (answer && answer.type === 'choice') {
            if (answer.choice === 'code') selectedDomain = 'code'
            else if (answer.choice === 'git') selectedDomain = 'git'
            else if (answer.choice === 'terminal') selectedDomain = 'terminal'
            else if (answer.choice === 'browser') selectedDomain = 'browser'
            else if (answer.choice === 'all') selectedDomain = 'multi'
            confidence = answer.confidence ?? attempt?.result?.minimumConfidence ?? 0.85
          }
        } else {
          // Cascade returned no selected provider (low confidence or failure)
          confidence = 0.40
          if (effective.failOpen) {
            fallback = true
            fallbackReason = 'Provider cascade did not meet confidence threshold'
          }
        }
      } catch (err) {
        if (effective.failOpen) {
          fallback = true
          fallbackReason = err instanceof Error ? err.message : String(err)
        }
      }
    }

    // Check if confidence falls below threshold
    if (!fallback && confidence < effective.confidenceThreshold) {
      if (effective.failOpen) {
        fallback = true
        fallbackReason = `Confidence ${confidence.toFixed(2)} is below threshold ${effective.confidenceThreshold}`
      }
    }

    // 3. Assemble selected tools
    let selectedTools: string[]
    if (fallback) {
      selectedTools = catalog.map((t) => t.name)
    } else if (selectedDomain === 'multi') {
      // Multi-tool task: include code, terminal, and git tools
      selectedTools = catalog
        .filter((t) => t.domain === 'code' || t.domain === 'terminal' || t.domain === 'git' || t.domain === 'core')
        .map((t) => t.name)
    } else {
      // Domain-specific tools
      selectedTools = catalog
        .filter((t) => t.domain === selectedDomain || t.domain === 'core')
        .map((t) => t.name)
    }

    // 4. Always ensure core safe tools are included if requested
    if (effective.alwaysAvailableCoreTools) {
      for (const coreTool of CORE_SAFE_TOOL_NAMES) {
        if (!selectedTools.includes(coreTool) && catalog.some((t) => t.name === coreTool)) {
          selectedTools.unshift(coreTool)
        }
      }
    }

    // 5. Ensure minimum tool threshold
    if (selectedTools.length < effective.minTools) {
      for (const tool of catalog) {
        if (!selectedTools.includes(tool.name)) {
          selectedTools.push(tool.name)
          if (selectedTools.length >= effective.minTools) break
        }
      }
    }

    // Determine effective tools exposed to agent
    // In 'shadow' mode: the full catalog is ALWAYS passed to the model, while recording the selected prediction
    // In 'assist' or 'enforce' mode: the filtered tool set is passed to the model
    const effectiveTools = effective.mode === 'shadow'
      ? catalog.map((t) => t.name)
      : selectedTools

    const selectedToolSchemas = catalog.filter((t) => selectedTools.includes(t.name))
    const selectedTokens = estimateSchemaTokens(selectedToolSchemas)
    const savedTokens = Math.max(0, fullTokens - selectedTokens)
    const savingsPercent = fullTokens > 0 ? Math.round((savedTokens / fullTokens) * 100) : 0
    const latencyMs = Math.round(performance.now() - started)

    const decision: ToolRoutingDecision = {
      mode: effective.mode,
      provider: providerUsed,
      confidence: Math.round(confidence * 100) / 100,
      latencyMs,
      totalCount: catalog.length,
      selectedCount: selectedTools.length,
      selectedTools,
      effectiveTools,
      fullSchemaTokens: fullTokens,
      selectedSchemaTokens: selectedTokens,
      savedSchemaTokens: savedTokens,
      savingsPercent,
      fallbackFullCatalog: fallback,
      ...(fallbackReason ? { fallbackReason } : {}),
      taskClass,
    }

    // Journal the effect if core is available and logging enabled
    if (effective.showRoutingInLog && this.core) {
      await this.core.request('effectJournal.append', {
        kind: 'tool.routing',
        state: 'complete',
        data: {
          mode: decision.mode,
          provider: decision.provider,
          confidence: decision.confidence,
          latencyMs: decision.latencyMs,
          totalCount: decision.totalCount,
          selectedCount: decision.selectedCount,
          savedSchemaTokens: decision.savedSchemaTokens,
          savingsPercent: decision.savingsPercent,
          fallbackFullCatalog: decision.fallbackFullCatalog,
          taskClass: decision.taskClass,
        },
      }, 5_000).catch(() => {})
    }

    return decision
  }

  private resolveEffectiveSettings(input: RouteTurnInput): ToolRoutingSettings {
    let resolved = { ...this.settings }
    if (resolved.perProjectOverride && input.projectOverride) {
      resolved = { ...resolved, ...input.projectOverride }
    }
    if (resolved.perAgentOverride && input.agentOverride) {
      resolved = { ...resolved, ...input.agentOverride }
    }
    return resolved
  }
}

/**
 * Deterministic classifier identifying task class from natural language intent.
 */
export function classifyTaskHeuristic(text: string): 'code-only' | 'git' | 'terminal' | 'browser' | 'multi-tool' | 'ambiguous' {
  const lower = text.toLowerCase()

  // Browser signals
  const browserMatch = /\b(?:browser|url|http|navigate|web|dom|page|scrape|accessibility|click button|form fill)\b/.test(lower)
  // Git signals
  const gitMatch = /\b(?:git|commit|diff|branch|status|log|merge|worktree|stash|checkout)\b/.test(lower)
  // Terminal/build signals
  const terminalMatch = /\b(?:terminal|cargo|pnpm|npm|build|compile|test runner|run test|bench|execute command)\b/.test(lower)
  // Code edit signals
  const codeMatch = /\b(?:edit|write|refactor|fix|function|class|variable|module|import|typescript|syntax)\b/.test(lower)

  const count = [browserMatch, gitMatch, terminalMatch, codeMatch].filter(Boolean).length
  if (count > 1) return 'multi-tool'
  if (browserMatch) return 'browser'
  if (gitMatch) return 'git'
  if (terminalMatch) return 'terminal'
  if (codeMatch) return 'code-only'
  return 'ambiguous'
}
