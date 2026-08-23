import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

interface BridgePillProps {
  state?: 'ready' | 'binding' | 'unavailable' | (string & {}) | undefined
  onClick?: (() => void) | undefined
  title?: string | undefined
  children: ReactNode
  className?: string
}

// Status pill describing the pinned browser/agent bridge; rendered as a
// button when clickable (clear selection / finish annotation).
export function BridgePill({ state, onClick, title, children, className }: BridgePillProps) {
  const classes = cn(
    'flex min-w-[76px] items-center gap-[5px] rounded-[5px] border border-border px-[7px] py-[5px] text-[8px] whitespace-nowrap text-faint',
    '[&>span]:size-[5px] [&>span]:shrink-0 [&>span]:rounded-full [&>span]:bg-faint',
    state === 'ready' && '[&>span]:bg-primary',
    state === 'binding' && '[&>span]:bg-info',
    state === 'unavailable' && 'border-destructive/40 text-destructive [&>span]:bg-destructive',
    onClick && 'transition-colors hover:border-(--border-focus) hover:text-foreground',
    className,
  )

  if (onClick) {
    return (
      <button type="button" title={title} onClick={onClick} className={classes}>
        <span />
        {children}
      </button>
    )
  }
  return (
    <span title={title} className={classes}>
      <span />
      {children}
    </span>
  )
}
