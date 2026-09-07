import { useEffect, useMemo, useState } from 'react'
import type { OrganizationSnapshot } from '../../../shared/organization'
import type { WorkflowDetectionPreview, WorkflowPluginsState, WorkflowProjectView } from '../../../shared/workflow-plugins'
import { SettingsButton, SettingsNote, SettingsRow, SettingsSection, StatusChip, rowDesc, rowPathText, rowStack, rowTitle } from './settings-primitives'
import { cn } from '../lib/utils'

const EMPTY_STATE: WorkflowPluginsState = { version: 1, plugins: [], bindings: [], snapshots: [] }
const selectClass = 'h-8 max-w-[220px] rounded-md border border-border bg-background px-2 text-[11px] text-soft outline-none focus:border-border-strong'
const inputClass = 'h-8 w-full rounded-md border border-border bg-background px-2.5 text-[11px] text-soft outline-none placeholder:text-faint focus:border-border-strong'

/**
 * Workflow plugins on the Plugins settings screen: install an external
 * workflow package on demand, then connect it to a company/project in Mirror
 * mode. Installing never activates anything; the explicit binding does.
 */
export function WorkflowPluginsCard({ onError }: { onError(message: string): void }) {
  const [plugins, setPlugins] = useState<WorkflowPluginsState>(EMPTY_STATE)
  const [org, setOrg] = useState<OrganizationSnapshot | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [view, setView] = useState<WorkflowProjectView>({})
  const [sourceMode, setSourceMode] = useState<'git' | 'local'>('git')
  const [gitUrl, setGitUrl] = useState('https://github.com/next-mmo/agent-dev-workflow.git')
  const [gitRef, setGitRef] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [previews, setPreviews] = useState<WorkflowDetectionPreview[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    // Load independently: a workflow-IPC failure (e.g. main process older
    // than the renderer) must not blank out the company/project pickers.
    void window.ndDshWorkflowPlugins.list()
      .then((state) => { if (mounted) setPlugins(state) })
      .catch((cause) => onError(errorMessage(cause)))
    void window.ndDshOrganization.state()
      .then((organization) => {
        if (!mounted) return
        setOrg(organization)
        const active = organization.companies.find((item) => item.id === organization.activeCompanyId) ?? organization.companies[0]
        if (active) setCompanyId((current) => current || active.id)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const off = window.ndDshWorkflowPlugins.onChanged((state) => {
      if (!mounted) return
      setPlugins(state)
      setView({})
    })
    return () => { mounted = false; off() }
  }, [onError])

  // Resolve the selected company/project's binding after installs change.
  useEffect(() => {
    if (!companyId || !projectId) return
    let mounted = true
    void window.ndDshWorkflowPlugins.snapshot(companyId, projectId)
      .then((value) => { if (mounted) setView(value) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [companyId, projectId, plugins])

  const projects = useMemo(() => (org?.projects ?? []).filter((item) => item.companyId === companyId), [org, companyId])
  const company = org?.companies.find((item) => item.id === companyId)
  const project = projects.find((item) => item.id === projectId)
  const binding = view.binding
  const bindingPlugin = plugins.plugins.find((item) => item.id === binding?.pluginId)

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
    if (projectId && !projects.some((item) => item.id === projectId)) setProjectId(projects[0]?.id ?? '')
  }, [projects, projectId])

  async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (cause) { onError(errorMessage(cause)) } finally { setBusy(null) }
  }

  async function install(): Promise<void> {
    await run('install', async () => {
      const source = sourceMode === 'local'
        ? { kind: 'local' as const, path: localPath.trim() }
        : { kind: 'git' as const, url: gitUrl.trim(), ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) }
      setPlugins(await window.ndDshWorkflowPlugins.install(source))
      setLocalPath('')
      setPreviews(null)
    })
  }

  return (
    <SettingsSection title="Workflow integrations" className="mt-9">
      <SettingsNote>
        External workflow plugins install on demand and then connect per company project in read-only Mirror mode:
        repository tasks appear beside ND tasks, but ND never runs project checks or approves work for them.
      </SettingsNote>

      {plugins.plugins.map((plugin) => {
        const provenance = plugin.source.kind === 'git'
          ? `${plugin.source.url}${plugin.source.ref ? ` @ ${plugin.source.ref}` : ''}${plugin.source.resolvedSha ? ` → ${plugin.source.resolvedSha.slice(0, 12)}` : ''}`
          : `${plugin.source.path}${plugin.source.gitDirty ? ' (dirty worktree)' : ''}${plugin.source.gitHead ? ` @ ${plugin.source.gitHead.slice(0, 12)}` : ''}`
        const usedBy = plugins.bindings.filter((item) => item.pluginId === plugin.id)
        return (
          <SettingsRow key={plugin.id} className="mb-1.5">
            <div className={rowStack}>
              <div className="flex items-center gap-2">
                <strong className={rowTitle}>{plugin.id}</strong>
                <span className={rowDesc}>{plugin.version}</span>
                {usedBy.length > 0 ? <StatusChip good>connected ×{usedBy.length}</StatusChip> : <StatusChip>not connected</StatusChip>}
              </div>
              <code className={rowPathText} title={provenance}>{provenance}</code>
            </div>
            <SettingsButton
              disabled={busy !== null}
              onClick={() => void run(`remove-${plugin.id}`, async () => setPlugins(await window.ndDshWorkflowPlugins.remove(plugin.id)))}
            >
              Remove
            </SettingsButton>
          </SettingsRow>
        )
      })}

      <div className="mb-1.5 rounded-lg border border-dashed border-border bg-surface-1 px-[13px] py-[11px]">
        <div className="mb-2 flex items-center gap-1">
          {(['git', 'local'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                'h-6 rounded-full px-2.5 text-[10px] font-medium transition-colors',
                sourceMode === mode ? 'bg-secondary text-strong' : 'text-faint hover:bg-secondary/60',
              )}
              onClick={() => setSourceMode(mode)}
            >
              {mode === 'git' ? 'Git repository' : 'Local folder'}
            </button>
          ))}
        </div>
        {sourceMode === 'git' ? (
          <div className="grid grid-cols-[1fr_200px_auto] items-center gap-2">
            <input aria-label="Repository URL" className={inputClass} placeholder="https://github.com/owner/workflow-plugins.git" value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} />
            <input aria-label="Pinned commit SHA or branch" className={inputClass} placeholder="Pinned SHA or branch (recommended)" value={gitRef} onChange={(event) => setGitRef(event.target.value)} />
            <SettingsButton disabled={busy !== null || !gitUrl.trim()} onClick={() => void install()}>{busy === 'install' ? 'Installing…' : 'Install'}</SettingsButton>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <input aria-label="Plugin bundle path" className={inputClass} placeholder="Absolute path to the checked-out plugin bundle" value={localPath} onChange={(event) => setLocalPath(event.target.value)} />
            <SettingsButton disabled={busy !== null || !localPath.trim()} onClick={() => void install()}>{busy === 'install' ? 'Installing…' : 'Install'}</SettingsButton>
          </div>
        )}
        <SettingsNote>
          {sourceMode === 'git'
            ? 'ND clones the repository, checks out the pinned ref, and records it as provenance.'
            : 'Expects an nd-plugin.json manifest; its git revision is recorded as provenance.'}
        </SettingsNote>
      </div>

      <SettingsRow>
        <div className={cn(rowStack, 'flex-1')}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className={rowTitle}>Connect company</strong>
            {binding ? (
              <StatusChip good>Connected</StatusChip>
            ) : view.disconnected ? (
              <StatusChip warn>Disconnected</StatusChip>
            ) : (
              <StatusChip>Not connected</StatusChip>
            )}
            {view.snapshot?.stale ? <StatusChip warn>Stale</StatusChip> : null}
            {view.pluginMissing ? <StatusChip warn>Plugin missing</StatusChip> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Company" className={selectClass} value={companyId} onChange={(event) => { setCompanyId(event.target.value); setProjectId('') }}>
              <option value="" disabled>{(org?.companies.length ?? 0) === 0 ? 'No companies yet' : 'Select company'}</option>
              {(org?.companies ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select aria-label="Project" className={selectClass} value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!companyId}>
              <option value="" disabled>{projects.length === 0 ? 'No projects yet' : 'Select project'}</option>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          {binding ? (
            <>
              <span className={rowDesc}>
                Mirror · {bindingPlugin?.manifest.upstream?.package ?? binding.pluginId} · reading <code>{binding.root}</code>
                {view.snapshot ? ` · last scan ${new Date(view.snapshot.scannedAt).toLocaleString()}` : ' · not scanned yet'}
              </span>
              {view.snapshot?.lastError ? <span className={cn(rowDesc, 'text-warning')}>{view.snapshot.lastError}</span> : null}
            </>
          ) : (
            <span className={rowDesc}>
              {companyId && projectId ? 'Run detection on the selected project, then enable Mirror to connect.' : 'Pick a company and project to connect a workflow plugin.'}
            </span>
          )}
          {previews?.map((preview) => (
            <div key={preview.pluginId} className={cn(rowDesc, 'rounded-md border border-border-soft bg-background px-2 py-1.5')}>
              <div className="flex items-center justify-between gap-2">
                <span>{preview.pluginId} · {preview.supported ? 'detected' : preview.error ? `error: ${preview.error}` : 'not detected'}</span>
                {preview.supported ? (
                  <SettingsButton
                    disabled={busy !== null}
                    onClick={() => void run(`enable-${preview.pluginId}`, async () => {
                      setPlugins(await window.ndDshWorkflowPlugins.enable(companyId, projectId, preview.pluginId))
                      setView(await window.ndDshWorkflowPlugins.snapshot(companyId, projectId))
                    })}
                  >
                    Enable Mirror
                  </SettingsButton>
                ) : null}
              </div>
              {preview.diagnostics.slice(0, 2).map((diagnostic, index) => (
                <div key={`${diagnostic.code}-${index}`}>· {diagnostic.message}</div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {binding ? (
            <>
              <SettingsButton disabled={busy !== null || !project} onClick={() => void run('refresh', async () => setPlugins(await window.ndDshWorkflowPlugins.refresh(companyId, projectId)))}>
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
              </SettingsButton>
              <SettingsButton
                disabled={busy !== null}
                onClick={() => void run('disable', async () => {
                  setPlugins(await window.ndDshWorkflowPlugins.disable(companyId, projectId, binding.pluginId))
                  setView(await window.ndDshWorkflowPlugins.snapshot(companyId, projectId))
                })}
              >
                Disconnect
              </SettingsButton>
            </>
          ) : (
            <SettingsButton disabled={busy !== null || !companyId || !projectId} onClick={() => void run('detect', async () => setPreviews(await window.ndDshWorkflowPlugins.detect(companyId, projectId)))}>
              {busy === 'detect' ? 'Detecting…' : 'Run detection'}
            </SettingsButton>
          )}
        </div>
      </SettingsRow>

      {company && project && binding ? (
        <SettingsNote good>
          {company.name} · {project.name} is connected in Mirror mode. Repository cards appear on the company work board and update on Refresh.
        </SettingsNote>
      ) : null}
    </SettingsSection>
  )
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
