import { useEffect, useState, type FormEvent } from 'react'
import type { InstalledWorkflowPlugin, WorkflowDetectionPreview, WorkflowPluginsState, WorkflowProjectView } from '../../../shared/workflow-plugins'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { cn } from '../lib/utils'

interface Props {
  companyId: string
  projectId: string
  projectName: string
  hasWorkspace: boolean
  open: boolean
  onOpenChange(open: boolean): void
  onError(message: string): void
}

const wfButton = cn(
  'h-7 shrink-0 rounded-md border border-border-strong bg-secondary px-[9px] text-sm text-soft transition-colors',
  'hover:bg-accent hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-45',
)
const wfPrimaryButton = cn(
  'h-7 shrink-0 rounded-md border border-primary/30 bg-primary/10 px-[9px] text-sm font-medium text-primary transition-colors',
  'hover:bg-primary/[0.16]',
  'disabled:pointer-events-none disabled:opacity-45',
)
const wfInput = cn(
  'min-w-0 rounded-md border border-border-strong bg-background px-[9px] py-[7px] text-sm text-foreground outline-none',
  'focus:border-primary/40',
)

const EMPTY_STATE: WorkflowPluginsState = { version: 1, plugins: [], bindings: [], snapshots: [] }

/**
 * Settings surface for external workflow plugins. Installing a package never
 * activates anything: an explicit company/project binding (Mirror mode) is a
 * separate, user-owned step, and repository cards stay read-only.
 */
export function WorkflowIntegrationPanel({ companyId, projectId, projectName, hasWorkspace, open, onOpenChange, onError }: Props) {
  const [plugins, setPlugins] = useState<WorkflowPluginsState>(EMPTY_STATE)
  const [view, setView] = useState<WorkflowProjectView>({})
  const [sourceMode, setSourceMode] = useState<'local' | 'git'>('git')
  const [localPath, setLocalPath] = useState('')
  const [gitUrl, setGitUrl] = useState('https://github.com/next-mmo/agent-dev-workflow.git')
  const [gitRef, setGitRef] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [previews, setPreviews] = useState<WorkflowDetectionPreview[] | null>(null)

  useEffect(() => {
    if (!open) return
    const workflowPlugins = window.ndDshWorkflowPlugins
    if (!workflowPlugins || typeof workflowPlugins.list !== 'function' || typeof workflowPlugins.snapshot !== 'function' || typeof workflowPlugins.onChanged !== 'function') {
      setPlugins(EMPTY_STATE)
      setView({})
      onError('Workflow integration is unavailable in this renderer session.')
      return
    }
    let mounted = true
    void workflowPlugins.list()
      .then((state) => { if (mounted) setPlugins(state) })
      .catch((cause) => onError(errorMessage(cause)))
    const off = workflowPlugins.onChanged((state) => {
      if (!mounted) return
      setPlugins(state)
      void workflowPlugins.snapshot(companyId, projectId).then((value) => { if (mounted) setView(value) }).catch(() => undefined)
    })
    void workflowPlugins.snapshot(companyId, projectId)
      .then((value) => { if (mounted) setView(value) })
      .catch((cause) => onError(errorMessage(cause)))
    return () => { mounted = false; off() }
  }, [open, companyId, projectId, onError])

  async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (cause) { onError(errorMessage(cause)) } finally { setBusy(null) }
  }

  async function install(event: FormEvent): Promise<void> {
    event.preventDefault()
    await run('install', async () => {
      const source = sourceMode === 'local'
        ? { kind: 'local' as const, path: localPath.trim() }
        : { kind: 'git' as const, url: gitUrl.trim(), ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) }
      setPlugins(await window.ndDshWorkflowPlugins.install(source))
      setLocalPath('')
      setPreviews(null)
    })
  }

  const binding = view.binding
  const bindingPlugin = plugins.plugins.find((item) => item.id === binding?.pluginId)
  const snapshot = view.snapshot

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Workflow integration · {projectName}</DialogTitle>
          <DialogDescription>
            Install an external workflow plugin on demand, then bind it to this project in Mirror mode. Mirror is read-only:
            repository cards report source state, and ND never runs project checks or approves work for it.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-[7px]">
          <h3 className="m-0 text-[13px] font-semibold">Installed plugins</h3>
          {plugins.plugins.length === 0 ? <p className="m-0 text-xs text-faint">No workflow plugins installed yet.</p> : null}
          {plugins.plugins.map((plugin) => <InstalledRow key={plugin.id} plugin={plugin} busy={busy} onRemove={() => void run(`remove-${plugin.id}`, async () => setPlugins(await window.ndDshWorkflowPlugins.remove(plugin.id)))} />)}
        </section>

        <section className="grid gap-[7px] rounded-[9px] border border-border-soft bg-surface-0 p-[11px]">
          <h3 className="m-0 text-[13px] font-semibold">Install from source</h3>
          <div className="flex gap-1">
            {(['git', 'local'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn('h-7 rounded-md border border-transparent bg-transparent px-[9px] text-sm', sourceMode === mode ? 'border-primary/30 bg-primary/10 text-primary' : 'text-soft hover:bg-accent')}
                onClick={() => setSourceMode(mode)}
              >
                {mode === 'git' ? 'Git repository' : 'Local folder'}
              </button>
            ))}
          </div>
          <form className="grid gap-[7px]" onSubmit={(event) => void install(event)}>
            {sourceMode === 'git' ? (
              <>
                <input className={wfInput} placeholder="https://github.com/owner/workflow-plugins.git" value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} required />
                <input className={wfInput} placeholder="Pinned commit SHA or branch (recommended: full SHA)" value={gitRef} onChange={(event) => setGitRef(event.target.value)} />
                <small className="text-[11px] text-faint">ND clones the repository, checks out the pinned ref, and records it as provenance. Review the manifest before enabling any binding.</small>
              </>
            ) : (
              <>
                <input className={wfInput} placeholder="Absolute path to the checked-out plugin bundle" value={localPath} onChange={(event) => setLocalPath(event.target.value)} required />
                <small className="text-[11px] text-faint">Expects an nd-plugin.json manifest (bundle root, nd/, or packages/*/plugin/nd/). Its git revision is recorded as provenance.</small>
              </>
            )}
            <div><button className={wfPrimaryButton} disabled={busy !== null}>{busy === 'install' ? 'Installing…' : 'Install plugin'}</button></div>
          </form>
        </section>

        <section className="grid gap-[7px] rounded-[9px] border border-border-soft bg-surface-0 p-[11px]">
          <h3 className="m-0 text-[13px] font-semibold">Project binding</h3>
          {binding ? (
            <div className="grid gap-[7px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-primary">
                  Mirror · {bindingPlugin?.manifest.upstream?.package ?? binding.pluginId}
                </span>
                {snapshot?.stale ? <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-warning">Stale</span> : null}
                {view.pluginMissing ? <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-destructive">Plugin missing</span> : null}
              </div>
              <p className="m-0 text-xs text-muted-foreground">
                Reading <code className="font-mono text-[11px]">{binding.root}</code>
                {snapshot ? ` · last scan ${new Date(snapshot.scannedAt).toLocaleString()}` : ' · not scanned yet'}
              </p>
              {snapshot?.lastError ? <p className="m-0 rounded-[7px] border border-destructive/25 bg-destructive/[0.06] p-[7px] text-xs text-destructive">{snapshot.lastError}</p> : null}
              <div className="flex gap-[7px]">
                <button className={wfButton} disabled={busy !== null} onClick={() => void run('refresh', async () => setPlugins(await window.ndDshWorkflowPlugins.refresh(companyId, projectId)))}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}</button>
                <button className={wfButton} disabled={busy !== null} onClick={() => void run('disable', async () => { setPlugins(await window.ndDshWorkflowPlugins.disable(companyId, projectId, binding.pluginId)); setView(await window.ndDshWorkflowPlugins.snapshot(companyId, projectId)) })}>Disable</button>
              </div>
            </div>
          ) : (
            <div className="grid gap-[7px]">
              <p className="m-0 text-xs text-muted-foreground">
                {hasWorkspace ? 'Detect a workflow in this project, then enable Mirror to show its tasks on the work board.' : 'Link this project to a workspace folder first.'}
              </p>
              <div className="flex gap-[7px]">
                <button className={wfButton} disabled={!hasWorkspace || busy !== null} onClick={() => void run('detect', async () => setPreviews(await window.ndDshWorkflowPlugins.detect(companyId, projectId)))}>{busy === 'detect' ? 'Detecting…' : 'Run detection'}</button>
              </div>
              {previews?.length === 0 ? <p className="m-0 text-xs text-faint">No workflow plugins installed — install one above first.</p> : null}
              {previews?.map((preview) => (
                <div key={preview.pluginId} className="grid gap-[5px] rounded-[7px] border border-border-soft bg-sidebar p-[9px]">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{preview.pluginId} <span className="text-xs font-normal text-faint">{preview.pluginVersion}</span></strong>
                    {preview.supported ? (
                      <button className={wfPrimaryButton} disabled={busy !== null} onClick={() => void run(`enable-${preview.pluginId}`, async () => {
                        setPlugins(await window.ndDshWorkflowPlugins.enable(companyId, projectId, preview.pluginId))
                        setView(await window.ndDshWorkflowPlugins.snapshot(companyId, projectId))
                      })}>{busy === `enable-${preview.pluginId}` ? 'Enabling…' : 'Enable Mirror'}</button>
                    ) : (
                      <span className="text-[11px] font-semibold text-warning">Not detected</span>
                    )}
                  </div>
                  {preview.error ? <p className="m-0 text-[11px] text-destructive">{preview.error}</p> : null}
                  {preview.config ? <p className="m-0 text-[11px] text-faint">config schema {preview.config.schemaVersion} · {preview.config.mode} · {preview.config.packageManager}</p> : null}
                  {preview.diagnostics.slice(0, 4).map((diagnostic, index) => (
                    <p key={`${diagnostic.code}-${index}`} className="m-0 text-[11px] text-muted-foreground">· {diagnostic.message}</p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className={wfButton}>Done</button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstalledRow({ plugin, busy, onRemove }: { plugin: InstalledWorkflowPlugin; busy: string | null; onRemove(): void }) {
  const provenance = plugin.source.kind === 'git'
    ? `${plugin.source.url}${plugin.source.ref ? ` @ ${plugin.source.ref}` : ''}${plugin.source.resolvedSha ? ` → ${plugin.source.resolvedSha.slice(0, 12)}` : ''}`
    : `${plugin.source.path}${plugin.source.gitDirty ? ' (dirty worktree)' : ''}${plugin.source.gitHead ? ` @ ${plugin.source.gitHead.slice(0, 12)}` : ''}`
  return (
    <div className="flex items-center justify-between gap-2 rounded-[7px] border border-border-soft bg-surface-0 p-[9px]">
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="truncate text-sm">{plugin.id} <span className="text-xs font-normal text-faint">{plugin.version}</span></strong>
        <small className="truncate font-mono text-[11px] text-faint" title={provenance}>{provenance}</small>
      </div>
      <button className={wfButton} disabled={busy !== null} onClick={onRemove}>Remove</button>
    </div>
  )
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
