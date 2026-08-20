import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface SelectionAction {
  id: string
  label: string
  icon: ReactNode
}

interface SelectionPromptMenuProps {
  containerRef: React.RefObject<HTMLElement | null>
  actions: SelectionAction[]
  onRun(actionId: string, selectedText: string): void
}

interface MenuPosition {
  x: number
  y: number
  text: string
}

const ESTIMATED_WIDTH = 260
const MENU_GAP = 8

/**
 * Floating toolbar that appears above a text selection inside the editor.
 * Tracks the native selection, anchors at the selection's midpoint, and
 * dismisses on collapse, scroll, outside click, or Escape.
 */
export function SelectionPromptMenu({ containerRef, actions, onRun }: SelectionPromptMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = (): void => {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!selection || selection.isCollapsed || !text) {
        setPosition(null)
        return
      }
      if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
        setPosition(null)
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const width = menuRef.current?.offsetWidth ?? ESTIMATED_WIDTH
      const x = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, MENU_GAP), window.innerWidth - width - MENU_GAP)
      const y = rect.top >= MENU_GAP + 44 ? rect.top - 44 : rect.bottom + MENU_GAP
      setPosition({ x, y, text })
    }
    const hide = (): void => setPosition(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('selectionchange', update)
    document.addEventListener('keydown', onKeyDown)
    container.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('keydown', onKeyDown)
      container.removeEventListener('scroll', hide)
    }
  }, [containerRef])

  // Re-clamp horizontally once the real width is known, before paint.
  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const width = menuRef.current.offsetWidth
    const clampedX = Math.min(Math.max(position.x, MENU_GAP), window.innerWidth - width - MENU_GAP)
    if (clampedX !== position.x) setPosition({ ...position, x: clampedX })
  }, [position])

  if (!position) return null

  return (
    <div
      ref={menuRef}
      className="editor-floating-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => {
            onRun(action.id, position.text)
            setPosition(null)
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
