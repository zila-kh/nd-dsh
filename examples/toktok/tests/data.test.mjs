/**
 * Unit tests for data.js (store, formatting, persistence guards).
 * data.js is a classic script that publishes its API on globalThis.TokTok.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../data.js';
import '../canvas-engine.js';
import '../audio-synth.js';

const T = globalThis.TokTok;

test('namespace exposes the expected public API', () => {
  assert.equal(typeof T.formatCount, 'function');
  assert.equal(typeof T.getRelativeTime, 'function');
  assert.equal(typeof T.loadSavedState, 'function');
  assert.equal(typeof T.saveAppState, 'function');
  assert.equal(typeof T.renderCanvasScene, 'function');
  assert.ok(Array.isArray(T.INITIAL_VIDEOS));
  assert.ok(T.audioSynth);
});

test('formatCount produces compact counters', () => {
  assert.equal(T.formatCount(0), '0');
  assert.equal(T.formatCount(999), '999');
  assert.equal(T.formatCount(1000), '1K');
  assert.equal(T.formatCount(124800), '124.8K');
  assert.equal(T.formatCount(1000000), '1M');
  assert.equal(T.formatCount(1500000), '1.5M');
});

test('formatCount handles invalid input safely', () => {
  assert.equal(T.formatCount(NaN), '0');
  assert.equal(T.formatCount('nope'), '0');
  assert.equal(T.formatCount(undefined), '0');
});

test('getRelativeTime formats past timestamps', () => {
  const now = Date.now();
  assert.equal(T.getRelativeTime(null), 'just now');
  assert.equal(T.getRelativeTime(now - 30 * 1000), 'just now');
  assert.equal(T.getRelativeTime(now - 5 * 60 * 1000), '5m ago');
  assert.equal(T.getRelativeTime(now - 2 * 60 * 60 * 1000), '2h ago');
  assert.equal(T.getRelativeTime(now - 3 * 24 * 60 * 60 * 1000), '3d ago');
});

test('INITIAL_VIDEOS has five well-formed entries', () => {
  assert.equal(T.INITIAL_VIDEOS.length, 5);
  const ids = new Set(T.INITIAL_VIDEOS.map((v) => v.id));
  assert.equal(ids.size, 5, 'video ids must be unique');

  for (const video of T.INITIAL_VIDEOS) {
    assert.ok(T.VISUAL_TYPES.includes(video.visualType), `${video.id} visualType`);
    assert.match(video.creator.handle, /^@/);
    assert.ok(video.caption.length > 0);
    assert.ok(video.hashtags.length > 0);
    assert.ok(video.duration > 0);
    for (const key of ['likes', 'comments', 'bookmarks', 'shares']) {
      assert.equal(typeof video.stats[key], 'number');
      assert.ok(video.stats[key] >= 0);
    }
    for (const key of ['liked', 'bookmarked', 'shared']) {
      assert.equal(typeof video.userState[key], 'boolean');
    }
    assert.ok(Array.isArray(video.comments));
    for (const comment of video.comments) {
      assert.match(comment.username, /^@/);
      assert.ok(comment.text.length > 0);
      assert.equal(typeof comment.likes, 'number');
    }
  }
});

test('persistence helpers are safe outside a browser', () => {
  // Node has no window/localStorage: load must return null, save must not throw.
  assert.equal(T.loadSavedState(), null);
  assert.doesNotThrow(() => T.saveAppState({ version: 1, videos: [] }));
});
