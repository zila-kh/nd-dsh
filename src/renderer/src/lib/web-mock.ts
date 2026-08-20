import type { WorkspaceEntry, WorkspaceFile, WorkspaceState } from '../../../shared/contracts'

/**
 * Demo data for web mode. The renderer has no file system access in a plain
 * browser tab, so the web bridge serves this fixture tree instead — enough to
 * explore every panel while iterating on the UI.
 */

interface MockNode {
  name: string
  kind: 'file' | 'directory'
  children?: MockNode[]
}

interface MockWorkspace {
  root: string
  name: string
  tree: MockNode[]
}

const APP_TREE: MockNode[] = [
  {
    name: 'src',
    kind: 'directory',
    children: [
      {
        name: 'main',
        kind: 'directory',
        children: [{ name: 'index.ts', kind: 'file' }],
      },
      {
        name: 'renderer',
        kind: 'directory',
        children: [
          { name: 'App.tsx', kind: 'file' },
          { name: 'styles.css', kind: 'file' },
        ],
      },
      {
        name: 'shared',
        kind: 'directory',
        children: [{ name: 'contracts.ts', kind: 'file' }],
      },
    ],
  },
  { name: 'package.json', kind: 'file' },
  { name: 'README.md', kind: 'file' },
  { name: '.gitignore', kind: 'file' },
]

const STATIC_TREE: MockNode[] = [
  {
    name: 'assets',
    kind: 'directory',
    children: [{ name: 'logo.svg', kind: 'file' }],
  },
  { name: 'index.html', kind: 'file' },
  { name: 'styles.css', kind: 'file' },
  { name: 'README.md', kind: 'file' },
]

const WORKSPACES: MockWorkspace[] = [
  { root: '/Users/dev/nd-dsh', name: 'nd-dsh', tree: APP_TREE },
  { root: '/Users/dev/web-preview', name: 'web-preview', tree: STATIC_TREE },
]

const GENERIC_TREE: MockNode[] = [
  {
    name: 'src',
    kind: 'directory',
    children: [{ name: 'index.ts', kind: 'file' }],
  },
  {
    name: 'public',
    kind: 'directory',
    children: [{ name: 'index.html', kind: 'file' }],
  },
  { name: 'package.json', kind: 'file' },
  { name: 'README.md', kind: 'file' },
]

const CONTENTS: Record<string, string> = {
  'src/main/index.ts': `import { createServer } from 'http'

const port = Number(process.env.PORT ?? 5173)

const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/plain')
  response.end('Hello from the mock workspace')
})

server.listen(port, () => {
  console.log('listening on http://localhost:' + port)
})
`,
  'src/renderer/App.tsx': `import { useState } from 'react'

export function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="app-shell">
      <h1>nd-dsh</h1>
      <button onClick={() => setCount((value) => value + 1)}>
        Clicked {count} times
      </button>
    </main>
  )
}
`,
  'src/renderer/styles.css': `:root {
  color-scheme: dark;
  --bg: #090b0e;
  --surface-0: #0b0e12;
  --accent: #a6f06d;
}

.app-shell {
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr) 24px;
  height: 100vh;
}

button:focus-visible {
  outline: 1px solid var(--accent);
}
`,
  'src/shared/contracts.ts': `export interface WorkspaceState {
  root: string
  name: string
}

export interface WorkspaceEntry {
  name: string
  relativePath: string
  kind: 'file' | 'directory'
}

export interface WorkspaceFile {
  relativePath: string
  content: string
  truncated: boolean
}
`,
  'package.json': `{
  "name": "nd-dsh",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json"
  },
  "devDependencies": {
    "electron": "43.4.0",
    "typescript": "7.0.2"
  }
}
`,
  'README.md': `# nd-dsh

Cursor-style Electron IDE shell powered by DeepSeek Harness.

## Getting started

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Layout

- \`src/main\` — Electron main process
- \`src/preload\` — sandboxed bridge
- \`src/renderer\` — React workbench
`,
  '.gitignore': `node_modules/
out/
dist/
.env
*.log
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Web preview</title>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
`,
  'styles.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #f4f5f7;
  color: #1b2128;
}
`,
  'assets/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="2.75" y="4" width="18.5" height="16" rx="2" fill="none" stroke="#a6f06d" stroke-width="1.7"/>
</svg>
`,
}

function genericContent(relativePath: string): string {
  const extension = relativePath.split('.').pop()
  if (extension === 'json') return '{\n  "preview": true\n}\n'
  if (extension === 'md') return `# ${relativePath}\n\nPlaceholder content for the web preview.\n`
  if (extension === 'css') return `/* ${relativePath} */\n`
  return `// ${relativePath}\n// Placeholder content for the web preview.\n`
}

function findChildren(nodes: MockNode[], relativePath: string | undefined): MockNode[] {
  if (!relativePath || relativePath === '.') return nodes
  const parts = relativePath.split('/')
  let current = nodes
  for (const part of parts) {
    const directory = current.find((node) => node.name === part && node.kind === 'directory')
    if (!directory?.children) return []
    current = directory.children
  }
  return current
}

function pathBasename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) ?? path
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

async function resolveDirHandle(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle> {
  let dir = handle
  for (const part of relativePath.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part)
  }
  return dir
}

/** Read a real directory tree through the File System Access API. */
async function listReal(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<WorkspaceEntry[]> {
  const dir = await resolveDirHandle(handle, relativePath)
  const entries: WorkspaceEntry[] = []
  for await (const [name, child] of dir.entries()) {
    entries.push({
      name,
      relativePath: relativePath === '.' ? name : `${relativePath}/${name}`,
      kind: child.kind === 'directory' ? 'directory' : 'file',
    })
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  return entries
}

/** Read a real file through the File System Access API. */
async function readReal(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<WorkspaceFile> {
  const parts = relativePath.split('/').filter(Boolean)
  let dir = handle
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
  const fileHandle = await dir.getFileHandle(parts.at(-1) ?? '')
  const file = await fileHandle.getFile()
  const content = await file.text()
  return { relativePath, content, truncated: content.length > 500_000 }
}

export class MockWorkspaceService {
  private index = 0
  private custom: MockWorkspace | null = null
  private real: FileSystemDirectoryHandle | null = null

  private current(): MockWorkspace {
    return WORKSPACES[this.index % WORKSPACES.length] ?? WORKSPACES[0]!
  }

  state(): WorkspaceState {
    if (this.real) return { root: this.real.name, name: this.real.name }
    const workspace = this.custom ?? this.current()
    return { root: workspace.root, name: workspace.name }
  }

  async pick(): Promise<WorkspaceState> {
    const picker = window.showDirectoryPicker
    if (typeof picker === 'function') {
      try {
        const handle = await picker.call(window, { id: 'nd-dsh-workspace', mode: 'read' })
        this.custom = null
        this.real = handle
        return this.state()
      } catch (cause) {
        if (isAbortError(cause)) return this.state()
        // Unsupported or denied: fall back to the fixture cycle below.
      }
    }
    this.custom = null
    this.real = null
    this.index = (this.index + 1) % WORKSPACES.length
    return this.state()
  }

  setRoot(path: string): WorkspaceState {
    this.real = null
    this.custom = {
      root: path,
      name: pathBasename(path) || path,
      tree: GENERIC_TREE,
    }
    return this.state()
  }

  async list(relativePath = '.'): Promise<WorkspaceEntry[]> {
    if (this.real) return listReal(this.real, relativePath)
    const workspace = this.custom ?? this.current()
    return findChildren(workspace.tree, relativePath).map((node) => ({
      name: node.name,
      relativePath: relativePath && relativePath !== '.' ? `${relativePath}/${node.name}` : node.name,
      kind: node.kind,
    }))
  }

  async read(relativePath: string): Promise<WorkspaceFile> {
    if (this.real) return readReal(this.real, relativePath)
    const content = CONTENTS[relativePath] ?? genericContent(relativePath)
    return { relativePath, content, truncated: false }
  }
}
