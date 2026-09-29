import { useEffect, useState, type FormEvent } from 'react'
import type { SavedWorkspace, WorkspaceRegistryView, WorkspaceState } from '../../../shared/contracts'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  rowDesc,
  rowPathText,
  rowStack,
  rowTitle,
} from './settings-primitives'

interface WorkspaceSettingsProps {
  workspace: WorkspaceState | null
  onWorkspaceChanged(workspace: WorkspaceState): void
  onError(message: string): void
}

/** General → Workspace: open folder, path entry, and the saved-workspace registry. */
export function WorkspaceSettings({ workspace, onWorkspaceChanged, onError }: WorkspaceSettingsProps) {
  const [pathDraft, setPathDraft] = useState('')
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceRegistryView | null>(null)
  const [workspaceToRemove, setWorkspaceToRemove] = useState<SavedWorkspace | null>(null)

  useEffect(() => {
    setPathDraft(workspace?.root ?? '')
  }, [workspace?.root])

  // This module only mounts while the Workspace sub-tab is active, so the
  // registry read stays on demand.
  useEffect(() => {
    let mounted = true
    void window.ndDsh.workspace.registry()
      .then((value) => { if (mounted) setSavedWorkspaces(value) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [workspace?.root])

  const removeSavedWorkspace = async (id: string): Promise<void> => {
    try {
      const next = await window.ndDsh.workspace.removeSaved(id)
      setSavedWorkspaces(next)
      setWorkspaceToRemove(null)
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const changeFolder = async (): Promise<void> => {
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.pick())
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const openPath = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const path = pathDraft.trim()
    if (!path) return
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.setRoot(path))
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  return (
    <>
      <SettingsSection title="Workspace" className="mt-3.5">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Folder</strong>
              <span className={rowPathText} title={workspace?.root}>{workspace ? workspace.root : 'No workspace open'}</span>
            </div>
            <SettingsButton onClick={() => void changeFolder()}>Change folder</SettingsButton>
          </SettingsRow>
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Folder path</strong>
              <span className={rowDesc}>Open a project workspace by path.</span>
            </div>
            <form className="flex shrink-0 min-w-0 items-center gap-1.5" onSubmit={openPath}>
              <input
                aria-label="Workspace path"
                placeholder="/Users/you/your-project"
                value={pathDraft}
                onChange={(event) => setPathDraft(event.target.value)}
                spellCheck={false}
                className="h-[26px] w-[220px] min-w-0 rounded-md border border-border-strong bg-background px-[9px] font-mono text-[9px] text-soft outline-none focus:border-(--border-focus)"
              />
              <SettingsButton type="submit">Open</SettingsButton>
            </form>
          </SettingsRow>
        </div>
      </SettingsSection>

      {savedWorkspaces && savedWorkspaces.items.length > 0 ? (
        <SettingsSection title="Saved workspaces">
          <div className="space-y-1.5">
            {savedWorkspaces.items.map((item) => (
              <SettingsRow key={item.id}>
                <div className={rowStack}>
                  <strong className={rowTitle}>
                    {item.name}
                    {item.id === savedWorkspaces.activeId ? <span className="ml-2 text-[9px] font-bold tracking-[0.08em] text-primary">CURRENT</span> : null}
                  </strong>
                  <span className={rowPathText} title={item.root}>{item.root}</span>
                </div>
                <SettingsButton
                  aria-label={`Remove saved workspace ${item.name}`}
                  className="hover:border-destructive/45 hover:text-destructive"
                  onClick={() => setWorkspaceToRemove(item)}
                >
                  Remove
                </SettingsButton>
              </SettingsRow>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <Dialog open={workspaceToRemove !== null} onOpenChange={(open) => { if (!open) setWorkspaceToRemove(null) }}>
        <DialogContent className="sm:max-w-[470px]">
          <DialogHeader>
            <DialogTitle>Remove saved workspace?</DialogTitle>
            <DialogDescription>
              {workspaceToRemove
                ? `“${workspaceToRemove.name}” will no longer be offered as a saved workspace. The folder and everything in it are left untouched.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {workspaceToRemove ? (
            <p className="m-0 font-mono text-[10px] text-muted-foreground">{workspaceToRemove.root}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[10px] text-soft transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              className="shrink-0 rounded-md border border-destructive/45 bg-secondary px-2.5 py-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10"
              onClick={() => { if (workspaceToRemove) void removeSavedWorkspace(workspaceToRemove.id) }}
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
