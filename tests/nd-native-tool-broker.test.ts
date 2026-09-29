import { describe, expect, it, vi } from 'vitest'
import { NdNativeToolBroker } from '../src/main/engines/nd-native/nd-native-tool-broker.js'
import { BUILTIN_BROWSER_TARGET_ID } from '../src/main/browser/browser-controller.js'

const project = 'C:/projects/nd-app'

function fixture(cwd = project) {
  const request = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === 'workspace.read') return { root: params.root, path: params.path, data: 'hello' }
    return { ok: true }
  })
  const callAgent = vi.fn(async () => ({ ok: true }))
  const broker = new NdNativeToolBroker({
    core: { request } as never,
    browser: { callAgent, issueSessionAccess: () => 'opaque-test-token' } as never,
    workspace: { state: () => ({ root: project }) } as never,
    ownsWorktree: () => false,
    engine: () => ({ listSessions: () => [{ sessionId: 'nd-native-one', cwd }] }) as never,
  })
  return { broker, request, callAgent }
}

describe('ND Agent trusted tool broker', () => {
  it('rejects a forged session workspace before any effect is journaled', async () => {
    const { broker, request } = fixture()
    await expect(broker.call({ sessionId: 'nd-native-one', cwd: 'C:/elsewhere', name: 'nd_workspace_read', arguments: { path: 'a.txt' } })).rejects.toThrow(/workspace-bound/)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a stored session outside the active project', async () => {
    const { broker, request } = fixture('C:/projects/other')
    await expect(broker.call({ sessionId: 'nd-native-one', cwd: 'C:/projects/other', name: 'nd_workspace_read', arguments: { path: 'a.txt' } })).rejects.toThrow(/outside the active project/)
    expect(request).not.toHaveBeenCalled()
  })

  it('journals before calling the bounded core workspace reader', async () => {
    const { broker, request } = fixture()
    await broker.call({ sessionId: 'nd-native-one', cwd: project, name: 'nd_workspace_read', arguments: { path: 'a.txt' } })
    expect(request.mock.calls.map(([method]) => method)).toEqual(['effectJournal.append', 'workspace.read', 'effectJournal.append'])
    expect(request.mock.calls[0]?.[1].state).toBe('intent')
    expect(request.mock.calls[2]?.[1].state).toBe('complete')
    expect(request.mock.calls[2]?.[1].idempotencyKey).toBe(request.mock.calls[0]?.[1].idempotencyKey)
    expect(request.mock.calls[1]?.[1]).toMatchObject({ root: project, path: 'a.txt', maxBytes: 1024 * 1024 })
  })

  it('injects browser access in the trusted host and blocks other method families', async () => {
    const { broker, callAgent } = fixture()
    await broker.call({ sessionId: 'nd-native-one', cwd: project, name: 'nd_browser_call', arguments: { method: 'browser.targets', params: {} } })
    expect(callAgent).toHaveBeenCalledWith('browser.targets', { targetId: BUILTIN_BROWSER_TARGET_ID, accessToken: 'opaque-test-token' })
    await expect(broker.call({ sessionId: 'nd-native-one', cwd: project, name: 'nd_browser_call', arguments: { method: 'admin.shutdown', params: {} } })).rejects.toThrow(/invalid/)
    expect(callAgent).toHaveBeenCalledTimes(1)
  })

  it('fails closed for native effects that have no verified sandbox', async () => {
    const { broker } = fixture()
    await expect(broker.call({ sessionId: 'nd-native-one', cwd: project, name: 'nd_shell', arguments: { command: 'echo hello' } })).rejects.toThrow(/unavailable/)
  })

  it('marks an interrupted effect uncertain without dispatching the tool again', async () => {
    const { broker, request } = fixture()
    request.mockImplementation(async (method: string) => {
      if (method === 'effectJournal.replay') return {
        records: [{ seq: 1, kind: 'nd-agent.tool', state: 'intent', resourceId: 'nd-native-one', idempotencyKey: 'nd-agent:one', data: { name: 'nd_browser_call' } }],
        truncated: false,
      }
      return { ok: true }
    })
    await expect(broker.reconcile()).resolves.toBe(1)
    expect(request.mock.calls.map(([method]) => method)).toEqual(['effectJournal.replay', 'effectJournal.append'])
    expect(request.mock.calls[1]?.[1]).toMatchObject({ state: 'uncertain', idempotencyKey: 'nd-agent:one' })
  })
})
