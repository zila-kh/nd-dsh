import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserPolicyService, classifyBrowserAction } from '../src/main/browser-platform/browser-policy-service.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('browser action normalization', () => {
  it.each([
    ['browser.snapshot', '', 'browser.read'],
    ['browser.navigate', 'https://example.com', 'browser.navigate'],
    ['browser.autofill', '', 'credential.use'],
    ['browser.cancelDownload', '', 'file.download'],
    ['browser.extension.install', '', 'browser.extension.manage'],
    ['browser.history', '', 'browser.history'],
    ['browser.click', 'deploy production release', 'production.deploy'],
    ['browser.click', 'purchase checkout', 'money.spend'],
    ['browser.siteTool', 'publish post to customers', 'external.publish'],
    ['browser.click', 'delete account', 'data.destructive'],
    ['browser.fill', '', 'browser.interact'],
  ])('%s %s -> %s', (operation, detail, expected) => {
    expect(classifyBrowserAction(operation, detail)).toBe(expected)
  })

  it('derives organization scope from the trusted session run rather than request ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-browser-policy-'))
    roots.push(root)
    const store = {
      runBySession: async (sessionId: string) => sessionId === 'session-a'
        ? {
            id: 'run-a',
            companyId: 'company-a',
            projectId: 'project-a',
            taskId: 'task-a',
            sessionId,
          }
        : undefined,
      policy: async () => 'allow' as const,
    }
    const service = new BrowserPolicyService(store as never, join(root, 'receipts.json'))
    const result = await service.authorize(
      { source: 'agent', sessionId: 'session-a' },
      {
        operation: 'browser.navigate',
        targetId: 'builtin',
        profileId: 'builtin:default',
        origin: 'https://example.com',
        detail: 'https://example.com',
      },
    )
    expect(result.decision).toBe('allow')
    expect(result.envelope.scope).toEqual({
      sessionId: 'session-a',
      companyId: 'company-a',
      projectId: 'project-a',
      taskId: 'task-a',
      runId: 'run-a',
    })
  })
})
