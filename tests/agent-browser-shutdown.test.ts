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

import { AGENT_BROWSER_DAEMON_NAMESPACE, AgentBrowserClient } from '../src/main/browser/agent-browser-client.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('AgentBrowserClient shutdown ownership', () => {
  it('cleans an app-owned daemon even when another client started it before this wrapper touched the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-agent-browser-external-daemon-'))
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
    expect(internal.sessionTouched).toBe(false)
    internal.run = vi.fn(async () => {
      await rm(pidPath, { force: true })
      return { stdout: '', stderr: '' }
    })

    try {
      await client.close()
      await waitForExit(daemon, 2_000)
      expect(isAlive(daemonPid)).toBe(false)
      expect(internal.run).toHaveBeenCalledWith(['close', '--all'], [], expect.any(Number), expect.any(Object))
    } finally {
      if (isAlive(daemonPid)) {
        try { process.kill(daemonPid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
  }, 8_000)

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
      expect(internal.run).toHaveBeenCalledWith(['close', '--all'], [], expect.any(Number), expect.any(Object))
    } finally {
      if (isAlive(daemonPid)) {
        try { process.kill(daemonPid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
  }, 8_000)

  it('stops a daemon another app-owned session left in this app socket directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-agent-browser-other-session-'))
    temporary.push(root)
    electronState.userData = root

    const client = new AgentBrowserClient(9_222, root)
    await mkdir(client.socketDir, { recursive: true })
    // The Harness browser MCP names its own session, so its daemon lives behind
    // a sidecar this wrapper's session name never matches. The app still owns
    // it, and a daemon that outlives the app is what stalls e2e teardown.
    const otherPidPath = join(client.socketDir, 'harness-browser-mcp.pid')
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!daemon.pid) throw new Error('test daemon did not start')
    const daemonPid = daemon.pid
    await writeFile(otherPidPath, String(daemonPid), 'utf8')

    const internal = client as unknown as {
      sessionTouched: boolean
      run: (command: string[], globalArguments?: string[], timeoutMs?: number) => Promise<{ stdout: string; stderr: string }>
    }
    expect(internal.sessionTouched).toBe(false)
    internal.run = vi.fn(async () => {
      await rm(otherPidPath, { force: true })
      return { stdout: '', stderr: '' }
    })

    try {
      await client.close()
      await waitForExit(daemon, 2_000)
      expect(isAlive(daemonPid)).toBe(false)
      expect(internal.run).toHaveBeenCalledWith(['close', '--all'], [], expect.any(Number), expect.any(Object))
    } finally {
      if (isAlive(daemonPid)) {
        try { process.kill(daemonPid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
  }, 8_000)
  it('stops a config-only consumer daemon in the namespaced home state directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-agent-browser-config-only-'))
    temporary.push(root)
    electronState.userData = root

    const client = new AgentBrowserClient(9_222, root)
    // A consumer that reads only the config file — the Harness browser MCP — has
    // no AGENT_BROWSER_SOCKET_DIR, so its daemon lands under the user's home state
    // directory rather than the app's socket directory. The pinned namespace is
    // what makes that location predictable enough to clean up.
    const configOnlyRoot = join(root, '.agent-browser', 'namespaces', AGENT_BROWSER_DAEMON_NAMESPACE, 'run')
    await mkdir(configOnlyRoot, { recursive: true })
    const pidPath = join(configOnlyRoot, 'harness-browser-mcp.pid')
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!daemon.pid) throw new Error('test daemon did not start')
    const daemonPid = daemon.pid
    await writeFile(pidPath, String(daemonPid), 'utf8')

    const internal = client as unknown as {
      sessionTouched: boolean
      run: (command: string[], globalArguments?: string[], timeoutMs?: number, options?: object) => Promise<{ stdout: string; stderr: string }>
    }
    expect(internal.sessionTouched).toBe(false)
    internal.run = vi.fn(async () => {
      await rm(pidPath, { force: true })
      return { stdout: '', stderr: '' }
    })

    try {
      await client.close()
      await waitForExit(daemon, 2_000)
      expect(isAlive(daemonPid)).toBe(false)
      expect(internal.run).toHaveBeenCalledWith(['close', '--all'], [], expect.any(Number), { withoutSocketDir: true })
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
