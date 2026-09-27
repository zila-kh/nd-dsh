/**
 * Unit tests for canvas-engine.js using a mock 2D context.
 * Verifies every visual renderer draws without throwing and that the
 * dispatcher falls back to a default scene for unknown types.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../canvas-engine.js';

const T = globalThis.TokTok;

/** Minimal recording mock of CanvasRenderingContext2D. */
function makeMockCtx(log = []) {
  const gradient = { addColorStop: (offset, color) => log.push(['stop', offset, color]) };
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        log.push([String(prop), ...args]);
        if (String(prop).startsWith('create')) return gradient;
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push(['set:' + String(prop)]);
      return true;
    }
  };
  return new Proxy({ canvas: { width: 320, height: 568 } }, handler);
}

test('VISUAL_TYPES exposes the five renderers used by the data set', () => {
  assert.deepEqual([...T.VISUAL_TYPES].sort(), [
    'cyber-neon',
    'fluid-wave',
    'lofi-coffee',
    'matrix-code',
    'sunset-drive'
  ]);
});

for (const visualType of ['cyber-neon', 'lofi-coffee', 'fluid-wave', 'matrix-code', 'sunset-drive']) {
  test(`renderCanvasScene draws '${visualType}' without throwing`, () => {
    const log = [];
    const ctx = makeMockCtx(log);
    assert.doesNotThrow(() => T.renderCanvasScene(visualType, ctx, 320, 568, 1.5, 0.7));
    assert.ok(log.length > 10, 'renderer should issue many draw calls');
    const hasBackground = log.some((entry) => entry[0] === 'fillRect');
    assert.ok(hasBackground, 'renderer should paint a background');
  });
}

test('renderCanvasScene falls back to cyber-neon for unknown types', () => {
  const withCyber = [];
  const withUnknown = [];
  T.renderCanvasScene('cyber-neon', makeMockCtx(withCyber), 320, 568, 0.5, 0.5);
  T.renderCanvasScene('does-not-exist', makeMockCtx(withUnknown), 320, 568, 0.5, 0.5);
  assert.equal(withUnknown.length, withCyber.length, 'fallback should match default renderer');
});

test('renderCanvasScene survives extreme dimensions and times', () => {
  const ctx = makeMockCtx();
  assert.doesNotThrow(() => T.renderCanvasScene('matrix-code', ctx, 1, 1, 0));
  assert.doesNotThrow(() => T.renderCanvasScene('sunset-drive', ctx, 1920, 1080, 3600));
});

test('renderCanvasScene tolerates a missing audio energy argument', () => {
  const ctx = makeMockCtx();
  assert.doesNotThrow(() => T.renderCanvasScene('cyber-neon', ctx, 320, 568, 1));
});
