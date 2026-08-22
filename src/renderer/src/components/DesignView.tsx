import { useState, type FormEvent } from 'react'
import type { BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'
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

export function DesignView({ active, workspace, browser, harness, onWorkspaceChanged, onAskAgent, onError }: DesignViewProps) {
  const [prompt, setPrompt] = useState('')
  const selected = browser?.selectedTarget
  const source = selected?.source ?? selected?.react?.source
  const bindingBlocked = workspace?.binding === 'unlinked' || workspace?.binding === 'missing'

  const chooseWorkspace = async (): Promise<void> => {
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.pick())
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
      : ''
    onAskAgent(`${text}${context}`)
    setPrompt('')
  }

  return (
    <div className="design-shell">
      <aside className="design-left-panel">
        <div className="design-panel-heading">
          <small>DESIGN</small>
          <strong>{workspace?.projectName ?? workspace?.name ?? 'No project'}</strong>
          <span>{workspace?.companyName ?? 'Standalone workspace'}</span>
        </div>

        <section className="design-section">
          <header>AI design actions</header>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Improve the selected UI while preserving the project design language.')}>Improve selected</button>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Make the selected UI responsive and verify it at mobile, tablet, and desktop widths.')}>Make responsive</button>
          <button disabled={!selected} onClick={() => selected && onAskAgent('Review the selected UI for accessibility, layout, and interaction problems, then fix them.')}>Fix accessibility</button>
        </section>

        <section className="design-section">
          <header>Project context</header>
          <div className={`design-binding ${workspace?.binding ?? 'standalone'}`}>
            <strong>{workspace?.binding === 'project' ? 'Project workspace linked' : workspace?.binding === 'missing' ? 'Workspace missing' : workspace?.binding === 'unlinked' ? 'Workspace not linked' : 'Standalone workspace'}</strong>
            <span>{workspace?.projectWorkspacePath ?? workspace?.root ?? 'Select a workspace'}</span>
          </div>
          {bindingBlocked ? <button className="design-primary" onClick={() => void chooseWorkspace()}>Select workspace</button> : null}
        </section>

        <form className="design-prompt" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={selected ? 'Ask AI to change the selected UI…' : 'Describe the design change…'}
          />
          <button disabled={!prompt.trim() || bindingBlocked || harness?.state === 'running'}>Open in Agent</button>
        </form>
      </aside>

      <main className="design-canvas">
        {bindingBlocked ? (
          <div className="design-empty-state">
            <div className="design-empty-mark">ND</div>
            <h2>{workspace?.binding === 'missing' ? 'Project workspace unavailable' : 'Link this project to a workspace'}</h2>
            <p>{workspace?.warning ?? 'Design Mode always follows the active project workspace. Select the project folder to continue.'}</p>
            <button onClick={() => void chooseWorkspace()}>Select workspace</button>
          </div>
        ) : (
          <BrowserPane
            active={active}
            state={browser}
            onSnapshot={() => undefined}
            onError={onError}
          />
        )}
      </main>

      <aside className="design-inspector">
        <div className="design-panel-heading">
          <small>INSPECTOR</small>
          <strong>{selected?.react?.component ?? selected?.tagName ?? 'Nothing selected'}</strong>
          <span>{source ? `${source.file}:${source.line}` : 'Use Inspect in the canvas toolbar'}</span>
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
          <div className="design-inspector-empty">Select an element in the live canvas to attach component, source, CSS, and runtime context.</div>
        )}
      </aside>
    </div>
  )
}

function Property({ label, value }: { label: string; value: string }) {
  return <div className="design-property"><span>{label}</span><code>{value}</code></div>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
