import { useState, useEffect } from 'react'
import type { ChatGptProjectBinding } from '../../../shared/contracts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { FolderIcon, ExternalIcon } from './Icons'

interface ChatGptProjectDialogProps {
  open: boolean
  workspaceRoot?: string
  workspaceName?: string
  currentBinding: ChatGptProjectBinding | null
  onClose(): void
  onSaved(binding: ChatGptProjectBinding): void
  onCleared?(): void
  onError(message: string): void
}

export function ChatGptProjectDialog({
  open,
  workspaceRoot,
  workspaceName,
  currentBinding,
  onClose,
  onSaved,
  onCleared,
  onError,
}: ChatGptProjectDialogProps) {
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setInput(currentBinding?.chatGptProjectUrl ?? currentBinding?.chatGptProjectRef ?? '')
    }
  }, [open, currentBinding])

  const handleSave = async () => {
    const trimmed = input.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const binding = await window.ndDsh.chatGptWeb.setProjectBinding(workspaceRoot || '', trimmed)
      onSaved(binding)
      onClose()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    try {
      await window.ndDsh.chatGptWeb.clearProjectBinding(workspaceRoot || '')
      onCleared?.()
      onClose()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenProjects = () => {
    void window.ndDsh.browser.navigate('https://chatgpt.com/projects')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderIcon className="size-4 text-primary" />
            <span>Link ChatGPT Project</span>
          </DialogTitle>
          <DialogDescription>
            {workspaceName ? `Link workspace "${workspaceName}" to a ChatGPT Project.` : 'Link workspace to a ChatGPT Project.'}
            {' '}Chats started with ChatGPT Web will stay scoped inside this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              ChatGPT Project Link or ID
            </label>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://chatgpt.com/g/g-p-6a9bf...-todo/project or g-p-..."
              className="font-mono text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSave()
                }
              }}
            />
            <p className="text-[11px] text-faint">
              Copy the URL from your browser bar when viewing the project on ChatGPT, or enter its ID.
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs text-soft"
              onClick={handleOpenProjects}
              title="Open ChatGPT Projects list in ND's Browser tab"
            >
              <ExternalIcon className="size-3" />
              <span>Open chatgpt.com/projects</span>
            </Button>
            {currentBinding ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => void handleClear()}
                disabled={saving}
              >
                Clear Link
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={saving}>Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={saving || !input.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save Project Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
