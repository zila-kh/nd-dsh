import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/utils'

interface TitlebarIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

// 26px ghost icon button used across the draggable titlebar; every instance
// must stay click-through inside the drag region (app-no-drag).
export function TitlebarIconButton({ className, active = false, type = 'button', ...props }: TitlebarIconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'app-no-drag grid size-[26px] shrink-0 place-items-center rounded-md text-faint transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-45',
        '[&_svg]:size-3.5',
        active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
        className,
      )}
      {...props}
    />
  )
}
