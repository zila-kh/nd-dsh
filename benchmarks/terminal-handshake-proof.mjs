#!/usr/bin/env node
/**
 * Prove the benchmark client's Windows ConPTY device-status handshake both ways.
 *
 * The handshake exists because ConPTY withholds a child's output until the
 * terminal answers its `ESC[6n` cursor-position query (see
 * `attachTerminalHandshake` in `benchmarks/lib/core-rpc.mjs`). Two properties
 * matter and neither is visible from a green throughput run:
 *
 *  1. A client that stops answering must fail loudly and quickly. The synthetic
 *     case drives the observer with a stub client and asserts the failure names
 *     the handshake inside the grace window instead of waiting out a fixture
 *     timeout.
 *  2. Where the platform does ask, the real stall is reproducible without the
 *     responder and disappears with it. POSIX PTYs never query, so that case is
 *     skipped there and the skip is printed rather than hidden.
 *
 * Run: node benchmarks/terminal-handshake-proof.mjs
 */
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import process from 'node:process'
import { CoreRpc, CONPTY_CURSOR_QUERY, CONPTY_CURSOR_REPLY, attachTerminalHandshake, benchmarkRoot } from './lib/core-rpc.mjs'

const PROBE = join(benchmarkRoot, 'benchmarks', 'fixtures', 'terminal-handshake-probe.mjs')
const MARKER = Buffer.from('ND_HANDSHAKE_PROOF')
const checks = []

function check(condition, label, detail) {
  checks.push({ label, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) })
  console.log((condition ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' - ' + detail))
}

await syntheticHandshake()
if (process.platform === 'win32') await realHandshake()
else console.log('SKIP real ConPTY stall: this platform does not send a cursor-position query.')

const failed = checks.filter((entry) => !entry.passed)
console.log(JSON.stringify({ status: failed.length ? 'fail' : 'pass', checks }, null, 2))
if (failed.length) process.exitCode = 1

/**
 * The observer's own failure path, without a PTY: a query that is answered but
 * never followed by output must fail inside the grace window.
 */
async function syntheticHandshake() {
  const writes = []
  const client = new EventEmitter()
  client.request = async (method, params) => { writes.push({ method, params }); return {} }
  const handshake = attachTerminalHandshake(client, { graceMs: 400 })

  client.emit('terminal.output', frame('synthetic-terminal', CONPTY_CURSOR_QUERY, 1))
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))

  check(writes.length === 1 && writes[0].method === 'terminal.write' && writes[0].params.data === CONPTY_CURSOR_REPLY,
    'the client answers the cursor-position query with a cursor position report',
    JSON.stringify(writes[0] ?? null))
  check(handshake.queriesAnswered === 1, 'the answered query is counted for evidence')

  const started = Date.now()
  const error = await handshake.progress(['synthetic-terminal']).then(() => null, (thrown) => thrown)
  const elapsedMs = Date.now() - started
  check(error !== null, 'an unanswered handshake fails instead of resolving')
  check(elapsedMs < 3_000, 'the failure lands on the handshake grace window, not a fixture timeout', elapsedMs + ' ms')
  check(error !== null && error.message.includes('ConPTY device-status handshake') && error.message.includes('replies=1'),
    'the failure names the handshake and the observed reply', error === null ? 'no error' : firstLine(error.message))

  client.emit('terminal.output', frame('synthetic-terminal', 'output after the answer', 2))
  await handshake.progress(['synthetic-terminal'], 100)
  check(true, 'output after the answer releases the terminal')
  handshake.dispose()
}

/** The real thing, on the platform that asks: stall without the responder, progress with it. */
async function realHandshake() {
  const stalled = await runProbeTerminal('proof-unanswered', { respond: false, graceMs: 3_000 })
  check(stalled.captured.queries === 1 && stalled.captured.beyondQueryBytes === 0 && stalled.exited === false,
    'without the responder the console host delivers the query and nothing else',
    describe(stalled))
  check(stalled.progressError !== null && stalled.progressMs < 6_000,
    'a client that stopped answering fails loudly instead of hanging', stalled.progressMs + ' ms: ' + firstLine(stalled.progressError ?? ''))
  check((stalled.progressError ?? '').includes('ConPTY device-status handshake') && (stalled.progressError ?? '').includes('replies=0'),
    'the loud failure names the handshake and the missing reply', firstLine(stalled.progressError ?? 'no error'))

  const answered = await runProbeTerminal('proof-answered', { graceMs: 8_000 })
  check(answered.captured.markerObserved && answered.exited,
    'with the responder the same terminal finishes and its output arrives', describe(answered))
  check(answered.progressError === null, 'the answered handshake reports progress', firstLine(answered.progressError ?? ''))
}

/** Run the probe fixture once and report both the stream and the observer's verdict. */
async function runProbeTerminal(terminalId, options) {
  const client = await CoreRpc.launch()
  const handshake = attachTerminalHandshake(client, options)
  const stream = []
  let exited = false
  const onOutput = (frame) => {
    if (frame.resourceId !== terminalId) return
    const bytes = frame.data?.bytes
    if (bytes) stream.push(Buffer.from(bytes))
  }
  const onExit = (frame) => { if (frame.resourceId === terminalId) exited = true }
  client.on('terminal.output', onOutput)
  client.on('terminal.exit', onExit)
  const progressStarted = Date.now()
  let progressError = null
  try {
    await client.request('terminal.create', {
      terminalId, sessionId: 'handshake-proof', shell: process.execPath,
      args: [PROBE], cwd: benchmarkRoot, cols: 80, rows: 24, env: {},
    })
    const started = Date.now()
    progressError = await handshake.progress([terminalId], options.graceMs).then(() => null, (error) => error.message)
    const progressMs = Date.now() - started
    const deadline = Date.now() + 4_000
    while (!exited && Date.now() < deadline) await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    return { captured: classify(stream), exited, progressError, progressMs, totalMs: Date.now() - progressStarted }
  } finally {
    handshake.dispose()
    client.off('terminal.output', onOutput)
    client.off('terminal.exit', onExit)
    await client.close()
  }
}

function classify(stream) {
  const captured = Buffer.concat(stream)
  const queryAt = captured.indexOf(Buffer.from(CONPTY_CURSOR_QUERY))
  return {
    queries: queryAt === -1 ? 0 : 1,
    beyondQueryBytes: queryAt === -1 ? captured.length : captured.length - queryAt - Buffer.byteLength(CONPTY_CURSOR_QUERY),
    markerObserved: captured.includes(MARKER),
  }
}

function describe(captured) {
  return JSON.stringify(captured)
}

function frame(resourceId, text, seq) {
  return { resourceId, seq, data: { bytes: new TextEncoder().encode(text) } }
}

function firstLine(text) {
  return String(text).split('\n')[0]
}
