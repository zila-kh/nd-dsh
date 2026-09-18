import { describe, expect, it } from 'vitest'
import { betaDiagnostics } from '../src/renderer/src/lib/beta-diagnostics.js'

describe('beta diagnostics privacy', () => {
  it('never copies raw error text, workspace paths, project ids, or browser URLs', () => {
    const workspacePath = 'C:\\Users\\alice\\secret-project'
    const projectId = 'project-secret-123'
    const browserUrl = 'https://private.example.test/session/secret-session'
    const credential = 'sk-super-secret-value'
    const report = betaDiagnostics(
      { name: 'ND-DSH', version: '0.1.0', platform: 'win32' } as never,
      { root: workspacePath, binding: 'ready', projectId } as never,
      {
        state: 'error',
        sourceReady: true,
        provider: 'openai-compatible',
        model: 'model-test',
        apiKeyRequired: true,
        apiKeyPresent: true,
        error: `Request failed in ${workspacePath} at ${browserUrl} using ${credential}`,
      } as never,
      {
        agentBrowser: 'error',
        loading: false,
        url: browserUrl,
        agentBrowserError: `Could not attach to ${browserUrl} for ${projectId}`,
      } as never,
    )

    expect(report).toContain('Runtime error: present (details redacted)')
    expect(report).toContain('Browser bridge error: present (details redacted)')
    expect(report).not.toContain(workspacePath)
    expect(report).not.toContain(projectId)
    expect(report).not.toContain(browserUrl)
    expect(report).not.toContain(credential)
  })
})
