/**
 * ND extension package contract (`nd.extension/1`).
 *
 * One manifest schema and one validator serve the runtime installer, the SDK
 * CLI, and unit tests, so a package that validates locally cannot discover a
 * second set of rules at install time. Contributions only reference the
 * allowlisted native host methods below; a third-party manifest cannot name an
 * arbitrary host method or inject renderer code.
 */

import {
  ND_CONTEXT_KINDS,
  isNdContextKind,
  type NdContext,
  type NdContextKind,
} from './nd-context.js'

export const ND_EXTENSION_PROTOCOL = 'nd.extension/1'
export const ND_EXTENSION_MANIFEST_FILENAME = 'nd-extension.json'
export const ND_EXTENSION_API_VERSION = 1

/** ND API grants a package may request; executable trust is a separate record. */
export const ND_EXTENSION_PERMISSIONS = [
  'notes.read',
  'notes.write',
  'capture.screen',
  'capture.area',
  'capture.read',
  'clipboard.read',
  'clipboard.write',
  'browser.navigate',
  'browser.openExternal',
  'os.launch',
  'os.wallpaper.write',
  'chat.start',
  'workflow.read',
] as const

export type NdExtensionPermission = (typeof ND_EXTENSION_PERMISSIONS)[number]

/**
 * Allowlisted native host methods. Each maps to one trusted main-process
 * handler; `sensitive` marks reads that always need an explicit user gesture
 * when the caller is an agent rather than the person at the keyboard.
 */
export interface NdHostMethodDescriptor {
  id: string
  title: string
  permission: NdExtensionPermission
  contexts: readonly NdContextKind[]
  sensitive: boolean
}

export const ND_HOST_METHODS = [
  { id: 'note.create', title: 'Save a note', permission: 'notes.write', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'note.search', title: 'Search notes', permission: 'notes.read', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'note.open', title: 'Open a note', permission: 'notes.read', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'note.delete', title: 'Delete a note', permission: 'notes.write', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'capture.screen', title: 'Capture a display', permission: 'capture.screen', contexts: ['personal', 'company', 'project'], sensitive: true },
  { id: 'capture.area', title: 'Capture a screen area', permission: 'capture.area', contexts: ['personal', 'company', 'project'], sensitive: true },
  { id: 'capture.list', title: 'List captures', permission: 'capture.read', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'capture.copy', title: 'Copy a capture', permission: 'capture.read', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'capture.export', title: 'Export a capture', permission: 'capture.read', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'clipboard.read', title: 'Read the clipboard', permission: 'clipboard.read', contexts: ['personal', 'company', 'project'], sensitive: true },
  { id: 'clipboard.write', title: 'Write the clipboard', permission: 'clipboard.write', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'browser.openUrl', title: 'Open a website', permission: 'browser.navigate', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'browser.search', title: 'Search the web', permission: 'browser.navigate', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'browser.openExternal', title: 'Open in the system browser', permission: 'browser.openExternal', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'os.openTarget', title: 'Open an app, file, or folder', permission: 'os.launch', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'os.wallpaper.chooseAndSet', title: 'Choose and set desktop wallpaper', permission: 'os.wallpaper.write', contexts: ['personal'], sensitive: true },
  { id: 'chat.ask', title: 'Ask ND', permission: 'chat.start', contexts: ['personal', 'company', 'project'], sensitive: false },
  { id: 'workflow.list', title: 'Read repository tasks', permission: 'workflow.read', contexts: ['project'], sensitive: false },
  { id: 'workflow.refresh', title: 'Refresh repository tasks', permission: 'workflow.read', contexts: ['project'], sensitive: false },
] as const satisfies readonly NdHostMethodDescriptor[]

export type NdHostMethod = (typeof ND_HOST_METHODS)[number]['id']

export function ndHostMethod(id: string): NdHostMethodDescriptor | undefined {
  return ND_HOST_METHODS.find((method) => method.id === id)
}

export function isNdHostMethod(value: unknown): value is NdHostMethod {
  return typeof value === 'string' && ndHostMethod(value) !== undefined
}

export type NdContributionKind = 'tool' | 'skill' | 'command' | 'view' | 'workflow'

export const ND_CONTRIBUTION_KINDS: readonly NdContributionKind[] = ['tool', 'skill', 'command', 'view', 'workflow']

/** Commands are deterministic host actions unless explicitly declared to start agent work. */
export interface NdCommandContribution {
  id: string
  title: string
  description?: string
  keywords?: string[]
  contexts: NdContextKind[]
  host: NdHostMethod
  startsAgent?: boolean
}

export interface NdViewActionContribution {
  id: string
  title: string
  host: NdHostMethod
}

/** Typed view descriptions rendered by ND; packages never supply their own UI code. */
export interface NdViewContribution {
  id: string
  title: string
  description?: string
  contexts: NdContextKind[]
  kind: 'list' | 'detail'
  host: NdHostMethod
  itemTitleKey: string
  itemBodyKey?: string
  actions: NdViewActionContribution[]
}

export interface NdToolContribution {
  id: string
  title: string
  description?: string
  contexts: NdContextKind[]
  /** Tool name inside the package's declared MCP stdio runtime. */
  toolName: string
}

export interface NdSkillContribution {
  id: string
  title: string
  description?: string
  contexts: NdContextKind[]
  instructions: string
}

/** Project-only adapter over the existing read-only `nd.workflow/1` integration. */
export interface NdWorkflowContribution {
  id: string
  title: string
  description?: string
  contexts: NdContextKind[]
  pluginId: string
}

export interface NdPackageContributions {
  tools: NdToolContribution[]
  skills: NdSkillContribution[]
  commands: NdCommandContribution[]
  views: NdViewContribution[]
  workflows: NdWorkflowContribution[]
}

export interface NdMcpStdioRuntime {
  kind: 'mcp-stdio'
  command: string
  args: string[]
  /** Maps a child variable name to a parent environment-variable name; never a secret value. */
  env: Record<string, string>
}

export interface NdPackageSettingField {
  key: string
  title: string
  type: 'string' | 'boolean' | 'number'
  default?: string | number | boolean
  description?: string
}

export interface NdExtensionManifest {
  protocol: typeof ND_EXTENSION_PROTOCOL
  id: string
  name: string
  description: string
  version: string
  apiVersion: number
  /** Default contexts for contributions; contributions may narrow but not widen past this. */
  contexts: NdContextKind[]
  permissions: NdExtensionPermission[]
  settings: NdPackageSettingField[]
  contributions: NdPackageContributions
  /** Executable transport. Installation never executes it; trust is granted separately. */
  executable?: NdMcpStdioRuntime
}

export interface NdValidationIssue {
  path: string
  message: string
}

export type NdManifestValidation =
  | { ok: true; manifest: NdExtensionManifest }
  | { ok: false; issues: NdValidationIssue[] }

const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/
const CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const SEMVER_PARTS = 3

/**
 * Validate a manifest with the same rules the runtime installer applies.
 * Issues accumulate so the SDK can report every problem in one pass.
 */
export function validateNdExtensionManifest(value: unknown): NdManifestValidation {
  const issues: NdValidationIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'Manifest must be a JSON object' }] }
  }
  const record = value as Record<string, unknown>

  if (record.protocol !== ND_EXTENSION_PROTOCOL) {
    issues.push({ path: 'protocol', message: `protocol must be "${ND_EXTENSION_PROTOCOL}"` })
  }
  const id = text(record.id, 'id', 128, PACKAGE_ID_PATTERN, issues)
  const name = text(record.name, 'name', 128, undefined, issues)
  const description = text(record.description, 'description', 2_000, undefined, issues)
  const version = text(record.version, 'version', 64, VERSION_PATTERN, issues)

  const apiVersion = record.apiVersion
  if (apiVersion !== ND_EXTENSION_API_VERSION) {
    issues.push({ path: 'apiVersion', message: `apiVersion must be ${ND_EXTENSION_API_VERSION}` })
  }

  const contexts = contextKinds(record.contexts, 'contexts', issues, { required: true })
  const permissions = permissionList(record.permissions, issues)
  const settings = settingFields(record.settings, issues)

  const contributions = contributionsValue(record.contributions, contexts, issues)
  validateHostContexts(contributions, issues)

  const executable = executableValue(record.executable, contributions, issues)

  if (issues.length > 0) return { ok: false, issues }
  const manifest: NdExtensionManifest = {
    protocol: ND_EXTENSION_PROTOCOL,
    id,
    name,
    description,
    version,
    apiVersion: ND_EXTENSION_API_VERSION,
    contexts,
    permissions,
    settings,
    contributions,
    ...(executable ? { executable } : {}),
  }
  return { ok: true, manifest }
}

/** Permissions a contribution actually requires, derived from its host methods. */
export function requiredPermissionsForManifest(manifest: NdExtensionManifest): NdExtensionPermission[] {
  const required = new Set<NdExtensionPermission>()
  for (const command of manifest.contributions.commands) required.add(ndHostMethod(command.host)!.permission)
  for (const view of manifest.contributions.views) {
    required.add(ndHostMethod(view.host)!.permission)
    for (const action of view.actions) required.add(ndHostMethod(action.host)!.permission)
  }
  if (manifest.contributions.workflows.length > 0) required.add('workflow.read')
  return [...required]
}

export function manifestPermissionIssues(manifest: NdExtensionManifest): NdValidationIssue[] {
  const declared = new Set(manifest.permissions)
  return requiredPermissionsForManifest(manifest)
    .filter((permission) => !declared.has(permission))
    .map((permission) => ({ path: 'permissions', message: `contributions require the "${permission}" permission` }))
}

export function contributionSupportsContext(contexts: readonly NdContextKind[], context: NdContext): boolean {
  return contexts.includes(context.kind)
}

export function totalContributions(contributions: NdPackageContributions): number {
  return contributions.tools.length + contributions.skills.length + contributions.commands.length
    + contributions.views.length + contributions.workflows.length
}

function text(
  value: unknown,
  path: string,
  max: number,
  pattern: RegExp | undefined,
  issues: NdValidationIssue[],
): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ path, message: `${path} is required` })
    return ''
  }
  const trimmed = value.trim()
  if (trimmed.length > max) issues.push({ path, message: `${path} must be at most ${max} characters` })
  if (pattern && !pattern.test(trimmed)) issues.push({ path, message: `${path} has an unsupported format` })
  return trimmed
}

function contextKinds(
  value: unknown,
  path: string,
  issues: NdValidationIssue[],
  options: { required: boolean },
): NdContextKind[] {
  if (value === undefined && !options.required) return [...ND_CONTEXT_KINDS]
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: `${path} must list at least one of: ${ND_CONTEXT_KINDS.join(', ')}` })
    return []
  }
  const kinds: NdContextKind[] = []
  for (const item of value) {
    if (!isNdContextKind(item)) {
      issues.push({ path, message: `${path} contains an unknown context kind` })
      continue
    }
    if (!kinds.includes(item)) kinds.push(item)
  }
  return kinds
}

function permissionList(value: unknown, issues: NdValidationIssue[]): NdExtensionPermission[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push({ path: 'permissions', message: 'permissions must be an array' })
    return []
  }
  const out: NdExtensionPermission[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(ND_EXTENSION_PERMISSIONS as readonly string[]).includes(item)) {
      issues.push({ path: 'permissions', message: `unknown permission: ${String(item)}` })
      continue
    }
    if (!out.includes(item as NdExtensionPermission)) out.push(item as NdExtensionPermission)
  }
  return out
}

function settingFields(value: unknown, issues: NdValidationIssue[]): NdPackageSettingField[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push({ path: 'settings', message: 'settings must be an array' })
    return []
  }
  const out: NdPackageSettingField[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const path = `settings[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ path, message: `${path} must be an object` })
      continue
    }
    const record = item as Record<string, unknown>
    const key = text(record.key, `${path}.key`, 64, SETTING_KEY_PATTERN, issues)
    const title = text(record.title, `${path}.title`, 128, undefined, issues)
    const type = record.type
    if (type !== 'string' && type !== 'boolean' && type !== 'number') {
      issues.push({ path: `${path}.type`, message: `${path}.type must be string, boolean, or number` })
      continue
    }
    if (seen.has(key)) {
      issues.push({ path: `${path}.key`, message: `duplicate setting key: ${key}` })
      continue
    }
    seen.add(key)
    const defaultValue = record.default
    if (defaultValue !== undefined && typeof defaultValue !== type) {
      issues.push({ path: `${path}.default`, message: `${path}.default must be a ${type}` })
      continue
    }
    out.push({
      key,
      title,
      type,
      ...(defaultValue === undefined ? {} : { default: defaultValue as string | number | boolean }),
      ...(typeof record.description === 'string' && record.description.trim()
        ? { description: record.description.trim().slice(0, 500) }
        : {}),
    })
  }
  return out
}

function contributionsValue(
  value: unknown,
  defaultContexts: NdContextKind[],
  issues: NdValidationIssue[],
): NdPackageContributions {
  const empty: NdPackageContributions = { tools: [], skills: [], commands: [], views: [], workflows: [] }
  if (value === undefined) {
    issues.push({ path: 'contributions', message: 'contributions is required (at least one contribution kind)' })
    return empty
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path: 'contributions', message: 'contributions must be an object' })
    return empty
  }
  const record = value as Record<string, unknown>
  const seen = new Set<string>()
  const result: NdPackageContributions = {
    tools: arrayOf(record.tools, 'contributions.tools', issues, (item, path) => {
      const id = contributionId(item.id, path, seen, issues)
      const contexts = contextKinds(item.contexts, `${path}.contexts`, issues, { required: false })
      const toolName = text(item.toolName, `${path}.toolName`, 128, undefined, issues)
      const title = text(item.title, `${path}.title`, 128, undefined, issues)
      return {
        id,
        title,
        contexts: narrowContexts(contexts, defaultContexts, `${path}.contexts`, issues),
        toolName,
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}),
      }
    }),
    skills: arrayOf(record.skills, 'contributions.skills', issues, (item, path) => {
      const id = contributionId(item.id, path, seen, issues)
      const contexts = contextKinds(item.contexts, `${path}.contexts`, issues, { required: false })
      return {
        id,
        title: text(item.title, `${path}.title`, 128, undefined, issues),
        contexts: narrowContexts(contexts, defaultContexts, `${path}.contexts`, issues),
        instructions: text(item.instructions, `${path}.instructions`, 16_000, undefined, issues),
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}),
      }
    }),
    commands: arrayOf(record.commands, 'contributions.commands', issues, (item, path) => {
      const id = contributionId(item.id, path, seen, issues)
      const contexts = contextKinds(item.contexts, `${path}.contexts`, issues, { required: false })
      const host = hostMethodValue(item.host, `${path}.host`, issues)
      const keywords = Array.isArray(item.keywords)
        ? item.keywords.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim().slice(0, 64)).slice(0, 32)
        : []
      return {
        id,
        title: text(item.title, `${path}.title`, 128, undefined, issues),
        contexts: narrowContexts(contexts, defaultContexts, `${path}.contexts`, issues),
        host,
        ...(item.startsAgent === true ? { startsAgent: true } : {}),
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}),
        ...(keywords.length > 0 ? { keywords } : {}),
      }
    }),
    views: arrayOf(record.views, 'contributions.views', issues, (item, path) => {
      const id = contributionId(item.id, path, seen, issues)
      const contexts = contextKinds(item.contexts, `${path}.contexts`, issues, { required: false })
      const kind = item.kind === 'detail' ? 'detail' as const : 'list' as const
      const actions = arrayOf(item.actions, `${path}.actions`, issues, (action, actionPath) => ({
        id: contributionId(action.id, actionPath, seen, issues),
        title: text(action.title, `${actionPath}.title`, 128, undefined, issues),
        host: hostMethodValue(action.host, `${actionPath}.host`, issues),
      }))
      return {
        id,
        title: text(item.title, `${path}.title`, 128, undefined, issues),
        kind,
        host: hostMethodValue(item.host, `${path}.host`, issues),
        itemTitleKey: text(item.itemTitleKey, `${path}.itemTitleKey`, 64, undefined, issues),
        contexts: narrowContexts(contexts, defaultContexts, `${path}.contexts`, issues),
        actions,
        ...(typeof item.itemBodyKey === 'string' && item.itemBodyKey.trim() ? { itemBodyKey: item.itemBodyKey.trim().slice(0, 64) } : {}),
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}),
      }
    }),
    workflows: arrayOf(record.workflows, 'contributions.workflows', issues, (item, path) => {
      const id = contributionId(item.id, path, seen, issues)
      const contexts = contextKinds(item.contexts, `${path}.contexts`, issues, { required: false })
      return {
        id,
        title: text(item.title, `${path}.title`, 128, undefined, issues),
        pluginId: text(item.pluginId, `${path}.pluginId`, 128, undefined, issues),
        contexts: narrowContexts(contexts, defaultContexts, `${path}.contexts`, issues),
        ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}),
      }
    }),
  }
  if (totalContributions(result) === 0) {
    issues.push({ path: 'contributions', message: 'a package must contribute at least one tool, skill, command, view, or workflow' })
  }
  return result
}

function validateHostContexts(contributions: NdPackageContributions, issues: NdValidationIssue[]): void {
  for (const [index, command] of contributions.commands.entries()) {
    const descriptor = ndHostMethod(command.host)
    if (!descriptor) continue
    const unsupported = command.contexts.filter((kind) => !(descriptor.contexts as readonly NdContextKind[]).includes(kind))
    if (unsupported.length > 0) {
      issues.push({
        path: `contributions.commands[${index}].contexts`,
        message: `${command.host} supports only: ${descriptor.contexts.join(', ')}`,
      })
    }
  }

  for (const [index, view] of contributions.views.entries()) {
    const hosts = [view.host, ...view.actions.map((action) => action.host)]
    for (const host of hosts) {
      const descriptor = ndHostMethod(host)
      if (!descriptor) continue
      const unsupported = view.contexts.filter((kind) => !(descriptor.contexts as readonly NdContextKind[]).includes(kind))
      if (unsupported.length > 0) {
        issues.push({
          path: `contributions.views[${index}].contexts`,
          message: `${host} supports only: ${descriptor.contexts.join(', ')}`,
        })
      }
    }
  }
}

function executableValue(
  value: unknown,
  contributions: NdPackageContributions,
  issues: NdValidationIssue[],
): NdMcpStdioRuntime | undefined {
  const hasTools = contributions.tools.length > 0
  if (value === undefined || value === null) {
    if (hasTools) issues.push({ path: 'executable', message: 'tool contributions require an mcp-stdio executable runtime' })
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path: 'executable', message: 'executable must be an object' })
    return undefined
  }
  const record = value as Record<string, unknown>
  if (record.kind !== 'mcp-stdio') {
    issues.push({ path: 'executable.kind', message: 'only mcp-stdio executable runtimes are supported' })
    return undefined
  }
  const command = text(record.command, 'executable.command', 1_024, undefined, issues)
  if (!Array.isArray(record.args) || record.args.length > 64) {
    issues.push({ path: 'executable.args', message: 'executable.args must be an array with at most 64 entries' })
    return undefined
  }
  const args: string[] = []
  for (const [index, item] of record.args.entries()) {
    if (typeof item !== 'string' || item.length > 4_096) {
      issues.push({ path: `executable.args[${index}]`, message: 'each argument must be a string under 4,096 characters' })
      continue
    }
    args.push(item)
  }
  const envRecord = record.env === undefined ? {} : record.env
  if (!envRecord || typeof envRecord !== 'object' || Array.isArray(envRecord)) {
    issues.push({ path: 'executable.env', message: 'executable.env must map variable names to parent environment-variable names' })
    return undefined
  }
  const env: Record<string, string> = {}
  for (const [target, source] of Object.entries(envRecord as Record<string, unknown>)) {
    if (!ENV_NAME_PATTERN.test(target) || typeof source !== 'string' || !ENV_NAME_PATTERN.test(source)) {
      issues.push({ path: 'executable.env', message: 'executable.env values must be environment-variable names, never secret values' })
      continue
    }
    env[target] = source
  }
  return { kind: 'mcp-stdio', command, args, env }
}

function contributionId(value: unknown, path: string, seen: Set<string>, issues: NdValidationIssue[]): string {
  if (typeof value !== 'string' || !CONTRIBUTION_ID_PATTERN.test(value.trim())) {
    issues.push({ path: `${path}.id`, message: `${path}.id must use lowercase letters, numbers, dots, dashes, or underscores` })
    return ''
  }
  const id = value.trim()
  if (seen.has(id)) {
    issues.push({ path: `${path}.id`, message: `duplicate contribution id across the package: ${id}` })
    return id
  }
  seen.add(id)
  return id
}

function hostMethodValue(value: unknown, path: string, issues: NdValidationIssue[]): NdHostMethod {
  if (!isNdHostMethod(value)) {
    issues.push({ path, message: `${path} must be an allowlisted ND host method (see ND_HOST_METHODS)` })
    return 'note.create'
  }
  return value
}

/** Contributions may narrow the package's declared contexts but never widen them. */
function narrowContexts(
  contexts: NdContextKind[],
  declared: NdContextKind[],
  path: string,
  issues: NdValidationIssue[],
): NdContextKind[] {
  if (declared.length === 0) return contexts
  const widened = contexts.filter((kind) => !declared.includes(kind))
  if (widened.length > 0) {
    issues.push({ path, message: `contribution contexts (${widened.join(', ')}) must be declared in the package contexts` })
    return contexts.filter((kind) => declared.includes(kind))
  }
  return contexts
}

function arrayOf<T>(
  value: unknown,
  path: string,
  issues: NdValidationIssue[],
  build: (item: Record<string, unknown>, itemPath: string) => T,
): T[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${path} must be an array` })
    return []
  }
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({ path: `${path}[${index}]`, message: `${path}[${index}] must be an object` })
      return []
    }
    return [build(item as Record<string, unknown>, `${path}[${index}]`)]
  })
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('-')[0]!.split('.').map(Number)
  const rightParts = right.split('-')[0]!.split('.').map(Number)
  for (let index = 0; index < SEMVER_PARTS; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
