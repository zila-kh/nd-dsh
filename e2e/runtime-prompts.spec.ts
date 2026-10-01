/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { IPC, type DshEventFrame } from '../src/shared/contracts.js'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

type Probe = {
  requests: Array<{ rpcId: string; value: unknown }>
  replies: Map<string, { resolve(): void; reject(error: Error): void }>
}
type ProbeGlobal = typeof globalThis & { __ndPromptProbe: Probe }
let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
  // Only the disposable test app uses this deferred IPC reply. No tool executes.
  await launched.app.evaluate(({ ipcMain }, channel) => {
    const probe: Probe = { requests: [], replies: new Map() }
    ;(globalThis as ProbeGlobal).__ndPromptProbe = probe
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_event, rpcId: string, value: unknown) => {
      probe.requests.push({ rpcId, value })
      return new Promise<void>((resolve, reject) => probe.replies.set(rpcId, { resolve, reject }))
    })
  }, IPC.dshRespond)
})
test.afterAll(async () => { await closeApp(launched) })

async function emit(frame: DshEventFrame) {
  await launched.app.evaluate(({ BrowserWindow }, { channel, frame }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send(channel, frame)
  }, { channel: IPC.dshEvent, frame })
}
async function reply(rpcId: string, succeed = true) {
  await launched.app.evaluate((_electron, { rpcId, succeed }) => {
    const probe = (globalThis as ProbeGlobal).__ndPromptProbe
    const pending = probe.replies.get(rpcId)!
    if (succeed) pending.resolve()
    else pending.reject(new Error('Release test approval transport unavailable'))
    probe.replies.delete(rpcId)
  }, { rpcId, succeed })
}
async function requests(rpcId: string) {
  return await launched.app.evaluate((_electron, rpcId) =>
    (globalThis as ProbeGlobal).__ndPromptProbe.requests.filter((item) => item.rpcId === rpcId), rpcId)
}
function approval(rpcId: string, sessionId: string): DshEventFrame {
  return { kind: 'approval-requested', rpcId, approvalId: rpcId, sessionId, callId: 'test-call', toolName: 'Release test tool', reason: 'Deferred test reply; no tool will execute.' }
}

test('pending answers are single-shot while separate sessions remain independently answerable', async () => {
  const { page } = launched
  await emit({ kind: 'session-event', sessionId: 'test-session-a', event: { type: 'tool/call', seq: 1, time: Date.now(), data: { callId: 'test-call', name: 'Release test tool', arguments: { command: 'node --test', apiKey: 'sk-test-placeholder' } } } })
  await emit(approval('test-approval-a', 'test-session-a'))
  await emit(approval('test-approval-b', 'test-session-b'))
  const a = page.getByRole('article').filter({ hasText: 'Session: test-session-a' })
  const b = page.getByRole('article').filter({ hasText: 'Session: test-session-b' })
  await expect(a).toBeVisible()
  await expect(b).toBeVisible()
  await a.getByText('Requested tool arguments').click()
  await expect(a.getByText(/node --test/)).toBeVisible()
  await expect(a.getByText(/sk-test-placeholder/)).toHaveCount(0)
  await expect(b.getByText('Requested tool arguments')).toHaveCount(0)
  await a.getByRole('button', { name: 'Allow once' }).evaluate((button) => { const element = button as HTMLButtonElement; element.click(); element.click() })
  await expect(a.getByRole('button', { name: 'Allow once' })).toBeDisabled()
  await expect(a.getByRole('button', { name: 'Reject' })).toBeDisabled()
  expect(await requests('test-approval-a')).toHaveLength(1)
  await expect(b.getByRole('button', { name: 'Reject' })).toBeEnabled()
  await b.getByRole('button', { name: 'Reject' }).click()
  expect(await requests('test-approval-b')).toHaveLength(1)
  await emit({ kind: 'approval-resolved' })
  await expect(a).toBeVisible()
  await expect(b).toBeVisible()
  await reply('test-approval-a')
  await expect(a).toHaveCount(0)
  await expect(b).toBeVisible()
  await reply('test-approval-b')
  await expect(b).toHaveCount(0)
})

test('a failed answer remains visible and can be retried once the pending reply settles', async () => {
  const { page } = launched
  await emit(approval('test-approval-retry', 'test-session-retry'))
  const card = page.getByRole('article').filter({ hasText: 'Session: test-session-retry' })
  await card.getByRole('button', { name: 'Allow once' }).click()
  await reply('test-approval-retry', false)
  await expect(card.getByRole('button', { name: 'Allow once' })).toBeEnabled()
  await card.getByRole('button', { name: 'Allow once' }).click()
  expect(await requests('test-approval-retry')).toHaveLength(2)
  await reply('test-approval-retry')
  await expect(card).toHaveCount(0)
})

test('question replies disable editing and cannot be submitted twice while pending', async () => {
  const { page } = launched
  await emit({ kind: 'question-requested', rpcId: 'test-question', sessionId: 'test-session-question', questions: [{ id: 'q', question: 'Choose the test answer', options: ['First', 'Second'] }] })
  const card = page.getByRole('article').filter({ hasText: 'Session: test-session-question' })
  await card.getByRole('button', { name: 'First', exact: true }).click()
  await card.getByRole('button', { name: 'Submit answer' }).evaluate((button) => { const element = button as HTMLButtonElement; element.click(); element.click() })
  await expect(card.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Second', exact: true })).toBeDisabled()
  await expect(card.getByRole('textbox')).toBeDisabled()
  expect(await requests('test-question')).toHaveLength(1)
  await reply('test-question')
  await expect(card).toHaveCount(0)
})
