import { promises as fs, type Dirent } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { WorkspaceState } from '../../shared/contracts.js'
import type {
  DesignComponentEntry,
  DesignPreviewState,
  DesignProjectKind,
  DesignProjectState,
  DesignShadcnState,
  DesignTemplateEntry,
  DesignTemplateKind,
} from '../../shared/design.js'
import type { BrowserController } from '../browser/browser-controller.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'

const MAX_SCAN_DEPTH = 6
const MAX_SCAN_ENTRIES = 2_000
const SKIPPED = new Set([
  '.git', '.dsh', '.sessions', '.next', '.turbo', '.cache',
  'node_modules', 'dist', 'out', 'build', 'coverage', 'vendor',
])

const STATIC_TEMPLATE_EXTENSIONS = new Map<string, DesignTemplateKind>([
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.ejs', 'ejs'],
  ['.hbs', 'handlebars'],
  ['.handlebars', 'handlebars'],
  ['.njk', 'nunjucks'],
  ['.nunjucks', 'nunjucks'],
  ['.liquid', 'liquid'],
])

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const BLOCKED_STATIC_NAMES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'components.json', 'tsconfig.json', 'jsconfig.json',
])

interface ScanCache {
  root: string
  project: Omit<DesignProjectState, 'preview'>
}

export class DesignService {
  private cache: ScanCache | undefined
  private preview: DesignPreviewState | undefined
  private server: Server | undefined
  private serverRoot: string | undefined
  private serverPort: number | undefined

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly browser: BrowserController,
  ) {}

  async state(): Promise<DesignProjectState> {
    const workspace = this.workspace.state()
    const project = this.cache?.root === workspace.root
      ? this.cache.project
      : await this.scan(workspace)
    return this.withPreview(project)
  }

  async refresh(): Promise<DesignProjectState> {
    const workspace = this.workspace.state()
    this.cache = undefined
    return this.withPreview(await this.scan(workspace))
  }

  async previewHtml(inputPath: string): Promise<DesignPreviewState> {
    const project = await this.refresh()
    const requested = normalizeRelativePath(inputPath)
    const template = project.templates.find((entry) => entry.path === requested)
    if (!template) throw new Error(`HTML template is not part of the active workspace: ${requested}`)
    if (!template.previewable) throw new Error(`${template.name} requires the project runtime and cannot be served as static HTML`)

    const port = await this.ensureStaticServer(project.root)
    const url = `http://127.0.0.1:${port}/${encodeRelativePath(template.path)}`
    const preview: DesignPreviewState = {
      kind: 'static-html',
      root: project.root,
      templatePath: template.path,
      url,
    }
    this.preview = preview
    try {
      await this.browser.navigate(url)
    } catch (cause) {
      this.preview = undefined
      throw cause
    }
    return preview
  }

  async stopPreview(): Promise<void> {
    const origin = this.preview ? new URL(this.preview.url).origin : undefined
    this.preview = undefined
    await this.closeServer()
    if (origin && this.browser.state().url.startsWith(origin)) {
      await this.browser.navigate('about:blank').catch(() => undefined)
    }
  }

  async handleWorkspaceChanged(state: WorkspaceState): Promise<void> {
    this.cache = undefined
    const blocked = state.binding === 'unlinked' || state.binding === 'missing'
    if (blocked || (this.preview && this.preview.root !== state.root) || (this.serverRoot && this.serverRoot !== state.root)) {
      await this.stopPreview()
    }
  }

  destroy(): void {
    this.preview = undefined
    this.serverRoot = undefined
    this.serverPort = undefined
    this.server?.close()
    this.server = undefined
  }

  private withPreview(project: Omit<DesignProjectState, 'preview'>): DesignProjectState {
    const preview = this.preview?.root === project.root ? this.preview : undefined
    return { ...project, ...(preview ? { preview } : {}) }
  }

  private async scan(workspace: WorkspaceState): Promise<Omit<DesignProjectState, 'preview'>> {
    const root = workspace.root
    const blocked = workspace.binding === 'unlinked' || workspace.binding === 'missing'
    if (blocked) {
      const project = emptyProject(root)
      this.cache = { root, project }
      return project
    }

    const files = await walkWorkspace(root)
    const fileSet = new Set(files)
    const packageJson = await readJsonRecord(root, 'package.json')
    const componentsJson = fileSet.has('components.json') ? await readJsonRecord(root, 'components.json') : undefined
    const dependencies = dependencyNames(packageJson)
    const frameworks = detectFrameworks(dependencies)
    const packageManager = detectPackageManager(fileSet)
    const devCommand = detectDevCommand(packageJson, packageManager)
    const templates = detectTemplates(files)
    const shadcn = detectShadcn(files, componentsJson)
    const kind = detectKind(shadcn, frameworks, templates)
    const project: Omit<DesignProjectState, 'preview'> = {
      root,
      kind,
      frameworks,
      ...(packageManager ? { packageManager } : {}),
      ...(devCommand ? { devCommand } : {}),
      templates,
      shadcn,
      capabilities: {
        liveApp: Boolean(devCommand) || frameworks.length > 0,
        htmlTemplates: templates.length > 0,
        shadcn: shadcn.detected,
        canvas: true,
      },
    }
    this.cache = { root, project }
    return project
  }

  private async ensureStaticServer(root: string): Promise<number> {
    if (this.server && this.serverRoot === root && this.serverPort) return this.serverPort
    await this.closeServer()

    const server = createServer((request, response) => {
      void serveWorkspaceFile(root, request.url ?? '/', request.method ?? 'GET', response)
        .catch(() => send(response, 500, 'text/plain; charset=utf-8', 'Internal preview error'))
    })
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolvePromise()
      })
    })
    const address = server.address() as AddressInfo | null
    if (!address?.port) {
      server.close()
      throw new Error('Static preview server did not bind to a loopback port')
    }
    this.server = server
    this.serverRoot = root
    this.serverPort = address.port
    return address.port
  }

  private async closeServer(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.serverRoot = undefined
    this.serverPort = undefined
    if (!server) return
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
}

function emptyProject(root: string): Omit<DesignProjectState, 'preview'> {
  return {
    root,
    kind: 'canvas',
    frameworks: [],
    templates: [],
    shadcn: { detected: false, components: [] },
    capabilities: { liveApp: false, htmlTemplates: false, shadcn: false, canvas: true },
  }
}

async function walkWorkspace(root: string): Promise<string[]> {
  const files: string[] = []
  let visited = 0

  async function visit(relativeDirectory: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_ENTRIES) return
    const absoluteDirectory = resolve(root, relativeDirectory || '.')
    let entries: Dirent[]
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (visited >= MAX_SCAN_ENTRIES) break
      visited += 1
      if (entry.isSymbolicLink() || SKIPPED.has(entry.name)) continue
      const relativePath = normalizeRelativePath(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name)
      if (entry.isDirectory()) await visit(relativePath, depth + 1)
      else if (entry.isFile()) files.push(relativePath)
    }
  }

  await visit('', 0)
  return files
}

function detectTemplates(files: string[]): DesignTemplateEntry[] {
  return files.flatMap((path) => {
    const extension = extname(path).toLowerCase()
    const kind = STATIC_TEMPLATE_EXTENSIONS.get(extension)
    if (!kind) return []
    const name = path.split('/').at(-1) ?? path
    return [{
      path,
      name,
      kind,
      previewable: kind === 'html',
      entry: kind === 'html' && /^index\.html?$/i.test(name),
    } satisfies DesignTemplateEntry]
  }).sort((left, right) => Number(right.entry) - Number(left.entry) || pathDepth(left.path) - pathDepth(right.path) || left.path.localeCompare(right.path))
}

function detectShadcn(files: string[], config: Record<string, unknown> | undefined): DesignShadcnState {
  const components: DesignComponentEntry[] = files.flatMap((path) => {
    const match = /(?:^|\/)(?:src\/)?components\/ui\/([^/]+)\.(?:tsx|jsx|ts|js)$/i.exec(path)
    if (!match?.[1]) return []
    return [{ name: componentName(match[1]), path, kind: 'shadcn' as const }]
  }).sort((left, right) => left.name.localeCompare(right.name))

  const tailwind = config?.tailwind && typeof config.tailwind === 'object'
    ? config.tailwind as Record<string, unknown>
    : undefined
  return {
    detected: Boolean(config) || components.length > 0,
    ...(config ? { configPath: 'components.json' } : {}),
    ...(typeof config?.style === 'string' ? { style: config.style } : {}),
    ...(typeof tailwind?.baseColor === 'string' ? { baseColor: tailwind.baseColor } : {}),
    ...(typeof tailwind?.cssVariables === 'boolean' ? { cssVariables: tailwind.cssVariables } : {}),
    components,
  }
}

function detectFrameworks(dependencies: Set<string>): string[] {
  const frameworks: string[] = []
  const candidates = [
    ['next', 'Next.js'],
    ['react', 'React'],
    ['vite', 'Vite'],
    ['@vitejs/plugin-react', 'Vite'],
    ['vue', 'Vue'],
    ['nuxt', 'Nuxt'],
    ['svelte', 'Svelte'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['astro', 'Astro'],
  ] as const
  for (const [dependency, label] of candidates) {
    if (dependencies.has(dependency) && !frameworks.includes(label)) frameworks.push(label)
  }
  return frameworks
}

function detectKind(shadcn: DesignShadcnState, frameworks: string[], templates: DesignTemplateEntry[]): DesignProjectKind {
  if (shadcn.detected) return 'shadcn'
  if (frameworks.includes('Next.js')) return 'next'
  if (frameworks.includes('React')) return 'react'
  if (frameworks.includes('Vite')) return 'vite'
  if (templates.some((entry) => entry.previewable)) return 'static-html'
  if (frameworks.length > 0) return 'web'
  return 'canvas'
}

function dependencyNames(packageJson: Record<string, unknown> | undefined): Set<string> {
  const result = new Set<string>()
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const group = packageJson?.[key]
    if (!group || typeof group !== 'object') continue
    for (const dependency of Object.keys(group)) result.add(dependency)
  }
  return result
}

function detectPackageManager(files: Set<string>): DesignProjectState['packageManager'] | undefined {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('package-lock.json')) return 'npm'
  return undefined
}

function detectDevCommand(packageJson: Record<string, unknown> | undefined, packageManager: DesignProjectState['packageManager']): string | undefined {
  const scripts = packageJson?.scripts
  if (!scripts || typeof scripts !== 'object' || typeof (scripts as Record<string, unknown>).dev !== 'string') return undefined
  const runner = packageManager ?? 'npm'
  return runner === 'npm' ? 'npm run dev' : `${runner} dev`
}

async function readJsonRecord(root: string, relativePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await fs.readFile(resolve(root, relativePath), 'utf8')
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function serveWorkspaceFile(root: string, requestUrl: string, method: string, response: ServerResponse): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    send(response, 405, 'text/plain; charset=utf-8', 'Method not allowed')
    return
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname)
  } catch {
    send(response, 400, 'text/plain; charset=utf-8', 'Invalid preview path')
    return
  }
  const relativePath = normalizeRelativePath(pathname.replace(/^\/+/, ''))
  if (!relativePath) {
    send(response, 404, 'text/plain; charset=utf-8', 'Preview file not found')
    return
  }
  if (!isSafeStaticPath(relativePath)) {
    send(response, 403, 'text/plain; charset=utf-8', 'Preview path is not a public web asset')
    return
  }

  let candidate = resolve(root, relativePath)
  if (!isInside(root, candidate)) {
    send(response, 403, 'text/plain; charset=utf-8', 'Forbidden')
    return
  }

  try {
    let stats = await fs.lstat(candidate)
    if (stats.isSymbolicLink()) throw new Error('symbolic links are not served')
    if (stats.isDirectory()) {
      candidate = resolve(candidate, 'index.html')
      if (!isInside(root, candidate)) throw new Error('path escapes workspace')
      stats = await fs.lstat(candidate)
      if (stats.isSymbolicLink()) throw new Error('symbolic links are not served')
    }
    if (!stats.isFile()) throw new Error('not a file')
    const body = method === 'HEAD' ? Buffer.alloc(0) : await fs.readFile(candidate)
    response.statusCode = 200
    response.setHeader('Content-Type', MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream')
    response.setHeader('Content-Length', method === 'HEAD' ? stats.size : body.length)
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(body)
  } catch {
    send(response, 404, 'text/plain; charset=utf-8', 'Preview file not found')
  }
}

function isSafeStaticPath(path: string): boolean {
  const segments = normalizeRelativePath(path).split('/')
  if (segments.some((segment) => !segment || segment.startsWith('.'))) return false
  const name = segments.at(-1)?.toLowerCase() ?? ''
  if (BLOCKED_STATIC_NAMES.has(name) || name.startsWith('tsconfig.') || name.startsWith('vite.config.') || name.startsWith('next.config.')) return false
  return Object.hasOwn(MIME_TYPES, extname(name).toLowerCase())
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  if (response.headersSent) return
  response.statusCode = status
  response.setHeader('Content-Type', contentType)
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate))
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
}

function encodeRelativePath(path: string): string {
  return normalizeRelativePath(path).split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function componentName(fileName: string): string {
  return fileName.split(/[-_.]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function pathDepth(path: string): number {
  return path.split('/').length
}
