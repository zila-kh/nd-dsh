import { type ReactNode, type ReactElement } from 'react'
import { Crop, Maximize2, Pencil } from 'lucide-react'
import type { AppInspectMode, InspectScope } from '../../../shared/contracts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export interface ScreenshotDropdownProps {
  children: ReactNode
  scope: InspectScope
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelectMode: (mode: AppInspectMode) => void
}

export function ScreenshotDropdown({
  children,
  scope,
  disabled = false,
  align = 'end',
  side = 'bottom',
  open,
  onOpenChange,
  onSelectMode,
}: ScreenshotDropdownProps): ReactElement {
  return (
    <DropdownMenu {...(open !== undefined ? { open } : {})} {...(onOpenChange !== undefined ? { onOpenChange } : {})}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-56 p-1 z-[160]">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          Screenshot Options
        </div>
        <DropdownMenuItem
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs"
          onClick={() => onSelectMode('full')}
        >
          <Maximize2 className="size-3.5 text-primary shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">
                {scope === 'self' ? 'Full Window' : 'Full Screen'}
              </span>
              <kbd className="text-[9px] font-mono text-faint ml-2">Ctrl+Alt+C</kbd>
            </div>
            <span className="text-[10px] text-faint truncate">
              {scope === 'self' ? 'Capture entire app window' : 'Capture entire screen'}
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuItem
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs"
          onClick={() => onSelectMode('area')}
        >
          <Crop className="size-3.5 text-primary shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-medium text-foreground">Select Area</span>
            <span className="text-[10px] text-faint truncate">Drag to capture a region</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs"
          onClick={() => onSelectMode('annotate')}
        >
          <Pencil className="size-3.5 text-primary shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-medium text-foreground">Direct Annotation</span>
            <span className="text-[10px] text-faint truncate">Draw boxes, arrows & notes</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
