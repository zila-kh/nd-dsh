import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { AntigravityEngine } from '../src/main/engines/antigravity/antigravity-engine.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

/**
 * Scripted stand-in for the `agy --output-format stream-json --input-format
 * stream-json` child: records the NDJSON user events written to stdin and lets
 * each test drive init/step_update/result events and crashes over stdout.
 */
class FakeAgy {
  readonly child: ChildProcess
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  argv: string[] = []
  spawnCwd: string | undefined = undefined
  prompts: Array<{ event: string; message: { content: string } }> = []
  private buffer = ''

  constructor() {
    this.stdin = new PassThrough()
    this.stdout = new PassThrough()
    const stderr = new PassThrough()
    const base = new EventEmitter() as unknown as Record<string, unknown>
    base.stdout = this.stdout
    base.stdin = this.stdin
    base.stderr = stderr
    base.pid = 43_434
    base.exitCode = null
    base.signalCode = null
    base.kill = () => {
      queueMicrotask(() => this.child.emit('exit', null, 'SIGTERM'))
      return true
    }
    this.child = base as unknown as ChildProcess
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline = this.buffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (line) this.prompts.push(JSON.parse(line) as { event: string; message: { content: string } })
        newline = this.buffer.indexOf('\n')
      }
    })
  }

  emitLine(value: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(value)}\n`)
  }

  init(conversationId: string): void {
    this.emitLine({ event: 'init', conversation_id: conversationId, init: { cwd: this.spawnCwd, tools: [], permission_mode: 'request-review' } })
  }

  step(stepIndex: number, extra: Record<string, unknown>): void {
    this.emitLine({ event: 'step_update', conversation_id: 'conv-1', step_update: { conversation_id: 'conv-1', step_index: stepIndex, ...extra } })
  }

  completeTurn(response: string): void {
    this.emitLine({ event: 'result', result: { conversation_id: 'conv-1', status: 'SUCCESS', response, duration_seconds: 1, num_turns: 1 } })
  }

  failTurn(message: string): void {
    this.emitLine({ event: 'result', result: { conversation_id: 'conv-1', status: 'ERROR', response: '', error: { message } } })
  }

  crash(code: number | null, signal: string | null): void {
    this.child.emit('exit', code, signal)
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))
const flush = async (): Promise<void> => { await tick(); await tick() }

// The engine refuses to spawn without a resolvable binary; point the dev
// override at any existing file since the fake child never executes it.
const originalOverride = process.env.ND_DSH_ANTIGRAVITY_BINARY
afterAll(() => {
  if (originalOverride === undefined) delete process.env.ND_DSH_ANTIGRAVITY_BINARY
  else process.env.ND_DSH_ANTIGRAVITY_BINARY = originalOverride
})

async function makeEngine() {
  process.env.ND_DSH_ANTIGRAVITY_BINARY = process.execPath
  const spawned: FakeAgy[] = []
  const engine = new AntigravityEngine({
    log: () => {},
    spawnProcess: ((command: string, args: readonly string[], options: { cwd?: string }) => {
      const fake = new FakeAgy()
      fake.argv = [command, ...args]
      fake.spawnCwd = options?.cwd
      spawned.push(fake)
      return fake.child
    }) as never,
  })
  const frames: DshEventFrame[] = []
  engine.setEmitter((frame) => frames.push(frame))
  return { engine, spawned, frames }
}

describe('AntigravityEngine', () => {
  it('creates a session, streams a turn into shared frames, and settles cleanly', async () => {
    const { engine, spawned, frames } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      expect(sessionId).toMatch(/^antigravity-/)
      const runPromise = engine.run('fix the bug', { sessionId })
      await flush()
      expect(spawned.length).toBe(1)
      expect(spawned[0]!.argv.slice(1)).toEqual([
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--disable-slash-commands',
        '--add-dir', '/workspace',
      ])
      expect(spawned[0]!.spawnCwd).toBe('/workspace')

      const fake = spawned[0]!
      fake.init('conv-1')
      fake.step(0, { state: 'DONE', step_type: 'user_input' })
      fake.step(1, { state: 'ACTIVE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: 'probe.txt' } } })
      fake.step(1, { state: 'DONE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: 'probe.txt' } } })
      fake.step(2, { state: 'DONE', step_type: 'agent_response', text_delta: 'all done' })
      fake.completeTurn('all done')
      await expect(runPromise).resolves.toEqual({ sessionId })

      const types = frames.filter((frame) => frame.sessionId === sessionId).map((frame) => frame.kind === 'session-event' ? frame.event?.type : frame.kind)
      expect(types).toContain('user/message')
      expect(types).toContain('tool/call')
      expect(types).toContain('tool/result')
      // The final `result` response duplicates the streamed agent_response; only
      // one assistant message must land in the transcript.
      expect(types.filter((type) => type === 'assistant/message')).toHaveLength(1)

      const transcript = engine.transcript(sessionId)
      expect(transcript.engineId).toBe('antigravity')
      expect(transcript.events.map((event) => event.type)).toEqual(['user/message', 'tool/call', 'tool/result', 'assistant/message'])
      const summaries = engine.listSessions()
      expect(summaries[0]?.running).toBe(false)
      expect(summaries[0]?.title).toBe('fix the bug')
      expect(engine.handlesApproval('any')).toBe(false)
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('runs multiple turns over one child and forwards the prompt on stdin', async () => {
    const { engine, spawned } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const first = engine.run('first task', { sessionId })
      await flush()
      spawned[0]!.completeTurn('ok')
      await first
      const second = engine.run('second task', { sessionId })
      await flush()
      expect(spawned.length).toBe(1)
      spawned[0]!.completeTurn('done')
      await second
      expect(spawned[0]!.prompts).toEqual([
        { event: 'user', message: { content: 'first task' } },
        { event: 'user', message: { content: 'second task' } },
      ])
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('passes a requested model slug to the spawned CLI', async () => {
    const { engine, spawned } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const runPromise = engine.run('plan the work', { sessionId, model: 'gemini-3.1-pro-high' })
      await flush()
      expect(spawned[0]!.argv).toContain('--model')
      expect(spawned[0]!.argv[spawned[0]!.argv.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high')
      spawned[0]!.completeTurn('planned')
      await runPromise
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('resumes the conversation by id after the child dies between turns', async () => {
    const { engine, spawned } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const first = engine.run('first task', { sessionId })
      await flush()
      spawned[0]!.init('conv-1')
      spawned[0]!.completeTurn('ok')
      await first

      spawned[0]!.crash(1, null)
      await flush()

      const second = engine.run('second task', { sessionId })
      await flush()
      expect(spawned.length).toBe(2)
      expect(spawned[1]!.argv).toContain('--conversation')
      expect(spawned[1]!.argv[spawned[1]!.argv.indexOf('--conversation') + 1]).toBe('conv-1')
      spawned[1]!.completeTurn('recovered')
      await expect(second).resolves.toEqual({ sessionId })

      // ND-side transcript survives across the child restart.
      expect(engine.transcript(sessionId).events.some((event) => event.type === 'user/message' && JSON.stringify(event.data).includes('second task'))).toBe(true)
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('reports an unexpected child crash mid-turn as an agent-error and rejects the run', async () => {
    const { engine, spawned, frames } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const runPromise = engine.run('keep going', { sessionId })
      await flush()
      spawned[0]!.crash(1, null)
      await expect(runPromise).rejects.toThrow(/exited/i)
      expect(frames.some((frame) => frame.kind === 'agent-error' && frame.sessionId === sessionId)).toBe(true)
      expect(engine.listSessions()[0]?.running).toBe(false)
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('fails a turn whose terminal result status is not SUCCESS', async () => {
    const { engine, spawned, frames } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const runPromise = engine.run('attempt the impossible', { sessionId })
      await flush()
      spawned[0]!.failTurn('quota exceeded')
      await expect(runPromise).rejects.toThrow(/quota exceeded/)
      expect(frames.some((frame) => frame.kind === 'agent-error')).toBe(true)
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('stop tears down the child, settles the turn as stopped, and resumes later', async () => {
    const { engine, spawned } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const runPromise = engine.run('long task', { sessionId })
      await flush()
      spawned[0]!.init('conv-1')
      // Attach the rejection expectation before stopping: the turn settles as
      // soon as stop() resolves it, and the rejection must not go unobserved.
      const stopped = expect(runPromise).rejects.toThrow(/stopped/i)
      await engine.stop(sessionId)
      await stopped
      expect(engine.listSessions()[0]?.running).toBe(false)

      const resume = engine.run('try again', { sessionId })
      await flush()
      expect(spawned.length).toBe(2)
      expect(spawned[1]!.argv).toContain('--conversation')
      spawned[1]!.completeTurn('done')
      await expect(resume).resolves.toEqual({ sessionId })
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('applies a mid-conversation model change by respawning with the new slug', async () => {
    const { engine, spawned } = await makeEngine()
    try {
      const { sessionId } = await engine.createSession({ cwd: '/workspace' })
      const first = engine.run('start', { sessionId, model: 'gemini-3.6-flash-high' })
      await flush()
      spawned[0]!.init('conv-1')
      spawned[0]!.completeTurn('ok')
      await first
      expect(spawned.length).toBe(1)

      const second = engine.run('switch model', { sessionId, model: 'gemini-3.1-pro-high' })
      await flush()
      expect(spawned.length).toBe(2)
      const argv = spawned[1]!.argv
      expect(argv[argv.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high')
      expect(argv[argv.indexOf('--conversation') + 1]).toBe('conv-1')
      spawned[1]!.completeTurn('done')
      await expect(second).resolves.toEqual({ sessionId })

      // The same slug again reuses the live child — no respawn.
      const third = engine.run('keep going', { sessionId, model: 'gemini-3.1-pro-high' })
      await flush()
      expect(spawned.length).toBe(2)
      spawned[1]!.completeTurn('ok')
      await third
    } finally {
      await engine.close()
    }
  }, 15_000)

  it('parses the agy models catalog and caches it', async () => {
    process.env.ND_DSH_ANTIGRAVITY_BINARY = process.execPath
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const base = new EventEmitter() as unknown as Record<string, unknown>
    base.stdout = stdout
    base.stderr = stderr
    base.stdin = new PassThrough()
    base.pid = 43_435
    base.exitCode = null
    base.signalCode = null
    base.kill = () => true
    const child = base as unknown as ChildProcess
    let spawnCount = 0
    const engine = new AntigravityEngine({
      log: () => {},
      spawnProcess: ((_command: string, args: readonly string[]) => {
        spawnCount += 1
        expect(args[0]).toBe('models')
        queueMicrotask(() => {
          stdout.write('Fetching available models...\n')
          stdout.write('gemini-3.1-pro-high\tGemini 3.1 Pro (High)\n')
          stdout.write('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n')
          stdout.write('\n')
          child.emit('exit', 0, null)
        })
        return child
      }) as never,
    })
    try {
      const models = await engine.listModels()
      expect(models).toEqual([
        { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
        { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      ])
      // The short cache serves repeat calls without respawning the CLI.
      await expect(engine.listModels()).resolves.toHaveLength(2)
      expect(spawnCount).toBe(1)
    } finally {
      await engine.close()
    }
  }, 15_000)
})
