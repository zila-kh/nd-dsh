import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignService } from '../src/main/design/design-service.js'
import type { BrowserController } from '../src/main/browser/browser-controller.js'
import type { WorkspaceService } from '../src/main/workspace/workspace-service.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('DesignService', () => {
  it('indexes HTML templates, shadcn components, and Freeform documents from the active workspace', async () => {
    const root = await makeWorkspace()
    await fs.mkdir(join(root, 'src/components/ui'), { recursive: true })
    await fs.mkdir(join(root, 'templates'), { recursive: true })
    await fs.mkdir(join(root, '.nd/design'), { recursive: true })
    await fs.writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^8.0.0' },
    }))
    await fs.writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await fs.writeFile(join(root, 'components.json'), JSON.stringify({
      style: 'new-york',
      tailwind: { baseColor: 'zinc', cssVariables: true },
    }))
    await fs.writeFile(join(root, 'src/components/ui/button.tsx'), 'export const Button = () => null\n')
    await fs.writeFile(join(root, 'templates/index.html'), '<!doctype html><title>Template</title>')
    await fs.writeFile(join(root, 'templates/page.hbs'), '<main>{{title}}</main>')
    await fs.writeFile(join(root, '.nd/design/home.op'), '{}')

    const design = new DesignService(workspaceStub(root), browserStub().api)
    const state = await design.refresh()

    expect(state.kind).toBe('shadcn')
    expect(state.frameworks).toEqual(['React', 'Vite'])
    expect(state.packageManager).toBe('pnpm')
    expect(state.devCommand).toBe('pnpm dev')
    expect(state.shadcn).toMatchObject({ detected: true, configPath: 'components.json', style: 'new-york', baseColor: 'zinc', cssVariables: true })
    expect(state.shadcn.components).toEqual([{ name: 'Button', path: 'src/components/ui/button.tsx', kind: 'shadcn' }])
    expect(state.templates.map((entry) => [entry.path, entry.previewable])).toEqual([
      ['templates/index.html', true],
      ['templates/page.hbs', false],
    ])
    expect(state.freeform.documents).toEqual([{ name: 'home.op', path: '.nd/design/home.op' }])
    expect(state.capabilities).toEqual({ liveApp: true, htmlTemplates: true, shadcn: true, canvas: true, freeform: true })
  })

  it('serves static HTML on loopback while blocking workspace secrets', async () => {
    const root = await makeWorkspace()
    await fs.writeFile(join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="style.css"><h1>ND</h1>')
    await fs.writeFile(join(root, 'style.css'), 'h1 { font-weight: 700; }')
    await fs.writeFile(join(root, '.env'), 'SECRET=do-not-serve\n')
    const browser = browserStub()
    const design = new DesignService(workspaceStub(root), browser.api)

    const preview = await design.previewHtml('index.html')
    expect(preview.kind).toBe('static-html')
    expect(browser.navigate).toHaveBeenCalledWith(preview.url)

    const page = await fetch(preview.url)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<h1>ND</h1>')

    const secret = await fetch(new URL('/.env', preview.url))
    expect(secret.status).toBe(403)

    await design.stopPreview()
    expect(browser.currentUrl()).toBe('about:blank')
  })

  it('keeps code and Freeform canvases available for an empty workspace', async () => {
    const root = await makeWorkspace()
    const design = new DesignService(workspaceStub(root), browserStub().api)
    const state = await design.refresh()
    expect(state.kind).toBe('canvas')
    expect(state.capabilities.canvas).toBe(true)
    expect(state.capabilities.freeform).toBe(true)
    expect(state.templates).toEqual([])
    expect(state.shadcn.detected).toBe(false)
    expect(state.freeform.documents).toEqual([])
  })
})

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'nd-dsh-design-'))
  temporaryRoots.push(root)
  return root
}

function workspaceStub(root: string): WorkspaceService {
  return {
    state: () => ({ root, name: 'design-test', binding: 'standalone' }),
  } as unknown as WorkspaceService
}

function browserStub(): { api: BrowserController; navigate: ReturnType<typeof vi.fn>; currentUrl(): string } {
  let url = 'about:blank'
  const navigate = vi.fn(async (next: string) => {
    url = next
    return { url }
  })
  const api = {
    state: () => ({ url }),
    navigate,
  } as unknown as BrowserController
  return { api, navigate, currentUrl: () => url }
}
