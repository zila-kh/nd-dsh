import type { ThreadEntry } from './chat-types.js'

export type ToolEntry = Extract<ThreadEntry, { kind: 'tool' }>

export type ToolGroupIcon = 'tool' | 'file' | 'skill' | 'read' | 'command' | 'search'

export type DisplayGroup =
  | { kind: 'entry'; key: string; entry: ThreadEntry }
  | { kind: 'tool-group'; key: string; tools: ToolEntry[]; label: string; icon: ToolGroupIcon }

export const SKILL_TOOL_NAMES = new Set(['skill_load', 'skill_run', 'load_skill'])
export const FS_WRITE_TOOL_NAMES = new Set(['fs_edit', 'fs_write', 'fs_write_text', 'fs_create', 'fs_apply_patch', 'fs_str_replace', 'apply_patch'])
export const FS_READ_TOOL_NAMES = new Set(['fs_read', 'fs_read_text', 'fs_cat', 'read_file'])
export const COMMAND_TOOL_NAMES = new Set(['bash', 'shell', 'shell_command', 'run_command', 'execute_command', 'command execution'])
// Codex transcripts surface file edits under the opaque "file change" name.
const FILE_CHANGE_TOOL_NAMES = new Set(['file change'])
const SEARCH_NAME_PATTERN = /grep|glob|search|explore|find/i
const COMMAND_NAME_PATTERN = /command|shell|terminal|exec|bash/i

/**
 * Collapses consecutive tool entries into typed groups. When a run contains a
 * mix of ops the run is split into sub-groups so each gets an accurate label
 * ("Read 3 files" / "Ran 2 commands").
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
    // Sub-group by category. Adjacent same-type tools stay together; type
    // changes produce a new group.
    const subGroupOf = (t: ToolEntry): ToolGroupIcon => {
      if (SKILL_TOOL_NAMES.has(t.name)) return 'skill'
      if (FS_WRITE_TOOL_NAMES.has(t.name) || FILE_CHANGE_TOOL_NAMES.has(t.name)) return 'file'
      if (FS_READ_TOOL_NAMES.has(t.name)) return 'read'
      if (COMMAND_TOOL_NAMES.has(t.name) || COMMAND_NAME_PATTERN.test(t.name)) return 'command'
      if (SEARCH_NAME_PATTERN.test(t.name)) return 'search'
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
        : icon === 'command' ? `Ran ${n} command${n === 1 ? '' : 's'}`
        : icon === 'search' ? `Searched ${n} file${n === 1 ? '' : 's'}`
        : `Used ${n} tool${n === 1 ? '' : 's'}`
      groups.push({ kind: 'tool-group', key: batch[0]!.id, tools: batch, label, icon })
    }
  }
  return groups
}

/**
 * Best-effort human preview for a tool call: the command line for shell
 * execs, the target path for fs tools, otherwise undefined.
 */
export function toolPreview(t: ToolEntry): string | undefined {
  const args = t.args
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  const command = record.command
  if (typeof command === 'string' && command.trim()) return command.trim()
  if (Array.isArray(command) && command.every((part) => typeof part === 'string') && command.length > 0) {
    return command.join(' ')
  }
  const nested = record.arguments
  if (nested && typeof nested === 'object') {
    return toolPreview({ ...t, args: nested })
  }
  const path = record.path ?? record.file_path ?? record.filePath
  if (typeof path === 'string' && path.trim()) return path.trim()
  return undefined
}
