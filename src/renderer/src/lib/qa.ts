import { useEffect, useState } from 'react'
import type { QaRunStatus, QaState, QaSuiteId } from '../../../shared/contracts'

/** Per-suite console cap; older scrollback is dropped. */
const MAX_OUTPUT_CHARS_PER_SUITE = 120_000

export interface QaStreams {
  qaState: QaState | null
  /** Rolling console text per suite, newest at the end. */
  outputs: Map<QaSuiteId, string>
}

/**
 * Subscribes to the QA service broadcasts (state snapshots + output chunks).
 * Both the QA page and the Settings developer card mount this hook; multiple
 * renderer listeners are supported by the underlying IPC fan-out.
 */
export function useQaStreams(onError: (message: string) => void): QaStreams {
  const [qaState, setQaState] = useState<QaState | null>(null)
  const [outputs, setOutputs] = useState<Map<QaSuiteId, string>>(() => new Map())

  useEffect(() => {
    let mounted = true
    void window.ndDsh.qa.state()
      .then((state) => {
        if (mounted) setQaState(state)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const offState = window.ndDsh.qa.onState((state) => {
      if (mounted) setQaState(state)
    })
    const offOutput = window.ndDsh.qa.onOutput((chunk) => {
      setOutputs((current) => {
        const next = new Map(current)
        const text = (next.get(chunk.suite) ?? '') + chunk.text
        next.set(chunk.suite, text.length > MAX_OUTPUT_CHARS_PER_SUITE ? text.slice(text.length - MAX_OUTPUT_CHARS_PER_SUITE) : text)
        return next
      })
    })
    return () => {
      mounted = false
      offState()
      offOutput()
    }
  }, [onError])

  return { qaState, outputs }
}

/** Last portion of a suite's console, sized for chat prompts and inline display. */
export function outputTail(text: string, maxChars = 6_000): string {
  return text.length > maxChars ? `…${text.slice(text.length - maxChars)}` : text
}

const STATUS_TEXT_CLASSES: Partial<Record<QaRunStatus, string>> = {
  passed: 'text-primary',
  failed: 'text-destructive',
  unavailable: 'text-warning',
  running: 'animate-pulse-dot text-info',
}

export function statusTextClass(status: QaRunStatus): string {
  return STATUS_TEXT_CLASSES[status] ?? 'text-faint'
}

export function statusLabel(status: QaRunStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'passed': return 'Passed'
    case 'failed': return 'Failed'
    case 'unavailable': return 'Unavailable'
    default: return 'Not run'
  }
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'unknown duration'
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(1)} s`
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
