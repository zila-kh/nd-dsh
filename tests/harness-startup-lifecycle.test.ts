import { describe, expect, it, vi } from 'vitest'
import { dshWebUrl, HarnessService } from '../src/main/harness/harness-service.js'

interface HarnessStartupSeam {
  gateway?: unknown
  startPromise?: Promise<unknown>
  stopping: boolean
  tokenSaverEnabled(): boolean
  start(): Promise<unknown>
  close(): Promise<void>
  updateStatus(state: string, error?: string): void
  ensureStarted(): Promise<unknown>
}

describe('HarnessService startup lifecycle', () => {
  it('extracts only the authenticated URL for the assigned loopback origin', () => {
    const output = [
      'noise',
      'dsh web: http://127.0.0.1:4123/?token=wrong-port',
      'dsh web: http://127.0.0.1:4124/?token=right-token (LAN: http://10.0.0.2:4124/?token=right-token)',
    ].join('\n')

    expect(dshWebUrl(output, 'http://127.0.0.1:4124')).toBe('http://127.0.0.1:4124/?token=right-token')
  })

  it('cleans up a partial launch and leaves starting state on failure', async () => {
    const service = Object.create(HarnessService.prototype) as HarnessStartupSeam
    const failure = new Error('Runtime gateway did not become ready within the timeout')

    service.stopping = false
    service.tokenSaverEnabled = () => true
    service.start = vi.fn().mockRejectedValue(failure)
    service.close = vi.fn(async () => {
      service.stopping = true
      service.updateStatus('stopped')
    })
    service.updateStatus = vi.fn()

    await expect(service.ensureStarted()).rejects.toBe(failure)

    expect(service.close).toHaveBeenCalledOnce()
    expect(service.updateStatus).toHaveBeenLastCalledWith('error', failure.message)
    expect(service.startPromise).toBeUndefined()
  })

  it('does not turn an intentional shutdown into a startup error', async () => {
    const service = Object.create(HarnessService.prototype) as HarnessStartupSeam

    service.stopping = true
    service.tokenSaverEnabled = () => true
    service.start = vi.fn().mockRejectedValue(new Error('Runtime exited'))
    service.close = vi.fn(async () => {
      service.updateStatus('stopped')
    })
    service.updateStatus = vi.fn()

    await expect(service.ensureStarted()).rejects.toThrow('Runtime exited')

    expect(service.updateStatus).toHaveBeenCalledTimes(1)
    expect(service.updateStatus).toHaveBeenCalledWith('stopped')
  })
})
