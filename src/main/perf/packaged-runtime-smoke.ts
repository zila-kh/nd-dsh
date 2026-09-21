import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { CoreClient } from '../core/core-client.js'
import type { GitService } from '../git/git-service.js'
import type { TerminalManager } from '../terminal/terminal-manager.js'

interface PackagedRuntimeSmokeOptions {
  outputPath: string
  workspaceRoot: string
  core: CoreClient
  terminal: TerminalManager
  git: GitService
}

export async function runPackagedRuntimeSmoke(options: PackagedRuntimeSmokeOptions): Promise<void> {
  const startedAt = Date.now()
  const marker = 'ND_PACKAGED_TERMINAL_SMOKE'
  const sessionId = 'packaged-runtime-smoke'
  let terminalId: string | undefined
  const receipt: Record<string, unknown> = {
    schemaVersion: 1,
    benchmark: 'packaged-runtime-smoke',
    status: 'fail',
    startedAt,
    workspaceRoot: options.workspaceRoot,
  }

  try {
    const health = options.core.health
    if (!health || health.protocolVersion !== 1) throw new Error('Bundled ND Core is not healthy at packaged smoke start.')
    receipt.core = health

    const session = await options.terminal.create({
      sessionId,
      cwd: options.workspaceRoot,
      title: 'Packaged runtime smoke',
      cols: 80,
      rows: 24,
    })
    const terminal = session.terminals.find((item) => item.id === session.activeTerminalId) ?? session.terminals.at(-1)
    if (!terminal) throw new Error('Packaged terminal smoke did not create a terminal.')
    terminalId = terminal.id

    const command = terminalCommand(terminal.shell)
    await options.terminal.write(sessionId, terminal.id, command)
    let snapshot = terminal
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      const state = await options.terminal.state(sessionId)
      snapshot = state.terminals.find((item) => item.id === terminal.id) ?? snapshot
      if (snapshot.buffer.includes(marker)) break
      if (snapshot.status === 'error') throw new Error(snapshot.error ?? 'Packaged terminal entered an error state.')
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    if (!snapshot.buffer.includes(marker)) throw new Error('Packaged Rust PTY did not produce the terminal smoke marker.')
    receipt.terminal = {
      shell: snapshot.shell,
      outputSeq: snapshot.outputSeq,
      markerObserved: true,
      status: snapshot.status,
    }

    const git = await options.git.refresh()
    if (!git.repoRoot || !git.branch || git.heads.length === 0) {
      throw new Error('Packaged Rust Git backend did not detect the prepared repository and commit.')
    }
    receipt.git = {
      root: git.root,
      repoRoot: git.repoRoot,
      branch: git.branch,
      head: git.heads[0]?.hash,
      staged: git.staged.length,
      unstaged: git.unstaged.length,
      untracked: git.untracked.length,
    }

    receipt.status = 'pass'
    receipt.completedAt = Date.now()
    receipt.durationMs = Date.now() - startedAt
    await writeReceipt(options.outputPath, receipt)
  } catch (error) {
    receipt.error = error instanceof Error ? error.message : String(error)
    receipt.completedAt = Date.now()
    receipt.durationMs = Date.now() - startedAt
    await writeReceipt(options.outputPath, receipt)
    throw error
  } finally {
    if (terminalId) await options.terminal.close(sessionId, terminalId).catch(() => undefined)
  }
}

function terminalCommand(shell: string): string {
  if (process.platform !== 'win32') return "printf 'ND_PACKAGED_%s\\n' \"$ND_DSH_SMOKE_SUFFIX\"; exit\n"
  if (/powershell|pwsh/i.test(shell)) return 'Write-Output ("ND_PACKAGED_" + $env:ND_DSH_SMOKE_SUFFIX); exit\r\n'
  return 'echo ND_PACKAGED_%ND_DSH_SMOKE_SUFFIX%\r\nexit\r\n'
}

async function writeReceipt(path: string, receipt: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = path + '.tmp-' + process.pid
  await fs.writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  await fs.rename(temporary, path)
}
