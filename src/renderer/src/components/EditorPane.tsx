import { useMemo, useRef } from 'react'
import hljs from 'highlight.js/lib/common'
import type { WorkspaceFile } from '../../../shared/contracts'
import { fileAccent } from '../lib/file-accents'
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
      // code-editor keeps the VS Code-style ::selection treatment.
      <section className="code-editor flex h-full w-full flex-col items-center justify-center text-center text-faint">
        <div className="grid size-[58px] place-items-center rounded-[14px] border border-primary/30 bg-primary/10 font-extrabold tracking-[0.08em] text-primary">ND</div>
        <h2 className="mb-[5px] mt-4 text-[15px] text-soft">ND-DSH Coding Workspace</h2>
        <p className="mb-[18px] text-[10px]">Open a file, switch to Browser, or ask the agent to start building.</p>
        <div className="grid grid-cols-[auto_auto] items-center gap-x-5 gap-y-[7px] text-left text-[9px] text-faint [&_kbd]:rounded-[4px] [&_kbd]:border [&_kbd]:border-border-strong [&_kbd]:bg-secondary [&_kbd]:px-1.5 [&_kbd]:py-[3px] [&_kbd]:font-sans [&_kbd]:text-muted-foreground">
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
    <section className="code-editor grid h-full w-full grid-rows-[31px_auto_minmax(0,1fr)] min-h-0 bg-surface-0" aria-label={`Editor ${file.relativePath}`}>
      <div className="flex border-b border-border-soft bg-secondary">
        <div className="flex items-center gap-1.5 border-r border-border-soft px-[11px] text-[10px] text-soft [&_svg]:size-[13px]">
          <FileIcon style={{ color: fileAccent(file.relativePath) }} />
          <span>{file.relativePath.split(/[\\/]/).at(-1)}</span>
        </div>
      </div>
      {file.truncated ? (
        <div className="border-b border-warning/25 bg-warning/10 px-2.5 py-[5px] text-[9px] text-warning">Preview truncated at 1 MiB.</div>
      ) : null}
      <div className="min-h-0 overflow-auto" ref={scrollRef}>
        <div className="flex min-w-full items-start">
          <div aria-hidden="true" className="shrink-0 select-none whitespace-pre py-[13px] pr-[13px] pb-10 text-right font-mono text-[11px]/[1.62] text-code-dim">
            {lineNumbers}
          </div>
          <pre className="m-0 block min-w-0 flex-1 overflow-visible whitespace-pre pt-[13px] pr-[18px] pb-10 font-mono text-[11px]/[1.62] text-soft">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
      </div>
      <SelectionPromptMenu containerRef={scrollRef} actions={SELECTION_ACTIONS} onRun={runSelectionAction} />
    </section>
  )
}
