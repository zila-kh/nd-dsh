import { describe, expect, it } from 'vitest'
import { classifyRuntimeApproval } from '../src/main/organization/approval-policy.js'

describe('runtime approval policy classification', () => {
  it('keeps uncertain runtime escalations human-reviewed', () => {
    expect(classifyRuntimeApproval('bash', 'needs permission outside the workspace')).toBe('runtime.escalation')
    expect(classifyRuntimeApproval('browser_click', 'interactive action')).toBe('runtime.escalation')
  })

  it('recognizes high-confidence organization policy classes', () => {
    expect(classifyRuntimeApproval('bash', 'git push origin main')).toBe('external.publish')
    expect(classifyRuntimeApproval('bash', 'deploy production release')).toBe('production.deploy')
    expect(classifyRuntimeApproval('billing', 'purchase paid action')).toBe('money.spend')
    expect(classifyRuntimeApproval('bash', 'terraform destroy production')).toBe('data.destructive')
  })
})
