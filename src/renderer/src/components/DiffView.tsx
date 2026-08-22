import { useEffect, useState } from 'react'
import { CloseIcon } from './Icons'

interface DiffViewProps {
  relativePath: string
  staged: boolean
  onClose(): void
  onError(message: string): void
}

/** Read-only unified diff rendered from `git diff` output for one file. */
export function DiffView({ relativePath, staged, onClose, onError }: DiffViewProps) {
  const [patch, setPatch] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setPatch(null)
    void window.ndDsh.git.diff(relativePath, staged)
      .then((result) => {
        if (mounted) setPatch(result)
      })
      .catch((cause) => {
        if (!mounted) return
        setPatch('')
        onError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      mounted = false
    }
  }, [relativePath, staged, onError])

  return (
    <div className="editor-pane diff-view">
      <div className="editor-tab-row">
        <div className="editor-tab">
          <span className={`scm-status ${staged ? 'added' : 'modified'}`}>{staged ? 'S' : 'D'}</span>
          <span title={relativePath}>{`Diff · ${relativePath}${staged ? ' (staged)' : ''}`}</span>
        </div>
        <button className="diff-close" title="Close diff" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {patch === null ? (
        <div className="view-loading"><div className="placeholder-ring" /></div>
      ) : patch.trim() === '' ? (
        <div className="empty-note">No textual changes.</div>
      ) : (
        <div className="code-scroll">
          <pre className="diff-code">
            {patch.split('\n').map((line, index) => (
              <span key={index} className={diffLineClass(line)}>{`${line}\n`}</span>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta'
  if (line.startsWith('+')) return 'diff-add'
  if (line.startsWith('-')) return 'diff-del'
  if (line.startsWith('@@')) return 'diff-hunk'
  return 'diff-ctx'
}
