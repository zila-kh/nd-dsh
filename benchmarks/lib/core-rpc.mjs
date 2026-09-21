import { decode, encode } from '@msgpack/msgpack'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { performance } from 'node:perf_hooks'

const MAX_FRAME = 8 * 1024 * 1024
const PROTOCOL = 1
export const benchmarkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/**
 * Windows ConPTY asks the terminal for its cursor position before it releases
 * the child's output, and waits for the answer. The query arrives on the output
 * stream as a Device Status Report (`ESC[6n`); the answer is a Cursor Position
 * Report (`ESC[<row>;<col>R`) written back to the terminal's input.
 *
 * A headless collector that never answers sees exactly the four bytes `ESC[6n`
 * and then nothing: no child output, no `terminal.exit`, and a fixture wait that
 * times out. A real terminal emulator answers automatically - xterm.js, which
 * renders the product's terminal pane, replies to the same query - so answering
 * it is ordinary terminal behaviour, not a benchmark accommodation. POSIX PTYs
 * never send the query, which is why this is invisible on Linux and why
 * {@link attachTerminalHandshake} reports zero queries there.
 */
export const CONPTY_CURSOR_QUERY = '\u001b[6n'
export const CONPTY_CURSOR_REPLY = '\u001b[1;1R'

/**
 * Answer ConPTY's cursor-position queries for every terminal on a client, and
 * fail loudly when a terminal never gets past the handshake.
 *
 * The benchmark client is a byte collector, so without this the Windows
 * terminal benchmarks stall until their own timeouts. The handshake never
 * touches byte accounting: it only writes the reply a terminal emulator would
 * write, and the bytes it writes travel to the terminal's input, not into the
 * measured output stream.
 * @param {CoreRpc} client - a launched client.
 * @param {object} [options] - overrides for tests and diagnostics.
 * @param {number} [options.graceMs] - how long a terminal may stay silent before {@link TerminalHandshake#progress} fails.
 * @param {boolean} [options.respond] - set false to observe without answering, which is how the proof script reproduces a client that stopped answering.
 * @returns {TerminalHandshake} the observer, detached with {@link TerminalHandshake#dispose}.
 */
export function attachTerminalHandshake(client, options = {}) {
  return new TerminalHandshake(client, options)
}

export class TerminalHandshake {
  #client
  #query
  #reply
  #graceMs
  #respond
  #terminals = new Map()
  #onOutput
  #onExit

  constructor(client, options = {}) {
    this.#client = client
    this.#query = options.query ?? CONPTY_CURSOR_QUERY
    this.#reply = options.reply ?? CONPTY_CURSOR_REPLY
    this.#graceMs = options.graceMs ?? 8_000
    this.#respond = options.respond ?? true
    this.#onOutput = (frame) => this.#observe(frame)
    this.#onExit = (frame) => { this.#state(frame.resourceId).exited = true }
    client.on('terminal.output', this.#onOutput)
    client.on('terminal.exit', this.#onExit)
  }

  /** Per-terminal handshake observation, for evidence. */
  stats() {
    return [...this.#terminals.entries()].map(([terminalId, state]) => ({
      terminalId,
      queries: state.queries,
      replies: state.replies,
      outputBytesAfterQuery: state.outputBytesAfterQuery,
      replyErrors: [...state.replyErrors],
      exited: state.exited,
    }))
  }

  /** Queries answered across every terminal. */
  get queriesAnswered() {
    return [...this.#terminals.values()].reduce((sum, state) => sum + state.replies, 0)
  }

  /**
   * Resolve once every listed terminal is past the handshake: it exited, or it
   * produced output after the query it was sent (or produced output at all on a
   * platform that never queries). Anything else fails with the handshake state
   * named, instead of letting the caller's own timeout expire.
   * @param {string[]} terminalIds - terminals that must show progress.
   * @param {number} [timeoutMs] - override for the instance grace period.
   */
  async progress(terminalIds, timeoutMs = this.#graceMs) {
    const deadline = Date.now() + timeoutMs
    let pending = terminalIds
    while (pending.length > 0 && Date.now() < deadline) {
      pending = pending.filter((terminalId) => !this.#pastHandshake(this.#state(terminalId)))
      if (pending.length === 0) return
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }
    if (pending.length === 0) return
    const failed = pending.map((terminalId) => this.#state(terminalId))
    const anyReplies = failed.some((state) => state.replies > 0)
    throw new Error(
      'terminal stalled in the ConPTY device-status handshake (no progress within ' + timeoutMs + ' ms):\n'
      + pending.map((terminalId, index) => this.#describe(terminalId, failed[index])).join('\n') + '\n'
      + (anyReplies
        ? 'The client answered the cursor-position query and the console host still produced no output. '
        : 'The client never answered the cursor-position query. ')
      + 'A Windows ConPTY withholds the child\'s output until a terminal answers ' + JSON.stringify(this.#query)
      + ' with a cursor position report such as ' + JSON.stringify(this.#reply) + ' (the product\'s xterm.js pane does this automatically). '
      + 'If this fires on Windows with replies=0, the benchmark client stopped answering; see attachTerminalHandshake in benchmarks/lib/core-rpc.mjs.',
    )
  }

  #describe(terminalId, state) {
    return '  - ' + terminalId
      + ': queries=' + state.queries
      + ' replies=' + state.replies
      + ' outputBytes=' + state.totalBytes
      + ' outputBytesAfterQuery=' + state.outputBytesAfterQuery
      + ' exited=' + state.exited
      + (state.replyErrors.length ? ' replyErrors=' + state.replyErrors.join(', ') : '')
  }

  /** Stop observing. Terminals created afterwards are not tracked. */
  dispose() {
    this.#client.off('terminal.output', this.#onOutput)
    this.#client.off('terminal.exit', this.#onExit)
  }

  #pastHandshake(state) {
    if (state.exited) return true
    return state.queries > 0 ? state.outputBytesAfterQuery > 0 : state.totalBytes > 0
  }

  #state(terminalId) {
    if (typeof terminalId !== 'string' || !terminalId) {
      throw new Error('terminal handshake received a frame without a terminal id')
    }
    let state = this.#terminals.get(terminalId)
    if (!state) {
      state = {
        queries: 0,
        replies: 0,
        replyErrors: [],
        totalBytes: 0,
        outputBytesAfterQuery: 0,
        queryFrameBytes: null,
        exited: false,
      }
      this.#terminals.set(terminalId, state)
    }
    return state
  }

  #observe(frame) {
    const bytes = frame.data?.bytes
    const length = bytes ? bytes.byteLength : 0
    const state = this.#state(frame.resourceId)
    state.totalBytes += length
    if (state.queryFrameBytes !== null) state.outputBytesAfterQuery += length
    const text = bytes ? Buffer.from(bytes).toString('latin1') : ''
    let index = text.indexOf(this.#query)
    if (index === -1) return
    if (state.queryFrameBytes === null) {
      state.queryFrameBytes = length
      state.outputBytesAfterQuery = 0
    }
    while (index !== -1) {
      state.queries += 1
      if (this.#respond) {
        this.#client
          .request('terminal.write', { terminalId: frame.resourceId, data: this.#reply })
          .then(() => { state.replies += 1 })
          .catch((error) => { state.replyErrors.push(error instanceof Error ? error.message : String(error)) })
      }
      index = text.indexOf(this.#query, index + this.#query.length)
    }
  }
}

export function defaultCoreBinary(profile = process.env.ND_DSH_BENCH_PROFILE || 'debug') {
  const name = process.platform === 'win32' ? 'nd-core.exe' : 'nd-core'
  return process.env.ND_DSH_CORE_BIN?.trim() || join(benchmarkRoot, 'target', profile, name)
}

export class CoreRpc extends EventEmitter {
  static async launch(options = {}) {
    const binary = resolve(options.binary || defaultCoreBinary(options.profile))
    if (!existsSync(binary)) throw new Error('ND Core benchmark binary is missing: ' + binary)
    const started = performance.now()
    const child = spawn(binary, [], {
      cwd: benchmarkRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, RUST_BACKTRACE: process.env.RUST_BACKTRACE || '1' },
    })
    const client = new CoreRpc(child)
    const health = await client.request('core.health', {}, 5_000)
    client.startupMs = performance.now() - started
    client.health = health
    return client
  }

  constructor(child) {
    super()
    this.child = child
    this.pid = child.pid
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)
    this.stderr = ''
    child.stdout.on('data', (chunk) => this.#read(Buffer.from(chunk)))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { this.stderr += chunk })
    child.once('exit', (code, signal) => {
      const error = new Error('nd-core exited code=' + code + ' signal=' + signal + (this.stderr ? '\n' + this.stderr.slice(-4000) : ''))
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(error)
      }
      this.pending.clear()
      this.emit('core-exit', { code, signal })
    })
  }

  /**
   * `requestId` and `deadlineMs` are both optional and exist so a benchmark can
   * address a request it started (cancel it, or give it a core-side deadline) the
   * way the desktop client does.
   */
  request(method, params = {}, timeoutMs = 30_000, options = {}) {
    const id = options.requestId || randomUUID()
    const frame = { version: PROTOCOL, kind: 'request', id, method, params }
    if (options.deadlineMs !== undefined) frame.deadlineMs = options.deadlineMs
    const payload = Buffer.from(encode(frame))
    if (payload.length > MAX_FRAME) return Promise.reject(new Error('benchmark request exceeds frame bound'))
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(payload.length)
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('nd-core benchmark request timed out: ' + method))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.child.stdin.write(Buffer.concat([header, payload]), (error) => {
        if (!error) return
        const entry = this.pending.get(id)
        if (!entry) return
        clearTimeout(entry.timer)
        this.pending.delete(id)
        entry.reject(error)
      })
    })
  }

  onceEvent(eventName, predicate = () => true, timeoutMs = 10_000) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.off(eventName, listener)
        reject(new Error('timed out waiting for nd-core event ' + eventName))
      }, timeoutMs)
      const listener = (frame) => {
        if (!predicate(frame)) return
        clearTimeout(timer)
        this.off(eventName, listener)
        resolvePromise(frame)
      }
      this.on(eventName, listener)
    })
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.stdin.end()
    await Promise.race([
      new Promise((resolvePromise) => this.child.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
    ])
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
  }

  #read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length <= 0 || length > MAX_FRAME) throw new Error('invalid nd-core frame length ' + length)
      if (this.buffer.length < length + 4) return
      const payload = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      const frame = decode(payload)
      if (frame.kind === 'response') {
        const entry = this.pending.get(frame.id)
        if (!entry) continue
        clearTimeout(entry.timer)
        this.pending.delete(frame.id)
        if (frame.error) entry.reject(new Error('[' + frame.error.code + '] ' + frame.error.message))
        else entry.resolve(frame.result)
      } else if (frame.kind === 'event') {
        this.emit(frame.event, frame)
        this.emit('*', frame)
      }
    }
  }
}
