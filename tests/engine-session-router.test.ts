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
  const run = vi.fn(async (_prompt: string, options?: { sessionId?: string }) => ({ sessionId: options?.sessionId ?? 'session-1' }))
  const sessions = new Map<string, { sessionId: string; engineId: string; cwd?: string; title: string; createdAt: number; updatedAt: number; running: boolean }>()
  let counter = 0
  const direct = {
    run,
    stop: vi.fn(),
    listModels: async () => [{ id: 'native-model' }],
    ownsSession: (id: string) => id === 'session-1' || sessions.has(id),
    createSession: vi.fn(async (input: { cwd?: string } = {}) => {
      counter += 1
      const sessionId = `direct-${counter}`
      sessions.set(sessionId, { sessionId, engineId: 'direct', ...(input.cwd ? { cwd: input.cwd } : {}), title: sessionId, createdAt: Date.now(), updatedAt: Date.now(), running: false })
      return { sessionId }
    }),
    listSessions: () => [...sessions.values()],
    transcript: (sessionId: string) => ({ sessionId, engineId: 'direct', events: [] }),
    handlesApproval: () => false,
    respond: vi.fn(),
  }
  const harness = { run: vi.fn(), stop: vi.fn(), gatewayRpc: vi.fn(async () => ({ ok: true })), status: () => ({}) }
  const workspace = { state: () => workspaceState, assertUsable: vi.fn() }
  const router = new EngineSessionRouter(harness as never, direct as never, workspace as never, direct as never, undefined, direct as never, direct as never, direct as never, direct as never)
  return { router, run, workspace, harness, direct, sessions }
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

  it('keeps mixed direct-engine task sessions on their ND-bound worktree roots', async () => {
    const { router, run } = fixture()
    const codexRoot = 'C:/projects/parent/.nd-dsh-worktrees/repo/task-codex'
    const zcodeRoot = 'C:/projects/parent/.nd-dsh-worktrees/repo/task-zcode'
    router.setWorktreeGuard((cwd) => cwd === codexRoot || cwd === zcodeRoot)

    const codex = await router.createSession('codex-cli', codexRoot)
    const zcode = await router.createSession('zcode-cli', zcodeRoot)

    await router.run('codex task', { sessionId: codex.sessionId })
    await router.run('zcode task', { sessionId: zcode.sessionId })

    expect(run).toHaveBeenNthCalledWith(1, expect.any(String), { sessionId: codex.sessionId, cwd: codexRoot })
    expect(run).toHaveBeenNthCalledWith(2, expect.any(String), { sessionId: zcode.sessionId, cwd: zcodeRoot })
  })

  it('fails closed if a direct adapter reports a different cwd than the ND session binding', async () => {
    const { router, sessions } = fixture()
    const root = 'C:/projects/parent/.nd-dsh-worktrees/repo/task-a'
    router.setWorktreeGuard((cwd) => cwd === root)
    const session = await router.createSession('zcode-cli', root)
    const row = sessions.get(session.sessionId)
    if (!row) throw new Error('missing fake direct session')
    row.cwd = 'C:/projects/other'

    await expect(router.run('should fail', { sessionId: session.sessionId })).rejects.toThrow(/changed the ND-bound task workspace/i)
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