export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  detail?: string
}

export type CenterView = 'browser' | 'editor' | 'settings'
