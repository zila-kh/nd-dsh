import { describe, expect, it } from 'vitest'
import {
  analyzeBrowserExtensionManifest,
  extensionIdFromManifestKey,
} from '../src/main/browser/browser-extension-compatibility.js'

describe('browser extension compatibility analyzer', () => {
  it('marks the documented Electron subset compatible', () => {
    const result = analyzeBrowserExtensionManifest({
      manifest_version: 3,
      name: 'Supported',
      version: '1.0.0',
      permissions: ['storage', 'scripting', 'tabs', 'webRequest'],
      host_permissions: ['https://example.com/*'],
      content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'] }],
    })
    expect(result.status).toBe('compatible')
    expect(result.notes).toEqual([])
  })

  it('keeps an ND-hosted action popup compatible while explaining the host boundary', () => {
    const result = analyzeBrowserExtensionManifest({
      manifest_version: 3,
      name: 'Popup',
      version: '1.0.0',
      permissions: ['storage'],
      action: {
        default_title: 'Popup',
        default_popup: 'popup.html',
      },
    })
    expect(result.status).toBe('compatible')
    expect(result.notes).toContain(
      'Action popup is hosted by ND inside the built-in browser; chrome.action itself is not claimed as a supported Electron API.',
    )
  })

  it('marks undocumented permission APIs limited', () => {
    const result = analyzeBrowserExtensionManifest({
      manifest_version: 3,
      name: 'Identity extension',
      version: '1.0.0',
      permissions: ['storage', 'identity', 'notifications'],
    })
    expect(result.status).toBe('limited')
    expect(result.notes.join(' ')).toContain('identity')
    expect(result.notes.join(' ')).toContain('notifications')
  })

  it('marks functional manifest features outside the documented subset limited', () => {
    const result = analyzeBrowserExtensionManifest({
      manifest_version: 3,
      name: 'Side panel',
      version: '1.0.0',
      side_panel: { default_path: 'side.html' },
    })
    expect(result.status).toBe('limited')
    expect(result.notes.join(' ')).toContain('side_panel')
  })

  it('records MV3 service workers as provisional without automatically rejecting the extension', () => {
    const result = analyzeBrowserExtensionManifest({
      manifest_version: 3,
      name: 'Worker',
      version: '1.0.0',
      background: { service_worker: 'worker.js' },
    })
    expect(result.status).toBe('limited')
    expect(result.notes.join(' ')).toContain('provisional')
  })
})


describe('extension id verification', () => {
  it('derives Chrome extension ids from the manifest public key', () => {
    expect(extensionIdFromManifestKey('AQIDBA==')).toBe('jpgekhehobljhpbdbpkllgleehcjgmjl')
  })

  it('rejects empty manifest keys', () => {
    expect(extensionIdFromManifestKey('')).toBeUndefined()
  })
})
