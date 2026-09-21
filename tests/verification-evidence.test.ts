import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runArtifactVerification } from '../src/main/organization/verification-evidence.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('artifact verification', () => {
  it('records bounded fingerprints for declared file and directory evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-artifact-evidence-'))
    temporary.push(root)
    await writeFile(join(root, 'research.md'), '# Findings\nVerified evidence\n')
    await mkdir(join(root, 'design'), { recursive: true })
    await writeFile(join(root, 'design', 'screen.json'), '{"kind":"screen"}\n')

    const evidence = await runArtifactVerification(['research.md', 'design'], root)
    expect(evidence.status).toBe('passed')
    expect(evidence.artifacts).toHaveLength(2)
    expect(evidence.artifacts?.map((item) => item.path)).toEqual(['research.md', 'design'])
    expect(evidence.artifacts?.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true)
  })

  it('fails closed when a declared artifact is missing or escapes the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-artifact-evidence-'))
    temporary.push(root)

    const missing = await runArtifactVerification(['missing.txt'], root)
    expect(missing.status).toBe('failed')
    expect(missing.reason).toMatch(/artifact verification failed/i)

    const escaped = await runArtifactVerification(['../outside.txt'], root)
    expect(escaped.status).toBe('failed')
    expect(escaped.reason).toMatch(/escapes the task workspace/i)
  })
})
