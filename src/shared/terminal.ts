export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'
export type TerminalSplitDirection = 'horizontal' | 'vertical'

export interface TerminalSnapshot {
  id: string
  sessionId: string
  title: string
  cwd: string
  shell: string
  status: TerminalStatus
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
  buffer: string
  outputSeq: number
  pid?: number
  exitCode?: number
  recovered?: boolean
  error?: string
}

export type TerminalPaneLayout =
  | { type: 'leaf'; paneId: string; terminalId: string }
  | {
      type: 'split'
      direction: TerminalSplitDirection
      first: TerminalPaneLayout
      second: TerminalPaneLayout
      ratio?: number
    }

export interface TerminalSessionState {
  sessionId: string
  terminals: TerminalSnapshot[]
  layout: TerminalPaneLayout | null
  activePaneId: string | null
  activeTerminalId: string | null
}

export interface TerminalCreateInput {
  sessionId: string
  cwd?: string
  title?: string
  shell?: string
  cols?: number
  rows?: number
}

export interface TerminalOutputEvent {
  sessionId: string
  terminalId: string
  seq: number
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  terminalId: string
  exitCode: number
  signal?: number
}

export interface TerminalStateEvent {
  sessionId: string
  state: TerminalSessionState
}

export interface TerminalDesktopApi {
  state(sessionId: string): Promise<TerminalSessionState>
  create(input: TerminalCreateInput): Promise<TerminalSessionState>
  write(sessionId: string, terminalId: string, data: string): Promise<void>
  resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void>
  close(sessionId: string, terminalId: string): Promise<TerminalSessionState>
  restart(sessionId: string, terminalId: string): Promise<TerminalSessionState>
  rename(sessionId: string, terminalId: string, title: string): Promise<TerminalSessionState>
  setLayout(sessionId: string, layout: TerminalPaneLayout | null, activePaneId: string | null, activeTerminalId: string | null): Promise<TerminalSessionState>
  onOutput(listener: (event: TerminalOutputEvent) => void): () => void
  onExit(listener: (event: TerminalExitEvent) => void): () => void
  onState(listener: (event: TerminalStateEvent) => void): () => void
}

export const TERMINAL_IPC = {
  state: 'terminal:state',
  create: 'terminal:create',
  write: 'terminal:write',
  resize: 'terminal:resize',
  close: 'terminal:close',
  restart: 'terminal:restart',
  rename: 'terminal:rename',
  setLayout: 'terminal:set-layout',
  outputEvent: 'terminal:output-event',
  exitEvent: 'terminal:exit-event',
  stateEvent: 'terminal:state-event',
} as const
