import type { ThreadEntry } from './chat-types.js'

export type ToolEntry = Extract<ThreadEntry, { kind: 'tool' }>

export type DisplayGroup =
  | { kind: 'entry'; key: string; entry: ThreadEntry }
  | { kind: 'tool-group'; key: string; tools: ToolEntry[]; label: string; icon: 'tool' | 'file' | 'skill' | 'read' }

export const SKILL_TOOL_NAMES = new Set(['skill_load', 'skill_run', 'load_skill'])
export const FS_WRITE_TOOL_NAMES = new Set(['fs_edit', 'fs_write', 'fs_write_text', 'fs_create', 'fs_apply_patch', 'fs_str_replace', 'apply_patch'])
export const FS_READ_TOOL_NAMES = new Set(['fs_read', 'fs_read_text', 'fs_cat', 'read_file'])

/**
 * Collapses consecutive tool entries into typed groups. When a run contains a
 * mix of read-only and write ops the run is split into sub-groups so each gets
 * an accurate label ("Read 3 files" / "Edited 2 files").
 */
export function groupEntries(entries: ThreadEntry[]): DisplayGroup[] {
  const groups: DisplayGroup[] = []
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]
    if (!entry) { i++; continue }
    if (entry.kind !== 'tool') {
      groups.push({ kind: 'entry', key: entry.id, entry })
      i++
      continue
    }
    // Collect a run of consecutive tool entries then sub-group by type.
    const toolRun: ToolEntry[] = []
    while (i < entries.length && entries[i]?.kind === 'tool') {
      toolRun.push(entries[i] as ToolEntry)
      i++
    }
    // Sub-group by category: skill → read → write → other. Adjacent same-type
    // tools stay together; type changes produce a new group.
    const subGroupOf = (t: ToolEntry): 'skill' | 'file' | 'read' | 'tool' => {
      if (SKILL_TOOL_NAMES.has(t.name)) return 'skill'
      if (FS_WRITE_TOOL_NAMES.has(t.name)) return 'file'
      if (FS_READ_TOOL_NAMES.has(t.name)) return 'read'
      return 'tool'
    }
    let j = 0
    while (j < toolRun.length) {
      const icon = subGroupOf(toolRun[j]!)
      const batch: ToolEntry[] = []
      while (j < toolRun.length && subGroupOf(toolRun[j]!) === icon) {
        batch.push(toolRun[j]!)
        j++
      }
      const n = batch.length
      const label =
        icon === 'skill' ? `Loaded ${n} skill${n === 1 ? '' : 's'}`
        : icon === 'file' ? `Edited ${n} file${n === 1 ? '' : 's'}`
        : icon === 'read' ? `Read ${n} file${n === 1 ? '' : 's'}`
        : `${n} tool call${n === 1 ? '' : 's'}`
      groups.push({ kind: 'tool-group', key: batch[0]!.id, tools: batch, label, icon })
    }
  }
  return groups
}
