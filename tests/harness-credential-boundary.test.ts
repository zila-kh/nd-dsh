import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ND intentionally gives provider credentials to the Harness model runtime,
 * not to model-created shell processes. The pinned Harness subprocess seam
 * owns that second boundary. Keep this characterization test close to ND so an
 * upstream submodule update cannot silently remove the scrub while ND still
 * assumes autonomous Bash/LSP/subprocess tools are credential-free.
 */
describe('pinned Harness credential boundary', () => {
  it('scrubs credential-shaped parent environment names before child processes', async () => {
    const source = await readFile(join(
      process.cwd(),
      'vendor/deepseek-harness/packages/subprocess/subprocess/src/index.ts',
    ), 'utf8')

    expect(source).toContain('export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i')
    expect(source).toContain('export function scrubbedParentEnv()')
    expect(source).toContain('!SENSITIVE_ENV_PATTERN.test(key)')
  })

  it('keeps ND-generated provider secret variable names inside that scrub shape', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/provider-runtime.ts'), 'utf8')
    expect(source).toContain('environment.DEEPSEEK_API_KEY = apiKey')
    expect(source).toContain('return `ND_DSH_LLM_KEY_${digest}`')
  })
})
