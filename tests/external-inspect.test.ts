import { describe, expect, it } from 'vitest'
import { describePick, externalCdpPort, formatExternalElementContext, RecentPickStore, summarizeElement, ExternalElementStage, type ExternalPick, type PickScreenshot } from '../src/main/capture/external-inspect.js'

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

const richPick: ExternalPick = {
  targetTitle: 'Todo (Electron demo)',
  element: {
    ...pick.element,
    selector: 'html > body > div#root > button#todo-add.todo-add',
    styles: { display: 'inline-block', color: 'rgb(255, 255, 255)', 'font-size': '14px' },
    source: 'src/App.tsx:42',
  },
}

const shot: PickScreenshot = {
  data: 'aGVsbG8=',
  mediaType: 'image/png',
  name: 'element-capture.png',
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
    expect(text).not.toContain('selector:')
    expect(text).not.toContain('source:')
    expect(text).not.toContain('computed styles:')
    expect(text).toContain('element: <div>')
  })

  it('includes the richer capture: selector path, computed styles, source location', () => {
    const text = formatExternalElementContext(richPick)
    expect(text).toContain('selector: html > body > div#root > button#todo-add.todo-add')
    expect(text).toContain("display: inline-block")
    expect(text).toContain('color: rgb(255, 255, 255)')
    expect(text).toContain('font-size: 14px')
    expect(text).toContain('source: src/App.tsx:42')
    expect(text).toContain('may be missing in production builds')
  })

  it('announces an attached element screenshot when one rode along', () => {
    expect(formatExternalElementContext(richPick, shot)).toContain('cropped screenshot of this exact element is attached')
    expect(formatExternalElementContext(pick)).not.toContain('cropped screenshot')
  })
})

describe('describePick', () => {
  it('builds a compact chip name from id or first class', () => {
    expect(describePick(pick).shortName).toBe('button#todo-add')
    expect(describePick({
      targetTitle: 'app',
      element: { tag: 'div', classes: ['todo-item', 'row'], box: { x: 0, y: 0, width: 1, height: 1 } },
    }).shortName).toBe('div.todo-item')
    expect(describePick({
      targetTitle: 'app',
      element: { tag: 'span', box: { x: 0, y: 0, width: 1, height: 1 } },
    }).shortName).toBe('span')
  })

  it('joins hover facts and always names the target app', () => {
    const { hover } = describePick(pick)
    expect(hover).toContain('<button> #todo-add')
    expect(hover).toContain('text: Add')
    expect(hover).toContain('Todo (Electron demo)')
  })

  it('surfaces the dev-build source location in the hover summary when present', () => {
    expect(describePick(richPick).hover).toContain('source: src/App.tsx:42')
    expect(describePick(pick).hover).not.toContain('source:')
  })
})

describe('RecentPickStore', () => {
  it('round-trips picks and screenshots by id', () => {
    const store = new RecentPickStore()
    const plainId = store.put(pick)
    const richId = store.put(richPick, shot)
    expect(plainId).not.toBe(richId)
    expect(store.get(plainId)).toEqual(pick)
    expect(store.screenshot(plainId)).toBeUndefined()
    expect(store.get(richId)).toEqual(richPick)
    expect(store.screenshot(richId)).toEqual(shot)
    expect(store.get('missing')).toBeUndefined()
  })

  it('evicts the oldest entries once past capacity', () => {
    const store = new RecentPickStore()
    const ids: string[] = []
    for (let index = 0; index < 8; index += 1) ids.push(store.put(pick))
    const [oldest, second, newest] = ids
    if (!oldest || !second || !newest) throw new Error('expected eight pick ids')
    expect(store.get(oldest)).toBeUndefined()
    expect(store.get(second)).toBeUndefined()
    expect(store.get(newest)).toEqual(pick)
  })
})

describe('ExternalElementStage', () => {
  it('keeps a screenshot attached to a staged pick through consumption', () => {
    const stage = new ExternalElementStage()
    const views = stage.stage(richPick, shot)
    expect(views).toHaveLength(1)
    expect(views[0]?.shortName).toBe('button#todo-add')
    expect(stage.consumeAll()).toEqual([{ pick: richPick, screenshot: shot }])
    expect(stage.consumeAll()).toEqual([])
  })

  it('consumes staged picks without screenshots as pick-only items', () => {
    const stage = new ExternalElementStage()
    stage.stage(pick)
    expect(stage.consumeAll()).toEqual([{ pick }])
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
