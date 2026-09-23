import { app } from 'electron'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { BrowserController } from '../browser/browser-controller.js'
import type { BrowserPlatformService } from '../browser-platform/browser-platform-service.js'

interface SampleSummary {
  p50: number | null
  p95: number | null
  min: number | null
  max: number | null
  mean: number | null
}

export async function runBrowserPlatformBenchmark(input: {
  outputPath: string
  browser: BrowserController
  browserPlatform: BrowserPlatformService
}): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(fixtureHtml(url.pathname, url.searchParams.get('n') ?? '0'))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Browser benchmark fixture server did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  const createdTabs: string[] = []

  try {
    const points = []
    for (const count of [1, 2, 4, 8]) {
      while (createdTabs.length < count) {
        const started = performance.now()
        const tab = await input.browser.createTab(`${origin}/tab?n=${createdTabs.length}`, false)
        createdTabs.push(tab.id)
        const createdMs = performance.now() - started
        points.push({
          kind: 'tab-create',
          count: createdTabs.length,
          tabId: tab.id,
          ms: createdMs,
        })
      }

      await input.browser.activateTab(createdTabs[count - 1]!)
      const metrics = app.getAppMetrics()
      points.push({
        kind: 'memory',
        count,
        mainRssBytes: process.memoryUsage().rss,
        processCount: metrics.length,
        processWorkingSetKiB: sum(metrics.map((metric) => metric.memory?.workingSetSize)),
        processPrivateBytesKiB: sum(metrics.map((metric) => metric.memory?.privateBytes)),
      })
    }

    const tabId = createdTabs[0]!
    await input.browser.activateTab(tabId)
    await input.browser.navigate(`${origin}/actions?n=0`, tabId)

    const snapshotMs: number[] = []
    const clickMs: number[] = []
    const navigateMs: number[] = []
    const screenshotMs: number[] = []
    const siteToolDiscoveryMs: number[] = []
    const siteToolCallMs: number[] = []

    for (let index = 0; index < 10; index += 1) {
      let started = performance.now()
      const snapshot = await input.browser.semanticSnapshot(tabId) as {
        revision?: number
        elements?: Array<{ ref?: string; name?: string; text?: string }>
      }
      snapshotMs.push(performance.now() - started)
      const button = snapshot.elements?.find((item) => item.name === 'Increment' || item.text === 'Increment')
      if (!button?.ref || !Number.isInteger(snapshot.revision)) throw new Error('Browser benchmark snapshot did not expose the Increment button')

      started = performance.now()
      await input.browser.click(tabId, button.ref, snapshot.revision!)
      clickMs.push(performance.now() - started)

      started = performance.now()
      await input.browser.navigate(`${origin}/actions?n=${index + 1}`, tabId)
      navigateMs.push(performance.now() - started)

      started = performance.now()
      await input.browser.screenshot(tabId)
      screenshotMs.push(performance.now() - started)

      started = performance.now()
      const tools = await input.browser.discoverSiteTools(tabId)
      siteToolDiscoveryMs.push(performance.now() - started)
      if (tools.some((tool) => tool.name === 'echo')) {
        started = performance.now()
        await input.browser.callSiteTool(tabId, 'echo', { value: index })
        siteToolCallMs.push(performance.now() - started)
      }
    }

    const state = await input.browserPlatform.state()
    const result = {
      schemaVersion: 1,
      kind: 'nd-unified-browser-platform-benchmark',
      timestamp: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node,
      },
      builtIn: {
        scalePoints: [1, 2, 4, 8],
        points,
        snapshotMs: summarize(snapshotMs),
        clickMs: summarize(clickMs),
        navigateMs: summarize(navigateMs),
        screenshotMs: summarize(screenshotMs),
        siteToolDiscoveryMs: summarize(siteToolDiscoveryMs),
        siteToolCallMs: summarize(siteToolCallMs),
        targets: state.targets.map((target) => ({
          id: target.id,
          kind: target.kind,
          capabilities: target.capabilities,
        })),
      },
      companion: {
        status: state.targets.some((target) => target.kind === 'companion') ? 'connected-not-benchmarked-by-this-fixture' : 'manual-evidence-required',
        note: 'Chrome Companion RTT and memory require the real installed extension/native host and are recorded during manual validation.',
      },
    }

    await fs.mkdir(dirname(input.outputPath), { recursive: true })
    await fs.writeFile(input.outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  } finally {
    for (const tabId of createdTabs) await input.browser.closeTab(tabId).catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function summarize(values: number[]): SampleSummary {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) return { p50: null, p95: null, min: null, max: null, mean: null }
  const percentile = (p: number) => finite[Math.min(finite.length - 1, Math.ceil(finite.length * p) - 1)]!
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    min: finite[0]!,
    max: finite[finite.length - 1]!,
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  }
}

function sum(values: Array<number | undefined>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value))
  return finite.length ? finite.reduce((total, value) => total + value, 0) : null
}

function fixtureHtml(pathname: string, counter: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ND Browser Benchmark</title></head>
<body>
  <h1>ND Browser Benchmark</h1>
  <button id="increment" aria-label="Increment">Increment</button>
  <input aria-label="Name" placeholder="Name">
  <input type="password" aria-label="Password" value="fixture-secret">
  <p id="counter">${escapeHtml(counter)}</p>
  <p id="path">${escapeHtml(pathname)}</p>
  <script>
    document.getElementById('increment').addEventListener('click', () => {
      const counter = document.getElementById('counter');
      counter.textContent = String(Number(counter.textContent || '0') + 1);
    });
    try {
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          async getTools() {
            return [{
              name: 'echo',
              title: 'Echo',
              description: 'Returns fixture input.',
              inputSchema: { type: 'object' },
              origin: location.origin,
              annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: true }
            }];
          },
          async executeTool(tool, input) {
            if (!tool || tool.name !== 'echo') throw new Error('unknown fixture tool');
            return { echoed: input };
          }
        }
      });
    } catch {}
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]!))
}
