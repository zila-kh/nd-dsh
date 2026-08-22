import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceEntry, WorkspaceState } from '../../../shared/contracts'
import { FOLDER_ACCENT, fileAccent } from '../lib/file-accents'
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FilesIcon, FolderIcon, GitIcon, SearchIcon } from './Icons'

interface ExplorerProps {
  workspace: WorkspaceState | null
  selectedPath: string | undefined
  onWorkspaceChanged(workspace: WorkspaceState): void
  onOpenFile(path: string): void
}

type ExplorerTab = 'files' | 'search' | 'git'

export function Explorer({ workspace, selectedPath, onWorkspaceChanged, onOpenFile }: ExplorerProps) {
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
    <aside className="explorer-pane">
      <header className="pane-heading">
        <span className="pane-title">{activeTab === 'files' ? 'EXPLORER' : activeTab === 'search' ? 'SEARCH' : 'SOURCE CONTROL'}</span>
        <div className="explorer-tab-bar">
          <button
            className={`tab-icon-button ${activeTab === 'files' ? 'active' : ''}`}
            title="Explorer"
            onClick={() => setActiveTab('files')}
          >
            <FilesIcon />
          </button>
          <button
            className={`tab-icon-button ${activeTab === 'search' ? 'active' : ''}`}
            title="Search"
            onClick={() => setActiveTab('search')}
          >
            <SearchIcon />
          </button>
          <button
            className={`tab-icon-button ${activeTab === 'git' ? 'active' : ''}`}
            title="Source Control"
            onClick={() => setActiveTab('git')}
          >
            <GitIcon />
          </button>
        </div>
      </header>

      {activeTab === 'files' && (
        <>
          <button className="workspace-heading" onClick={() => void pickWorkspace()} title={workspace?.root ?? 'Open workspace'}>
            <ChevronDownIcon />
            <span>{workspace?.name?.toUpperCase() ?? 'NO WORKSPACE'}</span>
          </button>
          <div className="tree-scroll">
            {error ? <div className="pane-error">{error}</div> : null}
            {rootEntries.map((entry) => (
              <TreeEntry key={entry.relativePath} entry={entry} depth={0} selectedPath={selectedPath} onOpenFile={onOpenFile} />
            ))}
            {rootEntries.length === 0 && !error ? <div className="empty-note">This folder is empty.</div> : null}
          </div>
          <div className="explorer-sections">
            <div>OUTLINE</div>
            <div>TIMELINE</div>
          </div>
        </>
      )}

      {activeTab === 'search' && (
        <div className="sidebar-placeholder">
          <strong>Search files</strong>
          <p>Use ⌘K or type to search across workspace.</p>
        </div>
      )}

      {activeTab === 'git' && (
        <div className="sidebar-placeholder">
          <strong>Source Control</strong>
          <p>Git repository tracking ready.</p>
        </div>
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
        className={`tree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => void toggle()}
        title={entry.relativePath}
      >
        <span className="tree-chevron">
          {entry.kind === 'directory' ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}
        </span>
        {entry.kind === 'directory'
          ? <FolderIcon className="folder-icon" style={{ color: FOLDER_ACCENT }} />
          : <FileIcon className="file-icon" style={{ color: fileAccent(entry.name) }} />}
        <span className="tree-label">{entry.name}</span>
        {loading ? <span className="tree-loading">…</span> : null}
      </button>
      {open ? children?.map((child) => (
        <TreeEntry key={child.relativePath} entry={child} depth={depth + 1} selectedPath={selectedPath} onOpenFile={onOpenFile} />
      )) : null}
    </>
  )
}
