import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { GitFileChange, GitStatusSnapshot, WorkspaceState } from '../../../shared/contracts'
import { ArrowLeftIcon, FileIcon, PlusIcon, ReloadIcon, TrashIcon } from './Icons'
import { ScmStatusChip, type ScmStatusKind } from './scm-status-chip'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'
import { cn } from '../lib/utils'

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

const DETACHED_VALUE = '__detached__'

const iconButtonClasses = cn(
  'grid size-6 shrink-0 place-items-center rounded-[3px] border-0 bg-transparent text-muted-foreground',
  'transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3',
)

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
      <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col gap-1 p-3">
          <strong className="text-xs font-semibold text-soft">Source Control</strong>
          <p className="text-[10px] leading-relaxed text-faint">This folder is not inside a Git repository.</p>
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
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-border-soft px-2 py-1.5">
        <Select
          value={state.branch ?? DETACHED_VALUE}
          onValueChange={(value) => {
            if (value !== DETACHED_VALUE) void run(() => window.ndDsh.git.checkout(value))
          }}
        >
          <SelectTrigger
            title="Switch branch"
            className="h-6 min-w-0 flex-1 rounded-[5px] border-border bg-secondary px-1.5 text-[11px] text-soft"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {state.branch === null ? <SelectItem value={DETACHED_VALUE} disabled>HEAD (detached)</SelectItem> : null}
            {state.branches.map((branch) => (
              <SelectItem key={branch.name} value={branch.name}>{branch.name}</SelectItem>
            ))}
            {state.branch !== null && !state.branches.some((branch) => branch.name === state.branch)
              ? <SelectItem value={state.branch}>{state.branch}</SelectItem>
              : null}
          </SelectContent>
        </Select>
        <button className={iconButtonClasses} title="Create branch" onClick={() => setBranchFormOpen((open) => !open)}>
          <PlusIcon />
        </button>
        <button className={iconButtonClasses} title="Refresh" onClick={() => void refresh()}>
          <ReloadIcon className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {branchFormOpen ? (
        <div className="flex gap-1 border-b border-border-soft px-2 py-1.5">
          <Input
            value={newBranch}
            placeholder="new-branch-name"
            autoFocus
            onChange={(event) => setNewBranch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createBranch()
              if (event.key === 'Escape') setBranchFormOpen(false)
            }}
            className="h-6 min-w-0 flex-1 rounded-[5px] border-border-strong bg-transparent px-[7px] text-[11px]"
          />
          <Button variant="secondary" className="h-[22px] rounded-[5px] px-2 text-[10px]" disabled={!newBranch.trim() || busy} onClick={() => void createBranch()}>
            Create
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-[5px] border-b border-border-soft px-2 py-1.5 text-[10px] text-faint">
        {state.ahead > 0 ? <Badge className="rounded-lg bg-primary/10 px-1.5 text-[9px] font-bold text-primary">{`↑ ${state.ahead}`}</Badge> : null}
        {state.behind > 0 ? <Badge className="rounded-lg bg-warning/10 px-1.5 text-[9px] font-bold text-warning">{`↓ ${state.behind}`}</Badge> : null}
        <span className="flex-1" />
        <Button variant="secondary" className="h-[22px] rounded-[5px] px-2 text-[10px]" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.fetch())}>Fetch</Button>
        <Button variant="secondary" className="h-[22px] rounded-[5px] px-2 text-[10px]" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.pull())}>Pull</Button>
        <Button variant="secondary" className="h-[22px] rounded-[5px] px-2 text-[10px]" disabled={!state.remotes.length || busy} onClick={() => void run(() => window.ndDsh.git.push())}>Push</Button>
      </div>

      <div className="flex flex-col gap-1.5 border-b border-border-soft p-2">
        <Textarea
          value={message}
          placeholder="Commit message (Ctrl+Enter to commit)"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onComposerKeyDown}
          className="min-h-[54px] resize-none rounded-md border-border-strong bg-composer px-2 py-[7px] text-[11px] leading-[1.45]"
        />
        <Button
          variant="ghost"
          className="h-6 rounded-md border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary hover:bg-primary/[0.16] hover:text-primary disabled:opacity-45"
          disabled={!state.staged.length || !message.trim() || busy}
          onClick={() => void commit()}
        >
          {state.staged.length > 0 ? `Commit (${state.staged.length})` : 'Commit'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2.5">
        {groups.map(({ kind, changes }) => changes.length > 0 ? (
          <section key={kind}>
            <div className="flex h-6 items-center gap-[5px] px-2.5 text-[9px] font-semibold tracking-[0.08em] text-faint">
              {GROUP_LABELS[kind]} <span className="text-muted-foreground">{changes.length}</span>
            </div>
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
          ? <div className="p-3 text-[10px]/[1.45] text-faint">Working tree clean.</div>
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
  const rowIconButtonClasses = cn(
    'grid size-[18px] shrink-0 basis-[18px] place-items-center rounded-[5px] border-0 bg-transparent text-muted-foreground',
    'hover:bg-accent hover:text-foreground',
    armed && 'text-destructive',
  )
  return (
    <div
      className="group flex h-[23px] cursor-default items-center gap-1.5 pl-2.5 pr-2 text-xs text-soft hover:bg-accent/50 hover:text-foreground"
      title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}
      onClick={onOpen}
    >
      <ScmStatusChip kind={statusKind(change, kind)} label={statusLetter(change, kind)} />
      <span className="min-w-0 truncate">{name}</span>
      {directory ? <span className="truncate text-[10px] text-fainter">{directory}</span> : null}
      <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {kind === 'staged' ? (
          <button className={rowIconButtonClasses} title="Unstage" onClick={(event) => { event.stopPropagation(); onUnstage() }}>
            <ArrowLeftIcon />
          </button>
        ) : (
          <button className={rowIconButtonClasses} title="Stage" onClick={(event) => { event.stopPropagation(); onStage() }}>
            <PlusIcon />
          </button>
        )}
        {kind === 'conflicts' ? (
          <button className={rowIconButtonClasses} title="Open file to resolve conflict" onClick={(event) => { event.stopPropagation(); onOpenFile() }}>
            <FileIcon />
          </button>
        ) : null}
        {kind === 'unstaged' || kind === 'untracked' ? (
          <button
            className={rowIconButtonClasses}
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

function statusKind(change: GitFileChange, kind: ChangeGroupKind): ScmStatusKind {
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
  return <p className="m-0 border-t border-border-soft px-2.5 py-[7px] text-[9px] text-fainter">Git integration adapted from microsoft/vscode extensions/git (MIT License).</p>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
