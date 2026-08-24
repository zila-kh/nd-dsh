import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { OrganizationStore } from '../src/main/organization/store.js'
import { ProjectRuntimeService, type ProjectRuntimeOptions } from '../src/main/workspace/project-runtime.js'

interface FakeChild {
  process: ChildProcess
  killed: boolean
}

function fakeChild(): FakeChild {
  const exitCallbacks: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  const child: FakeChild = { killed: false, process: undefined as unknown as ChildProcess }
  child.process = {
    pid: 4242,
    // A live process reports null here (not undefined) — killProcessTree relies on it.
    exitCode: null,
    signalCode: null,
    stdout: { setEncoding() {}, on() {} },
    stderr: { setEncoding() {}, on() {} },
    once(event: string, callback: () => void) {
      if (event === 'exit') exitCallbacks.push(callback as (code: number | null, signal: NodeJS.Signals | null) => void)
    },
    kill() {
      child.killed = true
      for (const callback of exitCallbacks.splice(0)) callback(null, 'SIGTERM')
    },
  } as unknown as ChildProcess
  return child
}

interface Fixture {
  service: ProjectRuntimeService
  store: OrganizationStore
  projectId: string
  workspaceRoot: string
  readyUrls: string[]
  children: FakeChild[]
  spawnCommands: Array<{ command: string; cwd?: string }>
}

async function serviceFixture(options?: Partial<ProjectRuntimeOptions>): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-runtime-'))
  const store = new OrganizationStore(join(dir, 'organization.json'))
  const seeded = await store.mutate({ type: 'company.create', name: 'Beta Co', mission: 'Ship the beta' })
  const companyId = seeded.companies[0]!.id
  const state = await store.mutate({ type: 'project.create', companyId, name: 'Todo Beta', objective: 'Ship Todo', workspacePath: dir })
  const project = state.projects.find((item) => item.companyId === companyId)!
  const fixture: Fixture = {
    store,
    projectId: project.id,
    workspaceRoot: dir,
    readyUrls: [],
    children: [],
    spawnCommands: [],
    service: undefined as unknown as ProjectRuntimeService,
  }
  fixture.service = new ProjectRuntimeService({
    store,
    spawnProcess: ((command: string, opts: { cwd?: string }) => {
      fixture.spawnCommands.push({ command, ...(opts?.cwd ? { cwd: opts.cwd } : {}) })
      const child = fakeChild()
      fixture.children.push(child)
      return child.process
    }) as unknown as typeof spawn,
    fetchFn: (async () => ({ status: 200 })) as unknown as typeof fetch,
    onTargetReady: (_projectId: string, url: string) => fixture.readyUrls.push(url),
    ...options,
  })
  return fixture
}

describe('ProjectRuntimeService', () => {
  it('defaults the browser target to localhost:3000 instead of assuming an ND-DSH port', async () => {
    const fixture = await serviceFixture()
    const status = await fixture.service.status(fixture.projectId)
    expect(status.targetUrl).toBe('http://localhost:3000/')
    expect(status.port).toBe(3000)
    expect(status.state).toBe('stopped')
  })

  it('prefers an explicit target URL over the port and exposes its port', async () => {
    const fixture = await serviceFixture()
    await fixture.service.status(fixture.projectId)
    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { targetUrl: 'localhost:4000/app' } })
    const status = await fixture.service.status(fixture.projectId)
    expect(status.targetUrl).toBe('http://localhost:4000/app')
    expect(status.port).toBe(4000)
  })

  it('refuses the ND-DSH control-plane origin as a project target', async () => {
    const fixture = await serviceFixture({ reservedOrigin: () => 'http://localhost:5173' })
    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { targetUrl: 'http://localhost:5173/#/agent' } })
    await expect(fixture.service.check(fixture.projectId)).rejects.toThrow(/control-plane preview/i)
    expect(fixture.readyUrls).toEqual([])
  })

  it('marks a healthy target ready, reports validation findings, and fires open-in-browser', async () => {
    const fixture = await serviceFixture()
    const status = await fixture.service.check(fixture.projectId)
    expect(status.state).toBe('ready')
    expect(status.checkedAt).toBeTypeOf('number')
    expect(fixture.readyUrls).toEqual(['http://localhost:3000/'])
    // The temp workspace has no package.json; validation must say so plainly.
    expect(status.validation?.join('\n')).toMatch(/package\.json/i)
  })

  it('reports an unreachable target instead of pretending success', async () => {
    const fixture = await serviceFixture({
      fetchFn: (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch,
    })
    const status = await fixture.service.check(fixture.projectId)
    expect(status.state).toBe('unreachable')
    expect(status.lastError).toMatch(/nothing answered at http:\/\/localhost:3000\//i)
    expect(fixture.readyUrls).toEqual([])
  })

  it('joins health paths without a duplicate slash', async () => {
    const requested: string[] = []
    const fixture = await serviceFixture({
      fetchFn: (async (url: string | URL) => {
        requested.push(String(url))
        return { status: 200 }
      }) as unknown as typeof fetch,
    })
    await fixture.service.check(fixture.projectId)
    expect(requested).toEqual(['http://localhost:3000/'])

    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { healthCheckPath: '/healthz' } })
    await fixture.service.check(fixture.projectId)
    expect(requested.at(-1)).toBe('http://localhost:3000/healthz')
  })

  it('spawns the start command in the project workspace and flips to ready when health passes', async () => {
    const fixture = await serviceFixture()
    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { startCommand: 'npm run dev' } })
    const status = await fixture.service.start(fixture.projectId)
    expect(status.state).toBe('ready')
    expect(status.pid).toBe(4242)
    expect(fixture.spawnCommands[0]?.cwd).toBe(fixture.workspaceRoot)
    expect(fixture.children[0]?.killed).toBe(false)
    expect(fixture.readyUrls).toEqual(['http://localhost:3000/'])
  })

  it('stops a running dev server tree on demand and reports stopped', async () => {
    const fixture = await serviceFixture()
    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { startCommand: 'npm run dev' } })
    await fixture.service.start(fixture.projectId)
    const status = await fixture.service.stop(fixture.projectId)
    expect(status.state).toBe('stopped')
    expect(status.pid).toBeUndefined()
    expect(fixture.children[0]?.killed).toBe(true)
  })

  it('stops a dev server spawned for another workspace when the active workspace changes', async () => {
    const fixture = await serviceFixture()
    await fixture.store.mutate({ type: 'project.update', id: fixture.projectId, patch: { startCommand: 'npm run dev' } })
    await fixture.service.start(fixture.projectId)
    await fixture.service.handleWorkspaceChanged(join(fixture.workspaceRoot, 'elsewhere'))
    expect(fixture.children[0]?.killed).toBe(true)
    const status = await fixture.service.status(fixture.projectId)
    expect(status.state).toBe('stopped')
  })

  it('treats projects without a start command as externally managed and only probes them', async () => {
    const fixture = await serviceFixture()
    const status = await fixture.service.start(fixture.projectId)
    expect(fixture.spawnCommands).toHaveLength(0)
    expect(status.state).toBe('ready')
  })
})
