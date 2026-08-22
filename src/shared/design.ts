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

export interface DesignPreviewState {
  kind: 'static-html'
  root: string
  templatePath: string
  url: string
}

export interface DesignProjectState {
  root: string
  kind: DesignProjectKind
  frameworks: string[]
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  devCommand?: string
  templates: DesignTemplateEntry[]
  shadcn: DesignShadcnState
  capabilities: {
    liveApp: boolean
    htmlTemplates: boolean
    shadcn: boolean
    canvas: true
  }
  preview?: DesignPreviewState
}

export interface DesignDesktopApi {
  state(): Promise<DesignProjectState>
  refresh(): Promise<DesignProjectState>
  previewHtml(path: string): Promise<DesignPreviewState>
  stopPreview(): Promise<void>
}

export const DESIGN_IPC = {
  state: 'design:state',
  refresh: 'design:refresh',
  previewHtml: 'design:preview-html',
  stopPreview: 'design:stop-preview',
} as const
