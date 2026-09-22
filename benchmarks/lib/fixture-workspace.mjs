import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * A deterministic project workspace for agent-task measurement.
 *
 * It is a real Git repository with a real `testCommand`, because ND's task path
 * is not "start an engine": it is a Git-worktree-isolated attempt, a machine
 * verification command that reviews the workspace, and an integration step. The
 * fixture therefore owns a verification script rather than a stub, so a task
 * counted as verified was verified by the same product code that verifies a
 * user's task.
 */
export async function createAgentTaskWorkspace(root) {
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'tools'), { recursive: true })
  await writeFile(join(root, 'README.md'), '# ND agent-task fixture\n\nDeterministic project used to measure the cost of one agent task.\n', 'utf8')
  await writeFile(join(root, 'src', 'app.txt'), 'fixture application source\n', 'utf8')
  await writeFile(join(root, 'tools', 'verify-task.mjs'), VERIFY_TASK, 'utf8')
  await writeFile(join(root, 'tools', 'verify-read-only.mjs'), VERIFY_READ_ONLY, 'utf8')
  await git(root, ['init'])
  await git(root, ['config', 'user.email', 'agent-task-bench@nd.local'])
  await git(root, ['config', 'user.name', 'ND Agent Task Bench'])
  await git(root, ['add', '.'])
  await git(root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'agent-task fixture baseline'])
  return root
}

/** The project's configured test command; it reads the evidence a worker left. */
export const AGENT_TASK_TEST_COMMAND = 'node tools/verify-task.mjs'
export const AGENT_TASK_READ_ONLY_TEST_COMMAND = 'node tools/verify-read-only.mjs'

const VERIFY_TASK = `#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'

try {
  const evidence = JSON.parse(await readFile(new URL('../evidence/task-result.json', import.meta.url), 'utf8'))
  if (evidence?.ok !== true) {
    process.stderr.write('fixture evidence reports ok=' + String(evidence?.ok) + '\\n')
    process.exit(1)
  }
  process.stdout.write('fixture evidence ok (steps=' + String(evidence.steps) + ', tools=' + String(evidence.tools) + ')\\n')
} catch (error) {
  process.stderr.write('fixture evidence unreadable: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
  process.exit(1)
}
`

async function git(cwd, args) {
  await execFileAsync('git', args, { cwd, windowsHide: true, encoding: 'utf8' })
}

const VERIFY_READ_ONLY = `#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'

try {
  const source = await readFile(new URL('../src/app.txt', import.meta.url), 'utf8')
  if (!source.includes('fixture application source')) throw new Error('fixture source marker missing')
  process.stdout.write('fixture read-only verification ok\\n')
} catch (error) {
  process.stderr.write('fixture read-only verification failed: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
  process.exit(1)
}
`
