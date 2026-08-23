import { cn } from '../lib/utils'

export type ScmStatusKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict'

const KIND_CLASSES: Record<ScmStatusKind, string> = {
  modified: 'bg-warning/10 text-warning',
  added: 'bg-primary/10 text-primary',
  deleted: 'bg-destructive/15 text-destructive',
  renamed: 'bg-info/[0.07] text-info',
  conflict: 'bg-destructive text-strong',
}

/** Git status letter chip shared by the source control panel and diff view. */
export function ScmStatusChip({ kind, label, className }: { kind: ScmStatusKind; label: string; className?: string }) {
  return (
    <span className={cn('grid size-3.5 shrink-0 place-items-center rounded-[3px] font-mono text-[9px] font-bold', KIND_CLASSES[kind], className)}>
      {label}
    </span>
  )
}
