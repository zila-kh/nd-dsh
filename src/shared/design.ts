import type { BrowserBounds } from './contracts.js'

export type DesignProjectKind = 'shadcn' | 'next' | 'react' | 'vite' | 'static-html' | 'web' | 'canvas'

export type DesignTemplateKind = 'html' | 'ejs' | 'handlebars' | 'nunjucks' | 'liquid'

export interface DesignTemplateEntry {
  path: string
  name: string
  kind: DesignTemplateKind
  previewable: boolean
  entry: boolean
}

export interface DesignComponentEntry {
  name: string
  path: string
  kind: 'shadcn'
}

export interface DesignShadcnState {
  detected: boolean
  configPath?: string
  style?: string
  baseColor?: string
  cssVariables?: boolean
  components: DesignComponentEntry[]
}

export interface DesignFreeformDocumentEntry {
  path: string
  name: string
}

export type DesignFreeformStatus = 'unavailable' | 'idle' | 'starting' | 'ready' | 'error'

export interface DesignFreeformState {
  engine: 'openpencil'
  status: DesignFreeformStatus
  available: boolean
  visible: boolean
  dirty: boolean
  documentPath?: string
  documentName?: string
  version?: string
  error?: string
}

export interface DesignPreviewState {
  kind: 'static-html' | 'dev-server'
  root: string
  url: string
  templatePath?: string
  command?: string
}

export interface DesignProjectState {
  root: string
  kind: DesignProjectKind
  frameworks: string[]
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  devCommand?: string
  templates: DesignTemplateEntry[]
  shadcn: DesignShadcnState
  freeform: {
    documents: DesignFreeformDocumentEntry[]
  }
  capabilities: {
    liveApp: boolean
    htmlTemplates: boolean
    shadcn: boolean
    canvas: true
    freeform: true
  }
  preview?: DesignPreviewState
}

export interface DesignDesktopApi {
  state(): Promise<DesignProjectState>
  refresh(): Promise<DesignProjectState>
  previewHtml(path: string): Promise<DesignPreviewState>
  startDevPreview(): Promise<DesignPreviewState>
  stopPreview(): Promise<void>
  freeformState(): Promise<DesignFreeformState>
  freeformSetBounds(bounds: BrowserBounds): Promise<void>
  freeformSetVisible(visible: boolean): Promise<DesignFreeformState>
  freeformOpen(path: string): Promise<DesignFreeformState>
  freeformCreate(path: string): Promise<DesignFreeformState>
  freeformSave(): Promise<DesignFreeformState>
  freeformClose(): Promise<DesignFreeformState>
  onFreeformState(listener: (state: DesignFreeformState) => void): () => void
}

export const DESIGN_IPC = {
  state: 'design:state',
  refresh: 'design:refresh',
  previewHtml: 'design:preview-html',
  startDevPreview: 'design:start-dev-preview',
  stopPreview: 'design:stop-preview',
  freeformState: 'design:freeform-state',
  freeformSetBounds: 'design:freeform-set-bounds',
  freeformSetVisible: 'design:freeform-set-visible',
  freeformOpen: 'design:freeform-open',
  freeformCreate: 'design:freeform-create',
  freeformSave: 'design:freeform-save',
  freeformClose: 'design:freeform-close',
  freeformChanged: 'design:freeform-changed',
} as const

export const OPENPENCIL_HOST_IPC = {
  pageMessage: 'design:openpencil-host-page-message',
  hostMessage: 'design:openpencil-host-message',
} as const
