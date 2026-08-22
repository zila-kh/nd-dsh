import { useEffect, useState, type FormEvent } from 'react'
import type { BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'
import type { DesignComponentEntry, DesignProjectState, DesignTemplateEntry } from '../../../shared/design'
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

type DesignSurface = 'live' | 'templates' | 'library' | 'canvas'

export function DesignView({ active, workspace, browser, harness, onWorkspaceChanged, onAskAgent, onError }: DesignViewProps) {
  const [prompt, setPrompt] = useState('')
  const [project, setProject] = useState<DesignProjectState | null>(null)
  const [surface, setSurface] = useState<DesignSurface>('live')
  const [busy, setBusy] = useState<string | null>(null)
  const selected = browser?.selectedTarget
  const source = selected?.source ?? selected?.react?.source
  const bindingBlocked = workspace?.binding === 'unlinked' || workspace?.binding === 'missing'

  useEffect(() => {
    if (!active || bindingBlocked) return
    let mounted = true
    setBusy('scan')
    void window.ndDshDesign.refresh()
      .then((state) => {
        if (!mounted) return
        setProject(state)
        setSurface(initialSurface(state, browser))
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
      const state = await window.ndDshDesign.refresh()
      setProject(state)
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

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text) return
    const context = selected
      ? `\n\nSelected UI: ${selected.react?.component ?? selected.tagName}${source ? ` at ${source.file}:${source.line}` : ''}.`
      : designSurfaceContext(surface, project)
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
          <button className="design-refresh" disabled={busy === 'scan' || bindingBlocked} onClick={() => void refreshProject()}>
            {busy === 'scan' ? 'Scanning…' : 'Refresh project index'}
          </button>
        </section>

        <section className="design-section">
          <header>AI design actions</header>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Improve the selected UI while preserving the project design language. Edit the real source and verify the result in Design Mode.')}>Improve selected</button>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Make the selected UI responsive and verify it at mobile, tablet, and desktop widths.')}>Make responsive</button>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Review the selected UI for accessibility, layout, and interaction problems, then fix them in the real source.')}>Fix accessibility</button>
        </section>

        <section className="design-section">
          <header>Project context</header>
          <div className={`design-binding ${workspace?.binding ?? 'standalone'}`}>
            <strong>{workspace?.binding === 'project' ? 'Project workspace linked' : workspace?.binding === 'missing' ? 'Workspace missing' : workspace?.binding === 'unlinked' ? 'Workspace not linked' : 'Standalone workspace'}</strong>
            <span>{workspace?.projectWorkspacePath ?? workspace?.root ?? 'Select a workspace'}</span>
          </div>
          {project?.devCommand ? <div className="design-runtime-hint"><span>Dev runtime</span><code>{project.devCommand}</code></div> : null}
          {bindingBlocked ? <button className="design-primary" onClick={() => void chooseWorkspace()}>Select workspace</button> : null}
        </section>

        <form className="design-prompt" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={selected ? 'Ask AI to change the selected UI…' : surface === 'canvas' ? 'Describe what to create on the code canvas…' : 'Describe the design change…'}
          />
          <button disabled={!prompt.trim() || bindingBlocked || harness?.state === 'running'}>Open in Agent</button>
        </form>
      </aside>

      <main className={`design-canvas design-surface-${surface}`}>
        {bindingBlocked ? (
          <WorkspaceEmpty workspace={workspace} onChoose={() => void chooseWorkspace()} />
        ) : surface === 'live' ? (
          <BrowserPane
            active={active}
            state={browser}
            onSnapshot={() => undefined}
            onError={onError}
          />
        ) : surface === 'templates' ? (
          <TemplateSurface
            project={project}
            busy={busy}
            onPreview={(template) => void previewTemplate(template)}
            onUse={(template) => onAskAgent(`Use ${template.path} as the active design template. Inspect its HTML/template structure and related styles/scripts, then implement the requested product UI by editing the real workspace files. Preserve the template's useful visual language, make it production-ready, and verify the result in Design Mode.`)}
          />
        ) : surface === 'library' ? (
          <ShadcnSurface project={project} onUse={useComponent} onAgent={onAskAgent} />
        ) : (
          <CodeCanvas project={project} onAgent={onAskAgent} />
        )}
      </main>

      <aside className="design-inspector">
        <div className="design-panel-heading">
          <small>INSPECTOR</small>
          <strong>{selected?.react?.component ?? selected?.tagName ?? surfaceTitle(surface)}</strong>
          <span>{source ? `${source.file}:${source.line}` : selected ? selected.selector : 'Source of truth: active workspace'}</span>
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
        ) : (
          <ProjectInspector project={project} surface={surface} />
        )}
      </aside>
    </div>
  )
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
    <header className="design-surface-header">
      <div><small>HTML & TEMPLATE SOURCES</small><h2>Use existing markup as the design.</h2><p>Plain HTML runs in ND's loopback preview. Server-side templates stay source-first and are handed to the agent/project runtime.</p></div>
      <span>{templates.length} found</span>
    </header>
    {templates.length ? <div className="design-card-grid">
      {templates.map((template) => <article className="design-source-card" key={template.path}>
        <div className="design-card-icon">{template.kind === 'html' ? 'HTML' : 'TPL'}</div>
        <strong>{template.name}</strong>
        <code>{template.path}</code>
        <small>{template.previewable ? 'Static preview + inspect' : `${template.kind} · project runtime`}</small>
        <footer>
          {template.previewable ? <button disabled={busy !== null} onClick={() => onPreview(template)}>{busy === `template:${template.path}` ? 'Opening…' : 'Preview'}</button> : null}
          <button onClick={() => onUse(template)}>Use with Agent</button>
        </footer>
      </article>)}
    </div> : <SurfaceEmpty title="No HTML templates found" text="Create or add HTML, EJS, Handlebars, Nunjucks, or Liquid files in this workspace. Design Mode will index them automatically." />}
  </div>
}

function ShadcnSurface({ project, onUse, onAgent }: { project: DesignProjectState | null; onUse(component: DesignComponentEntry): void; onAgent(prompt: string): void }) {
  const shadcn = project?.shadcn
  return <div className="design-browser-surface">
    <header className="design-surface-header">
      <div><small>SHADCN DESIGN LIBRARY</small><h2>{shadcn?.detected ? 'Project components are source assets.' : 'shadcn is not initialized yet.'}</h2><p>ND indexes installed components from the active workspace. Using one asks the agent to compose the real component instead of exporting fake canvas code.</p></div>
      <span>{shadcn?.components.length ?? 0} components</span>
    </header>
    {shadcn?.detected ? <>
      <div className="design-library-meta">
        <span>Config <code>{shadcn.configPath ?? 'inferred'}</code></span>
        {shadcn.style ? <span>Style <code>{shadcn.style}</code></span> : null}
        {shadcn.baseColor ? <span>Base <code>{shadcn.baseColor}</code></span> : null}
        {shadcn.cssVariables !== undefined ? <span>CSS variables <code>{shadcn.cssVariables ? 'yes' : 'no'}</code></span> : null}
      </div>
      {shadcn.components.length ? <div className="design-component-grid">
        {shadcn.components.map((component) => <button className="design-component-card" key={component.path} onClick={() => onUse(component)}>
          <span className="design-component-glyph">UI</span><div><strong>{component.name}</strong><code>{component.path}</code></div><b>Use</b>
        </button>)}
      </div> : <SurfaceEmpty title="No installed UI components found" text="The shadcn config exists, but no components/ui source files were detected. Add components through your normal project workflow or ask the agent to do it." />}
    </> : <div className="design-empty-stack">
      <SurfaceEmpty title="Start a shadcn project from the canvas" text="ND will not install shadcn into the IDE itself. It belongs inside the active project so source code remains the single source of truth." />
      <button className="design-large-action" onClick={() => onAgent('Inspect the active workspace and set up shadcn/ui only if it is compatible with the existing stack. Keep all generated components inside the project, preserve existing conventions, then build a minimal page that proves the setup works and verify it in Design Mode.')}>Set up with Agent</button>
    </div>}
  </div>
}

function CodeCanvas({ project, onAgent }: { project: DesignProjectState | null; onAgent(prompt: string): void }) {
  return <div className="design-code-canvas">
    <div className="design-canvas-hero">
      <div className="design-empty-mark">+</div>
      <small>CODE-FIRST CANVAS</small>
      <h2>Start visually. Ship real files.</h2>
      <p>The canvas is a starting surface, not a second document format. Pick a base and the agent creates the implementation directly in this workspace; the result then becomes the live canvas.</p>
    </div>
    <div className="design-starter-grid">
      <button onClick={() => onAgent('Create a polished static HTML page in the active workspace using semantic index.html plus local CSS and JavaScript as needed. Treat the files as production source, make the layout responsive and accessible, and leave index.html ready for ND Design Mode static preview.')}> <b>HTML</b><strong>Static HTML canvas</strong><span>No build step · instant preview</span></button>
      <button onClick={() => onAgent('Create or extend a React + Vite UI in the active workspace. Reuse the existing package setup if present, keep components maintainable, make the page responsive and accessible, and ensure the project can be opened in ND Design Mode through its live dev runtime.')}> <b>RE</b><strong>React canvas</strong><span>Components + live runtime</span></button>
      <button onClick={() => onAgent('Create or extend the current UI using shadcn/ui as the component system. If shadcn is already configured, reuse it. If not, initialize it only when compatible with the existing project. Use real project components and tokens, not a parallel mockup, and verify the result in Design Mode.')}> <b>UI</b><strong>shadcn canvas</strong><span>Real components + tokens</span></button>
      <button onClick={() => onAgent('Inspect the active workspace and choose the most appropriate existing web stack. Build the requested interface directly in that stack without replacing established architecture. Treat the running app as the design canvas and verify the final UI visually.')}> <b>↗</b><strong>Use existing stack</strong><span>{project?.frameworks.join(' + ') || 'Auto-detect project'}</span></button>
    </div>
  </div>
}

function ProjectInspector({ project, surface }: { project: DesignProjectState | null; surface: DesignSurface }) {
  if (!project) return <div className="design-inspector-empty">Scanning the active workspace for design sources…</div>
  return <>
    <section className="design-section design-properties">
      <header>Project design index</header>
      <Property label="Mode" value={project.kind} />
      <Property label="Surface" value={surfaceTitle(surface)} />
      <Property label="Frameworks" value={project.frameworks.join(', ') || 'none detected'} />
      <Property label="Templates" value={String(project.templates.length)} />
      <Property label="shadcn" value={project.shadcn.detected ? `${project.shadcn.components.length} components` : 'not detected'} />
      <Property label="Canvas" value="available" />
    </section>
    <div className="design-inspector-empty">Use Live app to inspect runtime elements. HTML templates, shadcn components, and the code canvas all resolve back to this same workspace.</div>
  </>
}

function SurfaceEmpty({ title, text }: { title: string; text: string }) {
  return <div className="design-surface-empty"><strong>{title}</strong><p>{text}</p></div>
}

function Property({ label, value }: { label: string; value: string }) {
  return <div className="design-property"><span>{label}</span><code>{value}</code></div>
}

function initialSurface(project: DesignProjectState, browser: BrowserState | null): DesignSurface {
  if (browser?.url && browser.url !== 'about:blank') return 'live'
  if (project.templates.some((entry) => entry.previewable)) return 'templates'
  if (project.shadcn.detected) return 'library'
  return 'canvas'
}

function designSurfaceContext(surface: DesignSurface, project: DesignProjectState | null): string {
  if (surface === 'templates') return '\n\nDesign source: use the active workspace HTML/template files as the visual source of truth.'
  if (surface === 'library') return '\n\nDesign source: use the active project shadcn components and design tokens; do not create a parallel mock component system.'
  if (surface === 'canvas') return `\n\nDesign source: code-first canvas in ${project?.root ?? 'the active workspace'}. Create or edit real source files so the result can become the live runtime canvas.`
  return '\n\nDesign source: the running application is the visual canvas. Edit its real source files and verify changes in the runtime.'
}

function projectLabel(project: DesignProjectState): string {
  const framework = project.frameworks.join(' + ')
  if (project.shadcn.detected) return `shadcn${framework ? ` · ${framework}` : ''}`
  if (framework) return framework
  if (project.templates.length) return 'HTML / template project'
  return 'Code canvas workspace'
}

function surfaceTitle(surface: DesignSurface): string {
  if (surface === 'templates') return 'HTML templates'
  if (surface === 'library') return 'shadcn library'
  if (surface === 'canvas') return 'Code canvas'
  return 'Live app'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
