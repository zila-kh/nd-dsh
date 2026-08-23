import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureProfilePluginLinks } from '../src/main/harness/profile-plugin-links.js'

const INSERTED_PACKAGES = [
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-subagent-codex',
] as const

let home: string
let vendorRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'nd-dsh-plugin-links-'))
  home = join(base, 'dsh-home')
  vendorRoot = join(base, 'vendor', 'deepseek-harness')
})

afterEach(() => {
  // Junction/symlink trees under a fresh temp directory need no teardown.
})

function makeVendoredPackage(vendoredPath: string): void {
  const dir = join(vendorRoot, vendoredPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8')
}

function fallbackLink(packageName: string): string {
  return join(home, 'profiles', 'node_modules', ...packageName.split('/'))
}

describe('ensureProfilePluginLinks', () => {
  it('links every ND-inserted entry package into the profile module fallback', () => {
    for (const vendoredPath of ['packages/mcp/mcp-client', 'packages/subagent/subagent-codex']) {
      makeVendoredPackage(vendoredPath)
    }

    ensureProfilePluginLinks(home, vendorRoot)

    for (const packageName of INSERTED_PACKAGES) {
      const link = fallbackLink(packageName)
      expect(existsSync(link)).toBe(true)
      expect(existsSync(join(link, 'package.json'))).toBe(true)
    }
  })

  it('skips inserted packages missing from the vendored runtime', () => {
    makeVendoredPackage('packages/mcp/mcp-client')

    ensureProfilePluginLinks(home, vendorRoot)

    expect(existsSync(fallbackLink('@deepseek-ai/dsh-mcp-client'))).toBe(true)
    expect(existsSync(fallbackLink('@deepseek-ai/dsh-subagent-codex'))).toBe(false)
  })

  it('keeps an already-correct link without recreating it', () => {
    makeVendoredPackage('packages/subagent/subagent-codex')
    ensureProfilePluginLinks(home, vendorRoot)
    const link = fallbackLink('@deepseek-ai/dsh-subagent-codex')
    const before = readFileSync(join(link, 'package.json'), 'utf8')

    ensureProfilePluginLinks(home, vendorRoot)

    expect(readFileSync(join(link, 'package.json'), 'utf8')).toBe(before)
  })

  it('re-points a stale link to the current vendored location', () => {
    makeVendoredPackage('packages/subagent/subagent-codex')
    ensureProfilePluginLinks(home, vendorRoot)

    // Simulate the installation moving: rebuild the vendor tree elsewhere and
    // leave the old link dangling behind.
    const staleTarget = join(vendorRoot, '..', 'harness-old', 'packages/subagent/subagent-codex')
    mkdirSync(staleTarget, { recursive: true })
    writeFileSync(join(staleTarget, 'package.json'), '{}', 'utf8')
    unlinkSync(fallbackLink('@deepseek-ai/dsh-subagent-codex'))
    symlinkSync(staleTarget, fallbackLink('@deepseek-ai/dsh-subagent-codex'), process.platform === 'win32' ? 'junction' : 'dir')

    ensureProfilePluginLinks(home, vendorRoot)

    const link = fallbackLink('@deepseek-ai/dsh-subagent-codex')
    expect(existsSync(link)).toBe(true)
    expect(existsSync(join(link, 'package.json'))).toBe(true)
  })

  it('refuses to replace a real directory sitting where the link belongs', () => {
    makeVendoredPackage('packages/mcp/mcp-client')
    mkdirSync(fallbackLink('@deepseek-ai/dsh-mcp-client'), { recursive: true })

    expect(() => ensureProfilePluginLinks(home, vendorRoot)).toThrowError(/non-link/)
  })
})
