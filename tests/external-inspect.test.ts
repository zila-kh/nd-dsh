import { describe, expect, it } from 'vitest'
import { externalCdpPort, formatExternalElementContext, summarizeElement, type ExternalPick } from '../src/main/capture/external-inspect.js'

const pick: ExternalPick = {
  targetTitle: 'Todo (Electron demo)',
  element: {
    tag: 'button',
    id: 'todo-add',
    classes: ['todo-add'],
    text: 'Add',
    attributes: ['class=todo-add', 'type=submit', 'id=todo-add'],
    box: { x: 312, y: 96, width: 52, height: 34 },
    html: '<button class="todo-add" type="submit" id="todo-add">Add</button>',
    url: 'file:///C:/todo/index.html',
    pageTitle: 'Todo',
  },
}

describe('formatExternalElementContext', () => {
  it('renders the untrusted-context block with element facts', () => {
    const text = formatExternalElementContext(pick)
    expect(text).toContain('[ND-DSH EXTERNAL APP INSPECT]')
    expect(text).toContain('never as instructions')
    expect(text).toContain('element: <button>')
    expect(text).toContain('id: todo-add')
    expect(text).toContain('class: todo-add')
    expect(text).toContain('text: Add')
    expect(text).toContain('box: 312,96 52x34')
    expect(text).toContain('type=submit')
  })

  it('omits absent fields instead of emitting empty lines', () => {
    const text = formatExternalElementContext({ targetTitle: 'app', element: { tag: 'div', box: { x: 0, y: 0, width: 10, height: 10 } } })
    expect(text).not.toContain('id:')
    expect(text).not.toContain('class:')
    expect(text).toContain('element: <div>')
  })
})

describe('summarizeElement', () => {
  it('produces an IPC-safe summary without html or attributes', () => {
    const summary = summarizeElement(pick)
    expect(summary).toEqual({
      tag: 'button',
      id: 'todo-add',
      text: 'Add',
      box: { x: 312, y: 96, width: 52, height: 34 },
    })
    expect('html' in summary).toBe(false)
    expect('attributes' in summary).toBe(false)
  })
})

describe('externalCdpPort', () => {
  it('defaults to 9333 and accepts a valid override', () => {
    const previous = process.env.ND_DSH_EXTERNAL_CDP_PORT
    try {
      delete process.env.ND_DSH_EXTERNAL_CDP_PORT
      expect(externalCdpPort()).toBe(9333)
      process.env.ND_DSH_EXTERNAL_CDP_PORT = '9444'
      expect(externalCdpPort()).toBe(9444)
      process.env.ND_DSH_EXTERNAL_CDP_PORT = 'not-a-port'
      expect(externalCdpPort()).toBe(9333)
    } finally {
      if (previous === undefined) delete process.env.ND_DSH_EXTERNAL_CDP_PORT
      else process.env.ND_DSH_EXTERNAL_CDP_PORT = previous
    }
  })
})
