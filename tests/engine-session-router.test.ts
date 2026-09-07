import { describe, expect, it, vi } from 'vitest'
import { EngineSessionRouter, isRestorableBrowserUrl } from '../src/main/engines/engine-session-router.js'
import type { WorkspaceState } from '../src/shared/contracts.js'
import { ND_WORKSPACE_CONTEXT_MARKER } from '../src/shared/workspace-context.js'

const workspaceState: WorkspaceState = {
  root: 'C:/projects/parent/examples',
  name: 'examples',
  binding: 'project',
  projectId: 'blog-news',
  projectName: 'Blog News',
  projectObjective: 'Publish local news and community stories.',
}

function fixture() {
  const run = vi.fn(async () => ({ sessionId: 'session-1' }))
  const direct = { run, stop: vi.fn(), listModels: async () => [{ id: 'native-model' }], ownsSession: (id: string) => id === 'session-1' }
  const harness = { run: vi.fn(), stop: vi.fn(), gatewayRpc: vi.fn(async () => ({ ok: true })), status: () => ({}) }
  const workspace = { state: () => workspaceState, assertUsable: vi.fn() }
  const router = new EngineSessionRouter(harness as never, direct as never, workspace as never, direct as never, undefined, direct as never, direct as never, direct as never, direct as never)
  return { router, run, workspace, harness, direct }
}

describe('session-scoped cancellation', () => {
  it('cancels only the requested harness session', async () => {
    const { router, harness, direct } = fixture()
    await router.stopSession('harness-session')
    expect(harness.gatewayRpc).toHaveBeenCalledWith('session.cancel', { sessionId: 'harness-session' })
    expect(harness.stop).not.toHaveBeenCalled()
    expect(direct.stop).not.toHaveBeenCalled()
  })

  it('passes the session id to its owning direct adapter', async () => {
    const { router, harness, direct } = fixture()
    await router.stopSession('session-1')
    expect(direct.stop).toHaveBeenCalledExactlyOnceWith('session-1')
    expect(harness.gatewayRpc).not.toHaveBeenCalled()
    expect(harness.stop).not.toHaveBeenCalled()
  })
})

describe('direct engine workspace context', () => {
  it.each(['antigravity', 'codex-cli', 'zcode-cli', 'pi-coding', 'cursor-cli', 'claude-code-cli'])('routes the catalog and selected model for %s', async (engineId) => {
    const { router, run } = fixture()
    await expect(router.models(engineId)).resolves.toEqual([{ id: 'native-model' }])
    await router.run('hello', { engineId, model: 'native-model' })
    expect(run).toHaveBeenCalledWith(expect.any(String), { cwd: workspaceState.root, model: 'native-model' })
  })

  it.each(['antigravity', 'codex-cli', 'zcode-cli', 'pi-coding', 'cursor-cli', 'claude-code-cli'])('sends the selected project and exact folder to %s', async (engineId) => {
    const { router, run, workspace } = fixture()
    await router.run('project about?', { engineId })
    expect(workspace.assertUsable).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(expect.stringContaining('project about?'), { cwd: workspaceState.root })
    const prompt = (run.mock.calls[0] as unknown as [string])[0]
    expect(prompt.split(ND_WORKSPACE_CONTEXT_MARKER)).toHaveLength(2)
    expect(prompt).toContain('"projectName": "Blog News"')
    expect(prompt).toContain('"projectObjective": "Publish local news and community stories."')
    expect(prompt).toContain('"workingDirectory": "C:/projects/parent/examples"')
  })

  it('does not start a direct engine for an unavailable project workspace', async () => {
    const { router, run, workspace } = fixture()
    workspace.assertUsable.mockImplementation(() => { throw new Error('Project workspace is unavailable') })
    await expect(router.run('project about?', { engineId: 'antigravity' })).rejects.toThrow('workspace is unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('leaves Harness context attachment to the Harness service', async () => {
    const { router, run, harness } = fixture()
    await router.run('project about?')
    expect(harness.run).toHaveBeenCalledWith('project about?', undefined)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('ChatGPT Web browser restoration', () => {
  it('does not restore the empty browser state over a completed chat', () => {
    expect(isRestorableBrowserUrl('about:blank')).toBe(false)
    expect(isRestorableBrowserUrl('ABOUT:BLANK')).toBe(false)
    expect(isRestorableBrowserUrl('https://chatgpt.com/c/abc')).toBe(false)
    expect(isRestorableBrowserUrl('http://localhost:5173/')).toBe(true)
  })
})
