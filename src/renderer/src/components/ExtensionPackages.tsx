import { useEffect, useState } from 'react'
import { Download, FolderOpen, Image, Package, RefreshCw, ShieldCheck, Shuffle, SkipForward, Undo2 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { NdContext } from '../../../shared/nd-context'
import { contextKey } from '../../../shared/nd-context'
import type {
  NdExtensionsStateView,
  NdInstalledPackageView,
  NdViewData,
} from '../../../shared/nd-invocations'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { describeContextForUi, optionIdForContext, type ContextOption } from '../lib/nd-context-model'
import type { OrganizationSnapshot } from '../../../shared/organization'

interface Props {
  state: NdExtensionsStateView
  organization: OrganizationSnapshot | null
  contexts: ContextOption[]
  requestedView?: { extensionId: string; viewId: string; context: NdContext } | null
  onRequestedViewHandled?(): void
  onError(message: string): void
  onChanged(): Promise<void>
}

/**
 * Extensions management: packages, versions and source, per-context
 * activation, settings, grants, pending agent approvals, and the audit trail.
 * Installation is global; activation and grants are per context, and the two
 * are never implied by each other.
 */
export function ExtensionPackagesCard({ state, organization, contexts, requestedView, onRequestedViewHandled, onError, onChanged }: Props): React.ReactNode {
  const [manageContextId, setManageContextId] = useState('personal')
  const manageContext = contexts.find((option) => option.id === manageContextId)?.context ?? { kind: 'personal' as const }
  const [view, setView] = useState<{ extensionId: string; viewId: string; context: NdContext } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!requestedView) return
    setManageContextId(optionIdForContext(contexts, requestedView.context) ?? 'personal')
    setView(requestedView)
    onRequestedViewHandled?.()
  }, [requestedView])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await onChanged()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const isActive = (extensionId: string, context: NdContext): boolean =>
    state.activations.some((record) =>
      record.extensionId === extensionId && record.contextKey === contextKey(context) && record.enabled)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Package className="size-4 text-primary" /> ND extension packages
          </h3>
          <p className="text-xs text-faint">
            Installed once for your ND profile. Activation, settings, and grants are per context; installation alone grants nothing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-border-soft bg-surface-0/60 px-2 text-xs text-foreground"
            value={manageContextId}
            onChange={(event) => setManageContextId(event.target.value)}
            aria-label="Context for settings and grants"
          >
            {contexts.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.installLocal())}>
            <Download className="size-3.5" /> Install from folder
          </Button>
        </div>
      </div>

      {(state.available?.length ?? 0) > 0 ? (
        <div className="space-y-2 rounded-md border border-border-soft p-3">
          <h4 className="text-xs font-semibold text-foreground">Available to install</h4>
          {state.available?.map((item) => {
            const installed = state.packages.find((pack) => pack.id === item.id)
            const updateAvailable = installed && installed.version !== item.version
            return (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0/40 p-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">{item.name} · v{item.version}</div>
                  <p className="text-[11px] text-faint">{item.description}</p>
                  <p className="text-[10px] text-faint">Can: {describePermissions(item.permissions) || 'no special access'}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy || !item.available || Boolean(installed && !updateAvailable)} onClick={() => void run(() => window.ndDsh.ndExtensions.installAvailable(item.id))}>
                  {updateAvailable ? 'Update' : installed ? 'Installed' : item.available ? 'Install' : 'Unavailable'}
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {state.pendingApprovals.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
            <ShieldCheck className="size-3.5" /> Agent requests waiting for your approval
          </div>
          <div className="mt-2 space-y-2">
            {state.pendingApprovals.map((approval) => (
              <div key={approval.approvalId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-soft bg-surface-0/50 p-2">
                <span className="min-w-0 flex-1 truncate text-xs text-soft">
                  {approval.title} · {describeContextForUi(approval.context, organization)}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.approve(approval.approvalId))}>Allow once</Button>
                  <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.approve(approval.approvalId, true))}>Allow always</Button>
                  <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.deny(approval.approvalId))}>Deny</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state.packages.length === 0 ? (
        <p className="text-xs text-faint">No extension packages are installed.</p>
      ) : state.packages.map((item) => (
        <PackageRow
          key={item.id}
          item={item}
          state={state}
          contexts={contexts}
          manageContext={manageContext}
          busy={busy}
          isActive={isActive}
          run={run}
          onOpenView={(viewId) => setView({ extensionId: item.id, viewId, context: manageContext })}
        />
      ))}

      <div className="rounded-md border border-border-soft p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Grants for {contexts.find((option) => option.id === manageContextId)?.label ?? 'Personal'}</span>
        </div>
        {(() => {
          const key = contextKey(manageContext)
          const grants = state.grants.filter((grant) => grant.contextKey === key)
          if (grants.length === 0) return <p className="mt-1 text-[11px] text-faint">No remembered grants in this context.</p>
          return (
            <div className="mt-2 space-y-1.5">
              {grants.map((grant) => (
                <div key={grant.id} className="flex items-center justify-between gap-2 rounded border border-border-soft bg-surface-0/40 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-soft">
                    {grant.extensionId} · {grant.host} · {grant.scope === 'once' ? 'one-time' : 'remembered'}
                    {grant.resource ? ` · ${grant.resource}` : ''}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.revokeGrant(grant.id))}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      <div className="rounded-md border border-border-soft p-3">
        <span className="text-xs font-semibold text-foreground">Recent extension decisions</span>
        {state.audit.length === 0 ? (
          <p className="mt-1 text-[11px] text-faint">No extension activity recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {state.audit.slice(0, 12).map((entry, index) => (
              <div key={`${entry.at}-${index}`} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-faint">
                  {new Date(entry.at).toLocaleTimeString()} · {entry.extensionId} · {entry.host} · {entry.contextKey} · {entry.caller}
                </span>
                <Badge variant={entry.decision === 'allowed' ? 'secondary' : 'destructive'}>{entry.decision}</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-faint">Decisions are logged without clipboard contents, screenshots, or credentials.</p>
      </div>

      <ExtensionViewDialog
        target={view}
        organization={organization}
        onClose={() => setView(null)}
        onError={onError}
        onChanged={onChanged}
      />
    </div>
  )
}

function PackageRow({
  item,
  state,
  contexts,
  manageContext,
  busy,
  isActive,
  run,
  onOpenView,
}: {
  item: NdInstalledPackageView
  state: NdExtensionsStateView
  contexts: ContextOption[]
  manageContext: NdContext
  busy: boolean
  isActive(extensionId: string, context: NdContext): boolean
  run(action: () => Promise<unknown>): Promise<void>
  onOpenView(viewId: string): void
}): React.ReactNode {
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({})
  const supported = contexts.filter((option) => item.contexts.includes(option.context.kind))
  const manageKey = contextKey(manageContext)
  const activation = state.activations.find((record) => record.extensionId === item.id && record.contextKey === manageKey)

  return (
    <div className="rounded-md border border-border-soft bg-surface-0/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{item.name}</span>
            <Badge variant="secondary">v{item.version}</Badge>
            {item.previousVersion ? <Badge variant="outline">rollback → v{item.previousVersion}</Badge> : null}
            {item.hasExecutable ? <Badge variant="outline">executable</Badge> : null}
          </div>
          <p className="mt-0.5 text-[11px] text-faint">{item.description}</p>
          <p
            className="mt-0.5 text-[10px] text-faint"
            title={`${item.source.location}${item.source.revision ? ` @ ${item.source.revision.slice(0, 10)}` : ''}`}
          >
            {describeSource(item.source.kind)} · {item.contributions.commands} commands · {item.contributions.views} views · {item.contributions.workflows} workflows
          </p>
          <p className="mt-0.5 text-[10px] text-faint">Can: {describePermissions(item.permissions) || 'no special access'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.update(item.id))}>
            <RefreshCw className="size-3" /> Update
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={busy || !item.previousVersion} onClick={() => void run(() => window.ndDsh.ndExtensions.rollback(item.id))}>
            <Undo2 className="size-3" /> Rollback
          </Button>
          {item.source.kind === 'builtin' ? (
            <Badge variant="outline">ND-maintained</Badge>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.uninstall(item.id))}>
              Uninstall
            </Button>
          )}
        </div>
      </div>

      {supported.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">Activation:</span>
          {supported.map((option) => {
            const active = isActive(item.id, option.context)
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${active ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border-soft text-faint hover:text-foreground'}`}
                onClick={() => void run(() => window.ndDsh.ndExtensions.setActivation(item.id, option.context, !active))}
              >
                {option.label}{active ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-faint">Activates in a company or project context — none is open yet, so there is nothing to switch on here.</p>
      )}

      {item.settings.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <span className="text-[11px] text-faint">Settings for {contexts.find((option) => contextKey(option.context) === manageKey)?.label ?? 'this context'}:</span>
          {item.settings.map((field) => {
            const current = activation?.settings[field.key] ?? field.default
            const draft = settingsDraft[`${item.id}:${field.key}`] ?? String(current ?? '')
            return (
              <div key={field.key} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-[11px] text-soft" title={field.description ?? field.title}>{field.title}</span>
                <Input
                  className="h-7 flex-1 text-xs"
                  value={draft}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, [`${item.id}:${field.key}`]: event.target.value }))}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy}
                  onClick={() => void run(() => window.ndDsh.ndExtensions.setSetting(
                    item.id,
                    manageContext,
                    field.key,
                    field.type === 'number' ? Number(draft) : field.type === 'boolean' ? draft === 'true' : draft,
                  ))}
                >
                  Save
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {item.views.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">Views:</span>
          {item.views.map((view) => (
            <Button
              key={view.id}
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!activation?.enabled}
              onClick={() => onOpenView(view.id)}
            >
              Open {view.title}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ExtensionViewDialog({
  target,
  organization,
  onClose,
  onError,
  onChanged,
}: {
  target: { extensionId: string; viewId: string; context: NdContext } | null
  organization: OrganizationSnapshot | null
  onClose(): void
  onError(message: string): void
  onChanged(): Promise<void>
}): React.ReactNode {
  const [data, setData] = useState<NdViewData | null>(null)
  const [selected, setSelected] = useState<{ title: string; body?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')

  useEffect(() => {
    setQuery('')
    setSortBy('name')
  }, [target])

  useEffect(() => {
    if (!target) {
      setData(null)
      setSelected(null)
      return
    }
    let mounted = true
    void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
      .then((next) => { if (mounted) setData(next) })
      .catch((cause) => { if (mounted) onError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { mounted = false }
  }, [target])

  useEffect(() => {
    if (!target || !data?.refreshIntervalMs) return
    let loading = false
    let failed = false
    const timer = setInterval(() => {
      if (loading || failed) return
      loading = true
      void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
        .then(setData)
        .catch((cause) => {
          failed = true
          onError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => { loading = false })
    }, data.refreshIntervalMs)
    return () => clearInterval(timer)
  }, [target, data?.refreshIntervalMs])

  const sortKeys = data?.rows[0]?.sortValues ? Object.keys(data.rows[0].sortValues) : []
  const visibleRows = (data?.rows ?? [])
    .filter((row) => !query.trim() || `${row.title} ${row.body ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => sortKeys.length === 0 ? 0 : sortBy === 'name'
      ? left.title.localeCompare(right.title)
      : (right.sortValues?.[sortBy] ?? -1) - (left.sortValues?.[sortBy] ?? -1))

  const isDetail = data?.kind === 'detail'
  const globalActions = isDetail ? data?.actions.filter((action) => action.id !== 'apply') ?? [] : []

  const runAction = async (actionId: string, host: string, row?: { id: string; title: string }): Promise<void> => {
    if (!target) return
    setBusy(true)
    try {
      const input = row
        ? host === 'note.open' || host === 'note.delete'
          ? { noteId: row.id }
          : host === 'capture.copy' || host === 'capture.export'
            ? { captureId: row.id }
            : { id: row.id }
        : {}
      const result = await window.ndDsh.ndExtensions.invoke({
        extensionId: target.extensionId,
        contributionId: target.viewId,
        contributionKind: 'view',
        context: target.context,
        caller: 'user',
        input: { ...input, action: actionId },
      })
      if (!result.ok) {
        onError(result.error?.message ?? 'The action failed')
        return
      }
      if (host === 'note.open' && result.value && typeof result.value === 'object') {
        const value = result.value as { title?: string; body?: string }
        setSelected({
          title: value.title ?? row?.title ?? 'Note',
          ...(typeof value.body === 'string' ? { body: value.body } : {}),
        })
        return
      }
      await onChanged()
      const reloaded = await window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
      setData(reloaded)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={cn("border-border-strong bg-surface-1 transition-all", isDetail ? "max-w-3xl sm:max-w-4xl" : "max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDetail ? <Image className="size-4 text-primary" /> : null}
            {data?.title ?? 'Extension view'}
          </DialogTitle>
          <DialogDescription>
            {target ? `${target.extensionId} · ${describeContextForUi(target.context, organization)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isDetail && globalActions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0/60 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground mr-1">Actions:</span>
              {globalActions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.id === 'next' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => void runAction(action.id, action.host)}
                >
                  {action.id === 'next' ? <SkipForward className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'random' ? <Shuffle className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'choose' ? <Image className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'set-folder' ? <FolderOpen className="mr-1.5 size-3.5" /> : null}
                  {action.title}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => {
                if (!target) return
                void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
                  .then(setData)
                  .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
              }}
            >
              <RefreshCw className="mr-1 size-3" /> Refresh
            </Button>
          </div>
        ) : null}

        {data && !selected && !isDetail ? (
          <div className="flex items-center gap-2">
            <Input aria-label="Search extension view" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 flex-1 text-xs" />
            {sortKeys.length > 0 ? (
              <select aria-label="Sort extension view" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-8 rounded-md border border-border-soft bg-surface-0 px-2 text-xs">
                <option value="name">Name</option>
                {sortKeys.map((key) => <option key={key} value={key}>{key === 'cpu' ? 'CPU' : key === 'pid' ? 'PID' : key === 'memory' ? 'Memory' : key}</option>)}
              </select>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              if (!target) return
              void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context).then(setData).catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
            }}>Refresh</Button>
          </div>
        ) : null}

        {data && !selected && isDetail && visibleRows.length > 0 ? (
          <div className="flex items-center gap-2">
            <Input aria-label="Search wallpapers" placeholder="Search wallpapers..." value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 flex-1 text-xs" />
            <span className="text-xs text-faint shrink-0">{visibleRows.length} wallpapers</span>
          </div>
        ) : null}

        {selected ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">{selected.title}</h4>
            <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap text-xs text-soft">{selected.body}</p>
            <Button size="sm" variant="outline" onClick={() => setSelected(null)}>Back to list</Button>
          </div>
        ) : data && visibleRows.length > 0 ? (
          isDetail ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 max-h-[440px] overflow-y-auto pr-1">
              {visibleRows.map((row) => {
                const isActive = row.meta === 'Active'
                return (
                  <div
                    key={row.id}
                    className={cn(
                      "relative flex flex-col justify-between rounded-lg border p-3 transition-colors",
                      isActive
                        ? "border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/40"
                        : "border-border-soft bg-surface-0/50 hover:bg-surface-0/80"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded",
                          isActive ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground/80"
                        )}>
                          <Image className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="block truncate text-xs font-medium text-foreground" title={row.title}>
                            {row.title}
                          </span>
                          {row.body ? (
                            <span className="block truncate text-[10px] text-faint" title={row.body}>
                              {row.body}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {row.meta ? (
                        <Badge variant={isActive ? "default" : "outline"} className="text-[10px] shrink-0">
                          {row.meta}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border-soft/60 pt-2">
                      <span className="text-[10px] text-faint">
                        {isActive ? 'Active wallpaper' : 'Available'}
                      </span>
                      <Button
                        size="sm"
                        variant={isActive ? "secondary" : "outline"}
                        className="h-6 text-[11px] px-2.5"
                        disabled={busy || row.actionsDisabled || isActive}
                        onClick={() => void runAction('apply', 'os.wallpaper.applySelected', row)}
                      >
                        {isActive ? 'Active' : 'Apply'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {visibleRows.map((row) => (
                <div key={row.id} className="rounded-md border border-border-soft bg-surface-0/40 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{row.title}</span>
                      {row.body ? <span className="mt-0.5 block line-clamp-2 text-[11px] text-faint">{row.body}</span> : null}
                      {row.meta ? <Badge variant="outline">{row.meta}</Badge> : null}
                    </div>
                  </div>
                  {data.actions.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {data.actions.map((action) => (
                        <Button key={action.id} size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy || row.actionsDisabled} onClick={() => void runAction(action.id, action.host, row)}>
                          {action.title}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : (
          isDetail ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-soft py-10 px-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-primary mb-3">
                <Image className="size-6" />
              </div>
              <h4 className="text-sm font-medium text-foreground">No wallpapers in current library</h4>
              <p className="mt-1 max-w-sm text-xs text-faint">
                {data?.empty ?? 'Select a folder containing images (.png, .jpg, .webp) or pick a single file to set as your desktop wallpaper.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void runAction('set-folder', 'os.wallpaper.setFolder')}
                >
                  <FolderOpen className="mr-1.5 size-3.5" /> Select Wallpaper Folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void runAction('choose', 'os.wallpaper.chooseAndSet')}
                >
                  <Image className="mr-1.5 size-3.5" /> Pick Image File...
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-faint">{query && data?.rows.length ? 'No rows match your search.' : data?.empty ?? 'This view has no rows yet.'}</p>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Plain-language permission summaries; unknown slugs stay honest instead of guessing. */
const PERMISSION_LABELS: Record<string, string> = {
  'notes.read': 'Read your notes',
  'notes.write': 'Create and edit notes',
  'capture.screen': 'Take screen captures',
  'capture.area': 'Capture parts of the screen',
  'capture.read': 'Read saved captures',
  'clipboard.read': 'Read copied text',
  'clipboard.write': 'Write copied text',
  'browser.navigate': 'Navigate the built-in browser',
  'browser.openExternal': 'Open links in your system browser',
  'os.launch': 'Open apps and files on this device',
  'os.wallpaper.write': 'Change desktop wallpaper',
  'process.read': 'See running processes',
  'process.quit': 'Quit running processes',
  'workflow.read': 'Read the project task board',
  'chat.start': 'Start chats as you',
}

function describePermissions(permissions: string[]): string {
  return Array.from(new Set(permissions.map((permission) => PERMISSION_LABELS[permission] ?? permission))).join(', ')
}

function describeSource(kind: string): string {
  return kind === 'builtin' ? 'Bundled with ND' : kind === 'local' ? 'Installed from a folder' : kind
}
