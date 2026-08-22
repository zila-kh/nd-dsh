import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { GitFileChange, GitStatusSnapshot, WorkspaceState } from '../../../shared/contracts'
import { ArrowLeftIcon, FileIcon, PlusIcon, ReloadIcon, TrashIcon } from './Icons'

interface SourceControlPanelProps {
  workspace: WorkspaceState | null
  onOpenFile(path: string): void
  onOpenDiff(relativePath: string, staged: boolean): void
  onError(message: string): void
}

type ChangeGroupKind = 'staged' | 'unstaged' | 'untracked' | 'conflicts'

const GROUP_LABELS: Record<ChangeGroupKind, string> = {
  staged: 'Staged Changes',
  conflicts: 'Merge Changes',
  unstaged: 'Changes',
  untracked: 'Untracked Files',
}

/** ND Source Control panel — git CLI plumbing derived from microsoft/vscode extensions/git (MIT). */
export function SourceControlPanel({ workspace, onOpenFile, onOpenDiff, onError }: SourceControlPanelProps) {
  const [state, setState] = useState<GitStatusSnapshot | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [branchFormOpen, setBranchFormOpen] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [armedDiscards, setArmedDiscards] = useState<string[]>([])
  const busyRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setState(await window.ndDsh.git.refresh())
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }, [onError])

  useEffect(() => {
    let mounted = true
    const off = window.ndDsh.git.onState((next) => {
      if (mounted) setState(next)
    })
    void refresh()
    return () => {
      mounted = false
      off()
    }
  }, [refresh, workspace?.root])

  const run = useCallback(async (operation: () => Promise<GitStatusSnapshot>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      setState(await operation())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [onError])

  const commit = async (): Promise<void> => {
    const trimmed = message.trim()
    if (!trimmed || !state?.staged.length) return
    await run(() => window.ndDsh.git.commit(trimmed))
    setMessage('')
  }

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void commit()
    }
  }

  const requestDiscard = (path: string): void => {
    if (armedDiscards.includes(path)) {
      setArmedDiscards((current) => current.filter((entry) => entry !== path))
      void run(() => window.ndDsh.git.discard([path]))
      return
    }
    setArmedDiscards((current) => [...current, path])
    window.setTimeout(() => setArmedDiscards((current) => current.filter((entry) => entry !== path)), 3_500)
  }

  const createBranch = async (): Promise<void> => {
    const name = newBranch.trim()
    if (!name) return
    await run(() => window.ndDsh.git.createBranch(name))
    setNewBranch('')
    setBranchFormOpen(false)
  }

  if (!state?.repoRoot) {
    return (
      <div className="scm-panel">
        <div className="sidebar-placeholder">
          <strong>Source Control</strong>
          <p>This folder is not inside a Git repository.</p>
        </div>
        <UpstreamCredit />
      </div>
    )
  }

  const groups: Array<{ kind: ChangeGroupKind; changes: GitFileChange[] }> = [
    { kind: 'staged', changes: state.staged },
    { kind: 'conflicts', changes: state.conflicts },
    { kind: 'unstaged', changes: state.unstaged },
    { kind: 'untracked', changes: state.untracked },
  ]

  return (
    <div className="scm-panel">
      <div className="scm-toolbar">
        <select
          className="scm-branch-select"
          value={state.branch ?? ''}
          title="Switch branch"
          onChange={(event) => void run(() => window.ndDsh.git.checkout(event.target.value))}
        >
          {state.branch === null ? <option value="" disabled>HEAD (detached)</option> : null}
          {state.branches.map((branch) => (
            <option key={branch.name} value={branch.name}>{branch.name}</option>
          ))}
          {state.branch !== null && !state.branches.some((branch) => branch.name === state.branch)
            ? <option value={state.branch}>{state.branch}</option>
            : null}
        </select>
        <button className="scm-icon-button" title="Create branch" onClick={() => setBranchFormOpen((open) => !open)}>
          <PlusIcon />
        </button>
        <button className="scm-icon-button" title="Refresh" onClick={() => void refresh()}>
          <ReloadIcon className={busy ? 'spin' : ''} />
        </button>
      </div>

      {branchFormOpen ? (
        <div className="scm-branch-form">
          <input
            value={newBranch}
            placeholder="new-branch-name"
            autoFocus
            onChange={(event) => setNewBranch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createBranch()
              if (event.key === 'Escape') setBranchFormOpen(false)
            }}
          />
          <button className="scm-text-button" disabled={!newBranch.trim() || busy} onClick={() => void createBranch()}>Create</button>
        </div>
      ) : null}

      <div className="scm-sync-row">
        {state.ahead > 0 ? <span className="scm-badge">{`↑ ${state.ahead}`}</span> : null}
        {state.behind > 0 ? <span className="scm-badge down">{`↓ ${state.behind}`}</span> : null}
        <span className="scm-flex" />
        <button className="scm-text-button" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.fetch())}>Fetch</button>
        <button className="scm-text-button" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.pull())}>Pull</button>
        <button className="scm-text-button" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.push())}>Push</button>
      </div>

      <div className="scm-commit-box">
        <textarea
          value={message}
          placeholder="Commit message (Ctrl+Enter to commit)"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <button className="scm-commit-button" disabled={!state.staged.length || !message.trim() || busy} onClick={() => void commit()}>
          {state.staged.length > 0 ? `Commit (${state.staged.length})` : 'Commit'}
        </button>
      </div>

      <div className="scm-scroll">
        {groups.map(({ kind, changes }) => changes.length > 0 ? (
          <section key={kind}>
            <div className="scm-group-label">{GROUP_LABELS[kind]} <span className="count">{changes.length}</span></div>
            {changes.map((change) => (
              <ChangeRow
                key={`${change.path}:${change.x}${change.y}`}
                change={change}
                kind={kind}
                armed={armedDiscards.includes(change.path)}
                onOpen={() => onOpenDiff(change.path, kind === 'staged')}
                onStage={() => void run(() => window.ndDsh.git.stage([change.path]))}
                onUnstage={() => void run(() => window.ndDsh.git.unstage([change.path]))}
                onDiscard={() => requestDiscard(change.path)}
                onOpenFile={() => onOpenFile(change.path)}
              />
            ))}
          </section>
        ) : null)}
        {state.staged.length + state.unstaged.length + state.untracked.length + state.conflicts.length === 0
          ? <div className="empty-note">Working tree clean.</div>
          : null}
      </div>

      <UpstreamCredit />
    </div>
  )
}

function ChangeRow({ change, kind, armed, onOpen, onStage, onUnstage, onDiscard, onOpenFile }: {
  change: GitFileChange
  kind: ChangeGroupKind
  armed: boolean
  onOpen(): void
  onStage(): void
  onUnstage(): void
  onDiscard(): void
  onOpenFile(): void
}) {
  const { name, directory } = splitPath(change.path)
  return (
    <div className="scm-row" title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} onClick={onOpen}>
      <span className={`scm-status ${statusClass(change, kind)}`}>{statusLetter(change, kind)}</span>
      <span className="scm-row-label">{name}</span>
      {directory ? <span className="scm-row-dir">{directory}</span> : null}
      <span className="scm-row-actions">
        {kind === 'staged' ? (
          <button className="scm-icon-button" title="Unstage" onClick={(event) => { event.stopPropagation(); onUnstage() }}>
            <ArrowLeftIcon />
          </button>
        ) : (
          <button className="scm-icon-button" title="Stage" onClick={(event) => { event.stopPropagation(); onStage() }}>
            <PlusIcon />
          </button>
        )}
        {kind === 'conflicts' ? (
          <button className="scm-icon-button" title="Open file to resolve conflict" onClick={(event) => { event.stopPropagation(); onOpenFile() }}>
            <FileIcon />
          </button>
        ) : null}
        {kind === 'unstaged' || kind === 'untracked' ? (
          <button
            className={`scm-icon-button ${armed ? 'armed' : ''}`}
            title={armed ? 'Click again to discard changes' : 'Discard changes'}
            onClick={(event) => { event.stopPropagation(); onDiscard() }}
          >
            <TrashIcon />
          </button>
        ) : null}
      </span>
    </div>
  )
}

function statusLetter(change: GitFileChange, kind: ChangeGroupKind): string {
  if (kind === 'conflicts') return '!'
  if (kind === 'untracked') return 'U'
  const letter = kind === 'staged' ? change.x : change.y
  return letter === ' ' ? 'M' : letter
}

function statusClass(change: GitFileChange, kind: ChangeGroupKind): string {
  if (kind === 'conflicts') return 'conflict'
  if (kind === 'untracked') return 'added'
  const letter = (kind === 'staged' ? change.x : change.y).toUpperCase()
  if (letter === 'D') return 'deleted'
  if (letter === 'A' || letter === '?') return 'added'
  if (letter === 'R' || letter === 'C') return 'renamed'
  return 'modified'
}

function splitPath(path: string): { name: string; directory: string } {
  const separator = path.lastIndexOf('/')
  if (separator === -1) return { name: path, directory: '' }
  return { name: path.slice(separator + 1), directory: path.slice(0, separator) }
}

function UpstreamCredit() {
  return <p className="scm-credit">Git integration adapted from microsoft/vscode extensions/git (MIT License).</p>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
