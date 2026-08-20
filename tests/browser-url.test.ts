import { describe, expect, it } from 'vitest'
import { DEFAULT_BROWSER_URL, normalizeBrowserUrl } from '../src/main/browser/browser-url.js'

describe('normalizeBrowserUrl', () => {
  it('uses the local development URL for blank input', () => {
    expect(normalizeBrowserUrl('   ')).toBe(DEFAULT_BROWSER_URL)
  })

  it('uses HTTP for loopback hosts without an explicit scheme', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeBrowserUrl('127.0.0.1:4173/app')).toBe('http://127.0.0.1:4173/app')
    expect(normalizeBrowserUrl('localhost:5173?view=browser')).toBe('http://localhost:5173/?view=browser')
    expect(normalizeBrowserUrl('127.0.0.1:4173#ready')).toBe('http://127.0.0.1:4173/#ready')
  })

  it('uses HTTPS for ordinary hosts and host-port pairs', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
    expect(normalizeBrowserUrl('example.com:8443/app')).toBe('https://example.com:8443/app')
    expect(normalizeBrowserUrl('example.com:8443?mode=test')).toBe('https://example.com:8443/?mode=test')
  })

  it('preserves explicitly allowed protocols', () => {
    expect(normalizeBrowserUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank')
  })

  it('rejects unsupported explicit protocols', () => {
    expect(() => normalizeBrowserUrl('file:///tmp/secret')).toThrow(/Unsupported browser protocol/)
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow(/Unsupported browser protocol/)
    expect(() => normalizeBrowserUrl('about:downloads')).toThrow(/Unsupported browser protocol/)
  })
})
