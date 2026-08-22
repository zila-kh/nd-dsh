import { randomUUID } from 'node:crypto'
import type { NativeImage, WebContents } from 'electron'
import type {
  UiAnnotation,
  UiAnnotationElementReference,
  UiAnnotationMark,
} from '../../shared/contracts.js'

const RUNTIME_KEY = '__ndDshAnnotatorRuntime'
const CONSOLE_PREFIX = '__ND_DSH_ANNOTATE__:'
const MAX_MARKS = 24
const MAX_POINTS_PER_MARK = 400
const MAX_ELEMENT_REFERENCES = 18
const MAX_PROMPT_IMAGE_BYTES = 3_200_000
const OVERLAY_MAX_DIMENSION = 1_600
const PROMPT_MAX_DIMENSION = 1_600

export interface UiAnnotationImage {
  mediaType: 'image/jpeg'
  data: string
  name: string
}

export interface UiAnnotationCapture {
  annotation: UiAnnotation
  image: UiAnnotationImage
}

interface AnnotationDraft {
  viewport: { width: number; height: number }
  marks: UiAnnotationMark[]
  elements: UiAnnotationElementReference[]
}

interface UiAnnotatorCallbacks {
  canceled(): void
}

export class UiAnnotator {
  private token: string | undefined

  constructor(
    private readonly contents: WebContents,
    private readonly callbacks: UiAnnotatorCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.contents.isDestroyed()) throw new Error('Browser page is not available')
    await this.cancel()

    const token = randomUUID()
    const frozenFrame = encodeFrozenFrame(await this.contents.capturePage())
    this.token = token
    try {
      await this.contents.executeJavaScript(annotationOverlayScript(token, frozenFrame), true)
    } catch (cause) {
      if (this.token === token) this.token = undefined
      throw cause
    }
  }

  async finish(): Promise<UiAnnotationCapture | undefined> {
    const token = this.token
    if (!token) return undefined
    if (this.contents.isDestroyed()) {
      this.token = undefined
      throw new Error('Browser page is not available')
    }

    try {
      const draft = await this.contents.executeJavaScript(annotationFinishScript(token), true) as AnnotationDraft | null
      if (!draft || draft.marks.length === 0) return undefined

      const id = randomUUID()
      const captured = await this.contents.capturePage()
      const image = encodePromptImage(captured, id)
      const annotation: UiAnnotation = {
        id,
        runtime: 'web',
        capturedAt: Date.now(),
        url: this.contents.getURL(),
        viewport: draft.viewport,
        marks: draft.marks,
        elements: draft.elements,
      }
      return { annotation, image }
    } finally {
      if (this.token === token) this.token = undefined
      if (!this.contents.isDestroyed()) {
        await this.contents.executeJavaScript(annotationCleanupScript(token), true).catch(() => undefined)
      }
    }
  }

  async cancel(): Promise<void> {
    const token = this.token
    this.token = undefined
    if (this.contents.isDestroyed()) return
    await this.contents.executeJavaScript(annotationCleanupScript(token), true).catch(() => undefined)
  }

  reset(): void {
    this.token = undefined
  }

  handleConsoleMessage(message: string): void {
    const token = this.token
    if (!token) return
    const marker = `${CONSOLE_PREFIX}${token}:`
    if (!message.startsWith(marker)) return
    if (message.slice(marker.length) !== 'cancel') return
    this.token = undefined
    this.callbacks.canceled()
  }
}

function encodeFrozenFrame(image: NativeImage): string {
  const prepared = resizeToMax(image, OVERLAY_MAX_DIMENSION)
  return `data:image/jpeg;base64,${prepared.toJPEG(84).toString('base64')}`
}

function encodePromptImage(image: NativeImage, annotationId: string): UiAnnotationImage {
  let prepared = resizeToMax(image, PROMPT_MAX_DIMENSION)
  let bytes = prepared.toJPEG(82)
  if (bytes.byteLength > MAX_PROMPT_IMAGE_BYTES) bytes = prepared.toJPEG(68)
  if (bytes.byteLength > MAX_PROMPT_IMAGE_BYTES) {
    prepared = resizeToMax(prepared, 1_200)
    bytes = prepared.toJPEG(70)
  }
  if (bytes.byteLength > MAX_PROMPT_IMAGE_BYTES) {
    throw new Error('Annotated browser frame is too large to attach safely')
  }
  return {
    mediaType: 'image/jpeg',
    data: bytes.toString('base64'),
    name: `nd-dsh-annotation-${annotationId}.jpg`,
  }
}

function resizeToMax(image: NativeImage, maxDimension: number): NativeImage {
  const { width, height } = image.getSize()
  if (width <= maxDimension && height <= maxDimension) return image
  const scale = Math.min(maxDimension / width, maxDimension / height)
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good',
  })
}

function annotationOverlayScript(token: string, frozenFrame: string): string {
  return `(() => {
    const KEY = ${JSON.stringify(RUNTIME_KEY)};
    const TOKEN = ${JSON.stringify(token)};
    const PREFIX = ${JSON.stringify(`${CONSOLE_PREFIX}${token}:`)};
    const previous = window[KEY];
    if (previous && typeof previous.cleanup === 'function') previous.cleanup();

    const root = document.createElement('div');
    root.setAttribute('data-nd-dsh-annotation-root', TOKEN);
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      overflow: 'hidden',
      cursor: 'crosshair',
      userSelect: 'none',
      touchAction: 'none',
      background: '#111827'
    });

    const frozen = document.createElement('img');
    frozen.src = ${JSON.stringify(frozenFrame)};
    frozen.alt = '';
    Object.assign(frozen.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'fill',
      pointerEvents: 'none'
    });

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'auto'
    });

    const hint = document.createElement('div');
    hint.textContent = 'Annotating · drag to draw · Shift+drag box · Ctrl/Cmd+Z undo · Esc cancel';
    Object.assign(hint.style, {
      position: 'absolute',
      top: '12px',
      left: '12px',
      zIndex: '2',
      maxWidth: 'calc(100vw - 24px)',
      padding: '6px 9px',
      border: '1px solid rgba(96,165,250,.65)',
      borderRadius: '999px',
      background: 'rgba(15,23,42,.88)',
      color: '#dbeafe',
      font: '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      pointerEvents: 'none'
    });

    root.append(frozen, canvas, hint);
    document.documentElement.appendChild(root);

    const ctx = canvas.getContext('2d');
    const marks = [];
    let current = null;
    let finalized = false;

    const resize = () => {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    const clampPoint = (event) => ({
      x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
      y: Math.max(0, Math.min(window.innerHeight, event.clientY))
    });
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const drawMark = (mark) => {
      if (!ctx || !mark || !mark.points.length) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2f81f7';
      ctx.fillStyle = 'rgba(47,129,247,.12)';
      ctx.shadowColor = 'rgba(15,23,42,.72)';
      ctx.shadowBlur = 2;
      if (mark.kind === 'rectangle') {
        const start = mark.points[0];
        const end = mark.points[mark.points.length - 1] || start;
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      } else if (mark.kind === 'point') {
        const point = mark.points[0];
        ctx.beginPath();
        ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        const first = mark.points[0];
        ctx.moveTo(first.x, first.y);
        for (let index = 1; index < mark.points.length; index += 1) {
          const point = mark.points[index];
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };
    const redraw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const mark of marks) drawMark(mark);
    };

    const onPointerDown = (event) => {
      if (finalized || event.button !== 0 || marks.length >= ${MAX_MARKS}) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = clampPoint(event);
      current = { kind: event.shiftKey ? 'rectangle' : 'freehand', points: [point] };
      marks.push(current);
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    };
    const onPointerMove = (event) => {
      if (finalized || !current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = clampPoint(event);
      if (current.kind === 'rectangle') {
        current.points = [current.points[0], point];
      } else if (current.points.length < ${MAX_POINTS_PER_MARK}) {
        const last = current.points[current.points.length - 1];
        if (!last || distance(last, point) >= 2) current.points.push(point);
      }
      redraw();
    };
    const finishPointer = (event) => {
      if (finalized || !current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const start = current.points[0];
      const end = clampPoint(event);
      if (distance(start, end) < 4) {
        current.kind = 'point';
        current.points = [start];
      } else if (current.kind === 'rectangle') {
        current.points = [start, end];
      } else if (current.points.length < 2) {
        current.points.push(end);
      }
      current = null;
      redraw();
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    };
    const onContextMenu = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup();
        console.debug(PREFIX + 'cancel');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopImmediatePropagation();
        current = null;
        marks.pop();
        redraw();
      }
    };
    const detachInteraction = () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', finishPointer, true);
      canvas.removeEventListener('pointercancel', finishPointer, true);
      root.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', resize);
    };
    const cleanup = () => {
      detachInteraction();
      root.remove();
      if (window[KEY] && window[KEY].token === TOKEN) delete window[KEY];
    };

    const cssEscape = (value) => window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(value)
      : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
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
    const sourceFromElement = (element) => {
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
    const reactInfo = (element) => {
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
    const round = (value) => Math.round(value * 100) / 100;
    const normalizeMark = (mark) => {
      const points = mark.points.map((point) => ({ x: round(point.x), y: round(point.y) }));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        kind: mark.kind,
        points,
        bounds: { x: minX, y: minY, width: round(maxX - minX), height: round(maxY - minY) }
      };
    };
    const samplePoints = (mark) => {
      const points = mark.points || [];
      if (!points.length) return [];
      if (mark.kind === 'rectangle' && points.length >= 2) {
        const a = points[0];
        const b = points[points.length - 1];
        return [
          a,
          b,
          { x: a.x, y: b.y },
          { x: b.x, y: a.y },
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        ];
      }
      if (points.length <= 8) return points;
      const samples = [];
      const step = (points.length - 1) / 7;
      for (let index = 0; index < 8; index += 1) samples.push(points[Math.round(index * step)]);
      return samples;
    };
    const elementReference = (element) => {
      const rect = element.getBoundingClientRect();
      const source = sourceFromElement(element);
      const react = reactInfo(element);
      return {
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
        bounds: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
        ...(source ? { source } : {}),
        ...(react ? { react } : {})
      };
    };
    const snapshot = () => {
      finalized = true;
      current = null;
      detachInteraction();
      hint.style.display = 'none';
      canvas.style.cursor = 'default';

      const normalizedMarks = marks.filter((mark) => mark.points && mark.points.length).map(normalizeMark);
      const elements = new Map();
      root.style.visibility = 'hidden';
      try {
        for (const mark of marks) {
          for (const point of samplePoints(mark)) {
            const element = document.elementFromPoint(point.x, point.y);
            if (!(element instanceof Element)) continue;
            const reference = elementReference(element);
            if (reference.selector && !elements.has(reference.selector)) elements.set(reference.selector, reference);
            if (elements.size >= ${MAX_ELEMENT_REFERENCES}) break;
          }
          if (elements.size >= ${MAX_ELEMENT_REFERENCES}) break;
        }
      } finally {
        root.style.visibility = 'visible';
      }
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        marks: normalizedMarks,
        elements: Array.from(elements.values())
      };
    };

    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', finishPointer, true);
    canvas.addEventListener('pointercancel', finishPointer, true);
    root.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', resize);
    window[KEY] = { token: TOKEN, root, cleanup, snapshot };
    resize();
    return true;
  })()`
}

function annotationFinishScript(token: string): string {
  return `(() => {
    const runtime = window[${JSON.stringify(RUNTIME_KEY)}];
    if (!runtime || runtime.token !== ${JSON.stringify(token)} || typeof runtime.snapshot !== 'function') return null;
    return runtime.snapshot();
  })()`
}

function annotationCleanupScript(token?: string): string {
  return `(() => {
    const runtime = window[${JSON.stringify(RUNTIME_KEY)}];
    if (!runtime) return true;
    const expected = ${JSON.stringify(token ?? '')};
    if (expected && runtime.token !== expected) return true;
    if (typeof runtime.cleanup === 'function') runtime.cleanup();
    return true;
  })()`
}
