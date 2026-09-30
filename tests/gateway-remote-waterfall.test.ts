import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { GatewayClient } from '../src/main/dsh/gateway-client.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

/**
 * The pinned runtime delivers answerable approvals and user questions as
 * $events waterfalls (`approval/request`, `user-questions/request`). A
 * waterfall nobody answers blocks the agent's turn forever — the recorded
 * 2026-09-29 first-turn hang — so these tests pin the delivery, the
 * $events/result reply mapping, and withdrawal.
 */

interface WfServer {
  server: Server
  wss: WebSocketServer
  hostEvents: Promise<HostSocket>
  posts: unknown[]
}

interface HostSocket {
  reply: (value: unknown) => void
  raw: (message: Record<string, unknown>) => void
}

function waterfallServer(): WfServer {
  const wss = new WebSocketServer({ noServer: true })
  const posts: unknown[] = []
  let resolveHost: (socket: HostSocket) => void
  const hostEvents = new Promise<HostSocket>((resolve) => { resolveHost = resolve })
  const server = createServer(async (request, response) => {
    // The remote face is negotiated by a legacy 404 on session.list.
    if (request.method === 'POST' && request.url === '/api/session.list') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'POST' && request.url === '/api/session/list') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response', rpcId: 'negotiated', result: { ok: true, value: { items: [] } },
      }))
      return
    }
    if (request.method === 'POST' && request.url?.startsWith('/api/$events/result')) {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const envelope = JSON.parse(body) as { payload: unknown }
      posts.push(envelope.payload)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        type: 'server-response',
        rpcId: (envelope as { rpcId?: string }).rpcId,
        result: { ok: true, value: null },
      }))
      return
    }
    response.writeHead(404).end()
  })
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (websocket) => {
      websocket.on('message', (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>
        if (message.endpoint !== '$events') return
        const reply = (value: unknown): void => {
          websocket.send(JSON.stringify({ type: 'item', streamId: message.streamId, value }))
        }
        resolveHost({
          reply,
          raw: (next: Record<string, unknown>) => websocket.send(JSON.stringify(next)),
        })
      })
      wss.emit('connection', websocket, request)
    })
  })
  return { server, wss, hostEvents, posts }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function closeAll(server: Server, wss: WebSocketServer): Promise<void> {
  for (const socket of wss.clients) socket.terminate()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function negotiateRemoteFace(client: GatewayClient): Promise<void> {
  // A 404 on the legacy method flips the client onto the remote face.
  await client.rpc('session.list')
}

describe('GatewayClient remote-face waterfalls', () => {
  it('delivers an approval waterfall as an answerable approval-requested frame and replies through $events/result', async () => {
    const { server, wss, hostEvents, posts } = waterfallServer()
    const port = await listen(server)
    const client = new GatewayClient(`http://127.0.0.1:${port}`)
    client.setWaterfallSessionResolver(() => 'session-active')
    const frames: DshEventFrame[] = []
    try {
      await negotiateRemoteFace(client)
      client.openEvents((frame) => frames.push(frame))
      const host = await hostEvents
      host.reply({ type: 'ready', clientId: 'client-1', host: { home: '/' } })
      host.reply({
        type: 'waterfall',
        event: 'approval/request',
        eventId: 'evt-1',
        agentId: 'agent-1',
        request: { toolName: 'pwsh', callId: 'call_1', reason: 'escalated beyond workspace-write' },
      })
      await vi.waitFor(() => {
        expect(frames.some((frame) => frame.kind === 'approval-requested')).toBe(true)
      })
      const approval = frames.find((frame) => frame.kind === 'approval-requested')
      expect(approval).toMatchObject({
        kind: 'approval-requested',
        sessionId: 'session-active',
        rpcId: 'wf-evt-1',
        approvalId: 'wf-evt-1',
        toolName: 'pwsh',
        callId: 'call_1',
        reason: 'escalated beyond workspace-write',
      })

      await client.respond('wf-evt-1', { sessionId: 'session-active', approvalId: 'wf-evt-1', outcome: 'allowed-once' })
      expect(posts).toEqual([
        { args: { clientId: 'client-1', eventId: 'evt-1', outcome: { kind: 'result', value: 'allowed-once' } } },
      ])
    } finally {
      client.close()
      await closeAll(server, wss)
    }
  })

  it('maps an unrecognized approval outcome onto the fail-closed rejection value', async () => {
    const { server, wss, hostEvents, posts } = waterfallServer()
    const port = await listen(server)
    const client = new GatewayClient(`http://127.0.0.1:${port}`)
    client.setWaterfallSessionResolver(() => 'session-active')
    const frames: DshEventFrame[] = []
    try {
      await negotiateRemoteFace(client)
      client.openEvents((frame) => frames.push(frame))
      const host = await hostEvents
      host.reply({ type: 'ready', clientId: 'client-1', host: { home: '/' } })
      host.reply({
        type: 'waterfall', event: 'approval/request', eventId: 'evt-2', agentId: 'agent-1',
        request: { toolName: 'pwsh' },
      })
      await vi.waitFor(() => expect(frames.some((frame) => frame.kind === 'approval-requested')).toBe(true))
      await client.respond('wf-evt-2', { outcome: 'allowed-always' })
      expect(posts).toEqual([
        { args: { clientId: 'client-1', eventId: 'evt-2', outcome: { kind: 'result', value: 'rejected' } } },
      ])
    } finally {
      client.close()
      await closeAll(server, wss)
    }
  })

  it('delivers a user-question waterfall and answers with the rendered answers object', async () => {
    const { server, wss, hostEvents, posts } = waterfallServer()
    const port = await listen(server)
    const client = new GatewayClient(`http://127.0.0.1:${port}`)
    client.setWaterfallSessionResolver(() => 'session-active')
    const frames: DshEventFrame[] = []
    try {
      await negotiateRemoteFace(client)
      client.openEvents((frame) => frames.push(frame))
      const host = await hostEvents
      host.reply({ type: 'ready', clientId: 'client-1', host: { home: '/' } })
      const questions = [{ id: 'q1', prompt: 'Which branch?' }]
      host.reply({
        type: 'waterfall', event: 'user-questions/request', eventId: 'evt-3', agentId: 'agent-1',
        request: { questions },
      })
      await vi.waitFor(() => {
        expect(frames.some((frame) => frame.kind === 'question-requested')).toBe(true)
      })
      const question = frames.find((frame) => frame.kind === 'question-requested')
      expect(question).toMatchObject({ kind: 'question-requested', sessionId: 'session-active', rpcId: 'wf-evt-3' })
      expect((question?.questions as unknown[]).at(0)).toMatchObject({ id: 'q1' })

      const answers = { answers: [{ id: 'q1', value: 'main' }] }
      await client.respond('wf-evt-3', { sessionId: 'session-active', answer: answers })
      expect(posts).toEqual([
        { args: { clientId: 'client-1', eventId: 'evt-3', outcome: { kind: 'result', value: answers } } },
      ])
    } finally {
      client.close()
      await closeAll(server, wss)
    }
  })

  it('withdraws a cancelled waterfall and rejects a later answer for it', async () => {
    const { server, wss, hostEvents, posts } = waterfallServer()
    const port = await listen(server)
    const client = new GatewayClient(`http://127.0.0.1:${port}`)
    client.setWaterfallSessionResolver(() => 'session-active')
    const frames: DshEventFrame[] = []
    try {
      await negotiateRemoteFace(client)
      client.openEvents((frame) => frames.push(frame))
      const host = await hostEvents
      host.reply({ type: 'ready', clientId: 'client-1', host: { home: '/' } })
      host.reply({
        type: 'waterfall', event: 'approval/request', eventId: 'evt-4', agentId: 'agent-1',
        request: { toolName: 'pwsh' },
      })
      await vi.waitFor(() => expect(frames.some((frame) => frame.kind === 'approval-requested')).toBe(true))
      host.reply({ type: 'cancel', eventId: 'evt-4' })
      await vi.waitFor(() => {
        expect(frames.some((frame) => frame.kind === 'approval-resolved' && frame.outcome === 'cancelled')).toBe(true)
      })
      await expect(client.respond('wf-evt-4', { outcome: 'allowed-once' })).rejects.toThrow()
      expect(posts).toEqual([])
    } finally {
      client.close()
      await closeAll(server, wss)
    }
  })
})
