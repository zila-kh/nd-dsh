import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'
import type {
  DesignComponentEntry,
  DesignFreeformDocumentEntry,
  DesignFreeformState,
  DesignProjectState,
  DesignTemplateEntry,
} from '../../../shared/design'
import { BrowserPane } from './BrowserPane'

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
      void window.ndDshDesign.freeformSetVisible(false)
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
      onAskAgent(`Build the OpenPencil Freeform design at ${path} into the active project's real application source. Treat the .op document as design intent, reuse existing project components and shadcn/ui where possible, preserve design tokens and accessibility, start or reuse the project runtime, and verify the result in Design Mode. Do not replace production source with a detached generated mockup.`)
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

  return (
    <div className="design-shell">
      <aside className="design-left-panel">
        <div className="design-panel-heading">
          <small>DESIGN</small>
          <strong>{workspace?.projectName ?? workspace?.name ?? 'No project'}</strong>
          <span>{project ? projectLabel(project) : workspace?.companyName ?? 'Standalone workspace'}</span>
        </div>

        <section className="design-section design-source-switcher">
          <header>Design sources</header>
          <button className={surface === 'live' ? 'active' : ''} onClick={() => setSurface('live')}>
            <span>Live app</span><b>{project?.capabilities.liveApp ? 'APP' : browser?.url && browser.url !== 'about:blank' ? 'URL' : '—'}</b>
          </button>
          <button className={surface === 'templates' ? 'active' : ''} onClick={() => setSurface('templates')}>
            <span>HTML / templates</span><b>{project?.templates.length ?? 0}</b>
          </button>
          <button className={surface === 'library' ? 'active' : ''} onClick={() => setSurface('library')}>
            <span>shadcn library</span><b>{project?.shadcn.components.length ?? 0}</b>
          </button>
          <button className={surface === 'canvas' ? 'active' : ''} onClick={() => setSurface('canvas')}>
            <span>Code canvas</span><b>NEW</b>
          </button>
          <button className={surface === 'freeform' ? 'active' : ''} onClick={() => setSurface('freeform')}>
            <span>Freeform</span><b>{project?.freeform.documents.length ?? 0}</b>
          </button>
          <button className="design-refresh" disabled={busy === 'scan' || bindingBlocked} onClick={() => void refreshProject()}>
            {busy === 'scan' ? 'Scanning…' : 'Refresh project index'}
          </button>
        </section>

        <section className="design-section">
          <header>AI design actions</header>
          {surface === 'freeform' && freeform?.documentPath ? <>
            <button onClick={() => void buildFreeform()}>Build Freeform into app</button>
            <button onClick={() => onAskAgent(`Review the OpenPencil design at ${freeform.documentPath} for layout consistency, hierarchy, accessibility, and design-system reuse. Improve the .op design while keeping it a Freeform artifact; do not change production application code unless I ask.`)}>Improve Freeform</button>
          </> : <>
            <button disabled={!selected} onClick={() => selected && onAskAgent('Improve the selected UI while preserving the project design language. Edit the real source and verify the result in Design Mode.')}>Improve selected</button>
            <button disabled={!selected} onClick={() => selected && onAskAgent('Make the selected UI responsive and verify it at mobile, tablet, and desktop widths.')}>Make responsive</button>
            <button disabled={!selected} onClick={() => selected && onAskAgent('Review the selected UI for accessibility, layout, and interaction problems, then fix them in the real source.')}>Fix accessibility</button>
          </>}
        </section>

        <section className="design-section">
          <header>Project context</header>
          <div className={`design-binding ${workspace?.binding ?? 'standalone'}`}>
            <strong>{workspace?.binding === 'project' ? 'Project workspace linked' : workspace?.binding === 'missing' ? 'Workspace missing' : workspace?.binding === 'unlinked' ? 'Workspace not linked' : 'Standalone workspace'}</strong>
            <span>{workspace?.projectWorkspacePath ?? workspace?.root ?? 'Select a workspace'}</span>
          </div>
          {surface === 'freeform' ? <div className={`design-runtime-hint ${freeform?.available ? 'ready' : 'missing'}`}><span>Freeform engine</span><code>{freeform?.available ? `OpenPencil ${freeform.version ?? 'built in'}` : 'OpenPencil unavailable'}</code></div> : null}
          {project?.devCommand ? <>
            <div className="design-runtime-hint"><span>Dev runtime</span><code>{project.devCommand}</code></div>
            <button className="design-primary" disabled={busy !== null} onClick={() => void startDevPreview()}>{busy === 'dev' ? 'Starting runtime…' : project.preview?.kind === 'dev-server' ? 'Restart dev preview' : 'Start dev preview'}</button>
          </> : null}
          {project?.preview ? <>
            <div className="design-runtime-hint"><span>Managed preview</span><code>{project.preview.kind === 'static-html' ? project.preview.templatePath ?? 'HTML' : project.preview.url}</code></div>
            <button disabled={busy !== null} onClick={() => void stopManagedPreview()}>{busy === 'stop' ? 'Stopping…' : 'Stop managed preview'}</button>
          </> : null}
          {bindingBlocked ? <button className="design-primary" onClick={() => void chooseWorkspace()}>Select workspace</button> : null}
        </section>

        <form className="design-prompt" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={selected ? 'Ask AI to change the selected UI…' : surface === 'canvas' ? 'Describe what to create on the code canvas…' : surface === 'freeform' ? 'Ask ND about this Freeform design…' : 'Describe the design change…'}
          />
          <button disabled={!prompt.trim() || bindingBlocked || harness?.state === 'running'}>Open in Agent</button>
        </form>
      </aside>

      <main className={`design-canvas design-surface-${surface}`}>
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

      <aside className="design-inspector">
        <div className="design-panel-heading">
          <small>INSPECTOR</small>
          <strong>{selected?.react?.component ?? selected?.tagName ?? surfaceTitle(surface)}</strong>
          <span>{source ? `${source.file}:${source.line}` : selected ? selected.selector : inspectorSubtitle(surface, freeform)}</span>
        </div>
        {selected ? (
          <>
            <section className="design-section design-properties">
              <header>Runtime</header>
              <Property label="Element" value={selected.tagName} />
              <Property label="Selector" value={selected.selector} />
              <Property label="Size" value={`${Math.round(selected.bounds.width)} × ${Math.round(selected.bounds.height)}`} />
              {selected.react?.hierarchy.length ? <Property label="React" value={selected.react.hierarchy.join(' › ')} /> : null}
            </section>
            <section className="design-section design-properties">
              <header>Layout & style</header>
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
    return <div className="design-browser-surface">
      <header className="design-surface-header"><div><small>FREEFORM · OPENPENCIL</small><h2>The Freeform engine is bundled with ND.</h2><p>In a source checkout the pinned runtime must be compiled once. Distributed ND builds package it automatically; users do not install OpenPencil separately.</p></div><span>ENGINE</span></header>
      <SurfaceEmpty title="OpenPencil runtime is not built" text={state?.error ?? 'Build the pinned runtime to enable the editable vector canvas.'} />
      <div className="design-command-card"><code>pnpm openpencil:build</code></div>
    </div>
  }

  if (state.documentPath) {
    return <OpenPencilPane active={active} state={state} busy={busy} onSave={onSave} onClose={onClose} onBuild={onBuild} onError={onError} />
  }

  const documents = project?.freeform.documents ?? []
  return <div className="design-browser-surface">
    <header className="design-surface-header">
      <div><small>FREEFORM · OPENPENCIL</small><h2>Explore visually before production code.</h2><p>Freeform documents are real versionable <code>.op</code> files inside this project. ND embeds the OpenPencil editor; no external app is launched.</p></div>
      <button className="design-header-action" disabled={busy !== null} onClick={onCreate}>{busy === 'freeform:new' ? 'Creating…' : 'New Freeform'}</button>
    </header>
    {documents.length ? <div className="design-card-grid">
      {documents.map((document) => <article className="design-source-card" key={document.path}>
        <div className="design-card-icon">OP</div>
        <strong>{document.name}</strong>
        <code>{document.path}</code>
        <small>OpenPencil · editable Freeform canvas</small>
        <footer><button disabled={busy !== null} onClick={() => onOpen(document)}>{busy === `freeform:${document.path}` ? 'Opening…' : 'Open canvas'}</button></footer>
      </article>)}
    </div> : <div className="design-empty-stack"><SurfaceEmpty title="No Freeform designs yet" text="Create one to sketch frames, layouts, flows, or visual alternatives without turning the design artifact into production source." /><button className="design-large-action" onClick={onCreate}>Create first Freeform</button></div>}
  </div>
}

function OpenPencilPane({ active, state, busy, onSave, onClose, onBuild, onError }: {
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
    })
    return () => { void window.ndDshDesign.freeformSetVisible(false) }
  }, [active])

  return <section className="openpencil-pane">
    <div className="openpencil-toolbar">
      <div className="openpencil-document"><span className={`openpencil-status ${state.status}`} /> <strong>{state.documentName}</strong>{state.dirty ? <b>●</b> : null}<small>Freeform</small></div>
      <div className="openpencil-actions">
        <span>{state.version ? `OpenPencil ${state.version}` : 'OpenPencil'}</span>
        <button disabled={busy !== null || state.status !== 'ready' || !state.dirty} onClick={onSave}>{busy === 'freeform:save' ? 'Saving…' : 'Save'}</button>
        <button className="design-primary" disabled={state.status !== 'ready'} onClick={onBuild}>Build this</button>
        <button disabled={busy !== null} onClick={onClose}>Close</button>
      </div>
    </div>
    <div className="openpencil-native-surface" ref={surfaceRef}>
      <div className="openpencil-placeholder">
        {state.status === 'starting' ? <div className="placeholder-ring" /> : null}
        <span>{state.status === 'starting' ? 'Starting ND Freeform canvas…' : state.error ?? 'OpenPencil canvas'}</span>
      </div>
    </div>
  </section>
}

function FreeformInspector({ state, project, onBuild }: { state: DesignFreeformState | null; project: DesignProjectState | null; onBuild(): void }) {
  return <>
    <section className="design-section design-properties">
      <header>Freeform</header>
      <Property label="Engine" value="OpenPencil · built in" />
      <Property label="Status" value={state?.status ?? 'loading'} />
      {state?.documentPath ? <Property label="Document" value={state.documentPath} /> : null}
      <Property label="Saved" value={state?.dirty ? 'Unsaved changes' : 'Up to date'} />
      <Property label="Files" value={String(project?.freeform.documents.length ?? 0)} />
    </section>
    {state?.documentPath ? <section className="design-section"><header>Handoff</header><button className="design-primary" onClick={onBuild}>Build Freeform into live app</button><p className="design-inspector-note">The .op document remains a design artifact. ND builds the selected concept into the project's real HTML/React/shadcn source.</p></section> : null}
  </>
}

function WorkspaceEmpty({ workspace, onChoose }: { workspace: WorkspaceState | null; onChoose(): void }) {
  return <div className="design-empty-state">
    <div className="design-empty-mark">ND</div>
    <h2>{workspace?.binding === 'missing' ? 'Project workspace unavailable' : 'Link this project to a workspace'}</h2>
    <p>{workspace?.warning ?? 'Design Mode always follows the active project workspace. Select the project folder to continue.'}</p>
    <button onClick={onChoose}>Select workspace</button>
  </div>
}

function TemplateSurface({ project, busy, onPreview, onUse }: { project: DesignProjectState | null; busy: string | null; onPreview(template: DesignTemplateEntry): void; onUse(template: DesignTemplateEntry): void }) {
  const templates = project?.templates ?? []
  return <div className="design-browser-surface">
    <header className="design-surface-header"><div><small>HTML & TEMPLATE SOURCES</small><h2>Use existing markup as the design.</h2><p>Plain HTML runs in ND's loopback preview. Server-side templates stay source-first and are handed to the agent/project runtime.</p></div><span>{templates.length} found</span></header>
    {templates.length ? <div className="design-card-grid">{templates.map((template) => <article className="design-source-card" key={template.path}>
      <div className="design-card-icon">{template.kind === 'html' ? 'HTML' : 'TPL'}</div><strong>{template.name}</strong><code>{template.path}</code><small>{template.previewable ? 'Static preview + inspect' : `${template.kind} · project runtime`}</small>
      <footer>{template.previewable ? <button disabled={busy !== null} onClick={() => onPreview(template)}>{busy === `template:${template.path}` ? 'Opening…' : 'Preview'}</button> : null}<button onClick={() => onUse(template)}>Use with Agent</button></footer>
    </article>)}</div> : <SurfaceEmpty title="No HTML templates found" text="Create or add HTML, EJS, Handlebars, Nunjucks, or Liquid files in this workspace. Design Mode will index them automatically." />}
  </div>
}

function ShadcnSurface({ project, onUse, onAgent }: { project: DesignProjectState | null; onUse(component: DesignComponentEntry): void; onAgent(prompt: string): void }) {
  const shadcn = project?.shadcn
  return <div className="design-browser-surface">
    <header className="design-surface-header"><div><small>SHADCN DESIGN LIBRARY</small><h2>{shadcn?.detected ? 'Project components are source assets.' : 'shadcn is not initialized yet.'}</h2><p>ND indexes installed components from the active workspace. Using one composes the real component instead of exporting fake canvas code.</p></div><span>{shadcn?.components.length ?? 0} components</span></header>
    {shadcn?.detected ? <>
      <div className="design-library-meta"><span>Config <code>{shadcn.configPath ?? 'inferred'}</code></span>{shadcn.style ? <span>Style <code>{shadcn.style}</code></span> : null}{shadcn.baseColor ? <span>Base <code>{shadcn.baseColor}</code></span> : null}</div>
      {shadcn.components.length ? <div className="design-component-grid">{shadcn.components.map((component) => <button className="design-component-card" key={component.path} onClick={() => onUse(component)}><span className="design-component-glyph">UI</span><div><strong>{component.name}</strong><code>{component.path}</code></div><b>Use</b></button>)}</div> : <SurfaceEmpty title="No installed UI components found" text="The shadcn config exists, but no components/ui source files were detected." />}
    </> : <div className="design-empty-stack"><SurfaceEmpty title="Start a shadcn project from the canvas" text="shadcn belongs inside the active project so source code remains the single source of truth." /><button className="design-large-action" onClick={() => onAgent('Inspect the active workspace and set up shadcn/ui only if it is compatible with the existing stack. Keep generated components inside the project, preserve existing conventions, then build a minimal page and verify it in Design Mode.')}>Set up with Agent</button></div>}
  </div>
}

function CodeCanvas({ project, onAgent }: { project: DesignProjectState | null; onAgent(prompt: string): void }) {
  return <div className="design-code-canvas">
    <div className="design-canvas-hero"><div className="design-empty-mark">+</div><small>CODE-FIRST CANVAS</small><h2>Start visually. Ship real source.</h2><p>This is the production path. ND asks the agent to create the first working screen directly in this workspace, then the live runtime becomes the editable canvas.</p></div>
    <div className="design-starter-grid">
      <button onClick={() => onAgent('Create a polished static HTML design canvas in the active workspace using real index.html/CSS/JS files. Keep it production-quality, start a preview that Design Mode can inspect, and do not create a detached mockup format.')}><b>HTML</b><strong>Static HTML canvas</strong><span>Real markup + CSS</span></button>
      <button onClick={() => onAgent('Inspect the active workspace. If it is empty, create a minimal React + Vite application; otherwise preserve the existing compatible React stack. Build the first polished responsive screen in real source files, run the dev server, and verify it in Design Mode.')}><b>RE</b><strong>React canvas</strong><span>Components + live runtime</span></button>
      <button onClick={() => onAgent('Inspect the active workspace and create a shadcn/ui design canvas using the project stack. Initialize shadcn only when compatible, use real installed components and CSS variables, build a polished first screen, run it, and verify it in Design Mode.')}><b>UI</b><strong>shadcn canvas</strong><span>Real project components</span></button>
      <button onClick={() => onAgent(`Use the active project's existing stack (${project?.frameworks.join(', ') || 'detect it first'}) as the design canvas. Build a polished first screen directly in production source, preserve conventions and dependencies, start the project runtime, and verify it in Design Mode.`)}><b>ND</b><strong>Existing stack</strong><span>Detect + preserve project</span></button>
    </div>
  </div>
}

function ProjectInspector({ project, surface }: { project: DesignProjectState | null; surface: DesignSurface }) {
  if (!project) return <div className="design-inspector-empty">Design Mode is indexing the active workspace.</div>
  return <>
    <section className="design-section design-properties"><header>Project design index</header><Property label="Mode" value={project.kind} /><Property label="Stack" value={project.frameworks.join(', ') || 'No framework detected'} /><Property label="Templates" value={String(project.templates.length)} /><Property label="shadcn" value={project.shadcn.detected ? `${project.shadcn.components.length} components` : 'Not detected'} /><Property label="Freeform" value={`${project.freeform.documents.length} .op documents`} /></section>
    <div className="design-inspector-empty">{surface === 'live' ? 'Select an element in the live canvas to attach component, source, CSS, and runtime context.' : 'This source is indexed from the active workspace. Production changes still go through real project files.'}</div>
  </>
}

function SurfaceEmpty({ title, text }: { title: string; text: string }) {
  return <div className="design-surface-empty"><strong>{title}</strong><p>{text}</p></div>
}

function Property({ label, value }: { label: string; value: string }) {
  return <div className="design-property"><span>{label}</span><code>{value}</code></div>
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
  if (project.freeform.documents.length) return `${project.freeform.documents.length} Freeform design${project.freeform.documents.length === 1 ? '' : 's'}`
  return 'Code canvas ready'
}

function surfaceTitle(surface: DesignSurface): string {
  if (surface === 'templates') return 'Template source'
  if (surface === 'library') return 'Component library'
  if (surface === 'canvas') return 'Code canvas'
  if (surface === 'freeform') return 'Freeform canvas'
  return 'Nothing selected'
}

function inspectorSubtitle(surface: DesignSurface, freeform: DesignFreeformState | null): string {
  if (surface === 'freeform') return freeform?.documentPath ?? 'Open or create a Freeform design'
  return 'Source of truth: active workspace'
}

function designSurfaceContext(surface: DesignSurface, project: DesignProjectState | null, freeform: DesignFreeformState | null): string {
  if (surface === 'templates') return '\n\nDesign source: the active workspace HTML/template library. Work from existing templates and edit real source files.'
  if (surface === 'library') return '\n\nDesign source: the active project shadcn/component library. Reuse installed components rather than recreating them visually.'
  if (surface === 'canvas') return `\n\nDesign source: code-first canvas. Detect the project stack (${project?.frameworks.join(', ') || 'currently unknown'}) and create/edit real production source; make the running app the canvas.`
  if (surface === 'freeform') return `\n\nDesign source: ND Freeform powered by the bundled OpenPencil engine.${freeform?.documentPath ? ` Active .op document: ${freeform.documentPath}.` : ''} Treat .op as exploratory design intent unless I explicitly ask to build it into production source.`
  return '\n\nDesign source: the live running application. Edit real source and verify the result in the runtime.'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
