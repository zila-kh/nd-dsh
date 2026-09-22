import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userData,
    isPackaged: false,
  },
}))

import { AgentBrowserClient } from '../src/main/browser/agent-browser-client.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('AgentBrowserClient shutdown ownership', () => {
  it('kills the daemon captured before close even when the CLI removes its pid file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-agent-browser-shutdown-'))
    temporary.push(root)
    electronState.userData = root

    const client = new AgentBrowserClient(9_222, root)
    await mkdir(client.socketDir, { recursive: true })
    const pidPath = join(client.socketDir, `${client.sessionName}.pid`)
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!daemon.pid) throw new Error('test daemon did not start')
    const daemonPid = daemon.pid
    await writeFile(pidPath, String(daemonPid), 'utf8')

    const internal = client as unknown as {
      sessionTouched: boolean
      run: (command: string[], globalArguments?: string[], timeoutMs?: number) => Promise<{ stdout: string; stderr: string }>
    }
    internal.sessionTouched = true
    internal.run = vi.fn(async () => {
      // Reproduce agent-browser close: its ownership file disappears while the
      // daemon remains alive. The client must retain the pre-close pid.
      await rm(pidPath, { force: true })
      return { stdout: '', stderr: '' }
    })

    try {
      await client.close()
      await waitForExit(daemon, 2_000)
      expect(isAlive(daemonPid)).toBe(false)
      expect(internal.run).toHaveBeenCalledWith(['close'], [], expect.any(Number))
    } finally {
      if (isAlive(daemonPid)) {
        try { process.kill(daemonPid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
  }, 8_000)
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error('captured test daemon did not exit'))
    }, timeoutMs)
    const onExit = (): void => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}
