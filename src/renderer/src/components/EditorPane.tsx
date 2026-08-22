import { useMemo, useRef } from 'react'
import hljs from 'highlight.js/lib/common'
import type { WorkspaceFile } from '../../../shared/contracts'
import { FileIcon, SparkIcon } from './Icons'
import { SelectionPromptMenu, type SelectionAction } from './SelectionPromptMenu'

interface EditorPaneProps {
  file: WorkspaceFile | null
  onAgentPrompt?(prompt: string): void
  onError?(message: string): void
}

const SELECTION_ACTIONS: SelectionAction[] = [
  { id: 'ask', label: 'Ask agent', icon: <SparkIcon /> },
  { id: 'explain', label: 'Explain', icon: <SparkIcon /> },
  { id: 'copy', label: 'Copy', icon: <FileIcon /> },
]

function languageFromPath(path: string): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript'
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'javascript'
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.css')) return 'css'
  if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.svg')) return 'xml'
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml'
  return 'plaintext'
}

export function EditorPane({ file, onAgentPrompt, onError }: EditorPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const highlighted = useMemo(() => {
    if (!file) return ''
    const language = languageFromPath(file.relativePath)
    try {
      return hljs.getLanguage(language)
        ? hljs.highlight(file.content, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(file.content).value
    } catch {
      return hljs.highlightAuto(file.content).value
    }
  }, [file])

  if (!file) {
    return (
      <section className="editor-empty">
        <div className="brand-mark">ND</div>
        <h2>ND-DSH Coding Workspace</h2>
        <p>Open a file, switch to Browser, or ask the agent to start building.</p>
        <div className="shortcut-grid">
          <span>Open a project</span><kbd>Explorer</kbd>
          <span>Inspect the live app</span><kbd>Browser</kbd>
          <span>Delegate a task</span><kbd>Agent</kbd>
        </div>
      </section>
    )
  }

  const lineCount = file.content.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')

  const runSelectionAction = (actionId: string, text: string): void => {
    if (actionId === 'copy') {
      void navigator.clipboard.writeText(text).catch(() => onError?.('Clipboard access is unavailable here.'))
      return
    }
    const instruction = actionId === 'explain' ? 'Explain this selected code' : 'Help me with this selected code'
    onAgentPrompt?.(`${instruction}:\n${text}`)
  }

  return (
    <section className="editor-pane" aria-label={`Editor ${file.relativePath}`}>
      <div className="editor-tab-row">
        <div className="editor-tab active"><FileIcon /><span>{file.relativePath.split(/[\\/]/).at(-1)}</span></div>
      </div>
      {file.truncated ? <div className="truncated-banner">Preview truncated at 1 MiB.</div> : null}
      <div className="code-scroll" ref={scrollRef}>
        <div className="code-lines">
          <div className="line-numbers" aria-hidden="true">{lineNumbers}</div>
          <pre className="code-view"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
        </div>
      </div>
      <SelectionPromptMenu containerRef={scrollRef} actions={SELECTION_ACTIONS} onRun={runSelectionAction} />
    </section>
  )
}
