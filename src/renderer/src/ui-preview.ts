import type {
  BrowserState,
  DesktopApi,
  DshEventFrame,
  GitStatusSnapshot,
  HarnessStatus,
  ModelProvider,
  QaState,
  ThemeState,
  WorkspaceState,
} from '../../shared/contracts'
import { buildCodingEngineCatalog } from '../../shared/coding-engines'
import type { DesignDesktopApi, DesignFreeformState, DesignProjectState } from '../../shared/design'
import type { OrganizationDesktopApi, OrganizationMutation, OrganizationSnapshot } from '../../shared/organization'

type Listener<T> = (value: T) => void

function signal<T>() {
  const listeners = new Set<Listener<T>>()
  return {
    emit(value: T): void { for (const listener of listeners) listener(value) },
    on(listener: Listener<T>): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const now = Date.now()
const workspaceEvents = signal<WorkspaceState>()
const browserEvents = signal<BrowserState>()
const harnessEvents = signal<HarnessStatus>()
const dshEvents = signal<DshEventFrame>()
const themeEvents = signal<ThemeState>()
const gitEvents = signal<GitStatusSnapshot>()
const qaEvents = signal<QaState>()
const organizationEvents = signal<OrganizationSnapshot>()
const freeformEvents = signal<DesignFreeformState>()

let workspace: WorkspaceState = {
  root: 'C:/workspace/nd-product',
  name: 'nd-product',
  binding: 'project',
  companyId: 'company-nd',
  companyName: 'Northstar Digital',
  projectId: 'project-console',
  projectName: 'Agent Console',
  projectWorkspacePath: 'C:/workspace/nd-product',
}

let browser: BrowserState = {
  url: 'http://localhost:3000/',
  title: 'Agent Console',
  loading: false,
  canGoBack: true,
  canGoForward: false,
  visible: false,
  cdpPort: 0,
  agentBrowser: 'ready',
}

let harness: HarnessStatus = {
  state: 'ready',
  sourceReady: true,
  apiKeyPresent: true,
  provider: 'openai-prod',
  model: 'gpt-5.6',
  sessionId: 'preview-session',
}

let theme: ThemeState = { mode: 'system', effective: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' }

let providers: ModelProvider[] = [
  { id: 'openai-prod', name: 'OpenAI', enabled: true, baseUrl: 'https://api.openai.com/v1', apiFormat: 'openai-responses', apiKey: '', hasApiKey: true, models: [{ id: 'gpt-5.6', context: '256k' }] },
  { id: 'deepseek-official', name: 'DeepSeek', enabled: true, baseUrl: 'https://api.deepseek.com', apiFormat: 'openai-completions', apiKey: '', hasApiKey: true, models: [{ id: 'deepseek-v4-flash', context: '128k' }] },
  { id: 'local-lab', name: 'Local Lab', enabled: false, baseUrl: 'http://127.0.0.1:11434/v1', apiFormat: 'openai-completions', apiKey: '', hasApiKey: false, models: [{ id: 'company-code-model', context: '32k' }] },
]

const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true })
let assignments: Record<string, string> = { 'agent-pm': 'nd-harness', 'agent-builder': 'codex-cli', 'agent-reviewer': 'nd-harness' }

let git: GitStatusSnapshot = {
  root: workspace.root,
  repoRoot: workspace.root,
  branch: 'codex/ui-refresh',
  ahead: 2,
  behind: 0,
  heads: [{ hash: '6c1f8a94', message: 'Refine agent workspace shell', authorName: 'ND Team', authorEmail: 'dev@example.com', date: new Date(now - 3_600_000).toISOString() }],
  branches: [
    { name: 'codex/ui-refresh', current: true, upstream: 'origin/codex/ui-refresh', ahead: 2, behind: 0 },
    { name: 'main', current: false, upstream: 'origin/main', ahead: 0, behind: 0 },
  ],
  staged: [{ path: 'src/components/AgentCard.tsx', x: 'M', y: ' ' }],
  unstaged: [{ path: 'src/App.tsx', x: ' ', y: 'M' }, { path: 'src/styles/theme.css', x: ' ', y: 'M' }],
  untracked: [{ path: 'src/components/RunBadge.tsx', x: '?', y: '?' }],
  conflicts: [],
  remotes: ['origin'],
  timestamp: now,
}

let qa: QaState = {
  activeRun: null,
  suites: [
    { id: 'unit', kind: 'internal', label: 'Unit tests', description: 'Runs the Vitest unit suite for this repository.', runner: 'Vitest', command: 'pnpm test', status: 'passed', lastExitCode: 0, lastDurationMs: 2540, lastFinishedAt: now - 240_000 },
    { id: 'e2e', kind: 'internal', label: 'Desktop E2E', description: 'Drives the built desktop app end to end with Playwright.', runner: 'Playwright', command: 'pnpm e2e', status: 'passed', lastExitCode: 0, lastDurationMs: 18_420, lastFinishedAt: now - 86_400_000 },
  ],
}

let organization: OrganizationSnapshot = {
  version: 1,
  activeCompanyId: 'company-nd',
  activeProjectId: 'project-console',
  companies: [{ id: 'company-nd', name: 'Northstar Digital', mission: 'Build reliable AI-native software teams.', autonomyLevel: 3, status: 'active', createdAt: now - 30 * 86_400_000, updatedAt: now - 60_000 }],
  projects: [{ id: 'project-console', companyId: 'company-nd', name: 'Agent Console', objective: 'Ship a polished control plane for autonomous software delivery.', status: 'active', workspacePath: workspace.root, repoUrls: ['https://github.com/example/agent-console'], teamIds: ['team-product'], progress: 68, createdAt: now - 20 * 86_400_000, updatedAt: now - 60_000 }],
  roles: [
    { id: 'role-pm', companyId: 'company-nd', name: 'Product Manager', responsibility: 'Plans outcomes and coordinates delivery.', systemPrompt: 'Plan clear, verifiable work.', skillIds: ['skill-planning'] },
    { id: 'role-builder', companyId: 'company-nd', name: 'Product Engineer', responsibility: 'Implements production changes.', systemPrompt: 'Build and verify real source.', skillIds: ['skill-code'] },
    { id: 'role-reviewer', companyId: 'company-nd', name: 'Independent Reviewer', responsibility: 'Reviews evidence and acceptance criteria.', systemPrompt: 'Review independently.', skillIds: ['skill-review'] },
  ],
  teams: [{ id: 'team-product', companyId: 'company-nd', name: 'Product Delivery', purpose: 'Plan, build, and review the product.', roleIds: ['role-pm', 'role-builder', 'role-reviewer'], skillIds: ['skill-code'] }],
  agents: [
    { id: 'agent-pm', companyId: 'company-nd', name: 'Nova', roleId: 'role-pm', teamId: 'team-product', status: 'idle', skillIds: ['skill-planning'], lastSessionId: 'preview-session' },
    { id: 'agent-builder', companyId: 'company-nd', name: 'Atlas', roleId: 'role-builder', teamId: 'team-product', status: 'working', skillIds: ['skill-code'], currentTaskId: 'task-shell' },
    { id: 'agent-reviewer', companyId: 'company-nd', name: 'Iris', roleId: 'role-reviewer', teamId: 'team-product', status: 'idle', skillIds: ['skill-review'] },
  ],
  skills: [
    { id: 'skill-planning', scope: 'company', companyId: 'company-nd', name: 'product-planning', description: 'Dependency-aware product planning.', instructions: 'Create testable milestones.' },
    { id: 'skill-code', scope: 'project', companyId: 'company-nd', projectId: 'project-console', name: 'production-code', description: 'Implementation in the real workspace.', instructions: 'Inspect, edit, and verify.' },
    { id: 'skill-review', scope: 'company', companyId: 'company-nd', name: 'independent-review', description: 'Evidence-based review.', instructions: 'Verify acceptance criteria independently.' },
  ],
  workflows: [{ id: 'workflow-delivery', name: 'Software delivery', scope: 'project', companyId: 'company-nd', projectId: 'project-console', steps: [{ id: 'plan', name: 'Plan', kind: 'plan' }, { id: 'build', name: 'Build', kind: 'execute' }, { id: 'review', name: 'Review', kind: 'review' }] }],
  goals: [{ id: 'goal-beta', companyId: 'company-nd', projectId: 'project-console', title: 'Private beta workbench', description: 'Complete the coding-first product loop.', status: 'active', progress: 68, createdAt: now - 14 * 86_400_000 }],
  milestones: [
    { id: 'milestone-shell', companyId: 'company-nd', projectId: 'project-console', goalId: 'goal-beta', title: 'Product shell', description: 'Polished desktop workbench.', status: 'active', order: 1 },
    { id: 'milestone-release', companyId: 'company-nd', projectId: 'project-console', goalId: 'goal-beta', title: 'Release readiness', description: 'Packaging and installed-app validation.', status: 'pending', order: 2 },
  ],
  tasks: [
    { id: 'task-contracts', companyId: 'company-nd', projectId: 'project-console', goalId: 'goal-beta', milestoneId: 'milestone-shell', title: 'Normalize runtime contracts', description: 'Keep engine-specific behavior behind adapters.', acceptanceCriteria: ['Organization state contains no engine branching.'], priority: 'high', status: 'completed', dependsOn: [], assignedAgentId: 'agent-builder', resultSummary: 'Runtime contracts normalized and verified.', reviewSummary: 'Passed independent review.', createdAt: now - 7 * 86_400_000, updatedAt: now - 2 * 86_400_000 },
    { id: 'task-shell', companyId: 'company-nd', projectId: 'project-console', goalId: 'goal-beta', milestoneId: 'milestone-shell', title: 'Polish the workbench shell', description: 'Improve hierarchy, density, and navigation.', acceptanceCriteria: ['All five product surfaces remain accessible.', 'Typecheck and tests pass.'], priority: 'critical', status: 'in_progress', dependsOn: ['task-contracts'], assignedAgentId: 'agent-builder', executionSessionId: 'preview-session', createdAt: now - 2 * 86_400_000, updatedAt: now - 60_000 },
    { id: 'task-installer', companyId: 'company-nd', projectId: 'project-console', goalId: 'goal-beta', milestoneId: 'milestone-release', title: 'Package the desktop runtime', description: 'Create signed installable artifacts.', acceptanceCriteria: ['Clean machine can launch without developer tooling.'], priority: 'high', status: 'backlog', dependsOn: ['task-shell'], createdAt: now - 86_400_000, updatedAt: now - 86_400_000 },
  ],
  memory: [{ id: 'memory-boundary', companyId: 'company-nd', projectId: 'project-console', title: 'Product boundary', content: 'ND owns company state and policies; providers and coding engines remain replaceable adapters.', tags: ['architecture', 'control-plane'], source: 'human', createdAt: now - 10 * 86_400_000, updatedAt: now - 10 * 86_400_000 }],
  policies: [
    { id: 'policy-deploy', companyId: 'company-nd', action: 'production.deploy', effect: 'ask', description: 'Require approval before production deployment.' },
    { id: 'policy-delete', companyId: 'company-nd', action: 'data.destructive', effect: 'deny', description: 'Deny destructive data operations.' },
  ],
  activity: [{ id: 'activity-review', companyId: 'company-nd', projectId: 'project-console', type: 'review.completed', message: 'Runtime contract review passed.', createdAt: now - 2 * 86_400_000 }],
  runs: [{ id: 'run-shell', companyId: 'company-nd', projectId: 'project-console', taskId: 'task-shell', goalId: 'goal-beta', kind: 'task-execution', status: 'running', sessionId: 'preview-session', startedAt: now - 180_000 }],
}

let freeform: DesignFreeformState = { engine: 'nd-pencil', status: 'ready', available: true, visible: false, dirty: false, documentPath: '.nd/design/home.op', documentName: 'home.op', version: '0.8.4' }
const designProject: DesignProjectState = {
  root: workspace.root,
  kind: 'shadcn',
  frameworks: ['React', 'Vite'],
  packageManager: 'pnpm',
  devCommand: 'pnpm dev',
  templates: [{ path: 'index.html', name: 'Application shell', kind: 'html', previewable: true, entry: true }],
  shadcn: { detected: true, configPath: 'components.json', style: 'new-york', baseColor: 'neutral', cssVariables: true, components: [{ name: 'Button', path: 'src/components/ui/button.tsx', kind: 'shadcn' }, { name: 'Dialog', path: 'src/components/ui/dialog.tsx', kind: 'shadcn' }, { name: 'Tabs', path: 'src/components/ui/tabs.tsx', kind: 'shadcn' }] },
  freeform: { documents: [{ path: '.nd/design/home.op', name: 'home.op' }] },
  capabilities: { liveApp: true, htmlTemplates: true, shadcn: true, canvas: true, freeform: true },
  preview: { kind: 'dev-server', root: workspace.root, url: 'http://localhost:3000/', command: 'pnpm dev' },
}

const sessionHistory = [
  { event: { type: 'user/message', seq: 1, time: now - 180_000, data: { message: { content: 'Polish the workbench shell and keep every product surface accessible.' } } } },
  { event: { type: 'assistant/message', seq: 2, time: now - 170_000, data: { message: { content: 'I mapped the shell, consolidated the visual primitives, and am validating the five navigation surfaces now.' } } } },
  { event: { type: 'tool/call', seq: 3, time: now - 160_000, data: { callId: 'preview-tool', name: 'workspace.inspect', arguments: { path: 'src/renderer' } } } },
  { event: { type: 'tool/result', seq: 4, time: now - 155_000, data: { message: { content: 'Renderer structure inspected successfully.' } } } },
]

const archivedPreviewSessions = new Set<string>()

const desktopApi: DesktopApi = {
  app: { info: async () => ({ name: 'ND-DSH', version: '0.1.0-dev-preview', platform: 'web-preview', projectRoot: workspace.root }) },
  providers: {
    list: async () => providers,
    save: async (value) => (providers = value.map((provider) => ({ ...provider, apiKey: '' }))),
    setApiKey: async (providerId) => (providers = providers.map((provider) => provider.id === providerId ? { ...provider, hasApiKey: true, apiKey: '' } : provider)),
    clearApiKey: async (providerId) => (providers = providers.map((provider) => provider.id === providerId ? { ...provider, hasApiKey: false, apiKey: '' } : provider)),
    ping: async (providerId) => ({ providerId, state: 'ok', latencyMs: 84, status: 200, hasApiKey: Boolean(providers.find((provider) => provider.id === providerId)?.hasApiKey), at: Date.now() }),
    onChanged: () => () => {},
  },
  engines: {
    list: async () => engines,
    assignments: async () => assignments,
    assign: async (agentId, engineId) => (assignments = { ...assignments, [agentId]: engineId }),
    sessions: async () => [],
    transcript: async (sessionId) => ({ sessionId, engineId: 'codex-cli', events: [] }),
  },
  sessions: {
    setArchived: async (sessionId, archived) => {
      if (archived) archivedPreviewSessions.add(sessionId)
      else archivedPreviewSessions.delete(sessionId)
      return [...archivedPreviewSessions]
    },
  },
  capture: {
    inspectApp: async () => ({ sessionId: 'preview-session', copiedToClipboard: false, width: innerWidth, height: innerHeight, displayLabel: 'UI preview' }),
    inspectElement: async () => ({ outcome: 'unreachable', message: 'Element inspection is available in Electron.' }),
    stageElement: async () => [],
    elementAttachments: async () => [],
    removeElement: async () => [],
    copyElementContext: async () => false,
    copyElementShot: async () => false,
  },
  browser: {
    state: async () => browser,
    setBounds: async () => undefined,
    setVisible: async (visible) => { browser = { ...browser, visible }; browserEvents.emit(browser) },
    navigate: async (url) => { browser = { ...browser, url, title: url, loading: false, canGoBack: true }; browserEvents.emit(browser); return browser },
    back: async () => browser,
    forward: async () => browser,
    reload: async () => browser,
    snapshot: async () => ({ preview: true, url: browser.url }),
    openExternal: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    onState: browserEvents.on,
  },
  workspace: {
    state: async () => workspace,
    pick: async () => workspace,
    setRoot: async (root) => { workspace = { ...workspace, root, name: root.split(/[\\/]/).at(-1) || 'workspace' }; workspaceEvents.emit(workspace); return workspace },
    list: async (path = '.') => path === '.' ? [
      { name: 'src', relativePath: 'src', kind: 'directory' },
      { name: 'docs', relativePath: 'docs', kind: 'directory' },
      { name: 'package.json', relativePath: 'package.json', kind: 'file' },
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ] : path === 'src' ? [
      { name: 'App.tsx', relativePath: 'src/App.tsx', kind: 'file' },
      { name: 'components', relativePath: 'src/components', kind: 'directory' },
      { name: 'styles', relativePath: 'src/styles', kind: 'directory' },
    ] : [],
    read: async (relativePath) => ({ relativePath, truncated: false, content: previewFile(relativePath) }),
    suggest: async (query) => ['src/App.tsx', 'src/components/AgentCard.tsx', 'src/styles/theme.css'].filter((path) => path.toLowerCase().includes(query.toLowerCase())).map((relativePath) => ({ relativePath, kind: 'file' as const })),
    onState: workspaceEvents.on,
    registry: async () => ({ version: 1, activeId: 'preview-workspace', items: [{ id: 'preview-workspace', root: workspace.root, name: workspace.name, addedAt: now - 86_400_000, lastOpenedAt: now }] }),
    addSaved: async () => ({ version: 1, activeId: 'preview-workspace', items: [{ id: 'preview-workspace', root: workspace.root, name: workspace.name, addedAt: now - 86_400_000, lastOpenedAt: now }] }),
    removeSaved: async () => ({ version: 1, items: [] }),
    openSaved: async () => ({ state: workspace, registry: { version: 1, activeId: 'preview-workspace', items: [{ id: 'preview-workspace', root: workspace.root, name: workspace.name, addedAt: now - 86_400_000, lastOpenedAt: now }] } }),
  },
  harness: {
    status: async () => harness,
    run: async (_prompt, options) => {
      const sessionId = options?.sessionId ?? 'preview-session'
      dshEvents.emit({ kind: 'session-event', sessionId, event: { type: 'assistant/message', seq: Date.now(), time: Date.now(), data: { message: { content: 'UI preview only — launch Electron to execute this request.' } } } })
      return { sessionId }
    },
    stop: async () => harness,
    getPermissionMode: async () => 'ask',
    setPermissionMode: async (mode) => mode,
    onStatus: harnessEvents.on,
  },
  dsh: {
    rpc: async (method) => gatewayPreview(method),
    respond: async () => undefined,
    onEvent: dshEvents.on,
  },
  surface: {
    state: async () => ({ surface: 'workbench', view: { ready: false, loading: false, title: 'UI preview', visible: false } }),
    set: async (surface) => ({ surface, view: { ready: false, loading: false, title: 'UI preview', visible: false } }),
    onChanged: () => () => undefined,
  },
  dshView: { setBounds: async () => undefined, setVisible: async () => undefined, reload: async () => undefined, onState: () => () => undefined },
  theme: {
    state: async () => theme,
    set: async (mode) => {
      const effective = mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode
      theme = { mode, effective }
      themeEvents.emit(theme)
      return theme
    },
    onChanged: themeEvents.on,
  },
  git: {
    state: async () => git,
    refresh: async () => git,
    stage: async (paths) => { git = moveGit(paths, 'staged'); gitEvents.emit(git); return git },
    unstage: async (paths) => { git = moveGit(paths, 'unstaged'); gitEvents.emit(git); return git },
    discard: async (paths) => { git = { ...git, unstaged: git.unstaged.filter((item) => !paths.includes(item.path)), untracked: git.untracked.filter((item) => !paths.includes(item.path)), timestamp: Date.now() }; gitEvents.emit(git); return git },
    commit: async () => { git = { ...git, staged: [], ahead: git.ahead + 1, timestamp: Date.now() }; gitEvents.emit(git); return git },
    diff: async (path, staged) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,4 @@\n export function View() {\n+  // UI preview change\n   return <main />\n }\n${staged ? '' : ''}`,
    checkout: async (branch) => { git = { ...git, branch, branches: git.branches.map((item) => ({ ...item, current: item.name === branch })) }; gitEvents.emit(git); return git },
    createBranch: async (branch) => { git = { ...git, branch, branches: [{ name: branch, current: true }, ...git.branches.map((item) => ({ ...item, current: false }))] }; gitEvents.emit(git); return git },
    push: async () => { git = { ...git, ahead: 0 }; gitEvents.emit(git); return git },
    pull: async () => git,
    fetch: async () => git,
    onState: gitEvents.on,
  },
  qa: {
    state: async () => qa,
    run: async (suite) => { qa = { ...qa, activeRun: null, suites: qa.suites.map((item) => item.id === suite ? { ...item, status: 'passed', lastExitCode: 0, lastDurationMs: 1240, lastFinishedAt: Date.now() } : item) }; qaEvents.emit(qa); return qa },
    stop: async () => qa,
    onState: qaEvents.on,
    onOutput: () => () => undefined,
  },
}

const designApi: DesignDesktopApi = {
  state: async () => designProject,
  refresh: async () => designProject,
  previewHtml: async () => designProject.preview!,
  startDevPreview: async () => designProject.preview!,
  stopPreview: async () => undefined,
  freeformState: async () => freeform,
  freeformSetBounds: async () => undefined,
  freeformSetVisible: async (visible) => { freeform = { ...freeform, visible }; freeformEvents.emit(freeform); return freeform },
  freeformOpen: async (path) => { freeform = { ...freeform, status: 'ready', available: true, documentPath: path, documentName: previewDocumentName(path), visible: true }; freeformEvents.emit(freeform); return freeform },
  freeformCreate: async (path) => { freeform = { ...freeform, status: 'ready', available: true, documentPath: path, documentName: previewDocumentName(path), visible: true, dirty: true }; freeformEvents.emit(freeform); return freeform },
  freeformSave: async () => { freeform = { ...freeform, dirty: false }; freeformEvents.emit(freeform); return freeform },
  freeformClose: async () => { const { documentPath: _closedPath, documentName: _closedName, ...openFreeform } = freeform; freeform = { ...openFreeform, visible: false, dirty: false }; freeformEvents.emit(freeform); return freeform },
  onFreeformState: freeformEvents.on,
}

const organizationApi: OrganizationDesktopApi = {
  state: async () => organization,
  mutate: async (mutation) => mutateOrganization(mutation),
  planProject: async (projectId) => ({ runId: 'preview-plan', sessionId: 'preview-session', projectId, kind: 'pm-plan' }),
  runTask: async (taskId) => ({ runId: 'preview-task', sessionId: 'preview-session', projectId: organization.activeProjectId!, taskId, kind: 'task-execution' }),
  reviewTask: async (taskId) => ({ runId: 'preview-review', sessionId: 'preview-session', projectId: organization.activeProjectId!, taskId, kind: 'task-review' }),
  runNext: async (projectId) => ({ runId: 'preview-next', sessionId: 'preview-session', projectId: projectId ?? organization.activeProjectId!, kind: 'task-execution' }),
  onChanged: organizationEvents.on,
}

export function installDevelopmentUiPreview(): void {
  window.ndDsh = desktopApi
  window.ndDshDesign = designApi
  window.ndDshOrganization = organizationApi
  window.ndDshRuntimeMode = 'ui-preview'
}

function gatewayPreview(method: string) {
  if (method === 'session.list') return Promise.resolve({ ok: true, value: { items: [{ sessionId: 'preview-session', updatedAt: now, running: false, blank: false, cwd: workspace.root, agentPreset: 'nd-dsh' }] } })
  if (method === 'session.history') return Promise.resolve({ ok: true, value: { events: sessionHistory } })
  if (method === 'session.create') return Promise.resolve({ ok: true, value: { sessionId: `preview-${Date.now()}` } })
  if (method === 'session.models') return Promise.resolve({ ok: true, value: { current: { provider: 'openai-prod', model: 'gpt-5.6', reasoningEffort: 'high' }, routable: true, groups: [{ id: 'openai-prod', name: 'OpenAI', models: [{ id: 'gpt-5.6', name: 'GPT-5.6', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }] }], failures: [] } })
  if (method === 'skill.list') return Promise.resolve({ ok: true, value: { skills: [{ name: 'live-browser', description: 'Inspect and verify the visible application.' }, { name: 'product-review', description: 'Review product changes against acceptance criteria.' }] } })
  if (method === 'agentPreset.list') return Promise.resolve({ ok: true, value: { presets: [{ id: 'nd-dsh', name: 'ND-DSH', description: 'Full product delivery agent', trust: 'project', isDefault: true }, { id: 'code', name: 'Code', description: 'Plan, tool, check coding mode', trust: 'system' }, { id: 'cordis', name: 'Creator', description: 'Create and refine agent presets', trust: 'system' }] } })
  return Promise.resolve({ ok: true, value: {} })
}

function previewFile(path: string): string {
  if (path.endsWith('.json')) return '{\n  "name": "nd-product",\n  "private": true,\n  "scripts": { "dev": "vite" }\n}\n'
  if (path.endsWith('.md')) return '# Agent Console\n\nAI company control plane and coding workbench.\n'
  return `export function App() {\n  return <main className="agent-console">Agent Console</main>\n}\n`
}

function moveGit(paths: string[], target: 'staged' | 'unstaged'): GitStatusSnapshot {
  const all = [...git.staged, ...git.unstaged, ...git.untracked]
  const moved = all.filter((item) => paths.includes(item.path)).map((item) => target === 'staged' ? { ...item, x: item.x === '?' ? 'A' : 'M', y: ' ' } : { ...item, x: ' ', y: 'M' })
  const remaining = all.filter((item) => !paths.includes(item.path))
  return { ...git, staged: target === 'staged' ? [...git.staged.filter((item) => !paths.includes(item.path)), ...moved] : remaining.filter((item) => item.x !== ' ' && item.x !== '?'), unstaged: target === 'unstaged' ? [...git.unstaged.filter((item) => !paths.includes(item.path)), ...moved] : remaining.filter((item) => item.x === ' '), untracked: remaining.filter((item) => item.x === '?'), timestamp: Date.now() }
}

function previewDocumentName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function mutateOrganization(mutation: OrganizationMutation): OrganizationSnapshot {
  const id = `${mutation.type.replace('.', '-')}-${Date.now()}`
  if (mutation.type === 'company.create') {
    const company = { id, name: mutation.name, mission: mutation.mission, autonomyLevel: 0 as const, status: 'active' as const, createdAt: Date.now(), updatedAt: Date.now() }
    const { activeProjectId: _clearedProjectId, ...withoutActiveProject } = organization
    organization = { ...withoutActiveProject, activeCompanyId: id, companies: [...organization.companies, company] }
  } else if (mutation.type === 'company.activate') organization = { ...organization, activeCompanyId: mutation.id }
  else if (mutation.type === 'company.update') organization = { ...organization, companies: organization.companies.map((item) => item.id === mutation.id ? { ...item, ...mutation.patch, updatedAt: Date.now() } : item) }
  else if (mutation.type === 'project.create') {
    const project = { id, companyId: mutation.companyId, name: mutation.name, objective: mutation.objective, status: 'planning' as const, ...(mutation.workspacePath ? { workspacePath: mutation.workspacePath } : {}), repoUrls: mutation.repoUrls ?? [], teamIds: [], progress: 0, createdAt: Date.now(), updatedAt: Date.now() }
    organization = { ...organization, activeProjectId: id, projects: [...organization.projects, project] }
  } else if (mutation.type === 'project.activate') organization = { ...organization, activeProjectId: mutation.id }
  else if (mutation.type === 'project.update') organization = { ...organization, projects: organization.projects.map((item) => item.id === mutation.id ? { ...item, ...mutation.patch, updatedAt: Date.now() } : item) }
  else if (mutation.type === 'task.create') organization = { ...organization, tasks: [...organization.tasks, { id, companyId: mutation.companyId, projectId: mutation.projectId, ...(mutation.goalId ? { goalId: mutation.goalId } : {}), ...(mutation.milestoneId ? { milestoneId: mutation.milestoneId } : {}), title: mutation.title, description: mutation.description, acceptanceCriteria: mutation.acceptanceCriteria ?? [], priority: mutation.priority ?? 'medium', status: 'backlog', dependsOn: mutation.dependsOn ?? [], ...(mutation.assignedAgentId ? { assignedAgentId: mutation.assignedAgentId } : {}), createdAt: Date.now(), updatedAt: Date.now() }] }
  else if (mutation.type === 'task.update') organization = { ...organization, tasks: organization.tasks.map((item) => item.id === mutation.id ? { ...item, ...mutation.patch, updatedAt: Date.now() } : item) }
  else if (mutation.type === 'role.update') organization = { ...organization, roles: organization.roles.map((item) => item.id === mutation.id ? { ...item, ...mutation.patch } : item) }
  else if (mutation.type === 'agent.update') organization = { ...organization, agents: organization.agents.map((item) => item.id === mutation.id ? { ...item, ...mutation.patch } : item) }
  else if (mutation.type === 'memory.add') organization = { ...organization, memory: [...organization.memory, { id, companyId: mutation.companyId, ...(mutation.projectId ? { projectId: mutation.projectId } : {}), title: mutation.title, content: mutation.content, tags: mutation.tags ?? [], source: 'human', createdAt: Date.now(), updatedAt: Date.now() }] }
  else if (mutation.type === 'policy.set') organization = { ...organization, policies: [...organization.policies.filter((item) => item.companyId !== mutation.companyId || item.action !== mutation.action), { id, companyId: mutation.companyId, action: mutation.action, effect: mutation.effect, description: mutation.description ?? '' }] }
  organizationEvents.emit(organization)
  return organization
}
