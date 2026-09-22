import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'

const outputPath = process.env.ND_DSH_BENCHMARK_OUTPUT?.trim()
const marks: Record<string, number> = {}
let histogram: IntervalHistogram | undefined

if (outputPath) {
  histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
}

export function markStartup(name: string): void {
  if (!outputPath || !name || marks[name] !== undefined) return
  marks[name] = Number((process.uptime() * 1_000).toFixed(3))
}

export async function flushStartupBenchmark(extra: Record<string, unknown> = {}): Promise<void> {
  if (!outputPath) return
  histogram?.disable()
  const payload = {
    schemaVersion: 1,
    benchmark: 'app-startup',
    pid: process.pid,
    backend: 'rust-core',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron,
    mainRssBytes: process.memoryUsage().rss,
    marks,
    eventLoop: histogram ? {
      p50Ms: Number((histogram.percentile(50) / 1e6).toFixed(3)),
      p95Ms: Number((histogram.percentile(95) / 1e6).toFixed(3)),
      p99Ms: Number((histogram.percentile(99) / 1e6).toFixed(3)),
      maxMs: Number((histogram.max / 1e6).toFixed(3)),
    } : undefined,
    ...extra,
  }
  await fs.mkdir(dirname(outputPath), { recursive: true })
  const temporary = outputPath + '.tmp-' + process.pid
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  await fs.rename(temporary, outputPath)
}
