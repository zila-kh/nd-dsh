import type { SessionSummary } from './contracts.js'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface AskQuestion {
  id: string
  question: string
  detail?: string
  header?: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

export type ThreadEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; callId?: string; name: string; args?: unknown; status: 'running' | 'done' | 'error'; result?: string }
  | { kind: 'todo'; id: string; items: TodoItem[] }
  | { kind: 'approval'; id: string; sessionId: string; approvalId: string; toolName: string; reason?: string; rpcId: string; resolved?: 'allowed-once' | 'rejected' }
  | { kind: 'question'; id: string; sessionId: string; questions: AskQuestion[]; rpcId: string; resolved?: boolean }
  | { kind: 'notice'; id: string; text: string; tone?: 'info' | 'error'; retryPrompt?: string }

export interface SessionThread {
  summary: SessionSummary
  entries: ThreadEntry[]
}
