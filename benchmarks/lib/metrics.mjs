import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function summarize(samples) {
  const values = samples.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!values.length) return { count: 0 }
  const percentile = (p) => values[Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1))]
  return {
    count: values.length,
    min: values[0],
    max: values.at(-1),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
  }
}

export async function processMemory(pid) {
  if (!pid) return { metric: 'unavailable', bytes: null }
  if (process.platform === 'linux') {
    try {
      const text = await fs.readFile('/proc/' + pid + '/smaps_rollup', 'utf8')
      const pss = text.match(/^Pss:\s+(\d+)\s+kB$/m)
      if (pss) return { metric: 'pss', bytes: Number(pss[1]) * 1024 }
    } catch {}
    try {
      const text = await fs.readFile('/proc/' + pid + '/status', 'utf8')
      const rss = text.match(/^VmRSS:\s+(\d+)\s+kB$/m)
      if (rss) return { metric: 'rss', bytes: Number(rss[1]) * 1024 }
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process -Id ' + pid + ').PrivateMemorySize64'], { windowsHide: true })
      const bytes = Number(stdout.trim())
      if (Number.isFinite(bytes)) return { metric: 'private-bytes', bytes }
    } catch {}
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
    const kb = Number(stdout.trim())
    if (Number.isFinite(kb)) return { metric: 'rss', bytes: kb * 1024 }
  } catch {}
  return { metric: 'unavailable', bytes: null }
}

export function environmentMetadata() {
  const cpus = os.cpus()
  return {
    os: process.platform,
    osVersion: os.release(),
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCpuCount: cpus.length,
    physicalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  }
}

export async function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

export async function directorySize(root) {
  let total = 0
  const visit = async (path) => {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink()) return
    if (stat.isFile()) { total += stat.size; return }
    if (!stat.isDirectory()) return
    for (const entry of await fs.readdir(path)) await visit(path + '/' + entry)
  }
  await visit(root)
  return total
}

export async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
