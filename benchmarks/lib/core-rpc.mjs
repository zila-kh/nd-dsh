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

  request(method, params = {}, timeoutMs = 30_000) {
    const id = randomUUID()
    const payload = Buffer.from(encode({ version: PROTOCOL, kind: 'request', id, method, params }))
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
