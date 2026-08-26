import { contextBridge, ipcRenderer } from 'electron'
import { TERMINAL_IPC, type TerminalDesktopApi, type TerminalExitEvent, type TerminalOutputEvent, type TerminalStateEvent } from '../shared/terminal.js'

const api: TerminalDesktopApi = {
  state: (sessionId) => ipcRenderer.invoke(TERMINAL_IPC.state, sessionId),
  create: (input) => ipcRenderer.invoke(TERMINAL_IPC.create, input),
  write: (sessionId, terminalId, data) => ipcRenderer.invoke(TERMINAL_IPC.write, sessionId, terminalId, data),
  resize: (sessionId, terminalId, cols, rows) => ipcRenderer.invoke(TERMINAL_IPC.resize, sessionId, terminalId, cols, rows),
  close: (sessionId, terminalId) => ipcRenderer.invoke(TERMINAL_IPC.close, sessionId, terminalId),
  restart: (sessionId, terminalId) => ipcRenderer.invoke(TERMINAL_IPC.restart, sessionId, terminalId),
  rename: (sessionId, terminalId, title) => ipcRenderer.invoke(TERMINAL_IPC.rename, sessionId, terminalId, title),
  setLayout: (sessionId, layout, activePaneId, activeTerminalId) => ipcRenderer.invoke(TERMINAL_IPC.setLayout, sessionId, layout, activePaneId, activeTerminalId),
  onOutput: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalOutputEvent) => listener(value)
    ipcRenderer.on(TERMINAL_IPC.outputEvent, handler)
    return () => ipcRenderer.removeListener(TERMINAL_IPC.outputEvent, handler)
  },
  onExit: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalExitEvent) => listener(value)
    ipcRenderer.on(TERMINAL_IPC.exitEvent, handler)
    return () => ipcRenderer.removeListener(TERMINAL_IPC.exitEvent, handler)
  },
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalStateEvent) => listener(value)
    ipcRenderer.on(TERMINAL_IPC.stateEvent, handler)
    return () => ipcRenderer.removeListener(TERMINAL_IPC.stateEvent, handler)
  },
}
contextBridge.exposeInMainWorld('ndDshTerminal', api)
