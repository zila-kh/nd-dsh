import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FolderOpen, Image, Package, Puzzle, RefreshCw, Search, Settings2, ShieldCheck, Shuffle, SkipBack, SkipForward, Undo2 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { NdContext } from '../../../shared/nd-context'
import { contextKey } from '../../../shared/nd-context'
import type {
  NdExtensionsStateView,
  NdInstalledPackageView,
  NdViewData,
  NdViewRow,
} from '../../../shared/nd-invocations'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { describeContextForUi, optionIdForContext, type ContextOption } from '../lib/nd-context-model'
import type { OrganizationSnapshot } from '../../../shared/organization'
import { SurfaceErrorBoundary } from './surface-error-boundary'

const NdTranslateView = lazy(() => import('./NdTranslateView'))

type ExtensionViewTarget = { extensionId: string; viewId: string; context: NdContext }

/** Recheck authorization and cancel a route when its dialog was closed or replaced. */
export async function openExtensionProviderTab(
  target: ExtensionViewTarget,
  tabId: string,
  isCurrent: () => boolean,
  onOpenBrowser: (tabId: string) => Promise<void>,
  onClose: () => void,
): Promise<void> {
  const assertCurrent = (): void => {
    if (!isCurrent()) throw new Error('The translation view was closed. Open it again to continue.')
  }
  assertCurrent()
  const authorized = await window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
  assertCurrent()
  if (authorized.extensionId !== target.extensionId || authorized.viewId !== target.viewId
    || contextKey(authorized.context) !== contextKey(target.context)) {
    throw new Error('The translation view is no longer available in this context.')
  }
  await onOpenBrowser(tabId)
  assertCurrent()
  onClose()
}

interface Props {
  state: NdExtensionsStateView
  organization: OrganizationSnapshot | null
  contexts: ContextOption[]
  requestedView?: { extensionId: string; viewId: string; context: NdContext } | null
  onRequestedViewHandled?(): void
  onOpenBrowser?: ((tabId: string) => Promise<void>) | undefined
  onError(message: string): void
  onChanged(): Promise<void>
}

/**
 * Extensions management: packages, versions and source, per-context
 * activation, settings, grants, pending agent approvals, and the audit trail.
 * Installation is global; activation and grants are per context, and the two
 * are never implied by each other.
 */
export function ExtensionPackagesCard({ state, organization, contexts, requestedView, onRequestedViewHandled, onOpenBrowser, onError, onChanged }: Props): React.ReactNode {
  const [manageContextId, setManageContextId] = useState('personal')
  const manageContext = contexts.find((option) => option.id === manageContextId)?.context ?? { kind: 'personal' as const }
  const [view, setView] = useState<{ extensionId: string; viewId: string; context: NdContext } | null>(null)
  const [busy, setBusy] = useState(false)
  const [catalogTab, setCatalogTab] = useState<'discover' | 'installed'>('discover')
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLowerCase()
  const available = (state.available ?? []).filter((item) =>
    !normalizedQuery || `${item.name} ${item.description} ${item.id}`.toLowerCase().includes(normalizedQuery))
  const installed = state.packages.filter((item) =>
    !normalizedQuery || `${item.name} ${item.description} ${item.id}`.toLowerCase().includes(normalizedQuery))

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
    <div className="mx-auto w-full max-w-[1120px] space-y-7 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-soft pb-5">
        <div className="max-w-[620px]">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <Puzzle className="size-4" aria-hidden="true" /> Extension directory
          </div>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">Extensions</h2>
          <p className="mt-1.5 text-xs leading-5 text-faint">
            Add tools and workflows to ND. Installations are shared across your profile; activation and access stay under your control for each context.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
            <Input
              aria-label="Search extensions"
              placeholder="Search extensions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-[210px] pl-8 text-xs"
            />
          </label>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.installLocal())}>
            <FolderOpen className="size-3.5" /> Install from folder
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Extension views" className="flex items-center gap-1 rounded-lg border border-border-soft bg-surface-0/60 p-1">
          {([
            ['discover', 'Discover', state.available?.length ?? 0],
            ['installed', 'Installed', state.packages.length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={catalogTab === id}
              onClick={() => setCatalogTab(id)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                catalogTab === id ? 'bg-primary/10 text-primary' : 'text-faint hover:bg-accent hover:text-foreground',
              )}
            >
              {label}<span className="text-[10px] opacity-75">{count}</span>
            </button>
          ))}
        </nav>
        <label className="flex items-center gap-2 text-[11px] text-faint">
          Manage context
          <select
            className="h-8 rounded-md border border-border-soft bg-surface-0/60 px-2 text-xs text-foreground"
            value={manageContextId}
            onChange={(event) => setManageContextId(event.target.value)}
            aria-label="Context for extension settings and grants"
          >
            {contexts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>

      {state.pendingApprovals.length > 0 ? (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" aria-label="Pending extension approvals">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
            <ShieldCheck className="size-3.5" /> Agent requests waiting for your approval
          </div>
          <div className="mt-3 space-y-2">
            {state.pendingApprovals.map((approval) => (
              <div key={approval.approvalId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-soft bg-surface-0/50 p-3">
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
        </section>
      ) : null}

      {catalogTab === 'discover' ? (
        <section aria-label="Discover extensions">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold text-foreground">Discover extensions</h3>
              <p className="mt-1 text-[11px] text-faint">Explore ND-maintained extensions and add the ones you need.</p>
            </div>
            <span className="text-[10px] text-faint">{available.length} {available.length === 1 ? 'extension' : 'extensions'}</span>
          </div>
          {available.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {available.map((item) => {
            const installed = state.packages.find((pack) => pack.id === item.id)
            const updateAvailable = installed && installed.version !== item.version
            return (
              <article key={item.id} className="flex min-h-[190px] flex-col rounded-xl border border-border-soft bg-surface-0/40 p-4 transition-colors hover:border-border-strong hover:bg-surface-1">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border-soft bg-surface-1 text-primary">
                    <Package className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="m-0 truncate text-sm font-semibold text-foreground">{item.name}</h4>
                    <p className="mt-0.5 text-[10px] text-faint">ND-maintained · v{item.version}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-9 text-[11px] leading-[1.45] text-soft">{item.description}</p>
                <div className="mt-auto border-t border-border-soft pt-3">
                  <p className="mb-3 flex gap-1.5 text-[10px] leading-4 text-faint">
                    <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    <span><strong className="font-medium text-soft">Access:</strong> {describePermissions(item.permissions) || 'No special access'}</span>
                  </p>
                  <Button className="w-full" size="sm" variant={installed && !updateAvailable ? 'outline' : 'default'} disabled={busy || !item.available || Boolean(installed && !updateAvailable)} onClick={() => void run(() => window.ndDsh.ndExtensions.installAvailable(item.id))}>
                    {installed && !updateAvailable ? <><Check className="size-3.5" /> Installed</> : updateAvailable ? <><RefreshCw className="size-3.5" /> Update to v{item.version}</> : item.available ? <><Download className="size-3.5" /> Install extension</> : 'Unavailable'}
                  </Button>
                </div>
              </article>
            )
              })}
            </div>
          ) : (
            <EmptyExtensions title={normalizedQuery ? 'No extensions found' : 'No extensions to discover'} detail={normalizedQuery ? 'Try a different search.' : 'ND-maintained extensions will appear here when available.'} />
          )}
        </section>
      ) : (
        <section aria-label="Installed extensions">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold text-foreground">Installed extensions</h3>
              <p className="mt-1 text-[11px] text-faint">Choose where each extension is active and review its available controls.</p>
            </div>
            <span className="text-[10px] text-faint">{installed.length} {installed.length === 1 ? 'extension' : 'extensions'}</span>
          </div>
          {installed.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {installed.map((item) => (
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
            </div>
          ) : (
            <EmptyExtensions title={normalizedQuery ? 'No installed extensions found' : 'Your extensions will show up here'} detail={normalizedQuery ? 'Try a different search.' : 'Browse the directory to add an extension, or install one from a local folder.'} />
          )}
        </section>
      )}

      <details className="group rounded-xl border border-border-soft bg-surface-0/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <span>Access and activity</span>
          <span className="text-[10px] font-normal text-faint">{state.grants.length} grants · {state.audit.length} decisions</span>
        </summary>
        <div className="space-y-4 border-t border-border-soft p-4">
        <div>
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

        <div>
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
        </div>
      </details>

      <ExtensionViewDialog
        target={view}
        organization={organization}
        state={state}
        onClose={() => setView(null)}
        onError={onError}
        onChanged={onChanged}
        onOpenBrowser={onOpenBrowser}
      />
    </div>
  )
}

type WallpaperPreviewDetail = {
  id: string
  filename: string
  path: string
  dataUrl?: string
  thumbnail?: string
  width?: number
  height?: number
  size?: number
  modifiedAt?: number
}

function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function WallpaperSettingsPreview({
  folder,
  context,
  onOpenStudio,
  onWallpaperChanged,
}: {
  folder: string
  context: NdContext
  onOpenStudio(): void
  onWallpaperChanged?(): void
}): React.ReactNode {
  const [items, setItems] = useState<NdViewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewDetail, setPreviewDetail] = useState<WallpaperPreviewDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  const loadWallpapers = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.ndDsh.ndExtensions.invoke({
        extensionId: 'nd.wallpaper-manager',
        contributionId: 'wallpaper-studio',
        contributionKind: 'view',
        context,
        caller: 'user',
        input: folder.trim() ? { folder: folder.trim() } : {},
      })
      if (res.ok && Array.isArray(res.value)) {
        const rows: NdViewRow[] = (res.value as Record<string, unknown>[]).map((rec, idx) => ({
          id: typeof rec.id === 'string' ? rec.id : `row-${idx}`,
          title: typeof rec.title === 'string' ? rec.title : String(rec.id ?? `Wallpaper ${idx + 1}`),
          ...(typeof rec.detail === 'string' ? { body: rec.detail } : {}),
          ...(typeof rec.status === 'string' ? { meta: rec.status } : {}),
          ...(typeof rec.thumbnail === 'string' ? { thumbnail: rec.thumbnail } : {}),
          ...(typeof rec.path === 'string' ? { path: rec.path } : {}),
        }))
        setItems(rows)
        const activeIdx = rows.findIndex((r) => r.meta === 'Active')
        setSelectedIndex(activeIdx >= 0 ? activeIdx : 0)
      } else {
        setItems([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWallpapers()
  }, [folder, context])

  const selectedItem = items[selectedIndex] ?? null
  const isSelectedActive = selectedItem?.meta === 'Active'

  useEffect(() => {
    if (!selectedItem) {
      setPreviewDetail(null)
      return
    }
    let active = true
    setPreviewLoading(true)
    setPreviewDetail({
      id: selectedItem.id,
      filename: selectedItem.title,
      path: selectedItem.path ?? selectedItem.body ?? '',
      ...(selectedItem.thumbnail ? { thumbnail: selectedItem.thumbnail } : {}),
    })

    void window.ndDsh.ndExtensions.invoke({
      extensionId: 'nd.wallpaper-manager',
      contributionId: 'wallpaper-studio',
      contributionKind: 'view',
      context,
      caller: 'user',
      input: { action: 'preview', id: selectedItem.id, ...(selectedItem.path ? { path: selectedItem.path } : {}) },
    }).then((res) => {
      if (!active) return
      if (res.ok && res.value && typeof res.value === 'object') {
        setPreviewDetail(res.value as WallpaperPreviewDetail)
      }
    }).catch(() => {
      // fallback to thumbnail
    }).finally(() => {
      if (active) setPreviewLoading(false)
    })

    return () => { active = false }
  }, [selectedItem?.id, selectedItem?.path, context])

  const handlePrev = (): void => {
    if (items.length <= 1) return
    setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
  }

  const handleNext = (): void => {
    if (items.length <= 1) return
    setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1))
  }

  const handleSetWallpaper = async (): Promise<void> => {
    if (!selectedItem) return
    setApplying(true)
    try {
      const res = await window.ndDsh.ndExtensions.invoke({
        extensionId: 'nd.wallpaper-manager',
        contributionId: 'wallpaper-studio',
        contributionKind: 'view',
        context,
        caller: 'user',
        input: { action: 'apply', id: selectedItem.id, ...(selectedItem.path ? { path: selectedItem.path } : {}) },
      })
      if (res.ok) {
        await loadWallpapers()
        onWallpaperChanged?.()
      } else {
        setError(res.error?.message ?? 'Failed to set wallpaper')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border-soft bg-surface-0/60 p-3.5">
      <div className="flex items-center justify-between gap-2 border-b border-border-soft/60 pb-2.5">
        <div className="flex items-center gap-2">
          <Image className="size-4 text-primary" />
          <h4 className="text-xs font-semibold text-foreground">Wallpaper Picture Previews</h4>
          <span className="text-[10px] text-faint">
            {loading ? 'Scanning folder…' : items.length > 0 ? `${items.length} wallpapers` : 'No pictures found'}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 text-primary hover:text-primary"
          onClick={onOpenStudio}
        >
          <ExternalLink className="mr-1 size-3" /> Open Wallpaper Studio
        </Button>
      </div>

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-faint">
          <RefreshCw className="mr-2 size-4 animate-spin text-primary" />
          <span className="text-xs">Loading picture previews…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center text-faint">
          <Image className="mb-2 size-8 opacity-40" />
          <p className="text-xs font-medium text-foreground">No images found in this folder</p>
          <p className="mt-0.5 text-[11px] text-faint">
            Use the “Browse…” button above to select a folder containing images (.jpg, .png, .webp).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {selectedItem ? (
            <div className="relative group/feat flex flex-col overflow-hidden rounded-lg border border-border-soft bg-surface-2/40">
              <div className="relative flex h-52 w-full items-center justify-center overflow-hidden bg-black/70 p-2">
                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Previous picture"
                    onClick={handlePrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex size-7 items-center justify-center rounded-full bg-black/60 text-white shadow backdrop-blur-sm transition-all hover:bg-black/90 hover:scale-110 active:scale-95"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                ) : null}

                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Next picture"
                    onClick={handleNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex size-7 items-center justify-center rounded-full bg-black/60 text-white shadow backdrop-blur-sm transition-all hover:bg-black/90 hover:scale-110 active:scale-95"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                ) : null}

                {previewDetail?.dataUrl || previewDetail?.thumbnail || selectedItem.thumbnail ? (
                  <img
                    src={previewDetail?.dataUrl || previewDetail?.thumbnail || selectedItem.thumbnail}
                    alt={selectedItem.title}
                    className="size-full object-contain shadow-md"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-faint">
                    <Image className="size-8 opacity-40" />
                    <span className="mt-1 text-[11px]">Loading preview…</span>
                  </div>
                )}

                {previewLoading ? (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-[10px] text-white">
                    <RefreshCw className="size-2.5 animate-spin" /> High-res
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft/60 bg-surface-1/90 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-semibold text-foreground truncate" title={selectedItem.title}>
                      {selectedItem.title}
                    </span>
                    {previewDetail?.width && previewDetail?.height ? (
                      <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
                        {previewDetail.width} × {previewDetail.height}
                      </Badge>
                    ) : null}
                    {typeof previewDetail?.size === 'number' && previewDetail.size > 0 ? (
                      <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">
                        {formatFileSize(previewDetail.size)}
                      </Badge>
                    ) : null}
                    {isSelectedActive ? (
                      <Badge variant="default" className="text-[9px] px-1 py-0">
                        Active
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={items.length <= 1}
                    onClick={handlePrev}
                    title="Previous wallpaper"
                  >
                    <ChevronLeft className="mr-0.5 size-3" /> Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={items.length <= 1}
                    onClick={handleNext}
                    title="Next wallpaper"
                  >
                    Next <ChevronRight className="ml-0.5 size-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant={isSelectedActive ? "secondary" : "default"}
                    className="h-6 px-2.5 text-[11px]"
                    disabled={applying || isSelectedActive}
                    onClick={() => void handleSetWallpaper()}
                  >
                    {isSelectedActive ? (
                      <><Check className="mr-1 size-3" /> Active</>
                    ) : (
                      <><Image className="mr-1 size-3" /> Set as Wallpaper</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-faint">
                Wallpapers in this folder ({selectedIndex + 1} of {items.length}):
              </span>
              <span className="text-[10px] text-faint">Click any image to preview</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5 max-w-full">
              {items.map((item, idx) => {
                const isSelected = idx === selectedIndex
                const isActive = item.meta === 'Active'
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedIndex(idx)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedIndex(idx) } }}
                    className={cn(
                      "group/thumb relative h-16 w-24 shrink-0 cursor-pointer overflow-hidden rounded-md border transition-all",
                      isSelected
                        ? "border-primary ring-2 ring-primary/40 shadow-sm"
                        : isActive
                          ? "border-primary/60 bg-primary/10"
                          : "border-border-soft hover:border-foreground/40 bg-surface-2/40"
                    )}
                    title={item.title}
                  >
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="size-full object-cover transition-transform group-hover/thumb:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-faint">
                        <Image className="size-4" />
                      </div>
                    )}
                    {isActive ? (
                      <span className="absolute bottom-1 right-1 rounded bg-primary px-1 text-[8px] font-medium text-primary-foreground shadow">
                        Active
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const supported = contexts.filter((option) => item.contexts.includes(option.context.kind))
  const manageKey = contextKey(manageContext)
  const activation = state.activations.find((record) => record.extensionId === item.id && record.contextKey === manageKey)
  const primaryView = item.views[0]

  return (
    <>
      <article className="flex min-h-[230px] min-w-0 flex-col rounded-xl border border-border-soft bg-surface-0/40 p-4 transition-colors hover:border-border-strong hover:bg-surface-1">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border-soft bg-surface-1 text-primary">
            <Package className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="m-0 text-sm font-semibold text-foreground">{item.name}</h4>
              <Badge variant="secondary">v{item.version}</Badge>
              {item.source.kind === 'builtin' ? <Badge variant="outline">ND-maintained</Badge> : null}
              {item.hasExecutable ? <Badge variant="outline">executable</Badge> : null}
            </div>
            {item.previousVersion ? <p className="mt-1 text-[10px] text-faint">Previous version v{item.previousVersion} is available for rollback.</p> : null}
          </div>
        </div>

        <p className="mt-3 min-h-9 text-[11px] leading-[1.45] text-soft">{item.description}</p>
        <div className="mt-auto border-t border-border-soft pt-3">
          <div className="flex items-start gap-1.5 text-[10px] leading-4 text-faint">
            <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span><strong className="font-medium text-soft">Access:</strong> {describePermissions(item.permissions) || 'No special access'}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-medium text-faint">Active in</span>
            {supported.length > 0 ? supported.map((option) => {
              const active = isActive(item.id, option.context)
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  className={cn('rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-50', active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-soft text-faint hover:bg-accent hover:text-foreground')}
                  onClick={() => void run(() => window.ndDsh.ndExtensions.setActivation(item.id, option.context, !active))}
                >
                  {option.label}{active ? ' ✓' : ''}
                </button>
              )
            }) : <span className="text-[10px] text-faint">No compatible context available.</span>}
          </div>

          <p
            className="mt-2 truncate text-[9px] text-fainter"
            title={`${item.source.location}${item.source.revision ? ` @ ${item.source.revision.slice(0, 10)}` : ''}`}
          >
            {describeSource(item.source.kind)} · {item.contributions.commands} commands · {item.contributions.views} views · {item.contributions.workflows} workflows
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.views.length > 0 ? (
              <Button size="sm" disabled={busy || !activation?.enabled} onClick={() => onOpenView(primaryView!.id)}>
                <Image className="size-3.5" /> Open{item.views.length === 1 ? '' : ` ${primaryView!.title}`}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-3.5" /> Settings
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.update(item.id))}>
              <RefreshCw className="size-3" /> Update
            </Button>
            {item.source.kind !== 'builtin' ? (
              <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.uninstall(item.id))}>
                Uninstall
              </Button>
            ) : null}
          </div>
          {item.views.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.views.slice(1).map((view) => (
                <Button key={view.id} size="sm" variant="ghost" className="h-7 px-2 text-[10px]" disabled={busy || !activation?.enabled} onClick={() => onOpenView(view.id)}>
                  Open {view.title}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </article>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={cn("max-h-[85vh] overflow-y-auto border-border-strong bg-surface-1", item.id === 'nd.wallpaper-manager' ? "sm:max-w-2xl md:max-w-3xl" : "sm:max-w-xl")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="size-4 text-primary" /> {item.name} settings</DialogTitle>
            <DialogDescription>Settings apply to {contexts.find((option) => contextKey(option.context) === manageKey)?.label ?? 'this context'}.</DialogDescription>
          </DialogHeader>
          {item.settings.length > 0 ? (
            <div className="space-y-4 py-1">
              {item.settings.map((field) => {
                const current = activation?.settings[field.key] ?? field.default
                const draftKey = `${item.id}:${manageKey}:${field.key}`
                const draft = settingsDraft[draftKey] ?? String(current ?? '')
                return (
                  <div key={field.key} className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground" htmlFor={`${item.id}-${field.key}`}>{field.title}</label>
                    {field.description ? <p className="m-0 text-[10px] leading-4 text-faint">{field.description}</p> : null}
                    {field.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-xs text-soft">
                        <input
                          id={`${item.id}-${field.key}`}
                          type="checkbox"
                          checked={draft === 'true'}
                          disabled={busy}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, [draftKey]: String(event.target.checked) }))}
                        />
                        {draft === 'true' ? 'On' : 'Off'}
                      </label>
                    ) : (field.key === 'folder' || field.key.toLowerCase().includes('folder') || field.title.toLowerCase().includes('folder')) ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            id={`${item.id}-${field.key}`}
                            type="text"
                            className="h-9 flex-1 text-xs"
                            placeholder={field.key === 'folder' ? 'Default system Pictures folder' : undefined}
                            value={draft}
                            disabled={busy}
                            onChange={(event) => setSettingsDraft((prev) => ({ ...prev, [draftKey]: event.target.value }))}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 gap-1.5"
                            disabled={busy}
                            onClick={async () => {
                              if (item.id === 'nd.wallpaper-manager' && field.key === 'folder') {
                                try {
                                  const result = await window.ndDsh.ndExtensions.invoke({
                                    extensionId: item.id,
                                    contributionId: 'wallpaper-studio',
                                    contributionKind: 'view',
                                    context: manageContext,
                                    caller: 'user',
                                    input: { action: 'set-folder' },
                                  })
                                  if (result.ok && result.value && typeof (result.value as { folder?: unknown }).folder === 'string') {
                                    const chosen = (result.value as { folder: string }).folder
                                    setSettingsDraft((prev) => ({ ...prev, [draftKey]: chosen }))
                                    await run(() => Promise.resolve())
                                    return
                                  }
                                  if (result.ok) return
                                } catch {
                                  // fall through to workspace pickPath
                                }
                              }
                              const picked = await window.ndDsh.workspace.pickPath({
                                title: `Choose ${field.title.toLowerCase()}`,
                                ...(draft.trim() ? { defaultPath: draft.trim() } : {}),
                              })
                              if (picked) {
                                setSettingsDraft((prev) => ({ ...prev, [draftKey]: picked }))
                                await run(() => window.ndDsh.ndExtensions.setSetting(item.id, manageContext, field.key, picked))
                              }
                            }}
                          >
                            <FolderOpen className="size-3.5" /> Browse…
                          </Button>
                        </div>
                        {item.id === 'nd.wallpaper-manager' && field.key === 'folder' ? (
                          <WallpaperSettingsPreview
                            folder={draft}
                            context={manageContext}
                            onOpenStudio={() => {
                              setSettingsOpen(false)
                              onOpenView('wallpaper-studio')
                            }}
                            onWallpaperChanged={() => void run(() => Promise.resolve())}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <Input
                        id={`${item.id}-${field.key}`}
                        type={field.type === 'number' ? 'number' : 'text'}
                        className="h-9 text-xs"
                        value={draft}
                        disabled={busy}
                        onChange={(event) => setSettingsDraft((prev) => ({ ...prev, [draftKey]: event.target.value }))}
                      />
                    )}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void run(() => window.ndDsh.ndExtensions.setSetting(
                          item.id,
                          manageContext,
                          field.key,
                          field.type === 'number' ? Number(draft) : field.type === 'boolean' ? draft === 'true' : draft,
                        ))}
                      >
                        Save {field.title}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-3 text-xs text-faint">This extension has no configurable settings. Use the context controls on its card to manage activation.</p>
          )}
          <div className="border-t border-border-soft pt-3">
            <p className="m-0 text-[10px] text-faint">{describeSource(item.source.kind)} · {item.id}</p>
            {item.previousVersion ? (
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.ndDsh.ndExtensions.rollback(item.id))}>
                  <Undo2 className="size-3.5" /> Roll back to v{item.previousVersion}
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmptyExtensions({ title, detail }: { title: string; detail: string }): React.ReactNode {
  return (
    <div className="rounded-xl border border-dashed border-border-soft bg-surface-0/20 px-6 py-12 text-center">
      <Package className="mx-auto size-6 text-faint" aria-hidden="true" />
      <h4 className="mt-3 text-sm font-semibold text-foreground">{title}</h4>
      <p className="mx-auto mt-1 max-w-[360px] text-[11px] leading-5 text-faint">{detail}</p>
    </div>
  )
}

function ExtensionViewDialog({
  target,
  organization,
  state,
  onClose,
  onError,
  onChanged,
  onOpenBrowser,
}: {
  target: { extensionId: string; viewId: string; context: NdContext } | null
  organization: OrganizationSnapshot | null
  state?: NdExtensionsStateView | undefined
  onClose(): void
  onError(message: string): void
  onChanged(): Promise<void>
  onOpenBrowser?: ((tabId: string) => Promise<void>) | undefined
}): React.ReactNode {
  const [data, setData] = useState<NdViewData | null>(null)
  const [loadedTarget, setLoadedTarget] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ title: string; body?: string } | null>(null)
  const [previewItem, setPreviewItem] = useState<NdViewRow | null>(null)
  const [previewDetail, setPreviewDetail] = useState<WallpaperPreviewDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const targetGeneration = useRef({ target, revision: 0 })
  if (targetGeneration.current.target !== target) {
    targetGeneration.current = { target, revision: targetGeneration.current.revision + 1 }
  }
  const closeDialog = (): void => {
    targetGeneration.current.revision += 1
    setSelected(null)
    setPreviewItem(null)
    setPreviewDetail(null)
    onClose()
  }
  useEffect(() => () => { targetGeneration.current.revision += 1 }, [])
  const targetKey = target ? `${target.extensionId}:${target.viewId}:${contextKey(target.context)}` : null
  const currentData = target && data && loadedTarget === targetKey
    && data.extensionId === target.extensionId && data.viewId === target.viewId
    && contextKey(data.context) === contextKey(target.context) ? data : null

  useEffect(() => {
    setQuery('')
    setSortBy('name')
  }, [target])

  useEffect(() => {
    setData(null)
    setLoadedTarget(null)
    setLoadError(null)
    setSelected(null)
    setPreviewItem(null)
    setPreviewDetail(null)
    if (!target) {
      return
    }
    let mounted = true
    void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
      .then((next) => { if (mounted) { setData(next); setLoadedTarget(targetKey) } })
      .catch((cause) => {
        if (!mounted) return
        const message = cause instanceof Error ? cause.message : String(cause)
        setLoadError(message)
        onError(message)
      })
    return () => { mounted = false }
  }, [target])

  useEffect(() => {
    if (!target || !currentData?.refreshIntervalMs) return
    let mounted = true
    let loading = false
    let failed = false
    const timer = setInterval(() => {
      if (loading || failed) return
      loading = true
      void window.ndDsh.ndExtensions.loadView(target.extensionId, target.viewId, target.context)
        .then((next) => { if (mounted) setData(next) })
        .catch((cause) => {
          if (!mounted) return
          failed = true
          onError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => { loading = false })
    }, currentData.refreshIntervalMs)
    return () => { mounted = false; clearInterval(timer) }
  }, [target, currentData?.refreshIntervalMs])

  const sortKeys = currentData?.rows[0]?.sortValues ? Object.keys(currentData.rows[0].sortValues) : []
  const visibleRows = (currentData?.rows ?? [])
    .filter((row) => !query.trim() || `${row.title} ${row.body ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => sortKeys.length === 0 ? 0 : sortBy === 'name'
      ? left.title.localeCompare(right.title)
      : (right.sortValues?.[sortBy] ?? -1) - (left.sortValues?.[sortBy] ?? -1))

  const isDetail = currentData?.kind === 'detail'
  const isTranslate = target?.extensionId === 'nd.translate' && target.viewId === 'translator'
    && currentData?.extensionId === target.extensionId && currentData.viewId === target.viewId
    && contextKey(currentData.context) === contextKey(target.context)
  const isWallpaperStudio = target?.extensionId === 'nd.wallpaper-manager' && target.viewId === 'wallpaper-studio'
  const activeRecord = isWallpaperStudio && target && state
    ? state.activations.find((a) => a.extensionId === target.extensionId && a.contextKey === contextKey(target.context))
    : null
  const currentWallpaperFolder = typeof activeRecord?.settings?.folder === 'string' && activeRecord.settings.folder.trim()
    ? activeRecord.settings.folder.trim()
    : null
  const globalActions = isDetail
    ? currentData?.actions.filter((action) => action.id !== 'apply' && action.id !== 'preview' && action.id !== 'set-folder') ?? []
    : []

  useEffect(() => {
    if (!previewItem || !target) {
      setPreviewDetail(null)
      setPreviewLoading(false)
      return
    }
    let active = true
    setPreviewLoading(true)
    setPreviewDetail({
      id: previewItem.id,
      filename: previewItem.title,
      path: previewItem.body ?? '',
      ...(previewItem.thumbnail ? { thumbnail: previewItem.thumbnail } : {}),
    })

    void window.ndDsh.ndExtensions.invoke({
      extensionId: target.extensionId,
      contributionId: target.viewId,
      contributionKind: 'view',
      context: target.context,
      caller: 'user',
      input: { id: previewItem.id, action: 'preview' },
    }).then((res) => {
      if (!active) return
      if (res.ok && res.value && typeof res.value === 'object') {
        const val = res.value as WallpaperPreviewDetail
        setPreviewDetail(val)
      }
    }).catch(() => {
      // keep fallback previewDetail
    }).finally(() => {
      if (active) setPreviewLoading(false)
    })

    return () => { active = false }
  }, [previewItem, target])

  const previewIndex = previewItem ? visibleRows.findIndex((r) => r.id === previewItem.id) : -1
  const isPreviewActive = Boolean(
    previewItem && currentData?.rows.find((r) => r.id === previewItem.id)?.meta === 'Active'
  )

  const handlePrevPreview = (): void => {
    if (visibleRows.length === 0) return
    const idx = previewIndex <= 0 ? visibleRows.length - 1 : previewIndex - 1
    const nextRow = visibleRows[idx]
    if (nextRow) setPreviewItem(nextRow)
  }

  const handleNextPreview = (): void => {
    if (visibleRows.length === 0) return
    const idx = previewIndex >= visibleRows.length - 1 ? 0 : previewIndex + 1
    const nextRow = visibleRows[idx]
    if (nextRow) setPreviewItem(nextRow)
  }

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

  const handleSetPreviewWallpaper = async (): Promise<void> => {
    if (!previewItem) return
    await runAction('apply', 'os.wallpaper.applySelected', previewItem)
  }

  useEffect(() => {
    if (!previewItem) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null
      const tag = targetEl?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || targetEl?.isContentEditable) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrevPreview()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNextPreview()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void handleSetPreviewWallpaper()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPreviewItem(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [previewItem, previewIndex, visibleRows])

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto border-border-strong bg-surface-1 transition-all", isDetail || isTranslate ? "max-w-3xl sm:max-w-4xl" : "max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDetail && !isTranslate ? <Image className="size-4 text-primary" /> : null}
            {previewItem ? `Preview: ${previewItem.title}` : currentData?.title ?? 'Extension view'}
          </DialogTitle>
          <DialogDescription>
            {target ? `${target.extensionId} · ${describeContextForUi(target.context, organization)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isTranslate && target ? (
          <SurfaceErrorBoundary label="ND Translate" resetKey={targetKey ?? undefined} onError={onError}>
            <Suspense fallback={<p className="text-xs text-faint" role="status">Loading ND Translate…</p>}>
              <NdTranslateView key={targetKey} context={target.context} onOpenBrowser={onOpenBrowser ? async (tabId) => {
                const revision = targetGeneration.current.revision
                await openExtensionProviderTab(target, tabId,
                  () => targetGeneration.current.target === target && targetGeneration.current.revision === revision,
                  onOpenBrowser, closeDialog)
              } : undefined} />
            </Suspense>
          </SurfaceErrorBoundary>
        ) : !currentData ? (
          <p className="text-xs text-faint" role={loadError ? 'alert' : 'status'}>{loadError ?? 'Loading extension view…'}</p>
        ) : <>
        {!previewItem && isDetail && globalActions.length > 0 ? (
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
                  {action.id === 'prev' ? <SkipBack className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'next' ? <SkipForward className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'random' ? <Shuffle className="mr-1.5 size-3.5" /> : null}
                  {action.id === 'choose' ? <Image className="mr-1.5 size-3.5" /> : null}
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

        {!previewItem && isWallpaperStudio ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0/40 px-3 py-1.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <FolderOpen className="size-3.5 shrink-0 text-primary" />
              <span className="font-semibold text-foreground shrink-0">Folder:</span>
              <span className="truncate text-soft font-mono text-[11px]" title={currentWallpaperFolder ?? 'System Pictures'}>
                {currentWallpaperFolder ?? 'Default (system Pictures directory)'}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] shrink-0"
              disabled={busy}
              onClick={() => void runAction('set-folder', 'os.wallpaper.setFolder')}
            >
              <FolderOpen className="mr-1 size-3" /> Browse…
            </Button>
          </div>
        ) : null}

        {!previewItem && data && !selected && !isDetail ? (
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

        {!previewItem && data && !selected && isDetail && visibleRows.length > 0 ? (
          <div className="flex items-center gap-2">
            <Input aria-label="Search wallpapers" placeholder="Search wallpapers..." value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 flex-1 text-xs" />
            <span className="text-xs text-faint shrink-0">{visibleRows.length} wallpapers</span>
          </div>
        ) : null}

        {previewItem ? (
          <div className="flex flex-col space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0/60 p-2">
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPreviewItem(null)}
                >
                  <ChevronLeft className="mr-1 size-3.5" /> Back to library
                </Button>
                {previewIndex >= 0 ? (
                  <span className="text-xs text-faint">
                    {previewIndex + 1} of {visibleRows.length}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  disabled={busy || visibleRows.length <= 1}
                  onClick={handlePrevPreview}
                  title="Previous wallpaper (Left arrow)"
                >
                  <ChevronLeft className="mr-1 size-3.5" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  disabled={busy || visibleRows.length <= 1}
                  onClick={handleNextPreview}
                  title="Next wallpaper (Right arrow)"
                >
                  Next <ChevronRight className="ml-1 size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={isPreviewActive ? "secondary" : "default"}
                  className="h-7 text-xs font-medium"
                  disabled={busy || isPreviewActive}
                  onClick={() => void handleSetPreviewWallpaper()}
                >
                  {isPreviewActive ? (
                    <><Check className="mr-1.5 size-3.5" /> Active Wallpaper</>
                  ) : (
                    <><Image className="mr-1.5 size-3.5" /> Set as Wallpaper</>
                  )}
                </Button>
              </div>
            </div>

            <div className="relative group/viewport flex min-h-[340px] max-h-[58vh] items-center justify-center overflow-hidden rounded-xl border border-border-soft bg-black/70 p-3 shadow-inner">
              {visibleRows.length > 1 ? (
                <button
                  type="button"
                  aria-label="Previous wallpaper"
                  onClick={handlePrevPreview}
                  disabled={busy}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/90 hover:scale-110 active:scale-95 disabled:opacity-30"
                >
                  <ChevronLeft className="size-5" />
                </button>
              ) : null}

              {visibleRows.length > 1 ? (
                <button
                  type="button"
                  aria-label="Next wallpaper"
                  onClick={handleNextPreview}
                  disabled={busy}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/90 hover:scale-110 active:scale-95 disabled:opacity-30"
                >
                  <ChevronRight className="size-5" />
                </button>
              ) : null}

              {previewDetail?.dataUrl || previewDetail?.thumbnail || previewItem.thumbnail ? (
                <img
                  src={previewDetail?.dataUrl || previewDetail?.thumbnail || previewItem.thumbnail}
                  alt={previewItem.title}
                  className="max-h-[54vh] max-w-full rounded-md object-contain shadow-2xl transition-opacity duration-200"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-faint">
                  <Image className="mb-2 size-12 opacity-50" />
                  <p className="text-xs">Loading image preview…</p>
                </div>
              )}

              {previewLoading ? (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-[11px] font-medium text-white shadow backdrop-blur-sm">
                  <RefreshCw className="size-3 animate-spin" /> Loading full image…
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0/40 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground truncate max-w-sm" title={previewItem.title}>
                    {previewItem.title}
                  </span>
                  {previewDetail?.width && previewDetail?.height ? (
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                      {previewDetail.width} × {previewDetail.height}
                    </Badge>
                  ) : null}
                  {typeof previewDetail?.size === 'number' && previewDetail.size > 0 ? (
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                      {formatFileSize(previewDetail.size)}
                    </Badge>
                  ) : null}
                  {isPreviewActive ? (
                    <Badge variant="default" className="text-[10px] shrink-0">
                      Active
                    </Badge>
                  ) : null}
                </div>
                {previewDetail?.path || previewItem.body ? (
                  <p className="mt-0.5 truncate text-[11px] text-faint font-mono" title={previewDetail?.path ?? previewItem.body}>
                    {previewDetail?.path ?? previewItem.body}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2 text-[11px] text-faint">
                <span>
                  <kbd className="rounded border border-border-soft bg-surface-2 px-1 py-0.5 font-mono text-[10px]">←</kbd>{' '}
                  <kbd className="rounded border border-border-soft bg-surface-2 px-1 py-0.5 font-mono text-[10px]">→</kbd> Browse ·{' '}
                  <kbd className="rounded border border-border-soft bg-surface-2 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> Set ·{' '}
                  <kbd className="rounded border border-border-soft bg-surface-2 px-1 py-0.5 font-mono text-[10px]">Esc</kbd> Back
                </span>
              </div>
            </div>
          </div>
        ) : selected ? (
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
                      "group/card relative flex flex-col justify-between rounded-lg border p-3 transition-colors",
                      isActive
                        ? "border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/40"
                        : "border-border-soft bg-surface-0/50 hover:bg-surface-0/80"
                    )}
                  >
                    <div
                      className="group/thumb relative mb-2.5 h-28 w-full cursor-pointer overflow-hidden rounded-md border border-border-soft bg-surface-2/60 transition-colors hover:border-primary/50"
                      onClick={() => setPreviewItem(row)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewItem(row) } }}
                      title={`Preview ${row.title}`}
                    >
                      {row.thumbnail ? (
                        <img
                          src={row.thumbnail}
                          alt={row.title}
                          className="size-full object-cover transition-transform duration-200 group-hover/thumb:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-faint">
                          <Image className="size-6" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/thumb:opacity-100">
                        <span className="flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow">
                          <Eye className="size-3.5" /> Preview
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded",
                          isActive ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground/80"
                        )}>
                          <Image className="size-3.5" />
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
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] px-2"
                          disabled={busy}
                          onClick={() => setPreviewItem(row)}
                          title="Preview wallpaper"
                        >
                          <Eye className="mr-1 size-3" /> Preview
                        </Button>
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
        </>}
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
