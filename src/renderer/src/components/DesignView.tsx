import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'
import type {
  DesignComponentEntry,
  DesignFreeformDocumentEntry,
  DesignFreeformState,
  DesignProjectState,
  DesignTemplateEntry,
} from '../../../shared/design'
import { BrowserPane } from './BrowserPane'
import { cn } from '../lib/utils'

interface DesignViewProps {
  active: boolean
  workspace: WorkspaceState | null
  browser: BrowserState | null
  harness: HarnessStatus | null
  onWorkspaceChanged(workspace: WorkspaceState): void
  onAskAgent(prompt: string): void
  onError(message: string): void
}

type DesignSurface = 'live' | 'templates' | 'library' | 'canvas' | 'freeform'

const sectionButton = cn(
  'h-[29px] rounded-md border border-border-strong bg-secondary px-2 text-xs text-soft transition-colors',
  'hover:bg-accent hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-45',
)
const primaryButton = cn(
  'h-[29px] rounded-md border border-primary/30 bg-primary/10 px-2 text-xs text-primary transition-colors',
  'hover:bg-primary/[0.16]',
  'disabled:pointer-events-none disabled:opacity-45',
)

export function DesignView({ active, workspace, browser, harness, onWorkspaceChanged, onAskAgent, onError }: DesignViewProps) {
  const [prompt, setPrompt] = useState('')
  const [project, setProject] = useState<DesignProjectState | null>(null)
  const [freeform, setFreeform] = useState<DesignFreeformState | null>(null)
  const [surface, setSurface] = useState<DesignSurface>('live')
  const [busy, setBusy] = useState<string | null>(null)
  const selected = surface === 'live' ? browser?.selectedTarget : undefined
  const source = selected?.source ?? selected?.react?.source
  const bindingBlocked = workspace?.binding === 'unlinked' || workspace?.binding === 'missing'

  useEffect(() => {
    let mounted = true
    void window.ndDshDesign.freeformState()
      .then((state) => { if (mounted) setFreeform(state) })
      .catch((cause) => { if (mounted) onError(errorMessage(cause)) })
    const off = window.ndDshDesign.onFreeformState((state) => {
      if (mounted) setFreeform(state)
    })
    return () => {
      mounted = false
      off()
      void window.ndDshDesign.freeformSetVisible(false).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!active || bindingBlocked) return
    let mounted = true
    setBusy('scan')
    void window.ndDshDesign.refresh()
      .then((state) => {
        if (!mounted) return
        setProject(state)
        setSurface((current) => current === 'freeform' && freeform?.documentPath ? 'freeform' : initialSurface(state, browser))
      })
      .catch((cause) => { if (mounted) onError(errorMessage(cause)) })
      .finally(() => { if (mounted) setBusy(null) })
    return () => { mounted = false }
  }, [active, bindingBlocked, workspace?.root, workspace?.projectId])

  const chooseWorkspace = async (): Promise<void> => {
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.pick())
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const refreshProject = async (): Promise<void> => {
    setBusy('scan')
    try {
      setProject(await window.ndDshDesign.refresh())
      setFreeform(await window.ndDshDesign.freeformState())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const previewTemplate = async (template: DesignTemplateEntry): Promise<void> => {
    setBusy(`template:${template.path}`)
    try {
      await window.ndDshDesign.previewHtml(template.path)
      setProject(await window.ndDshDesign.state())
      setSurface('live')
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const startDevPreview = async (): Promise<void> => {
    setBusy('dev')
    try {
      await window.ndDshDesign.startDevPreview()
      setProject(await window.ndDshDesign.state())
      setSurface('live')
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const stopManagedPreview = async (): Promise<void> => {
    setBusy('stop')
    try {
      await window.ndDshDesign.stopPreview()
      setProject(await window.ndDshDesign.refresh())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const openFreeform = async (document: DesignFreeformDocumentEntry): Promise<void> => {
    setBusy(`freeform:${document.path}`)
    try {
      setFreeform(await window.ndDshDesign.freeformOpen(document.path))
      setSurface('freeform')
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const createFreeform = async (): Promise<void> => {
    setBusy('freeform:new')
    try {
      const path = nextFreeformPath(project)
      setFreeform(await window.ndDshDesign.freeformCreate(path))
      setProject(await window.ndDshDesign.refresh())
      setSurface('freeform')
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const saveFreeform = async (): Promise<void> => {
    setBusy('freeform:save')
    try {
      setFreeform(await window.ndDshDesign.freeformSave())
      setProject(await window.ndDshDesign.refresh())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const closeFreeform = async (): Promise<void> => {
    setBusy('freeform:close')
    try {
      setFreeform(await window.ndDshDesign.freeformClose())
      setProject(await window.ndDshDesign.refresh())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const buildFreeform = async (): Promise<void> => {
    const path = freeform?.documentPath
    if (!path) return
    try {
      if (freeform.dirty) setFreeform(await window.ndDshDesign.freeformSave())
      onAskAgent(`Build the ND Pencil Freeform design at ${path} into the active project's real application source. Treat the .op document as design intent, reuse existing project components and shadcn/ui where possible, preserve design tokens and accessibility, start or reuse the project runtime, and verify the result in Design Mode. Do not replace production source with a detached generated mockup.`)
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text) return
    const context = selected
      ? `\n\nSelected UI: ${selected.react?.component ?? selected.tagName}${source ? ` at ${source.file}:${source.line}` : ''}.`
      : designSurfaceContext(surface, project, freeform)
    onAskAgent(`${text}${context}`)
    setPrompt('')
  }

  const useComponent = (component: DesignComponentEntry): void => {
    onAskAgent(`Use the existing shadcn component ${component.name} from ${component.path} in the current UI. Preserve the project's component conventions, tokens, variants, accessibility, and responsive behavior. Edit the real source files and verify the result in the live app.`)
  }

  const sourceSwitcherClasses = (isActive: boolean): string =>
    cn(
      sectionButton,
      'flex items-center justify-between text-left [&>span]:truncate [&>b]:min-w-6 [&>b]:text-right [&>b]:text-[10px] [&>b]:tracking-[0.06em] [&>b]:text-faint',
      isActive && 'border-primary/20 bg-primary/[0.06] text-primary [&>b]:text-primary hover:bg-primary/[0.06]',
    )

  return (
    <div className="grid h-full w-full min-h-0 min-w-0 grid-cols-[220px_minmax(0,1fr)_250px] bg-surface-0 min-[1181px]:grid-cols-[250px_minmax(0,1fr)_290px]">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-auto border-r border-border-soft bg-sidebar">
        <div className="flex flex-col gap-[3px] border-b border-border-soft p-3.5">
          <small className="text-[11px] font-extrabold tracking-[0.12em] text-primary">DESIGN</small>
          <strong className="truncate text-base font-bold text-strong">{workspace?.projectName ?? workspace?.name ?? 'No project'}</strong>
          <span className="truncate text-xs text-faint">{project ? projectLabel(project) : workspace?.companyName ?? 'Standalone workspace'}</span>
        </div>

        <section className="flex flex-col gap-1.5 border-b border-border-soft px-3.5 py-3">
          <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Design sources</header>
          <button className={sourceSwitcherClasses(surface === 'live')} onClick={() => setSurface('live')}>
            <span>Live app</span><b>{project?.capabilities.liveApp ? 'APP' : browser?.url && browser.url !== 'about:blank' ? 'URL' : '—'}</b>
          </button>
          <button className={sourceSwitcherClasses(surface === 'templates')} onClick={() => setSurface('templates')}>
            <span>HTML / templates</span><b>{project?.templates.length ?? 0}</b>
          </button>
          <button className={sourceSwitcherClasses(surface === 'library')} onClick={() => setSurface('library')}>
            <span>shadcn library</span><b>{project?.shadcn.components.length ?? 0}</b>
          </button>
          <button className={sourceSwitcherClasses(surface === 'canvas')} onClick={() => setSurface('canvas')}>
            <span>Code canvas</span><b>NEW</b>
          </button>
          <button className={sourceSwitcherClasses(surface === 'freeform')} onClick={() => setSurface('freeform')}>
            <span>ND Pencil</span><b>{project?.freeform.documents.length ?? 0}</b>
          </button>
          <button className={cn(sectionButton, 'mt-0.5 justify-center border-dashed text-faint')} disabled={busy === 'scan' || bindingBlocked} onClick={() => void refreshProject()}>
            {busy === 'scan' ? 'Scanning…' : 'Refresh project index'}
          </button>
        </section>

        <section className="flex flex-col gap-1.5 border-b border-border-soft px-3.5 py-3">
          <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">AI design actions</header>
          {surface === 'freeform' && freeform?.documentPath ? <>
            <button className={primaryButton} onClick={() => void buildFreeform()}>Build ND Pencil into app</button>
            <button className={sectionButton} onClick={() => onAskAgent(`Review the ND Pencil design at ${freeform.documentPath} for layout consistency, hierarchy, accessibility, and design-system reuse. Improve the .op design through the ND Pencil editor while keeping it a Freeform artifact; do not change production application code unless I ask.`)}>Improve ND Pencil</button>
          </> : <>
            <button className={sectionButton} disabled={!selected} onClick={() => selected && onAskAgent('Improve the selected UI while preserving the project design language. Edit the real source and verify the result in Design Mode.')}>Improve selected</button>
            <button className={sectionButton} disabled={!selected} onClick={() => selected && onAskAgent('Make the selected UI responsive and verify it at mobile, tablet, and desktop widths.')}>Make responsive</button>
            <button className={sectionButton} disabled={!selected} onClick={() => selected && onAskAgent('Review the selected UI for accessibility, layout, and interaction problems, then fix them in the real source.')}>Fix accessibility</button>
          </>}
        </section>

        <section className="flex flex-col gap-1.5 border-b border-border-soft px-3.5 py-3">
          <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Project context</header>
          <div
            className={cn(
              'flex flex-col gap-[3px] rounded-[7px] border border-border-soft bg-surface-0 p-2',
              workspace?.binding === 'project' && 'border-primary/20',
              (workspace?.binding === 'missing' || workspace?.binding === 'unlinked') && 'border-warning/25 bg-warning/10',
            )}
          >
            <strong className="text-xs">{workspace?.binding === 'project' ? 'Project workspace linked' : workspace?.binding === 'missing' ? 'Workspace missing' : workspace?.binding === 'unlinked' ? 'Workspace not linked' : 'Standalone workspace'}</strong>
            <span className="truncate font-mono text-[11px] text-faint">{workspace?.projectWorkspacePath ?? workspace?.root ?? 'Select a workspace'}</span>
          </div>
          {surface === 'freeform' ? (
            <div className={cn('flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0 px-2 py-1.5', freeform?.available ? 'border-primary/20' : 'border-warning/25 bg-warning/10')}>
              <span className="shrink-0 text-[11px] text-faint">Freeform engine</span>
              <code className="truncate text-[11px] text-soft">{freeform?.available ? `ND Pencil ${freeform.version ?? 'built in'}` : 'ND Pencil unavailable'}</code>
            </div>
          ) : null}
          {project?.devCommand ? <>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0 px-2 py-1.5">
              <span className="shrink-0 text-[11px] text-faint">Dev runtime</span>
              <code className="truncate text-[11px] text-soft">{project.devCommand}</code>
            </div>
            <button className={primaryButton} disabled={busy !== null} onClick={() => void startDevPreview()}>{busy === 'dev' ? 'Starting runtime…' : project.preview?.kind === 'dev-server' ? 'Restart dev preview' : 'Start dev preview'}</button>
          </> : null}
          {project?.preview ? <>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-0 px-2 py-1.5">
              <span className="shrink-0 text-[11px] text-faint">Managed preview</span>
              <code className="truncate text-[11px] text-soft">{project.preview.kind === 'static-html' ? project.preview.templatePath ?? 'HTML' : project.preview.url}</code>
            </div>
            <button className={sectionButton} disabled={busy !== null} onClick={() => void stopManagedPreview()}>{busy === 'stop' ? 'Stopping…' : 'Stop managed preview'}</button>
          </> : null}
          {bindingBlocked ? <button className={primaryButton} onClick={() => void chooseWorkspace()}>Select workspace</button> : null}
        </section>

        <form className="mt-auto flex flex-col gap-[7px] p-3.5" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={selected ? 'Ask AI to change the selected UI…' : surface === 'canvas' ? 'Describe what to create on the code canvas…' : surface === 'freeform' ? 'Ask ND to edit this ND Pencil canvas…' : 'Describe the design change…'}
            className="min-h-[88px] resize-y rounded-[7px] border border-border-strong bg-background p-[9px] text-xs/[1.45] text-foreground outline-none focus:border-primary/40"
          />
          <button className={primaryButton} disabled={!prompt.trim() || bindingBlocked || harness?.state === 'running'}>Open in Agent</button>
        </form>
      </aside>

      <main className="flex min-h-0 min-w-0 overflow-hidden bg-surface-0">
        {bindingBlocked ? (
          <WorkspaceEmpty workspace={workspace} onChoose={() => void chooseWorkspace()} />
        ) : surface === 'live' ? (
          <BrowserPane active={active} state={browser} onSnapshot={() => undefined} onError={onError} />
        ) : surface === 'templates' ? (
          <TemplateSurface
            project={project}
            busy={busy}
            onPreview={(template) => void previewTemplate(template)}
            onUse={(template) => onAskAgent(`Use ${template.path} as the active design template. Inspect its markup, styles, and scripts, then implement the requested product UI by editing the real workspace files. Preserve useful visual language and verify the result in Design Mode.`)}
          />
        ) : surface === 'library' ? (
          <ShadcnSurface project={project} onUse={useComponent} onAgent={onAskAgent} />
        ) : surface === 'freeform' ? (
          <FreeformSurface
            active={active}
            project={project}
            state={freeform}
            busy={busy}
            onOpen={(document) => void openFreeform(document)}
            onCreate={() => void createFreeform()}
            onSave={() => void saveFreeform()}
            onClose={() => void closeFreeform()}
            onBuild={() => void buildFreeform()}
            onError={onError}
          />
        ) : (
          <CodeCanvas project={project} onAgent={onAskAgent} />
        )}
      </main>

      <aside className="flex min-h-0 min-w-0 flex-col overflow-auto border-l border-border-soft bg-sidebar">
        <div className="flex flex-col gap-[3px] border-b border-border-soft p-3.5">
          <small className="text-[11px] font-extrabold tracking-[0.12em] text-primary">INSPECTOR</small>
          <strong className="truncate text-base font-bold text-strong">{selected?.react?.component ?? selected?.tagName ?? surfaceTitle(surface)}</strong>
          <span className="truncate text-xs text-faint">{source ? `${source.file}:${source.line}` : selected ? selected.selector : inspectorSubtitle(surface, freeform)}</span>
        </div>
        {selected ? (
          <>
            <section className="flex flex-col gap-0 border-b border-border-soft px-3.5 pt-2.5">
              <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Runtime</header>
              <Property label="Element" value={selected.tagName} />
              <Property label="Selector" value={selected.selector} />
              <Property label="Size" value={`${Math.round(selected.bounds.width)} × ${Math.round(selected.bounds.height)}`} />
              {selected.react?.hierarchy.length ? <Property label="React" value={selected.react.hierarchy.join(' › ')} /> : null}
            </section>
            <section className="flex flex-col gap-0 border-b border-border-soft px-3.5 pt-2.5">
              <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Layout & style</header>
              {['display', 'position', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'font-size', 'font-weight', 'background-color', 'color', 'border-radius'].map((key) => (
                selected.computedStyle[key] ? <Property key={key} label={key} value={selected.computedStyle[key]} /> : null
              ))}
            </section>
          </>
        ) : surface === 'freeform' ? (
          <FreeformInspector state={freeform} project={project} onBuild={() => void buildFreeform()} />
        ) : (
          <ProjectInspector project={project} surface={surface} />
        )}
      </aside>
    </div>
  )
}

function FreeformSurface({ active, project, state, busy, onOpen, onCreate, onSave, onClose, onBuild, onError }: {
  active: boolean
  project: DesignProjectState | null
  state: DesignFreeformState | null
  busy: string | null
  onOpen(document: DesignFreeformDocumentEntry): void
  onCreate(): void
  onSave(): void
  onClose(): void
  onBuild(): void
  onError(message: string): void
}) {
  if (!state?.available) {
    return <div className="h-full w-full min-h-0 min-w-0 overflow-auto bg-surface-0 p-7">
      <header className="mx-auto mb-[22px] flex max-w-[980px] items-start justify-between gap-6">
        <div className="min-w-0">
          <small className="mb-[7px] block text-[11px] font-extrabold tracking-[0.12em] text-primary">FREEFORM · ND PENCIL</small>
          <h2 className="m-0 text-[26px] font-bold tracking-tight text-strong">ND Pencil is built into ND.</h2>
          <p className="mt-[7px] max-w-[660px] text-sm/[1.6] text-muted-foreground">In a source checkout the pinned engine implementation must be compiled once. Distributed ND builds package it automatically; users never install a separate design application.</p>
        </div>
        <span className="shrink-0 rounded-full border border-border-soft bg-sidebar px-2 py-[5px] text-[11px] text-faint">ENGINE</span>
      </header>
      <SurfaceEmpty title="ND Pencil runtime is not built" text={state?.error ?? 'Build the pinned runtime to enable the editable vector canvas.'} />
      <div className="mx-auto my-3.5 flex max-w-[520px] justify-center rounded-lg border border-border-soft bg-sidebar px-3 py-2.5">
        <code className="text-xs text-soft">pnpm nd-pencil:build</code>
      </div>
    </div>
  }

  if (state.documentPath) {
    return <NdPencilPane active={active} state={state} busy={busy} onSave={onSave} onClose={onClose} onBuild={onBuild} onError={onError} />
  }

  const documents = project?.freeform.documents ?? []
  return <div className="h-full w-full min-h-0 min-w-0 overflow-auto bg-surface-0 p-7">
    <header className="mx-auto mb-[22px] flex max-w-[980px] items-start justify-between gap-6">
      <div className="min-w-0">
        <small className="mb-[7px] block text-[11px] font-extrabold tracking-[0.12em] text-primary">FREEFORM · ND PENCIL</small>
        <h2 className="m-0 text-[26px] font-bold tracking-tight text-strong">Explore visually before production code.</h2>
        <p className="mt-[7px] max-w-[660px] text-sm/[1.6] text-muted-foreground">ND Pencil designs are real versionable <code>.op</code> files inside this project. The editor is native to ND and always follows the active workspace.</p>
      </div>
      <button
        className="h-[30px] shrink-0 rounded-md border border-primary/30 bg-primary/10 px-[11px] text-xs text-primary transition-colors hover:bg-primary/[0.16] disabled:pointer-events-none disabled:opacity-45"
        disabled={busy !== null}
        onClick={onCreate}
      >
        {busy === 'freeform:new' ? 'Creating…' : 'New ND Pencil'}
      </button>
    </header>
    {documents.length ? <div className="mx-auto grid max-w-[980px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
      {documents.map((document) => <SourceCard
        key={document.path}
        icon="NP"
        name={document.name}
        path={document.path}
        note="ND Pencil · editable Freeform canvas"
        actionLabel={busy === `freeform:${document.path}` ? 'Opening…' : 'Open canvas'}
        actionDisabled={busy !== null}
        onAction={() => onOpen(document)}
      />)}
    </div> : <div className="mx-auto flex max-w-[760px] flex-col items-center gap-3">
      <SurfaceEmpty title="No ND Pencil designs yet" text="Create one to sketch frames, layouts, flows, or visual alternatives without turning the design artifact into production source." />
      <LargeActionButton onClick={onCreate}>Create first ND Pencil design</LargeActionButton>
    </div>}
  </div>
}

function NdPencilPane({ active, state, busy, onSave, onClose, onBuild, onError }: {
  active: boolean
  state: DesignFreeformState
  busy: string | null
  onSave(): void
  onClose(): void
  onBuild(): void
  onError(message: string): void
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let frame = 0
    const sync = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect()
        void window.ndDshDesign.freeformSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch((cause) => onError(errorMessage(cause)))
      })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(surface)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    void window.ndDshDesign.freeformSetVisible(active).catch((cause) => onError(errorMessage(cause)))
    if (active) requestAnimationFrame(() => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect) void window.ndDshDesign.freeformSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        .catch((cause) => onError(errorMessage(cause)))
    })
    return () => { void window.ndDshDesign.freeformSetVisible(false).catch(() => undefined) }
  }, [active, onError])

  return <section className="flex h-full w-full min-h-0 min-w-0 flex-col bg-surface-0">
    {/* Native WebContentsView host — bounds-synced over CDP; keep this DOM stable. */}
    <div className="flex h-9 shrink-0 min-w-0 items-center justify-between gap-3 border-b border-border-soft bg-secondary px-2">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className={cn(
          'block size-[7px] shrink-0 rounded-full',
          state.status === 'ready' ? 'bg-primary' : state.status === 'starting' ? 'bg-warning' : 'bg-destructive',
        )} />
        <strong className="max-w-[300px] truncate text-xs font-bold text-strong">{state.documentName}</strong>
        {state.dirty ? <b className="text-[11px] text-warning">●</b> : null}
        <small className="text-[11px] text-faint">ND Pencil</small>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-[7px]">
        <span className="text-[11px] text-faint">{state.version ? `ND Pencil engine ${state.version}` : 'ND Pencil'}</span>
        <button
          className="h-6 rounded-[5px] border border-border-strong bg-secondary px-2 text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
          disabled={busy !== null || state.status !== 'ready' || !state.dirty}
          onClick={onSave}
        >
          {busy === 'freeform:save' ? 'Saving…' : 'Save'}
        </button>
        <button
          className="h-6 rounded-[5px] border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary transition-colors hover:bg-primary/[0.16] disabled:pointer-events-none disabled:opacity-45"
          disabled={state.status !== 'ready'}
          onClick={onBuild}
        >
          Build this
        </button>
        <button
          className="h-6 rounded-[5px] border border-border-strong bg-secondary px-2 text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
          disabled={busy !== null}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-0" ref={surfaceRef}>
      <div className="m-auto flex flex-col items-center gap-[9px] text-xs text-faint">
        {state.status === 'starting' ? <div className="size-5 animate-spin rounded-full border border-border-strong border-t-primary" /> : null}
        <span>{state.status === 'starting' ? 'Starting ND Pencil canvas…' : state.error ?? 'ND Pencil canvas'}</span>
      </div>
    </div>
  </section>
}

function FreeformInspector({ state, project, onBuild }: { state: DesignFreeformState | null; project: DesignProjectState | null; onBuild(): void }) {
  return <>
    <section className="flex flex-col gap-0 border-b border-border-soft px-3.5 pt-2.5">
      <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">ND Pencil</header>
      <Property label="Engine" value="ND Pencil · built in" />
      <Property label="Status" value={state?.status ?? 'loading'} />
      {state?.documentPath ? <Property label="Document" value={state.documentPath} /> : null}
      <Property label="Saved" value={state?.dirty ? 'Unsaved changes' : 'Up to date'} />
      <Property label="Files" value={String(project?.freeform.documents.length ?? 0)} />
    </section>
    {state?.documentPath ? (
      <section className="flex flex-col gap-1.5 border-b border-border-soft px-3.5 py-3">
        <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Handoff</header>
        <button className={primaryButton} onClick={onBuild}>Build ND Pencil into live app</button>
        <p className="m-0 mt-0.5 text-[11px]/[1.55] text-faint">The .op document remains a design artifact. ND builds the selected concept into the project's real HTML/React/shadcn source.</p>
      </section>
    ) : null}
  </>
}

function WorkspaceEmpty({ workspace, onChoose }: { workspace: WorkspaceState | null; onChoose(): void }) {
  return <div className="mx-auto my-auto flex w-[min(520px,calc(100%-48px))] flex-col items-center text-center">
    <div className="grid size-[54px] place-items-center rounded-[14px] border border-primary/30 bg-primary/10 text-lg font-black tracking-[0.08em] text-primary">ND</div>
    <h2 className="mb-[5px] mt-3.5 text-[22px] font-bold text-strong">{workspace?.binding === 'missing' ? 'Project workspace unavailable' : 'Link this project to a workspace'}</h2>
    <p className="mb-3.5 max-w-[460px] text-sm/[1.55] text-muted-foreground">{workspace?.warning ?? 'Design Mode always follows the active project workspace. Select the project folder to continue.'}</p>
    <button className={cn(primaryButton, 'px-3.5')} onClick={onChoose}>Select workspace</button>
  </div>
}

function TemplateSurface({ project, busy, onPreview, onUse }: { project: DesignProjectState | null; busy: string | null; onPreview(template: DesignTemplateEntry): void; onUse(template: DesignTemplateEntry): void }) {
  const templates = project?.templates ?? []
  return <div className="h-full w-full min-h-0 min-w-0 overflow-auto bg-surface-0 p-7 max-[1180px]:p-5">
    <header className="mx-auto mb-[22px] flex max-w-[980px] items-start justify-between gap-6">
      <div className="min-w-0">
        <small className="mb-[7px] block text-[11px] font-extrabold tracking-[0.12em] text-primary">HTML & TEMPLATE SOURCES</small>
        <h2 className="m-0 text-[26px] font-bold tracking-tight text-strong">Use existing markup as the design.</h2>
        <p className="mt-[7px] max-w-[660px] text-sm/[1.6] text-muted-foreground">Plain HTML runs in ND's loopback preview. Server-side templates stay source-first and are handed to the agent/project runtime.</p>
      </div>
      <span className="shrink-0 rounded-full border border-border-soft bg-sidebar px-2 py-[5px] text-[11px] text-faint">{templates.length} found</span>
    </header>
    {templates.length ? <div className="mx-auto grid max-w-[980px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
      {templates.map((template) => <SourceCard
        key={template.path}
        icon={template.kind === 'html' ? 'HTML' : 'TPL'}
        name={template.name}
        path={template.path}
        note={template.previewable ? 'Static preview + inspect' : `${template.kind} · project runtime`}
        actionLabel={busy === `template:${template.path}` ? 'Opening…' : 'Preview'}
        actionDisabled={busy !== null}
        onAction={() => onPreview(template)}
        secondaryLabel="Use with Agent"
        onSecondary={() => onUse(template)}
      />)}
    </div> : <SurfaceEmpty title="No HTML templates found" text="Create or add HTML, EJS, Handlebars, Nunjucks, or Liquid files in this workspace. Design Mode will index them automatically." />}
  </div>
}

function ShadcnSurface({ project, onUse, onAgent }: { project: DesignProjectState | null; onUse(component: DesignComponentEntry): void; onAgent(prompt: string): void }) {
  const shadcn = project?.shadcn
  return <div className="h-full w-full min-h-0 min-w-0 overflow-auto bg-surface-0 p-7 max-[1180px]:p-5">
    <header className="mx-auto mb-[22px] flex max-w-[980px] items-start justify-between gap-6">
      <div className="min-w-0">
        <small className="mb-[7px] block text-[11px] font-extrabold tracking-[0.12em] text-primary">SHADCN DESIGN LIBRARY</small>
        <h2 className="m-0 text-[26px] font-bold tracking-tight text-strong">{shadcn?.detected ? 'Project components are source assets.' : 'shadcn is not initialized yet.'}</h2>
        <p className="mt-[7px] max-w-[660px] text-sm/[1.6] text-muted-foreground">ND indexes installed components from the active workspace. Using one composes the real component instead of exporting fake canvas code.</p>
      </div>
      <span className="shrink-0 rounded-full border border-border-soft bg-sidebar px-2 py-[5px] text-[11px] text-faint">{shadcn?.components.length ?? 0} components</span>
    </header>
    {shadcn?.detected ? <>
      <div className="mx-auto mb-3.5 flex max-w-[980px] flex-wrap gap-[7px]">
        <span className="rounded-md border border-border-soft bg-sidebar px-2 py-1.5 text-[11px] text-faint">Config <code className="text-soft">{shadcn.configPath ?? 'inferred'}</code></span>
        {shadcn.style ? <span className="rounded-md border border-border-soft bg-sidebar px-2 py-1.5 text-[11px] text-faint">Style <code className="text-soft">{shadcn.style}</code></span> : null}
        {shadcn.baseColor ? <span className="rounded-md border border-border-soft bg-sidebar px-2 py-1.5 text-[11px] text-faint">Base <code className="text-soft">{shadcn.baseColor}</code></span> : null}
      </div>
      {shadcn.components.length ? <div className="mx-auto grid max-w-[980px] grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
        {shadcn.components.map((component) => (
          <button
            key={component.path}
            className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-lg border border-border-soft bg-sidebar p-[9px] text-left text-foreground transition-colors hover:border-primary/20 hover:bg-accent"
            onClick={() => onUse(component)}
          >
            <span className="grid size-[34px] place-items-center rounded-[7px] border border-border-strong bg-surface-0 text-[11px] font-black text-faint">UI</span>
            <div className="flex min-w-0 flex-col gap-[3px]">
              <strong className="text-sm">{component.name}</strong>
              <code className="truncate text-[10px] text-faint">{component.path}</code>
            </div>
            <b className="text-[11px] font-bold text-primary">Use</b>
          </button>
        ))}
      </div> : <SurfaceEmpty title="No installed UI components found" text="The shadcn config exists, but no components/ui source files were detected." />}
    </> : <div className="mx-auto flex max-w-[760px] flex-col items-center gap-3">
      <SurfaceEmpty title="Start a shadcn project from the canvas" text="shadcn belongs inside the active project so source code remains the single source of truth." />
      <LargeActionButton onClick={() => onAgent('Inspect the active workspace and set up shadcn/ui only if it is compatible with the existing stack. Keep generated components inside the project, preserve existing conventions, then build a minimal page and verify it in Design Mode.')}>Set up with Agent</LargeActionButton>
    </div>}
  </div>
}

function CodeCanvas({ project, onAgent }: { project: DesignProjectState | null; onAgent(prompt: string): void }) {
  return <div className="flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-center overflow-auto bg-surface-0 p-7 max-[1180px]:p-5">
    <div className="mx-auto flex max-w-[700px] flex-col items-center text-center">
      <div className="mb-3.5 grid size-[54px] place-items-center rounded-[14px] border border-primary/30 bg-primary/10 text-lg font-black tracking-[0.08em] text-primary">+</div>
      <small className="mb-[7px] block text-[11px] font-extrabold tracking-[0.12em] text-primary">CODE-FIRST CANVAS</small>
      <h2 className="m-0 text-[26px] font-bold tracking-tight text-strong">Start visually. Ship real source.</h2>
      <p className="mt-[7px] max-w-[660px] text-sm/[1.6] text-muted-foreground">This is the production path. ND asks the agent to create the first working screen directly in this workspace, then the live runtime becomes the editable canvas.</p>
    </div>
    <div className="mt-6 grid w-[min(720px,100%)] grid-cols-[repeat(2,minmax(210px,1fr))] gap-2.5 max-[1180px]:grid-cols-1">
      <StarterTile glyph="HTML" title="Static HTML canvas" detail="Real markup + CSS" onClick={() => onAgent('Create a polished static HTML design canvas in the active workspace using real index.html/CSS/JS files. Keep it production-quality, start a preview that Design Mode can inspect, and do not create a detached mockup format.')} />
      <StarterTile glyph="RE" title="React canvas" detail="Components + live runtime" onClick={() => onAgent('Inspect the active workspace. If it is empty, create a minimal React + Vite application; otherwise preserve the existing compatible React stack. Build the first polished responsive screen in real source files, run the dev server, and verify it in Design Mode.')} />
      <StarterTile glyph="UI" title="shadcn canvas" detail="Real project components" onClick={() => onAgent('Inspect the active workspace and create a shadcn/ui design canvas using the project stack. Initialize shadcn only when compatible, use real installed components and CSS variables, build a polished first screen, run it, and verify it in Design Mode.')} />
      <StarterTile glyph="ND" title="Existing stack" detail="Detect + preserve project" onClick={() => onAgent(`Use the active project's existing stack (${project?.frameworks.join(', ') || 'detect it first'}) as the design canvas. Build a polished first screen directly in production source, preserve conventions and dependencies, start the project runtime, and verify it in Design Mode.`)} />
    </div>
  </div>
}

function StarterTile({ glyph, title, detail, onClick }: { glyph: string; title: string; detail: string; onClick(): void }) {
  return (
    <button
      className="grid min-h-[76px] grid-cols-[36px_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-2.5 gap-y-0.5 rounded-[10px] border border-border-soft bg-sidebar p-3 text-left text-foreground transition-colors hover:border-primary/20 hover:bg-accent"
      onClick={onClick}
    >
      <b className="col-start-1 row-span-2 row-start-1 grid size-9 place-items-center self-center rounded-lg border border-primary/20 bg-primary/[0.06] text-xs text-primary">{glyph}</b>
      <strong className="col-start-2 row-start-2 self-end text-sm">{title}</strong>
      <span className="col-start-2 row-start-1 self-start text-[11px] text-faint">{detail}</span>
    </button>
  )
}

function SourceCard({ icon, name, path, note, actionLabel, actionDisabled, onAction, secondaryLabel, onSecondary }: {
  icon: string
  name: string
  path: string
  note: string
  actionLabel: string
  actionDisabled: boolean
  onAction(): void
  secondaryLabel?: string
  onSecondary?(): void
}) {
  return (
    <article className="flex min-h-[170px] min-w-0 flex-col rounded-[10px] border border-border-soft bg-sidebar p-[13px]">
      <div className="mb-3 grid h-[30px] w-[38px] place-items-center rounded-[7px] border border-primary/20 bg-primary/[0.06] text-[11px] font-black tracking-[0.05em] text-primary">{icon}</div>
      <strong className="text-[15px] font-bold text-strong">{name}</strong>
      <code className="mt-1 truncate text-[11px] text-faint">{path}</code>
      <small className="mt-[7px] text-[11px] text-muted-foreground">{note}</small>
      <footer className="mt-auto flex gap-1.5 pt-3">
        <button
          className="h-[27px] rounded-md border border-primary/30 bg-primary/10 px-[9px] text-[11px] text-primary transition-colors hover:bg-primary/[0.16] disabled:pointer-events-none disabled:opacity-50"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button
            className="h-[27px] rounded-md border border-border-strong bg-secondary px-[9px] text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        ) : null}
      </footer>
    </article>
  )
}

function ProjectInspector({ project, surface }: { project: DesignProjectState | null; surface: DesignSurface }) {
  if (!project) return <div className="px-3.5 py-[18px] text-xs/[1.55] text-faint">Design Mode is indexing the active workspace.</div>
  return <>
    <section className="flex flex-col gap-0 border-b border-border-soft px-3.5 pt-2.5">
      <header className="mb-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">Project design index</header>
      <Property label="Mode" value={project.kind} />
      <Property label="Stack" value={project.frameworks.join(', ') || 'No framework detected'} />
      <Property label="Templates" value={String(project.templates.length)} />
      <Property label="shadcn" value={project.shadcn.detected ? `${project.shadcn.components.length} components` : 'Not detected'} />
      <Property label="ND Pencil" value={`${project.freeform.documents.length} .op documents`} />
    </section>
    <div className="px-3.5 py-[18px] text-xs/[1.55] text-faint">{surface === 'live' ? 'Select an element in the live canvas to attach component, source, CSS, and runtime context.' : 'This source is indexed from the active workspace. Production changes still go through real project files.'}</div>
  </>
}

function SurfaceEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto my-11 max-w-[720px] rounded-[10px] border border-dashed border-border-strong bg-sidebar p-6 text-center">
      <strong className="text-base font-bold text-strong">{title}</strong>
      <p className="mx-auto mt-[7px] max-w-[580px] text-xs/[1.6] text-muted-foreground">{text}</p>
    </div>
  )
}

function LargeActionButton({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button
      className="h-8 rounded-md border border-primary/30 bg-primary/10 px-3.5 text-xs text-primary transition-colors hover:bg-primary/[0.16]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-2 border-b border-border-soft py-1.5 last:border-b-0">
      <span className="text-[11px] capitalize text-faint">{label}</span>
      <code className="[overflow-wrap:anywhere] text-[11px]/[1.4] text-soft">{value}</code>
    </div>
  )
}

function initialSurface(project: DesignProjectState, browser: BrowserState | null): DesignSurface {
  if (project.kind === 'canvas' && project.freeform.documents.length > 0) return 'freeform'
  if (project.capabilities.liveApp || (browser?.url && browser.url !== 'about:blank')) return 'live'
  if (project.templates.length > 0) return 'templates'
  if (project.shadcn.detected) return 'library'
  return 'canvas'
}

function nextFreeformPath(project: DesignProjectState | null): string {
  const paths = new Set(project?.freeform.documents.map((document) => document.path) ?? [])
  if (!paths.has('.nd/design/home.op')) return '.nd/design/home.op'
  let index = 2
  while (paths.has(`.nd/design/design-${index}.op`)) index += 1
  return `.nd/design/design-${index}.op`
}

function projectLabel(project: DesignProjectState): string {
  if (project.kind === 'shadcn') return `shadcn · ${project.frameworks.join(' + ') || 'web'}`
  if (project.frameworks.length) return project.frameworks.join(' + ')
  if (project.templates.length) return `${project.templates.length} template${project.templates.length === 1 ? '' : 's'}`
  if (project.freeform.documents.length) return `${project.freeform.documents.length} ND Pencil design${project.freeform.documents.length === 1 ? '' : 's'}`
  return 'Code canvas ready'
}

function surfaceTitle(surface: DesignSurface): string {
  if (surface === 'templates') return 'Template source'
  if (surface === 'library') return 'Component library'
  if (surface === 'canvas') return 'Code canvas'
  if (surface === 'freeform') return 'ND Pencil canvas'
  return 'Nothing selected'
}

function inspectorSubtitle(surface: DesignSurface, freeform: DesignFreeformState | null): string {
  if (surface === 'freeform') return freeform?.documentPath ?? 'Open or create an ND Pencil design'
  return 'Source of truth: active workspace'
}

function designSurfaceContext(surface: DesignSurface, project: DesignProjectState | null, freeform: DesignFreeformState | null): string {
  if (surface === 'templates') return '\n\nDesign source: the active workspace HTML/template library. Work from existing templates and edit real source files.'
  if (surface === 'library') return '\n\nDesign source: the active project shadcn/component library. Reuse installed components rather than recreating them visually.'
  if (surface === 'canvas') return `\n\nDesign source: code-first canvas. Detect the project stack (${project?.frameworks.join(', ') || 'currently unknown'}) and create/edit real production source; make the running app the canvas.`
  if (surface === 'freeform') return `\n\nDesign source: ND Pencil Freeform.${freeform?.documentPath ? ` Active .op document: ${freeform.documentPath}.` : ''} Treat .op as exploratory design intent unless I explicitly ask to build it into production source.`
  return '\n\nDesign source: the live running application. Edit real source and verify the result in the runtime.'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
