import { matchingProcesses, processDescendants, readProcessRows } from './e2e-process-tree.mjs'

/** Standalone acceptance drivers must prove app and child processes exited. */
export async function closeElectronApp(app) {
  if (!app) return
  const child = app.process()
  const gone = () => child.exitCode !== null || child.signalCode !== null
  const prematurelyExited = gone()
  // A second cleanup call after a failure must not inventory a reused PID.
  const rows = gone() ? [] : readProcessRows()
  const root = rows.find((row) => row.pid === child.pid)
  const owned = new Map(processDescendants(child.pid, rows).map((row) => [`${row.pid}:${row.command}`, row]))
  const observe = () => {
    const current = readProcessRows()
    if (!root || !matchingProcesses([root], current).length) return
    for (const row of processDescendants(child.pid, current)) owned.set(`${row.pid}:${row.command}`, row)
  }
  const pause = (ms) => new Promise((done) => setTimeout(done, ms))
  let forced = false
  try {
    if (prematurelyExited) throw new Error('Electron exited before cleanup could verify its owned descendants.')
    if (!root) throw new Error('Cannot identify the live Electron process for cleanup.')
    let timer
    await Promise.race([
      app.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => undefined),
      new Promise((done) => { timer = setTimeout(done, 2_000) }),
    ]).finally(() => clearTimeout(timer))
    const deadline = Date.now() + 8_000
    while (!gone() && Date.now() < deadline) { observe(); await pause(250) }
    if (!gone()) {
      forced = true
      observe()
      for (const row of matchingProcesses([...owned.values(), ...(root ? [root] : [])], readProcessRows()).reverse()) {
        try { process.kill(row.pid, 'SIGKILL') } catch { /* already gone */ }
      }
      const forcedDeadline = Date.now() + 5_000
      while (!gone() && Date.now() < forcedDeadline) await pause(100)
    }
    const cleanupDeadline = Date.now() + 3_000
    let survivors
    do {
      survivors = matchingProcesses([...owned.values()], readProcessRows())
      if (!survivors.length) break
      await pause(250)
    } while (Date.now() < cleanupDeadline)
    if (survivors.length) {
      for (const row of survivors.reverse()) { try { process.kill(row.pid, 'SIGKILL') } catch { /* already gone */ } }
      throw new Error('Electron shutdown left owned descendants: ' + survivors.map((row) => row.command).join(', '))
    }
    if (!gone()) throw new Error('Electron did not exit after bounded cleanup.')
    console.log(`[e2e-close] path=${forced ? 'force-kill' : 'graceful'} exited=true ownedDescendants=${owned.size} survivors=0`)
  } finally {
    if (gone()) {
      for (const stream of child.stdio) stream?.destroy()
      child.unref()
      let timer
      await Promise.race([
        app.close().catch(() => undefined),
        new Promise((done) => { timer = setTimeout(done, 15_000) }),
      ]).finally(() => clearTimeout(timer))
    }
  }
}
