import {
  GOOSE_CLI_ENGINE_ID,
  HERMES_CLI_ENGINE_ID,
  JCODE_CLI_ENGINE_ID,
  MINIMAX_CLI_ENGINE_ID,
  OPENCODE_CLI_ENGINE_ID,
} from '../../../shared/extra-coding-engines.js'
import { gooseBinPath, hermesBinPath, jcodeBinPath, opencodeBinPath } from './extra-cli-paths.js'
import { MiniMaxCliEngine } from './minimax-cli-engine.js'
import { StructuredCliEngine, type StructuredCliAdapter, type StructuredCliEvent } from './structured-cli-engine.js'

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const opencodeAdapter: StructuredCliAdapter = {
  id: OPENCODE_CLI_ENGINE_ID,
  label: 'OpenCode',
  sessionPrefix: 'opencode',
  binary: opencodeBinPath,
  unavailableMessage: 'The OpenCode CLI is not installed. Install OpenCode or set ND_DSH_OPENCODE_BINARY.',
  buildArgs: ({ prompt, model, nativeSessionId }) => {
    const args = ['run', '--format', 'json']
    if (nativeSessionId) args.push('--session', nativeSessionId)
    if (model) args.push('--model', model)
    args.push(prompt)
    return args
  },
  parse: (wire) => {
    const events: StructuredCliEvent[] = []
    const nativeSessionId = stringValue(wire.sessionID) ?? stringValue(wire.session_id)
    if (nativeSessionId) events.push({ kind: 'session', sessionId: nativeSessionId })
    const type = stringValue(wire.type)
    const part = recordValue(wire.part)
    if (type === 'text' && part) {
      const text = stringValue(part.text)
      if (text) events.push({ kind: 'text', text })
    }
    if (type === 'tool' && part) {
      const name = stringValue(part.tool) ?? stringValue(part.name) ?? 'tool'
      const state = recordValue(part.state)
      const callId = stringValue(part.callID) ?? stringValue(part.callId) ?? stringValue(part.id)
      const status = stringValue(state?.status)
      if (status === 'running' || status === 'pending') {
        events.push({ kind: 'tool-start', ...(callId ? { callId } : {}), name, input: state?.input ?? part.input ?? null })
      } else if (status === 'completed' || status === 'error') {
        events.push({
          kind: 'tool-result',
          ...(callId ? { callId } : {}),
          name,
          output: state?.output ?? state?.error ?? part.output ?? null,
          ...(status === 'error' ? { isError: true } : {}),
        })
      }
    }
    if (type === 'step_finish' || type === 'step-finish') events.push({ kind: 'done' })
    if (type === 'error') events.push({ kind: 'error', message: stringValue(wire.message) ?? 'OpenCode reported an error' })
    return events
  },
}

const gooseAdapter: StructuredCliAdapter = {
  id: GOOSE_CLI_ENGINE_ID,
  label: 'Goose',
  sessionPrefix: 'goose',
  binary: gooseBinPath,
  unavailableMessage: 'The goose CLI is not installed. Install goose or set ND_DSH_GOOSE_BINARY.',
  buildArgs: ({ prompt, model, nativeSessionId }) => {
    const args = ['run', '--quiet', '--output-format', 'stream-json', '--with-builtin', 'developer']
    if (nativeSessionId) args.push('--resume', '--session-id', nativeSessionId)
    if (model) args.push('--model', model)
    args.push('-t', prompt)
    return args
  },
  parse: (wire) => {
    const events: StructuredCliEvent[] = []
    const nativeSessionId = stringValue(wire.session_id) ?? stringValue(wire.sessionId)
    if (nativeSessionId) events.push({ kind: 'session', sessionId: nativeSessionId })
    const type = stringValue(wire.type)
    if (type === 'message') {
      const message = recordValue(wire.message)
      for (const blockValue of arrayValue(message?.content)) {
        const block = recordValue(blockValue)
        if (!block) continue
        const blockType = stringValue(block.type)
        const text = stringValue(block.text)
        if (text && (blockType === 'text' || blockType === undefined)) events.push({ kind: 'text', text })
        if (blockType === 'toolRequest' || blockType === 'tool_use' || blockType === 'toolUse') {
          const toolCall = recordValue(block.toolCall) ?? recordValue(block.tool_call) ?? block
          const callId = stringValue(toolCall.id)
          const name = stringValue(toolCall.name) ?? 'tool'
          events.push({ kind: 'tool-start', ...(callId ? { callId } : {}), name, input: toolCall.arguments ?? toolCall.input ?? null })
        }
        if (blockType === 'toolResponse' || blockType === 'tool_result' || blockType === 'toolResult') {
          const toolResult = recordValue(block.toolResult) ?? recordValue(block.tool_result) ?? block
          const callId = stringValue(toolResult.id) ?? stringValue(toolResult.toolCallId)
          events.push({ kind: 'tool-result', ...(callId ? { callId } : {}), output: toolResult.result ?? toolResult.output ?? toolResult.text ?? null })
        }
      }
    }
    if (type === 'complete') events.push({ kind: 'done', text: stringValue(wire.text) })
    if (type === 'error') events.push({ kind: 'error', message: stringValue(wire.message) ?? stringValue(wire.error) ?? 'Goose reported an error' })
    return events
  },
}

const jcodeAdapter: StructuredCliAdapter = {
  id: JCODE_CLI_ENGINE_ID,
  label: 'JCode',
  sessionPrefix: 'jcode',
  binary: jcodeBinPath,
  unavailableMessage: 'The JCode CLI is not installed. Install it from https://jcode.sh or set ND_DSH_JCODE_BINARY.',
  buildArgs: ({ prompt, model }) => {
    const args = ['--quiet', '--no-update', '--no-selfdev']
    if (model) args.push('--model', model)
    args.push('run', '--ndjson', prompt)
    return args
  },
  parse: (wire) => {
    const events: StructuredCliEvent[] = []
    const nativeSessionId = stringValue(wire.session_id) ?? stringValue(wire.sessionId)
    if (nativeSessionId) events.push({ kind: 'session', sessionId: nativeSessionId })
    const type = stringValue(wire.type)
    if (type === 'text_delta') {
      const text = stringValue(wire.delta) ?? stringValue(wire.text)
      if (text) events.push({ kind: 'text', text })
    }
    if (type === 'tool_start' || type === 'tool_exec') {
      const callId = stringValue(wire.id) ?? stringValue(wire.call_id)
      events.push({
        kind: 'tool-start',
        ...(callId ? { callId } : {}),
        name: stringValue(wire.name) ?? stringValue(wire.tool) ?? 'tool',
        input: wire.input ?? wire.arguments ?? null,
      })
    }
    if (type === 'tool_done') {
      const callId = stringValue(wire.id) ?? stringValue(wire.call_id)
      events.push({ kind: 'tool-result', ...(callId ? { callId } : {}), output: wire.output ?? wire.result ?? null })
    }
    if (type === 'done') events.push({ kind: 'done', text: stringValue(wire.text) })
    if (type === 'error') events.push({ kind: 'error', message: stringValue(wire.message) ?? stringValue(wire.error) ?? 'JCode reported an error' })
    return events
  },
}

const hermesAdapter: StructuredCliAdapter = {
  id: HERMES_CLI_ENGINE_ID,
  label: 'Hermes',
  sessionPrefix: 'hermes',
  binary: hermesBinPath,
  unavailableMessage: 'The Hermes Agent CLI is not installed. Install Hermes Agent or set ND_DSH_HERMES_BINARY.',
  buildArgs: ({ prompt, model, nativeSessionId }) => {
    const args = ['chat', '--format', 'stream-json', '--source', 'tool']
    if (nativeSessionId) args.push('--resume', nativeSessionId, '--no-restore-cwd')
    if (model) args.push('--model', model)
    args.push('-q', prompt)
    return args
  },
  parse: (wire) => {
    const events: StructuredCliEvent[] = []
    const nativeSessionId = stringValue(wire.session_id) ?? stringValue(wire.sessionId)
    if (nativeSessionId) events.push({ kind: 'session', sessionId: nativeSessionId })
    const type = stringValue(wire.type)
    if (type === 'text') {
      const text = stringValue(wire.text)
      if (text) events.push({ kind: 'text', text })
    }
    if (type === 'tool_use') {
      const callId = stringValue(wire.id) ?? stringValue(wire.call_id)
      events.push({ kind: 'tool-start', ...(callId ? { callId } : {}), name: stringValue(wire.name) ?? 'tool', input: wire.input ?? null })
    }
    if (type === 'tool_result') {
      const callId = stringValue(wire.id) ?? stringValue(wire.call_id)
      const name = stringValue(wire.name)
      events.push({
        kind: 'tool-result',
        ...(callId ? { callId } : {}),
        ...(name ? { name } : {}),
        output: wire.output ?? null,
        ...(wire.is_error === true ? { isError: true } : {}),
      })
    }
    if (type === 'result') {
      const exitCode = typeof wire.exit_code === 'number' ? wire.exit_code : 0
      events.push({
        kind: 'done',
        text: stringValue(wire.text),
        ...(exitCode !== 0 ? { failed: true, message: stringValue(wire.error) ?? `Hermes exited with code ${exitCode}` } : {}),
      })
    }
    return events
  },
}

export type ExtraCliEngine = StructuredCliEngine | MiniMaxCliEngine

export function createExtraCliEngines(log?: (line: string) => void): Array<[string, ExtraCliEngine]> {
  const structured = [opencodeAdapter, gooseAdapter, jcodeAdapter, hermesAdapter].map<[string, ExtraCliEngine]>((adapter) => [
    adapter.id,
    new StructuredCliEngine(adapter, log ? { log } : {}),
  ])
  return [
    ...structured,
    [MINIMAX_CLI_ENGINE_ID, new MiniMaxCliEngine(log)],
  ]
}
