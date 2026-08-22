import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { UiCssDeclaration, UiCssRule, UiSourceLocation, UiTarget } from '../../shared/contracts.js'

const INSPECT_ATTRIBUTE = 'data-nd-dsh-inspect-id'
const CONSOLE_PREFIX = '__ND_DSH_INSPECT__:'
const MAX_TEXT = 1_500
const MAX_HTML = 6_000
const MAX_ATTRIBUTES = 48
const MAX_MATCHED_RULES = 18
const MAX_DECLARATIONS = 32

const COMPUTED_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex',
  'flex-direction',
  'align-items',
  'justify-content',
  'grid-template-columns',
  'grid-template-rows',
  'transform',
  'z-index',
] as const

interface UiInspectorCallbacks {
  selected(target: UiTarget): void
  canceled(): void
  error(error: Error): void
}

interface BasicCapture {
  tagName: string
  text: string
  selector: string
  outerHtml: string
  attributes: Record<string, string>
  bounds: UiTarget['bounds']
  computedStyle: Record<string, string>
  source?: UiSourceLocation
  react?: UiTarget['react']
}

interface StyleSheetHeader {
  styleSheetId?: string
  sourceURL?: string
  sourceMapURL?: string
}

export class UiInspector {
  private token: string | undefined

  constructor(
    private readonly contents: WebContents,
    private readonly callbacks: UiInspectorCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.contents.isDestroyed()) throw new Error('Browser page is not available')
    const token = randomUUID()
    this.token = token
    await this.contents.executeJavaScript(selectionOverlayScript(token), true)
  }

  async stop(): Promise<void> {
    this.token = undefined
    if (this.contents.isDestroyed()) return
    try {
      await this.contents.executeJavaScript(cleanupOverlayScript(), true)
    } catch {
      // The page may be navigating or tearing down.
    }
  }

  reset(): void {
    this.token = undefined
  }

  handleConsoleMessage(message: string): void {
    const token = this.token
    if (!token) return
    const marker = `${CONSOLE_PREFIX}${token}:`
    if (!message.startsWith(marker)) return

    const action = message.slice(marker.length)
    this.token = undefined
    if (action === 'cancel') {
      this.callbacks.canceled()
      return
    }
    if (action !== 'selected') return

    void this.capture(token)
      .then((target) => this.callbacks.selected(target))
      .catch((cause) => this.callbacks.error(asError(cause)))
  }

  private async capture(inspectId: string): Promise<UiTarget> {
    let basic: BasicCapture | null = null
    try {
      basic = await this.contents.executeJavaScript(basicCaptureScript(inspectId), true) as BasicCapture | null
      if (!basic) throw new Error('The selected UI element is no longer available')

      const matchedCssRules = await this.captureMatchedCssRules(inspectId).catch(() => [])
      const source = normalizeSource(basic.source ?? basic.react?.source)
      const reactSource = basic.react?.source ? normalizeSource(basic.react.source) : undefined
      const react = basic.react
        ? {
            ...basic.react,
            ...(reactSource ? { source: reactSource } : {}),
          }
        : undefined

      return {
        id: randomUUID(),
        runtime: 'web',
        capturedAt: Date.now(),
        url: this.contents.getURL(),
        tagName: basic.tagName,
        text: basic.text,
        selector: basic.selector,
        outerHtml: basic.outerHtml,
        attributes: basic.attributes,
        bounds: basic.bounds,
        computedStyle: basic.computedStyle,
        matchedCssRules,
        ...(source ? { source } : {}),
        ...(react ? { react } : {}),
      }
    } finally {
      if (!this.contents.isDestroyed()) {
        void this.contents.executeJavaScript(removeInspectAttributeScript(inspectId), true).catch(() => undefined)
      }
    }
  }

  private async captureMatchedCssRules(inspectId: string): Promise<UiCssRule[]> {
    const debuggerApi = this.contents.debugger
    const attachedHere = !debuggerApi.isAttached()
    const headers = new Map<string, StyleSheetHeader>()
    const onMessage = (_event: unknown, method: string, params: unknown): void => {
      if (method !== 'CSS.styleSheetAdded' || !params || typeof params !== 'object') return
      const header = (params as { header?: StyleSheetHeader }).header
      if (header?.styleSheetId) headers.set(header.styleSheetId, header)
    }

    if (attachedHere) debuggerApi.attach('1.3')
    debuggerApi.on('message', onMessage)
    try {
      await debuggerApi.sendCommand('DOM.enable')
      await debuggerApi.sendCommand('CSS.enable')
      const documentResult = await debuggerApi.sendCommand('DOM.getDocument', { depth: 0, pierce: true }) as {
        root?: { nodeId?: number }
      }
      const rootNodeId = documentResult.root?.nodeId
      if (!rootNodeId) return []

      const selector = `[${INSPECT_ATTRIBUTE}="${inspectId}"]`
      const queryResult = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: rootNodeId, selector }) as {
        nodeId?: number
      }
      const nodeId = queryResult.nodeId
      if (!nodeId) return []

      const matched = await debuggerApi.sendCommand('CSS.getMatchedStylesForNode', { nodeId }) as {
        matchedCSSRules?: Array<{
          rule?: {
            origin?: string
            styleSheetId?: string
            selectorList?: { text?: string }
            style?: {
              range?: SourceRange
              cssProperties?: Array<{
                name?: string
                value?: string
                important?: boolean
                disabled?: boolean
                parsedOk?: boolean
                range?: SourceRange
              }>
            }
          }
        }>
      }

      return (matched.matchedCSSRules ?? [])
        .slice(0, MAX_MATCHED_RULES)
        .flatMap((entry) => {
          const rule = entry.rule
          const selectorText = rule?.selectorList?.text?.trim()
          if (!rule || !selectorText) return []
          const header = rule.styleSheetId ? headers.get(rule.styleSheetId) : undefined
          const sourceUrl = header?.sourceURL?.trim() || undefined
          const source = sourceUrl && rule.style?.range
            ? sourceFromRange(sourceUrl, rule.style.range, 'exact')
            : undefined
          const declarations: UiCssDeclaration[] = (rule.style?.cssProperties ?? [])
            .filter((property) => property.name && property.value && property.disabled !== true && property.parsedOk !== false)
            .slice(0, MAX_DECLARATIONS)
            .map((property) => ({
              name: property.name ?? '',
              value: property.value ?? '',
              ...(property.important ? { important: true } : {}),
              ...(sourceUrl && property.range
                ? { source: sourceFromRange(sourceUrl, property.range, 'exact') }
                : {}),
            }))

          return [{
            selector: selectorText,
            origin: rule.origin ?? 'regular',
            declarations,
            ...(source ? { source } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(header?.sourceMapURL ? { sourceMapUrl: header.sourceMapURL } : {}),
          }]
        })
    } finally {
      debuggerApi.removeListener('message', onMessage)
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }
}

interface SourceRange {
  startLine?: number
  startColumn?: number
  endLine?: number
  endColumn?: number
}

function sourceFromRange(file: string, range: SourceRange, confidence: UiSourceLocation['confidence']): UiSourceLocation {
  return normalizeSource({
    file,
    line: (range.startLine ?? 0) + 1,
    column: (range.startColumn ?? 0) + 1,
    confidence,
  }) ?? { file, line: 1, column: 1, confidence }
}

function normalizeSource(source: UiSourceLocation | undefined): UiSourceLocation | undefined {
  if (!source?.file) return undefined
  return { ...source, file: normalizeSourceFile(source.file) }
}

function normalizeSourceFile(input: string): string {
  let value = input.trim()
  if (!value) return value

  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      value = decodeURIComponent(parsed.pathname)
    } else if (parsed.protocol === 'file:') {
      value = decodeURIComponent(parsed.pathname)
    }
  } catch {
    // Non-URL source values are normalized below.
  }

  value = value
    .replace(/^webpack:\/\/\/?/, '')
    .replace(/^vite:\/\/\/?/, '')
    .replace(/^\/@fs\//, '/')
    .replace(/^\.\//, '')
    .replace(/[?#].*$/, '')

  const srcIndex = value.lastIndexOf('/src/')
  if (srcIndex >= 0) return value.slice(srcIndex + 1)
  const libIndex = value.lastIndexOf('/lib/')
  if (libIndex >= 0) return value.slice(libIndex + 1)
  if (/^\/[A-Za-z]:\//.test(value)) return value.slice(1)
  return value
}

function selectionOverlayScript(token: string): string {
  const computedNames = JSON.stringify(COMPUTED_STYLE_PROPERTIES)
  return `(() => {
    const KEY = '__ndDshInspectorRuntime';
    const ATTR = ${JSON.stringify(INSPECT_ATTRIBUTE)};
    const PREFIX = ${JSON.stringify(`${CONSOLE_PREFIX}${token}:`)};
    const previous = window[KEY];
    if (previous && typeof previous.cleanup === 'function') previous.cleanup();

    const overlay = document.createElement('div');
    overlay.setAttribute('data-nd-dsh-overlay', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '2px solid #8b5cf6',
      background: 'rgba(139, 92, 246, 0.12)',
      boxSizing: 'border-box',
      borderRadius: '3px',
      display: 'none'
    });

    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute',
      left: '-2px',
      top: '-24px',
      maxWidth: '360px',
      padding: '3px 7px',
      borderRadius: '4px',
      background: '#7c3aed',
      color: '#fff',
      font: '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
    overlay.appendChild(label);
    document.documentElement.appendChild(overlay);

    let current = null;
    const elementLabel = (element) => {
      const name = element.tagName.toLowerCase();
      const id = element.id ? '#' + element.id : '';
      const classes = Array.from(element.classList || []).slice(0, 3).map((item) => '.' + item).join('');
      return name + id + classes;
    };
    const update = (event) => {
      overlay.style.display = 'none';
      const candidate = document.elementFromPoint(event.clientX, event.clientY);
      if (!(candidate instanceof Element) || candidate === overlay || overlay.contains(candidate)) return;
      current = candidate;
      const rect = candidate.getBoundingClientRect();
      Object.assign(overlay.style, {
        display: 'block',
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: Math.max(0, rect.width) + 'px',
        height: Math.max(0, rect.height) + 'px'
      });
      label.textContent = elementLabel(candidate);
      label.style.top = rect.top < 28 ? '2px' : '-24px';
    };
    const block = (event) => {
      if (!current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', update, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('mousedown', block, true);
      document.removeEventListener('click', select, true);
      document.removeEventListener('keydown', keydown, true);
      overlay.remove();
      if (window[KEY] && window[KEY].cleanup === cleanup) delete window[KEY];
    };
    const select = (event) => {
      if (!current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      current.setAttribute(ATTR, ${JSON.stringify(token)});
      cleanup();
      console.debug(PREFIX + 'selected');
    };
    const keydown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();
      console.debug(PREFIX + 'cancel');
    };

    document.addEventListener('pointermove', update, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('click', select, true);
    document.addEventListener('keydown', keydown, true);
    window[KEY] = { cleanup, computedNames: ${computedNames} };
    return true;
  })()`
}

function cleanupOverlayScript(): string {
  return `(() => {
    const runtime = window.__ndDshInspectorRuntime;
    if (runtime && typeof runtime.cleanup === 'function') runtime.cleanup();
    return true;
  })()`
}

function removeInspectAttributeScript(inspectId: string): string {
  return `(() => {
    const element = document.querySelector('[${INSPECT_ATTRIBUTE}="${inspectId}"]');
    if (element) element.removeAttribute(${JSON.stringify(INSPECT_ATTRIBUTE)});
    return true;
  })()`
}

function basicCaptureScript(inspectId: string): string {
  return `(() => {
    const ATTR = ${JSON.stringify(INSPECT_ATTRIBUTE)};
    const element = document.querySelector('[${INSPECT_ATTRIBUTE}="${inspectId}"]');
    if (!(element instanceof Element)) return null;

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const computedStyle = {};
    for (const name of ${JSON.stringify(COMPUTED_STYLE_PROPERTIES)}) {
      const value = style.getPropertyValue(name);
      if (value) computedStyle[name] = value.trim();
    }

    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, ${MAX_ATTRIBUTES + 1})) {
      if (attribute.name === ATTR) continue;
      attributes[attribute.name] = attribute.value.slice(0, 1000);
      if (Object.keys(attributes).length >= ${MAX_ATTRIBUTES}) break;
    }

    const clone = element.cloneNode(true);
    if (clone instanceof Element) clone.removeAttribute(ATTR);

    const cssEscape = (value) => window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(value)
      : value.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    const selectorFor = (target) => {
      if (target.id) return '#' + cssEscape(target.id);
      const parts = [];
      let cursor = target;
      while (cursor instanceof Element && cursor !== document.documentElement && parts.length < 6) {
        let part = cursor.tagName.toLowerCase();
        const classes = Array.from(cursor.classList || []).filter(Boolean).slice(0, 2);
        if (classes.length) part += classes.map((name) => '.' + cssEscape(name)).join('');
        const parent = cursor.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === cursor.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cursor) + 1) + ')';
        }
        parts.unshift(part);
        cursor = parent;
      }
      return parts.join(' > ');
    };

    const parseLocation = (value, confidence) => {
      if (!value || typeof value !== 'string') return undefined;
      const match = /^(.*):(\\d+)(?::(\\d+))?$/.exec(value.trim());
      if (!match) return undefined;
      return {
        file: match[1],
        line: Number(match[2]),
        ...(match[3] ? { column: Number(match[3]) } : {}),
        confidence
      };
    };
    const sourceFromAttributes = () => {
      let cursor = element;
      while (cursor instanceof Element) {
        for (const name of ['data-nd-source', 'data-inspector-source', 'data-source']) {
          const parsed = parseLocation(cursor.getAttribute(name), name === 'data-nd-source' ? 'exact' : 'inferred');
          if (parsed) return parsed;
        }
        const file = cursor.getAttribute('data-source-file');
        const line = Number(cursor.getAttribute('data-source-line'));
        if (file && Number.isFinite(line) && line > 0) {
          const column = Number(cursor.getAttribute('data-source-column'));
          return { file, line, ...(Number.isFinite(column) && column > 0 ? { column } : {}), confidence: 'exact' };
        }
        cursor = cursor.parentElement;
      }
      return undefined;
    };
    const sourceFromStack = (stack) => {
      if (!stack || typeof stack !== 'string') return undefined;
      for (const line of stack.split('\\n')) {
        if (line.includes('node_modules') || line.includes('react-dom') || line.includes('react.development')) continue;
        const match = /(https?:\\/\\/[^\\s)]+|file:\\/\\/[^\\s)]+|webpack:\\/\\/[^\\s)]+|\\/[^\\s)]+):(\\d+):(\\d+)/.exec(line);
        if (match) return { file: match[1], line: Number(match[2]), column: Number(match[3]), confidence: 'framework' };
      }
      return undefined;
    };
    const reactInfo = () => {
      const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
      if (!key) return undefined;
      let fiber = element[key];
      const hierarchy = [];
      let source;
      for (let depth = 0; fiber && depth < 18; depth += 1, fiber = fiber.return) {
        const type = fiber.elementType || fiber.type;
        if (typeof type !== 'string') {
          const unwrapped = type && typeof type === 'object' && type.type ? type.type : type;
          const name = unwrapped && (unwrapped.displayName || unwrapped.name)
            ? (unwrapped.displayName || unwrapped.name)
            : type && type.displayName
              ? type.displayName
              : undefined;
          if (name && hierarchy[hierarchy.length - 1] !== name) hierarchy.push(String(name));
        }
        if (!source && fiber._debugSource && fiber._debugSource.fileName) {
          source = {
            file: String(fiber._debugSource.fileName),
            line: Number(fiber._debugSource.lineNumber || 1),
            ...(fiber._debugSource.columnNumber ? { column: Number(fiber._debugSource.columnNumber) } : {}),
            confidence: 'framework'
          };
        }
        if (!source) source = sourceFromStack(fiber._debugStack && fiber._debugStack.stack);
      }
      if (!hierarchy.length && !source) return undefined;
      return {
        ...(hierarchy[0] ? { component: hierarchy[0] } : {}),
        hierarchy,
        ...(source ? { source } : {})
      };
    };

    return {
      tagName: element.tagName.toLowerCase(),
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT}),
      selector: selectorFor(element),
      outerHtml: (clone.outerHTML || '').slice(0, ${MAX_HTML}),
      attributes,
      bounds: {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100
      },
      computedStyle,
      source: sourceFromAttributes(),
      react: reactInfo()
    };
  })()`
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}
