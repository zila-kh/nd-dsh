import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { ArrowUpRight, Check, Crop, MoveUpRight, Palette, Pencil, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import type { AppInspectArea, InspectScope } from '../../../shared/contracts'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

export type CaptureOverlayMode = 'area' | 'annotate'
type AnnotationTool = 'box' | 'arrow' | 'pen'

interface Point {
  x: number
  y: number
}

interface AnnotationMark {
  tool: AnnotationTool
  points: Point[]
  color: string
  lineWidth: number
}

export interface CaptureOverlayProps {
  active: boolean
  initialMode: CaptureOverlayMode
  scope: InspectScope
  onCapture: (options: { mode: CaptureOverlayMode; rect?: AppInspectArea }) => Promise<void>
  onClose: () => void
}

const COLOR_PRESETS = [
  { id: 'red', hex: '#ef4444', label: 'Red' },
  { id: 'blue', hex: '#3b82f6', label: 'Blue' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
  { id: 'green', hex: '#10b981', label: 'Green' },
]

export function CaptureOverlay({
  active,
  initialMode,
  scope,
  onCapture,
  onClose,
}: CaptureOverlayProps): ReactElement | null {
  const [mode, setMode] = useState<CaptureOverlayMode>(initialMode)
  const [selectedRect, setSelectedRect] = useState<AppInspectArea | null>(null)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(true)

  // Annotation states
  const [currentTool, setCurrentTool] = useState<AnnotationTool>('box')
  const [currentColor, setCurrentColor] = useState<string>('#ef4444')
  const [marks, setMarks] = useState<AnnotationMark[]>([])
  const [activeMark, setActiveMark] = useState<AnnotationMark | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  /** Map a pointer event to coordinates local to the overlay / canvas. */
  const toLocal = (e: PointerEvent<HTMLDivElement>): Point => {
    const rect = overlayRef.current?.getBoundingClientRect()
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    }
  }

  // Reset when activated
  useEffect(() => {
    if (active) {
      setMode(initialMode)
      setSelectedRect(null)
      setDragStart(null)
      setIsDragging(false)
      setToolbarVisible(true)
      setMarks([])
      setActiveMark(null)
    }
  }, [active, initialMode])

  // Redraw canvas whenever marks change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const cssW = canvas.clientWidth || window.innerWidth
    const cssH = canvas.clientHeight || window.innerHeight

    // Sync bitmap resolution to the CSS layout size × device-pixel-ratio
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }

    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const allMarks = activeMark ? [...marks, activeMark] : marks
    for (const mark of allMarks) {
      drawAnnotationMark(ctx, mark)
    }
    ctx.restore()
  }, [marks, activeMark])

  // Keyboard shortcuts
  useEffect(() => {
    if (!active) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'area' && selectedRect) {
          void handleConfirmCapture()
        } else if (mode === 'annotate') {
          void handleConfirmCapture()
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (mode === 'annotate') {
          setMarks((prev) => prev.slice(0, -1))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active, mode, selectedRect, marks])

  if (!active) return null

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const point = toLocal(e)

    if (mode === 'area') {
      setIsDragging(true)
      setDragStart(point)
      setSelectedRect({ x: point.x, y: point.y, width: 0, height: 0 })
    } else if (mode === 'annotate') {
      setIsDragging(true)
      setActiveMark({
        tool: currentTool,
        points: [point],
        color: currentColor,
        lineWidth: currentTool === 'box' ? 2.5 : 3,
      })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    const currentPoint = toLocal(e)

    if (mode === 'area' && dragStart) {
      const x = Math.min(dragStart.x, currentPoint.x)
      const y = Math.min(dragStart.y, currentPoint.y)
      const width = Math.abs(currentPoint.x - dragStart.x)
      const height = Math.abs(currentPoint.y - dragStart.y)
      setSelectedRect({ x, y, width, height })
    } else if (mode === 'annotate' && activeMark) {
      if (activeMark.tool === 'box' || activeMark.tool === 'arrow') {
        const anchorPoint = activeMark.points[0] ?? currentPoint
        setActiveMark({
          ...activeMark,
          points: [anchorPoint, currentPoint],
        })
      } else if (activeMark.tool === 'pen') {
        const last = activeMark.points[activeMark.points.length - 1]
        if (!last || Math.hypot(last.x - currentPoint.x, last.y - currentPoint.y) >= 2) {
          setActiveMark({
            ...activeMark,
            points: [...activeMark.points, currentPoint],
          })
        }
      }
    }
  }

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    setIsDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)

    if (mode === 'area') {
      setDragStart(null)
      if (selectedRect && (selectedRect.width < 16 || selectedRect.height < 16)) {
        setSelectedRect(null)
      }
    } else if (mode === 'annotate' && activeMark) {
      if (activeMark.points.length > 1) {
        setMarks((prev) => [...prev, activeMark])
      }
      setActiveMark(null)
    }
  }

  const handleConfirmCapture = async (): Promise<void> => {
    // Hide UI toolbar so it is not visible in the screenshot
    setToolbarVisible(false)
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)))
    try {
      const rect = selectedRect && selectedRect.width > 10 && selectedRect.height > 10 ? selectedRect : undefined
      await onCapture({ mode, ...(rect !== undefined ? { rect } : {}) })
    } finally {
      onClose()
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-label="Screen capture overlay"
      className="fixed inset-0 z-[200] select-none touch-none overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: 'crosshair' }}
    >
      {/* Dimmed backdrop or cutout in Area mode */}
      {mode === 'area' && toolbarVisible && (
        <>
          {selectedRect && selectedRect.width > 0 && selectedRect.height > 0 ? (
            <div
              className="absolute pointer-events-none border-2 border-primary rounded-xs"
              style={{
                left: selectedRect.x,
                top: selectedRect.y,
                width: selectedRect.width,
                height: selectedRect.height,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.48)',
              }}
            >
              {/* Corner accent handles */}
              <div className="absolute -top-1 -left-1 size-2 bg-primary rounded-xs shadow" />
              <div className="absolute -top-1 -right-1 size-2 bg-primary rounded-xs shadow" />
              <div className="absolute -bottom-1 -left-1 size-2 bg-primary rounded-xs shadow" />
              <div className="absolute -bottom-1 -right-1 size-2 bg-primary rounded-xs shadow" />

              {/* Dimensions badge */}
              <div className="absolute -top-7 left-0 flex items-center gap-1 rounded bg-surface-1/90 px-1.5 py-0.5 font-mono text-[10px] text-primary shadow border border-border-strong backdrop-blur">
                <Crop className="size-2.5" />
                <span>
                  {Math.round(selectedRect.width)} × {Math.round(selectedRect.height)}
                </span>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 bg-black/45 pointer-events-none" />
          )}
        </>
      )}

      {/* Canvas for Direct Annotation */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        className={cn(
          'absolute inset-0 pointer-events-none',
          mode === 'annotate' ? 'block' : selectedRect ? 'block' : 'hidden',
        )}
      />

      {/* Area selection bottom action menu */}
      {toolbarVisible && mode === 'area' && selectedRect && !isDragging && selectedRect.width > 20 && selectedRect.height > 20 && (
        <div
          className="absolute z-10 flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1/95 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur"
          style={{
            left: Math.max(12, Math.min((overlayRef.current?.clientWidth ?? window.innerWidth) - 240, selectedRect.x + selectedRect.width / 2 - 110)),
            top: selectedRect.y + selectedRect.height + 12 < (overlayRef.current?.clientHeight ?? window.innerHeight) - 50
              ? selectedRect.y + selectedRect.height + 8
              : Math.max(12, selectedRect.y - 48),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs font-semibold"
            onClick={() => void handleConfirmCapture()}
          >
            <Check className="size-3.5" />
            Capture Area
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setMode('annotate')}
            title="Annotate this area with boxes, arrows, or drawings"
          >
            <Pencil className="size-3" />
            Annotate
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs text-faint hover:text-foreground"
            onClick={onClose}
            title="Cancel (Esc)"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Top Floating Toolbar (Instructions for Area mode, Drawing Tools for Annotate mode) */}
      {toolbarVisible && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-xl border border-border-strong bg-surface-1/95 px-3 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {mode === 'area' ? (
            <div className="flex items-center gap-3 text-xs text-soft">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Crop className="size-3.5 text-primary" />
                Select an area to capture
              </span>
              <span className="text-faint text-[11px]">Click & drag a rectangle · Esc to cancel</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1 text-faint hover:text-foreground"
                onClick={onClose}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* Tool selector */}
              <div className="flex items-center rounded-lg border border-border-soft bg-surface-0/60 p-0.5">
                <button
                  type="button"
                  aria-label="Draw Box"
                  aria-pressed={currentTool === 'box'}
                  className={cn(
                    'grid size-7 place-items-center rounded-md text-xs transition-colors',
                    currentTool === 'box'
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-faint hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setCurrentTool('box')}
                  title="Rectangle / Box tool"
                >
                  <Square className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Draw Arrow"
                  aria-pressed={currentTool === 'arrow'}
                  className={cn(
                    'grid size-7 place-items-center rounded-md text-xs transition-colors',
                    currentTool === 'arrow'
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-faint hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setCurrentTool('arrow')}
                  title="Arrow tool"
                >
                  <MoveUpRight className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Draw Freehand"
                  aria-pressed={currentTool === 'pen'}
                  className={cn(
                    'grid size-7 place-items-center rounded-md text-xs transition-colors',
                    currentTool === 'pen'
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-faint hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setCurrentTool('pen')}
                  title="Pen / Freehand tool"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>

              {/* Color swatches */}
              <div className="flex items-center gap-1 px-1 border-l border-border-soft">
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    aria-label={color.label}
                    className={cn(
                      'size-4 rounded-full transition-transform',
                      currentColor === color.hex ? 'scale-125 ring-2 ring-foreground/40 ring-offset-1' : 'opacity-80 hover:opacity-100',
                    )}
                    style={{ backgroundColor: color.hex }}
                    onClick={() => setCurrentColor(color.hex)}
                  />
                ))}
              </div>

              {/* Undo & Clear */}
              <div className="flex items-center gap-1 border-l border-border-soft pl-1">
                <button
                  type="button"
                  aria-label="Undo"
                  disabled={marks.length === 0}
                  className="grid size-7 place-items-center rounded-md text-faint hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  onClick={() => setMarks((prev) => prev.slice(0, -1))}
                  title="Undo last mark (Cmd+Z)"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Clear all annotations"
                  disabled={marks.length === 0}
                  className="grid size-7 place-items-center rounded-md text-faint hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  onClick={() => setMarks([])}
                  title="Clear all annotations"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 border-l border-border-soft pl-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 gap-1.5 px-3 text-xs font-semibold"
                  onClick={() => void handleConfirmCapture()}
                >
                  <Send className="size-3" />
                  Send to Agent
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-xs text-faint hover:text-foreground"
                  onClick={onClose}
                  title="Cancel (Esc)"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function drawAnnotationMark(ctx: CanvasRenderingContext2D, mark: AnnotationMark): void {
  if (mark.points.length === 0) return

  ctx.save()
  ctx.strokeStyle = mark.color
  ctx.lineWidth = mark.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (mark.tool === 'box') {
    const start = mark.points[0]
    const end = mark.points[mark.points.length - 1] ?? start
    if (!start || !end) return
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const w = Math.abs(end.x - start.x)
    const h = Math.abs(end.y - start.y)

    // Subtle colored translucent fill
    ctx.fillStyle = hexToRgba(mark.color, 0.12)
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)
  } else if (mark.tool === 'arrow') {
    const start = mark.points[0]
    const end = mark.points[mark.points.length - 1] ?? start
    if (!start || !end) return
    const dx = end.x - start.x
    const dy = end.y - start.y
    const angle = Math.atan2(dy, dx)
    const headLen = 14

    // Main line
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // Arrowhead
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  } else if (mark.tool === 'pen') {
    const first = mark.points[0]
    if (!first) return
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < mark.points.length; i++) {
      const p = mark.points[i]
      if (p) ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  ctx.restore()
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) || 0
  const g = parseInt(clean.substring(2, 4), 16) || 0
  const b = parseInt(clean.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
