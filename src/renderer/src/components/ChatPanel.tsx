import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { HarnessStatus } from '../../../shared/contracts'
import type { ChatMessage } from '../lib/types'
import { SendIcon, SparkIcon, StopIcon } from './Icons'

interface ChatPanelProps {
  status: HarnessStatus | null
  notifications: string[]
  messages: ChatMessage[]
  onMessages(messages: ChatMessage[]): void
  onError(message: string): void
}

export function ChatPanel({ status, notifications, messages, onMessages, onError }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busy = status?.state === 'running' || status?.state === 'starting'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, notifications.length])

  const run = async (): Promise<void> => {
    const input = prompt.trim()
    if (!input || busy) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input }
    const next = [...messages, userMessage]
    onMessages(next)
    setPrompt('')
    try {
      const result = await window.ndDsh.harness.run(input)
      onMessages([
        ...next,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.finalResponse || 'The Harness completed without a text response.',
          detail: `${result.eventCount} events · ${result.notificationCount} notifications`,
        },
      ])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      onMessages([...next, { id: crypto.randomUUID(), role: 'system', content: message }])
      onError(message)
    }
  }

  const stop = async (): Promise<void> => {
    try {
      await window.ndDsh.harness.stop()
      onMessages([...messages, { id: crypto.randomUUID(), role: 'system', content: 'Harness runtime stopped. The next prompt starts a fresh session.' }])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <aside className="chat-pane">
      <header className="chat-heading">
        <div>
          <span className="eyebrow">DEEPSEEK HARNESS</span>
          <strong>Build with Agent</strong>
        </div>
        <span className={`status-orb ${status?.state ?? 'stopped'}`} title={status?.error} />
      </header>
      {!status?.sourceReady ? <div className="setup-card"><strong>Harness not built</strong><span>Run <code>pnpm bootstrap</code> once.</span></div> : null}
      {status?.sourceReady && !status.apiKeyPresent ? <div className="setup-card warning"><strong>API key missing</strong><span>Add <code>DEEPSEEK_API_KEY</code> to <code>.env</code>.</span></div> : null}
      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((message) => (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="message-label">{message.role === 'assistant' ? <><SparkIcon /> Harness</> : message.role === 'user' ? 'You' : 'Runtime'}</div>
            <div className="message-content">{message.content}</div>
            {message.detail ? <div className="message-detail">{message.detail}</div> : null}
          </article>
        ))}
        {busy ? <div className="agent-working"><span /><span /><span /><em>{status?.state === 'starting' ? 'Starting pinned runtime' : 'Harness is working'}</em></div> : null}
        {notifications.length > 0 ? (
          <details className="notification-log">
            <summary>Runtime activity · {notifications.length}</summary>
            {notifications.slice(-12).map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
          </details>
        ) : null}
      </div>
      <div className="composer-wrap">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void run()
            }
          }}
          placeholder="Ask the agent to inspect, edit, run, or test…"
          rows={3}
        />
        <div className="composer-footer">
          <span>{status?.model ?? 'deepseek-v4-flash'}</span>
          {busy ? (
            <button className="send-button stop" onClick={() => void stop()} title="Stop runtime"><StopIcon /></button>
          ) : (
            <button className="send-button" disabled={!prompt.trim()} onClick={() => void run()} title="Send"><SendIcon /></button>
          )}
        </div>
      </div>
      <div className="chat-footnote">Browser actions run in the pane you can see.</div>
    </aside>
  )
}
