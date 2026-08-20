import type { WorkspaceFile } from '../../../shared/contracts'
import { FileIcon } from './Icons'

interface EditorPaneProps {
  file: WorkspaceFile | null
}

export function EditorPane({ file }: EditorPaneProps) {
  if (!file) {
    return (
      <section className="editor-empty">
        <div className="brand-mark">ND</div>
        <h2>DeepSeek Harness Desktop</h2>
        <p>Open a file, switch to Browser, or ask the agent to start building.</p>
        <div className="shortcut-grid">
          <span>Open a project</span><kbd>Explorer</kbd>
          <span>Inspect the live app</span><kbd>Browser</kbd>
          <span>Delegate a task</span><kbd>Agent</kbd>
        </div>
      </section>
    )
  }

  const lines = file.content.split('\n')
  return (
    <section className="editor-pane" aria-label={`Editor ${file.relativePath}`}>
      <div className="editor-tab-row">
        <div className="editor-tab active"><FileIcon /><span>{file.relativePath.split(/[\\/]/).at(-1)}</span></div>
      </div>
      {file.truncated ? <div className="truncated-banner">Preview truncated at 1 MiB.</div> : null}
      <div className="code-scroll">
        <pre className="code-view">
          {lines.map((line, index) => (
            <span className="code-line" key={`${index}-${line.slice(0, 12)}`}>
              <span className="line-number">{index + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </span>
          ))}
        </pre>
      </div>
    </section>
  )
}
