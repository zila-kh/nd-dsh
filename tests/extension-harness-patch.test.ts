import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('ND Harness extension gateway patch', () => {
  it('mounts the stable nd-extensions MCP bridge through the sanctioned overlay', async () => {
    const patch = await readFile('configs/dsh/nd-dsh.patch.yml', 'utf8')
    expect(patch).toContain('id: nd-extensions-mcp')
    expect(patch).toContain("serverName: nd-extensions")
    expect(patch).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(patch).toContain('ND_DSH_EXTENSION_MCP_ENTRY')
    expect(patch).toContain('ND_EXTENSION_PROXY')
    expect(patch).toContain('ND_EXTENSION_CATALOG')
    expect(patch).toContain('ND_EXTENSION_STATE')
  })

  it('does not require changes inside the vendored Harness checkout', async () => {
    const patch = await readFile('configs/dsh/nd-dsh.patch.yml', 'utf8')
    expect(patch).toMatch(/universal ND extensions/i)
    expect(patch).not.toContain('vendor/deepseek-harness/packages/')
  })
})
