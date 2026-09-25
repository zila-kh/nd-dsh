import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import {
  defaultToolRoutingSettings,
  type ToolRoutingDecision,
  type ToolRoutingMode,
  type ToolRouterProvider,
  type ToolRoutingSettings,
} from '../../shared/tool-routing.js'
import type { DecisionSupportService } from './decision-support.js'
import type { CoreClient } from '../core/core-client.js'
import { ToolRouter, type RouteTurnInput } from './tool-router.js'

export class ToolRoutingService {
  private settingsValue: ToolRoutingSettings
  private readonly router: ToolRouter
  private readonly recentDecisions: ToolRoutingDecision[] = []
  private readonly maxRecent = 50

  constructor(
    private readonly storagePath?: string,
    decisionSupport?: DecisionSupportService,
    core?: Pick<CoreClient, 'request'>,
  ) {
    this.settingsValue = this.loadSettings()
    this.router = new ToolRouter(this.settingsValue, decisionSupport, core)
  }

  settings(): ToolRoutingSettings {
    return { ...this.settingsValue }
  }

  async updateSettings(patch: Partial<ToolRoutingSettings>): Promise<ToolRoutingSettings> {
    this.settingsValue = { ...this.settingsValue, ...patch }
    this.router.updateSettings(this.settingsValue)
    this.persist()
    return { ...this.settingsValue }
  }

  async routeTools(input: RouteTurnInput): Promise<ToolRoutingDecision> {
    const decision = await this.router.routeTurn(input)
    this.recentDecisions.unshift(decision)
    if (this.recentDecisions.length > this.maxRecent) {
      this.recentDecisions.pop()
    }
    return decision
  }

  state(): { settings: ToolRoutingSettings; recentDecisions: ToolRoutingDecision[] } {
    return {
      settings: this.settings(),
      recentDecisions: [...this.recentDecisions],
    }
  }

  private loadSettings(): ToolRoutingSettings {
    let settings = defaultToolRoutingSettings()
    if (this.storagePath && existsSync(this.storagePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.storagePath, 'utf8'))
        settings = { ...settings, ...raw }
      } catch {}
    }

    // Apply environment overrides if present
    const envMode = process.env.ND_TOOL_ROUTING_MODE?.trim().toLowerCase() as ToolRoutingMode | undefined
    if (envMode && ['off', 'shadow', 'assist', 'enforce'].includes(envMode)) {
      settings.mode = envMode
    }
    const envProvider = process.env.ND_TOOL_ROUTING_PROVIDER?.trim().toLowerCase() as ToolRouterProvider | undefined
    if (envProvider && ['auto', 'laya', 'jev', 'deterministic'].includes(envProvider)) {
      settings.provider = envProvider
    }
    const envConfidence = Number.parseFloat(process.env.ND_TOOL_ROUTING_CONFIDENCE ?? '')
    if (!Number.isNaN(envConfidence) && envConfidence >= 0 && envConfidence <= 1) {
      settings.confidenceThreshold = envConfidence
    }
    if (process.env.ND_TOOL_ROUTING_FAIL_OPEN !== undefined) {
      settings.failOpen = process.env.ND_TOOL_ROUTING_FAIL_OPEN !== 'false'
    }

    return settings
  }

  private persist(): void {
    if (!this.storagePath) return
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true })
      writeFileSync(this.storagePath, JSON.stringify(this.settingsValue, null, 2), 'utf8')
    } catch {}
  }
}
