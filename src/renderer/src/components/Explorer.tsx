import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceEntry, WorkspaceState } from '../../../shared/contracts'
import { FOLDER_ACCENT, fileAccent } from '../lib/file-accents'
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FilesIcon, FolderIcon, GitIcon, SearchIcon } from './Icons'
import { SourceControlPanel } from './SourceControlPanel'
import { cn } from '../lib/utils'

interface ExplorerProps {
  workspace: WorkspaceState | null
  selectedPath: string | undefined
  onWorkspaceChanged(workspace: WorkspaceState): void
  onOpenFile(path: string): void
  onOpenDiff(relativePath: string, staged: boolean): void
  onError(message: string): void
}

type ExplorerTab = 'files' | 'search' | 'git'

const tabButtonClasses = (active: boolean): string =>
  cn(
    'relative grid size-7 shrink-0 place-items-center rounded-none border-b-2 border-transparent text-faint transition-colors [&_svg]:size-[15px]',
    active
      ? 'border-b-primary bg-transparent text-foreground'
      : 'hover:bg-accent/50 hover:text-soft',
  )

export function Explorer({ workspace, selectedPath, onWorkspaceChanged, onOpenFile, onOpenDiff, onError }: ExplorerProps) {
  const [rootEntries, setRootEntries] = useState<WorkspaceEntry[]>([])
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useState<ExplorerTab>('files')

  const refresh = useCallback(async () => {
    try {
      setRootEntries(await window.ndDsh.workspace.list('.'))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    if (workspace) void refresh()
  }, [refresh, workspace?.root])

  const pickWorkspace = async (): Promise<void> => {
    const next = await window.ndDsh.workspace.pick()
    onWorkspaceChanged(next)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar">
      <header className="flex h-[38px] shrink-0 items-center justify-between border-b border-border-soft bg-sidebar px-2.5">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">
          {activeTab === 'files' ? 'EXPLORER' : activeTab === 'search' ? 'SEARCH' : 'SOURCE CONTROL'}
        </span>
        <div className="flex h-full items-center gap-0.5">
          <button aria-label="Explorer" aria-pressed={activeTab === 'files'} className={tabButtonClasses(activeTab === 'files')} title="Explorer" onClick={() => setActiveTab('files')}>
            <FilesIcon />
          </button>
          <button aria-label="Search" aria-pressed={activeTab === 'search'} className={tabButtonClasses(activeTab === 'search')} title="Search" onClick={() => setActiveTab('search')}>
            <SearchIcon />
          </button>
          <button aria-label="Source Control" aria-pressed={activeTab === 'git'} className={tabButtonClasses(activeTab === 'git')} title="Source Control" onClick={() => setActiveTab('git')}>
            <GitIcon />
          </button>
        </div>
      </header>

      {activeTab === 'files' && (
        <>
          <button
            className="flex h-7 min-w-0 items-center gap-[5px] border-y border-border-soft px-2 text-left text-[10px] font-semibold tracking-[0.05em] text-soft [&_svg]:size-3 [&_svg]:shrink-0"
            onClick={() => void pickWorkspace()}
            title={workspace?.root ?? 'Open workspace'}
          >
            <ChevronDownIcon />
            <span className="truncate">{workspace?.name?.toUpperCase() ?? 'NO WORKSPACE'}</span>
          </button>
          <div className="min-h-0 flex-1 overflow-auto py-[3px] pb-2.5">
            {error ? <div className="p-3 text-[10px]/[1.45] text-destructive">{error}</div> : null}
            {rootEntries.map((entry) => (
              <TreeEntry key={entry.relativePath} entry={entry} depth={0} selectedPath={selectedPath} onOpenFile={onOpenFile} />
            ))}
            {rootEntries.length === 0 && !error ? <div className="p-3 text-[10px]/[1.45] text-faint">This folder is empty.</div> : null}
          </div>
          <div className="border-t border-border-soft bg-surface-1">
            <div className="h-[27px] border-b border-border-soft px-2.5 py-2 text-[9px] font-semibold tracking-[0.08em] text-faint">OUTLINE</div>
            <div className="h-[27px] border-b border-border-soft px-2.5 py-2 text-[9px] font-semibold tracking-[0.08em] text-faint">TIMELINE</div>
          </div>
        </>
      )}

      {activeTab === 'search' && (
        <div className="flex flex-1 flex-col gap-1 p-3">
          <strong className="text-xs font-semibold text-soft">Search files</strong>
          <p className="text-[10px] leading-relaxed text-faint">Use ⌘K or type to search across workspace.</p>
        </div>
      )}

      {activeTab === 'git' && (
        <SourceControlPanel
          workspace={workspace}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onError={onError}
        />
      )}
    </aside>
  )
}

function TreeEntry({ entry, depth, selectedPath, onOpenFile }: {
  entry: WorkspaceEntry
  depth: number
  selectedPath: string | undefined
  onOpenFile(path: string): void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<WorkspaceEntry[]>()
  const [loading, setLoading] = useState(false)

  const toggle = async (): Promise<void> => {
    if (entry.kind === 'file') {
      onOpenFile(entry.relativePath)
      return
    }
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && !children) {
      setLoading(true)
      try {
        setChildren(await window.ndDsh.workspace.list(entry.relativePath))
      } finally {
        setLoading(false)
      }
    }
  }

  const isSelected = selectedPath === entry.relativePath
  return (
    <>
      <button
        className={cn(
          'flex h-[23px] w-full min-w-0 items-center gap-[5px] pr-2 text-left text-xs text-soft hover:bg-accent/50 hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0',
          isSelected && 'bg-selected text-foreground',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => void toggle()}
        title={entry.relativePath}
      >
        <span className="grid w-3 shrink-0 place-items-center [&_svg]:size-3">
          {entry.kind === 'directory' ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}
        </span>
        {entry.kind === 'directory'
          ? <FolderIcon style={{ color: FOLDER_ACCENT }} />
          : <FileIcon style={{ color: fileAccent(entry.name) }} />}
        <span className="min-w-0 truncate">{entry.name}</span>
        {loading ? <span className="ml-auto text-primary">…</span> : null}
      </button>
      {open ? children?.map((child) => (
        <TreeEntry key={child.relativePath} entry={child} depth={depth + 1} selectedPath={selectedPath} onOpenFile={onOpenFile} />
      )) : null}
    </>
  )
}
