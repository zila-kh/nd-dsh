/**
 * External workflow plugin contract (protocol `nd.workflow/1`).
 *
 * A workflow plugin reports repository workflow state to ND and renders bounded
 * context. It is a read-only reporting surface: the plugin never mutates the
 * project, never executes project commands, and never grants approval. ND owns
 * identity, authorization, board projection, and any future transition actions.
 *
 * The pilot plugin is Agent Workflow Scrum (`agent-workflow-scrum`), consumed
 * through its project-local CLI with fixed argv, `shell: false`, deadlines, and
 * output caps. ND never installs or updates the upstream package; the project
 * owns that dependency.
 */

export const WORKFLOW_PLUGIN_PROTOCOL = 'nd.workflow/1'
/** ND host API version this protocol implementation speaks. */
export const WORKFLOW_PLUGIN_ND_API_VERSION = '1'

export const WORKFLOW_PLUGIN_METHODS = ['detect', 'readSnapshot', 'buildContext'] as const
export type WorkflowPluginMethod = (typeof WORKFLOW_PLUGIN_METHODS)[number]

/**
 * Permissions a workflow plugin may request. Anything else fails manifest
 * validation — requestedPermissions is an allow-list, not free text.
 */
export const WORKFLOW_PERMISSIONS = ['project.workflow.read', 'board.project', 'context.contribute'] as const
export type WorkflowPermission = (typeof WORKFLOW_PERMISSIONS)[number]

export type WorkflowContributionKind = 'workflow' | 'context' | 'command'

export interface WorkflowContribution {
  kind: WorkflowContributionKind
  id: string
  protocolVersion?: number
  methods?: WorkflowPluginMethod[]
  hostCommand?: string
}

/** ND only accepts the fail-closed transport shape; other transports are future work. */
export interface WorkflowCliRequirements {
  shell: false
  fixedArgv: true
  timeoutMs: number
  maxOutputBytes: number
  noInstall: true
}

export interface WorkflowCliTransport {
  kind: 'cli'
  invocation: string
  requirements: WorkflowCliRequirements
  /** Protocol method -> CLI subcommand passed after the `nd` keyword. */
  methods: { detect: string; readSnapshot: string; buildContext: string }
}

export interface WorkflowPluginUpstream {
  package: string
  supportedConfigSchemas: number[]
  supportedModes: string[]
  taskPrefixes: string[]
}

export interface WorkflowPluginManifest {
  protocol: typeof WORKFLOW_PLUGIN_PROTOCOL
  id: string
  version: string
  surface: 'plugin'
  ndApiVersion: string
  description: string
  contributions: WorkflowContribution[]
  requestedPermissions: WorkflowPermission[]
  transport: WorkflowCliTransport
  upstream?: WorkflowPluginUpstream
  limitations?: string[]
}

/** Where an installed plugin package came from. Provenance is recorded, never trusted. */
export type WorkflowPluginInstallSource =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; ref?: string }

export interface InstalledWorkflowPlugin {
  id: string
  version: string
  manifest: WorkflowPluginManifest
  source:
    | { kind: 'local'; path: string; gitRemote?: string; gitHead?: string; gitDirty?: boolean }
    | { kind: 'git'; url: string; ref?: string; resolvedSha?: string; localPath: string }
  installedAt: number
  updatedAt: number
}

/** Company/project-scoped activation of one installed workflow plugin. */
export interface ProjectWorkflowBinding {
  version: 1
  companyId: string
  projectId: string
  pluginId: string
  pluginVersion: string
  contributionId: string
  mode: 'mirror'
  contextEnabled: boolean
  /** Canonical absolute workspace root this binding reads. */
  root: string
  source: { remote?: string; branch?: string; head?: string; dirty?: boolean }
  config?: { schemaVersion: number; mode: string; packageManager: string }
  createdAt: number
  updatedAt: number
  validatedAt?: number
}

export interface WorkflowDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  sourcePath?: string
}

export type RepositoryTaskLifecycle = 'todo' | 'wip' | 'blocked' | 'done'
export type RepositoryTaskDisplayStatus = 'ready' | 'in_progress' | 'blocked' | 'completed'

export interface RepositoryWorkflowTask {
  /** Canonical task number; null when unnumbered (needs an explicit mapping before ND can act on it). */
  key: string | null
  sourcePath: string
  contentHash: string
  title: string
  lifecycle: RepositoryTaskLifecycle
  /** Absent when the source record is ambiguous; ND must not invent a status. */
  displayStatus?: RepositoryTaskDisplayStatus
  archived: boolean
  legacyArchive: boolean
  prdRefs: string[]
  outcome?: string
  scope: string[]
  criteria: Array<{ text: string; checked: boolean }>
  /** Recorded evidence excerpt, when the source recorded one. */
  evidence?: string
  /** True when the source records evidence exists, even without a readable excerpt. */
  evidencePresent?: boolean
  /** Recorded human acceptance excerpt, when present. */
  humanAcceptance?: string
  /** True when the source records an explicit human acceptance, even without a readable excerpt. */
  humanAcceptanceRecorded?: boolean
  diagnostics: WorkflowDiagnostic[]
}

export interface RepositoryWorkflowPrd {
  key: string | null
  sourcePath: string
  contentHash: string
  title: string
  status?: string
  inIndex: boolean
  indexStatus?: string
  summary?: string
}

export interface ProjectWorkflowSnapshot {
  version: 1
  scannedAt: string
  git: { available: boolean; branch?: string; head?: string; dirty: boolean }
  stale: boolean
  lastError?: string
  tasks: RepositoryWorkflowTask[]
  prds: RepositoryWorkflowPrd[]
  diagnostics: WorkflowDiagnostic[]
}

/** Snapshot storage key: one binding's last-known board state. */
export interface WorkflowSnapshotKey {
  companyId: string
  projectId: string
  pluginId: string
}

export function workflowSnapshotKeyId(key: WorkflowSnapshotKey): string {
  return `${key.companyId}:${key.projectId}:${key.pluginId}`
}

export interface WorkflowSnapshotEntry {
  key: WorkflowSnapshotKey
  snapshot: ProjectWorkflowSnapshot
}

/** Everything the renderer may see about installed plugins, bindings and boards. */
export interface WorkflowPluginsState {
  version: 1
  plugins: InstalledWorkflowPlugin[]
  bindings: ProjectWorkflowBinding[]
  snapshots: WorkflowSnapshotEntry[]
}

export interface WorkflowDetectionPreview {
  pluginId: string
  pluginVersion: string
  supported: boolean
  config?: { schemaVersion: number; mode: string; packageManager: string }
  diagnostics: WorkflowDiagnostic[]
  error?: string
}

/** Per-project view resolved by the main process; the renderer never supplies paths. */
export interface WorkflowProjectView {
  binding?: ProjectWorkflowBinding
  snapshot?: ProjectWorkflowSnapshot
  /** True when a binding exists but its plugin package was uninstalled. */
  pluginMissing?: boolean
  /** True when the integration was disabled but a last-known snapshot remains (shown disconnected). */
  disconnected?: boolean
}

export const WORKFLOW_PLUGINS_IPC = {
  list: 'workflow-plugins:list',
  install: 'workflow-plugins:install',
  remove: 'workflow-plugins:remove',
  detect: 'workflow-plugins:detect',
  enable: 'workflow-plugins:enable',
  disable: 'workflow-plugins:disable',
  refresh: 'workflow-plugins:refresh',
  snapshot: 'workflow-plugins:snapshot',
  changedEvent: 'workflow-plugins:changed-event',
} as const

export interface WorkflowPluginsDesktopApi {
  list(): Promise<WorkflowPluginsState>
  install(source: WorkflowPluginInstallSource): Promise<WorkflowPluginsState>
  remove(pluginId: string): Promise<WorkflowPluginsState>
  detect(companyId: string, projectId: string, pluginId?: string): Promise<WorkflowDetectionPreview[]>
  enable(companyId: string, projectId: string, pluginId: string): Promise<WorkflowPluginsState>
  disable(companyId: string, projectId: string, pluginId: string): Promise<WorkflowPluginsState>
  refresh(companyId: string, projectId: string): Promise<WorkflowPluginsState>
  snapshot(companyId: string, projectId: string): Promise<WorkflowProjectView>
  onChanged(listener: (state: WorkflowPluginsState) => void): () => void
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/
const CLAMP_TIMEOUT_MS: [number, number] = [2_000, 60_000]
const CLAMP_OUTPUT_BYTES: [number, number] = [4_096, 8_000_000]

/** Parse and normalize an `nd.workflow/1` plugin manifest; throws on anything unsupported. */
export function parseWorkflowPluginManifest(value: unknown): WorkflowPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow plugin manifest must be an object')
  const record = value as Record<string, unknown>
  if (record.protocol !== WORKFLOW_PLUGIN_PROTOCOL) throw new Error(`Unsupported workflow plugin protocol: ${string(record.protocol, 'protocol', 64)}`)
  const id = string(record.id, 'Plugin id', 128)
  if (!ID_PATTERN.test(id)) throw new Error('Workflow plugin id must use lowercase letters, numbers, dots, dashes, or underscores')
  const version = string(record.version, 'Plugin version', 64)
  if (record.surface !== 'plugin') throw new Error('Workflow plugin manifests must declare surface "plugin"')
  if (record.ndApiVersion !== WORKFLOW_PLUGIN_ND_API_VERSION) throw new Error(`Workflow plugin requires ND API ${string(record.ndApiVersion, 'ndApiVersion', 16)}, this ND host speaks ${WORKFLOW_PLUGIN_ND_API_VERSION}`)
  const description = string(record.description, 'Description', 4_000)

  const contributions = parseContributions(record.contributions)
  if (!contributions.some((item) => item.kind === 'workflow' && item.protocolVersion === 1)) {
    throw new Error('Workflow plugin manifest must declare a workflow contribution with protocolVersion 1')
  }

  const requestedPermissions = parsePermissions(record.requestedPermissions)
  const transport = parseTransport(record.transport)
  const upstream = parseUpstream(record.upstream)
  const limitations = parseStringList(record.limitations, 'limitations', 16, 2_000)

  return {
    protocol: WORKFLOW_PLUGIN_PROTOCOL,
    id,
    version,
    surface: 'plugin',
    ndApiVersion: WORKFLOW_PLUGIN_ND_API_VERSION,
    description,
    contributions,
    requestedPermissions,
    transport,
    ...(upstream ? { upstream } : {}),
    ...(limitations ? { limitations } : {}),
  }
}

function parseContributions(value: unknown): WorkflowContribution[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new Error('Workflow plugin manifest must declare 1-16 contributions')
  }
  const kinds = new Set<WorkflowContributionKind>()
  const contributions = value.map((entry): WorkflowContribution => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each contribution must be an object')
    const item = entry as Record<string, unknown>
    const kind = item.kind
    if (kind !== 'workflow' && kind !== 'context' && kind !== 'command') throw new Error(`Unsupported workflow contribution kind: ${string(kind, 'kind', 32)}`)
    if (kinds.has(kind)) throw new Error(`Duplicate workflow contribution kind: ${kind}`)
    kinds.add(kind)
    const id = string(item.id, 'Contribution id', 128)
    const methods = item.methods === undefined
      ? undefined
      : (Array.isArray(item.methods) ? item.methods : []).flatMap((method) =>
          typeof method === 'string' && (WORKFLOW_PLUGIN_METHODS as readonly string[]).includes(method)
            ? [method as WorkflowPluginMethod]
            : [],
        )
    if (methods && methods.length !== (item.methods as unknown[]).length) throw new Error('Workflow contribution declares an unsupported method')
    return {
      kind,
      id,
      ...(typeof item.protocolVersion === 'number' && Number.isInteger(item.protocolVersion) ? { protocolVersion: item.protocolVersion } : {}),
      ...(methods ? { methods } : {}),
      ...(typeof item.hostCommand === 'string' && item.hostCommand.trim() ? { hostCommand: item.hostCommand.trim().slice(0, 128) } : {}),
    }
  })
  return contributions
}

function parsePermissions(value: unknown): WorkflowPermission[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > WORKFLOW_PERMISSIONS.length) {
    throw new Error('Workflow plugin must request between 1 and 4 known permissions')
  }
  const out: WorkflowPermission[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !(WORKFLOW_PERMISSIONS as readonly string[]).includes(entry)) {
      throw new Error(`Workflow plugin requested an unknown permission: ${string(entry, 'permission', 128)}`)
    }
    if (!out.includes(entry as WorkflowPermission)) out.push(entry as WorkflowPermission)
  }
  return out
}

function parseTransport(value: unknown): WorkflowCliTransport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow plugin transport is required')
  const record = value as Record<string, unknown>
  if (record.kind !== 'cli') throw new Error('Only the CLI workflow transport is supported by this ND host')
  const requirements = record.requirements
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new Error('Workflow transport requirements are required')
  const req = requirements as Record<string, unknown>
  if (req.shell !== false) throw new Error('Workflow CLI transport must require shell: false')
  if (req.fixedArgv !== true) throw new Error('Workflow CLI transport must require fixed argv')
  if (req.noInstall !== true) throw new Error('Workflow CLI transport must require noInstall: ND never installs the upstream package')
  const methods = record.methods
  if (!methods || typeof methods !== 'object' || Array.isArray(methods)) throw new Error('Workflow transport method mapping is required')
  const methodRecord = methods as Record<string, unknown>
  for (const key of ['detect', 'readSnapshot', 'buildContext'] as const) {
    if (typeof methodRecord[key] !== 'string' || !(methodRecord[key] as string).trim()) throw new Error(`Workflow transport must map the ${key} method`)
  }
  return {
    kind: 'cli',
    invocation: string(record.invocation, 'Transport invocation', 512),
    requirements: {
      shell: false,
      fixedArgv: true,
      timeoutMs: clampNumber(req.timeoutMs, 'timeoutMs', CLAMP_TIMEOUT_MS),
      maxOutputBytes: clampNumber(req.maxOutputBytes, 'maxOutputBytes', CLAMP_OUTPUT_BYTES),
      noInstall: true,
    },
    methods: {
      detect: string(methodRecord.detect, 'detect method', 64),
      readSnapshot: string(methodRecord.readSnapshot, 'readSnapshot method', 64),
      buildContext: string(methodRecord.buildContext, 'buildContext method', 64),
    },
  }
}

function parseUpstream(value: unknown): WorkflowPluginUpstream | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow plugin upstream must be an object')
  const record = value as Record<string, unknown>
  const pkg = string(record.package, 'Upstream package', 128)
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(pkg)) throw new Error('Upstream package must be an npm package name')
  const schemas = (Array.isArray(record.supportedConfigSchemas) ? record.supportedConfigSchemas : []).flatMap((entry) =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 1_000 ? [entry] : [],
  )
  return {
    package: pkg,
    supportedConfigSchemas: schemas,
    supportedModes: parseStringList(record.supportedModes, 'supportedModes', 16, 64) ?? [],
    taskPrefixes: parseStringList(record.taskPrefixes, 'taskPrefixes', 16, 64) ?? [],
  }
}

/** Envelope present on every CLI result: `protocol`, `plugin`, `root`, `diagnostics`. */
export interface WorkflowResultEnvelope {
  protocol: string
  plugin: { id: string; version: string }
  root: string
  diagnostics: WorkflowDiagnostic[]
}

/** Validate the common CLI result envelope against the expected plugin identity. */
export function parseWorkflowEnvelope(value: unknown, expected: { protocol: string; pluginId: string }): WorkflowResultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow CLI result must be a JSON object')
  const record = value as Record<string, unknown>
  if (record.protocol !== expected.protocol) throw new Error(`Workflow CLI result protocol mismatch: ${string(record.protocol, 'protocol', 64)}`)
  const plugin = record.plugin
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) throw new Error('Workflow CLI result is missing plugin identity')
  const pluginRecord = plugin as Record<string, unknown>
  if (pluginRecord.id !== expected.pluginId) throw new Error(`Workflow CLI result came from an unexpected plugin: ${string(pluginRecord.id, 'plugin id', 128)}`)
  return {
    protocol: expected.protocol,
    plugin: { id: expected.pluginId, version: string(pluginRecord.version, 'plugin version', 64) },
    root: string(record.root, 'result root', 1_024),
    diagnostics: parseDiagnostics(record.diagnostics),
  }
}

export interface WorkflowDetectionData {
  supported: boolean
  config?: { schemaVersion: number; mode: string; packageManager: string }
}

/** Validate a `detect` payload after envelope validation. */
export function parseWorkflowDetection(value: unknown): WorkflowDetectionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow detect result must be an object')
  const record = value as Record<string, unknown>
  const supported = record.supported === true
  let config: WorkflowDetectionData['config'] | undefined
  if (record.config !== undefined) {
    if (!record.config || typeof record.config !== 'object' || Array.isArray(record.config)) throw new Error('Workflow detect config must be an object')
    const cfg = record.config as Record<string, unknown>
    config = {
      schemaVersion: typeof cfg.schemaVersion === 'number' && Number.isInteger(cfg.schemaVersion) ? cfg.schemaVersion : Number.NaN,
      mode: string(cfg.mode, 'config mode', 64),
      packageManager: string(cfg.packageManager, 'config packageManager', 32),
    }
  }
  return { supported, ...(config ? { config } : {}) }
}

const SNAPSHOT_TASK_LIMIT = 200
const SNAPSHOT_PRD_LIMIT = 200

/**
 * Validate a `readSnapshot` payload after envelope validation. Invalid
 * individual records are dropped and surfaced as diagnostics instead of
 * failing the whole snapshot, so one malformed file cannot hide the board.
 */
export function parseWorkflowSnapshot(value: unknown): ProjectWorkflowSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow snapshot must be an object')
  const record = value as Record<string, unknown>
  const scannedAt = string(record.scannedAt, 'scannedAt', 64)
  if (!Number.isFinite(Date.parse(scannedAt))) throw new Error('Workflow snapshot scannedAt must be an ISO timestamp')
  const git = parseGitFacts(record.git)
  const diagnostics = parseDiagnostics(record.diagnostics)

  const tasks: RepositoryWorkflowTask[] = []
  if (Array.isArray(record.tasks)) {
    for (const entry of record.tasks.slice(0, SNAPSHOT_TASK_LIMIT)) {
      const task = parseTaskRecord(entry)
      if (task) tasks.push(task)
      else diagnostics.push({ severity: 'warning', code: 'invalid_task_record', message: 'A repository task record was malformed and was dropped from the snapshot.' })
    }
    if (record.tasks.length > SNAPSHOT_TASK_LIMIT) {
      diagnostics.push({ severity: 'warning', code: 'scan_limit_exceeded', message: `Snapshot contained more than ${SNAPSHOT_TASK_LIMIT} tasks; excess records were dropped.` })
    }
  }

  const prds: RepositoryWorkflowPrd[] = []
  if (Array.isArray(record.prds)) {
    for (const entry of record.prds.slice(0, SNAPSHOT_PRD_LIMIT)) {
      const prd = parsePrdRecord(entry)
      if (prd) prds.push(prd)
      else diagnostics.push({ severity: 'warning', code: 'invalid_prd_record', message: 'A repository PRD record was malformed and was dropped from the snapshot.' })
    }
  }

  return {
    version: 1,
    scannedAt,
    git,
    stale: false,
    tasks,
    prds,
    diagnostics,
  }
}

/** Individual records are parsed defensively: a malformed file drops one card, never the board. */
function parseTaskRecord(value: unknown): RepositoryWorkflowTask | undefined {
  try {
    return parseTask(value)
  } catch {
    return undefined
  }
}

function parseTask(value: unknown): RepositoryWorkflowTask | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const lifecycle = record.lifecycle
  if (lifecycle !== 'todo' && lifecycle !== 'wip' && lifecycle !== 'blocked' && lifecycle !== 'done') return undefined
  const sourcePath = safeSourcePath(record.sourcePath)
  if (!sourcePath) return undefined
  const displayStatus = record.displayStatus
  const display = displayStatus === 'ready' || displayStatus === 'in_progress' || displayStatus === 'blocked' || displayStatus === 'completed'
    ? displayStatus as RepositoryTaskDisplayStatus
    : undefined
  const criteria = (Array.isArray(record.criteria) ? record.criteria : []).slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    if (typeof item.text !== 'string' || !item.text.trim()) return []
    return [{ text: item.text.trim().slice(0, 2_000), checked: item.checked === true }]
  })
  const evidence = parseReportedFact(record.evidence)
  const acceptance = parseReportedFact(record.humanAcceptance)
  return {
    key: typeof record.key === 'string' && record.key.trim() ? record.key.trim().slice(0, 64) : null,
    sourcePath,
    contentHash: typeof record.contentHash === 'string' ? record.contentHash.slice(0, 256) : '',
    title: string(record.title, 'Task title', 512),
    lifecycle,
    ...(display ? { displayStatus: display } : {}),
    archived: record.archived === true,
    legacyArchive: record.legacyArchive === true,
    prdRefs: parseStringList(record.prdRefs, 'prdRefs', 50, 256) ?? [],
    ...(typeof record.outcome === 'string' && record.outcome.trim() ? { outcome: record.outcome.trim().slice(0, 4_000) } : {}),
    scope: parseStringList(record.scope, 'scope', 50, 512) ?? [],
    criteria,
    ...(evidence.excerpt ? { evidence: evidence.excerpt } : {}),
    ...(evidence.recorded ? { evidencePresent: true } : {}),
    ...(acceptance.excerpt ? { humanAcceptance: acceptance.excerpt } : {}),
    ...(acceptance.recorded ? { humanAcceptanceRecorded: true } : {}),
    diagnostics: parseDiagnostics(record.diagnostics),
  }
}

/**
 * Evidence and acceptance arrive either as plain strings or as the upstream
 * `{ present | recorded, excerpt }` facts object; both shapes are accepted so
 * a recorded fact is never silently dropped.
 */
function parseReportedFact(value: unknown): { recorded: boolean; excerpt?: string } {
  if (typeof value === 'string') {
    const excerpt = value.trim().slice(0, 4_000)
    return { recorded: excerpt.length > 0, ...(excerpt ? { excerpt } : {}) }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { recorded: false }
  const record = value as Record<string, unknown>
  const excerpt = typeof record.excerpt === 'string' ? record.excerpt.trim().slice(0, 4_000) : ''
  const recorded = record.present === true || record.recorded === true || excerpt.length > 0
  return { recorded, ...(excerpt ? { excerpt } : {}) }
}

/** Individual records are parsed defensively: a malformed file drops one card, never the board. */
function parsePrdRecord(value: unknown): RepositoryWorkflowPrd | undefined {
  try {
    return parsePrd(value)
  } catch {
    return undefined
  }
}

function parsePrd(value: unknown): RepositoryWorkflowPrd | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sourcePath = safeSourcePath(record.sourcePath)
  if (!sourcePath) return undefined
  return {
    key: typeof record.key === 'string' && record.key.trim() ? record.key.trim().slice(0, 64) : null,
    sourcePath,
    contentHash: typeof record.contentHash === 'string' ? record.contentHash.slice(0, 256) : '',
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 512) : sourcePath,
    ...(typeof record.status === 'string' && record.status.trim() ? { status: record.status.trim().slice(0, 64) } : {}),
    inIndex: record.inIndex === true,
    ...(typeof record.indexStatus === 'string' && record.indexStatus.trim() ? { indexStatus: record.indexStatus.trim().slice(0, 64) } : {}),
    ...(typeof record.summary === 'string' && record.summary.trim() ? { summary: record.summary.trim().slice(0, 4_000) } : {}),
  }
}

function parseGitFacts(value: unknown): ProjectWorkflowSnapshot['git'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { available: false, dirty: false }
  const record = value as Record<string, unknown>
  return {
    available: record.available === true,
    ...(typeof record.branch === 'string' && record.branch.trim() ? { branch: record.branch.trim().slice(0, 256) } : {}),
    ...(typeof record.head === 'string' && record.head.trim() ? { head: record.head.trim().slice(0, 64) } : {}),
    dirty: record.dirty === true,
  }
}

export function parseDiagnostics(value: unknown): WorkflowDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((entry): WorkflowDiagnostic[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const severity = record.severity
    if (severity !== 'info' && severity !== 'warning' && severity !== 'error') return []
    const code = typeof record.code === 'string' && record.code.trim() ? record.code.trim().slice(0, 128) : 'unspecified'
    return [{
      severity,
      code,
      message: typeof record.message === 'string' ? record.message.slice(0, 4_000) : code,
      ...(typeof record.sourcePath === 'string' && record.sourcePath.trim() ? { sourcePath: safeSourcePath(record.sourcePath) ?? undefined } : {}),
    }]
  })
}

/**
 * Source paths stay inside the reported root: relative paths must not escape
 * via `..`, absolute paths must sit under the reported root. Pure string
 * containment — the main process re-validates against the real filesystem.
 */
export function safeSourcePath(value: unknown, root?: string): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 1_024) return ''
  const normalized = trimmed.replaceAll('\\', '/')
  if (normalized.includes('\0')) return ''
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
    if (!root) return ''
    const rootNorm = root.replaceAll('\\', '/').replace(/\/+$/, '')
    const valueNorm = normalized.replace(/\/+$/, '')
    if (valueNorm !== rootNorm && !valueNorm.startsWith(`${rootNorm}/`)) return ''
    return normalized
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment === '..')) return ''
  return segments.join('/')
}

export type WorkflowBoardColumn = 'ready' | 'in_progress' | 'review' | 'blocked' | 'completed'
export const WORKFLOW_BOARD_COLUMNS: readonly WorkflowBoardColumn[] = ['ready', 'in_progress', 'review', 'blocked', 'completed']

/** One mirrored repository card projected onto the ND company board. */
export interface RepositoryBoardCard {
  /** Stable board key: `<keyPrefix>:<task key or source path>`. */
  key: string
  sourcePath: string
  title: string
  lifecycle: RepositoryTaskLifecycle
  column: WorkflowBoardColumn
  /** Unnumbered/ambiguous records are shown in a needs-attention area, never given an invented status. */
  needsAttention: boolean
  legacyArchive: boolean
  sourceReported: boolean
  criteriaTotal: number
  criteriaChecked: number
  hasEvidence: boolean
  humanAcceptance: boolean
  prdRefs: string[]
  warnings: string[]
}

export type RepositoryBoard = Record<WorkflowBoardColumn | 'needs_attention', RepositoryBoardCard[]>

/**
 * Project a repository snapshot onto the company board. Checked criteria do
 * not imply completion; completion and human acceptance stay source-reported
 * facts and repository cards never receive run/review actions in mirror mode.
 */
export function projectRepositoryBoard(snapshot: ProjectWorkflowSnapshot | undefined, keyPrefix = 'repo'): RepositoryBoard {
  const board: RepositoryBoard = { ready: [], in_progress: [], review: [], blocked: [], completed: [], needs_attention: [] }
  if (!snapshot) return board
  for (const task of snapshot.tasks) {
    const warnings: string[] = []
    let needsAttention = false
    if (!task.key) {
      needsAttention = true
      warnings.push('Unnumbered task record; needs an explicit mapping before it can be tracked.')
    }
    if (!task.displayStatus) {
      needsAttention = true
      warnings.push('Source lifecycle is ambiguous; no status is invented for it.')
    }
    for (const diagnostic of task.diagnostics) {
      if (diagnostic.severity === 'error') needsAttention = true
      if (diagnostic.severity !== 'info') warnings.push(diagnostic.message)
    }
    if (task.legacyArchive) warnings.push('Legacy archived record retains its original in-progress filename.')
    const hasAcceptance = Boolean(task.humanAcceptance) || task.humanAcceptanceRecorded === true
    const column: WorkflowBoardColumn | null = task.displayStatus
      ? task.displayStatus === 'in_progress' ? 'in_progress' : task.displayStatus
      : null
    if (column === 'completed' && !hasAcceptance) {
      warnings.push('Source-reported completion without an explicit human acceptance record; acceptance is not implied.')
    }
    const card: RepositoryBoardCard = {
      key: `${keyPrefix}:${task.key ?? task.sourcePath}`,
      sourcePath: task.sourcePath,
      title: task.title,
      lifecycle: task.lifecycle,
      column: column ?? 'ready',
      needsAttention,
      legacyArchive: task.legacyArchive,
      sourceReported: true,
      criteriaTotal: task.criteria.length,
      criteriaChecked: task.criteria.filter((item) => item.checked).length,
      hasEvidence: Boolean(task.evidence) || task.evidencePresent === true,
      humanAcceptance: hasAcceptance,
      prdRefs: task.prdRefs,
      warnings,
    }
    if (needsAttention) board.needs_attention.push(card)
    else board[column!].push(card)
  }
  return board
}

function string(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim().slice(0, max)
}

function parseStringList(value: unknown, label: string, maxEntries: number, maxLength: number): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.slice(0, maxEntries).flatMap((entry) => typeof entry === 'string' && entry.trim() ? [entry.trim().slice(0, maxLength)] : [])
}

function clampNumber(value: unknown, label: string, [min, max]: [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`)
  return Math.min(max, Math.max(min, Math.round(value)))
}
