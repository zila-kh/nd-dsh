import { contextBridge, ipcRenderer } from 'electron'
import { ND_GATEWAY_IPC, type NdGatewayDesktopApi, type NdGatewayState } from '../shared/gateway.js'
import { TERMINAL_IPC, type TerminalDesktopApi, type TerminalExitEvent, type TerminalOutputEvent, type TerminalStateEvent } from '../shared/terminal.js'
import { TOKEN_SAVER_IPC, type TokenSaverDesktopApi, type TokenSaverState } from '../shared/token-saver.js'

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

const tokenSaverApi: TokenSaverDesktopApi = {
  state: () => ipcRenderer.invoke(TOKEN_SAVER_IPC.state),
  updateSettings: (settings) => ipcRenderer.invoke(TOKEN_SAVER_IPC.updateSettings, settings),
  resetCounters: () => ipcRenderer.invoke(TOKEN_SAVER_IPC.resetCounters),
  detectExternalApps: () => ipcRenderer.invoke(TOKEN_SAVER_IPC.detectExternalApps),
  runDemo: () => ipcRenderer.invoke(TOKEN_SAVER_IPC.runDemo),
  connectAccount: (id) => ipcRenderer.invoke(TOKEN_SAVER_IPC.connectAccount, id),
  disconnectAccount: (id) => ipcRenderer.invoke(TOKEN_SAVER_IPC.disconnectAccount, id),
  refreshAccounts: () => ipcRenderer.invoke(TOKEN_SAVER_IPC.refreshAccounts),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TokenSaverState) => listener(value)
    ipcRenderer.on(TOKEN_SAVER_IPC.changedEvent, handler)
    return () => ipcRenderer.removeListener(TOKEN_SAVER_IPC.changedEvent, handler)
  },
}

const gatewayApi: NdGatewayDesktopApi = {
  state: () => ipcRenderer.invoke(ND_GATEWAY_IPC.state),
  connect: (input) => ipcRenderer.invoke(ND_GATEWAY_IPC.connect, input),
  disconnect: (appId) => ipcRenderer.invoke(ND_GATEWAY_IPC.disconnect, appId),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: NdGatewayState) => listener(value)
    ipcRenderer.on(ND_GATEWAY_IPC.changedEvent, handler)
    return () => ipcRenderer.removeListener(ND_GATEWAY_IPC.changedEvent, handler)
  },
}

contextBridge.exposeInMainWorld('ndDshTerminal', api)
contextBridge.exposeInMainWorld('ndDshTokenSaver', tokenSaverApi)
contextBridge.exposeInMainWorld('ndDshGateway', gatewayApi)
