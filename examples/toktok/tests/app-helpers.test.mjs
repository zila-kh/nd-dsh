/**
 * Unit tests for pure helpers exported by app.js (escapeHtml, buildCaptionHtml).
 * app.js bails out of DOM initialization when `document` is undefined, so it is
 * safe to import in Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../data.js';
import '../app.js';

const T = globalThis.TokTok;

test('escapeHtml neutralizes markup characters', () => {
  assert.equal(T.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(T.escapeHtml("it's & <b>bold</b>"), 'it&#39;s &amp; &lt;b&gt;bold&lt;/b&gt;');
  assert.equal(T.escapeHtml(null), '');
  assert.equal(T.escapeHtml(undefined), '');
  assert.equal(T.escapeHtml(42), '42');
});

test('buildCaptionHtml linkifies hashtags after escaping', () => {
  const html = T.buildCaptionHtml('Neon vibes #cyberpunk #fyp <script>');
  assert.match(html, /data-tag="cyberpunk"/);
  assert.match(html, /data-tag="fyp"/);
  assert.match(html, /#cyberpunk<\/span>/);
  assert.ok(!html.includes('<script>'), 'raw script tags must be escaped');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('buildCaptionHtml leaves plain text untouched', () => {
  assert.equal(T.buildCaptionHtml('no tags here'), 'no tags here');
});

test('buildCaptionHtml handles unicode hashtags', () => {
  const html = T.buildCaptionHtml('#café #стрім');
  assert.match(html, /data-tag="café"/);
  assert.match(html, /data-tag="стрім"/);
});

test('data set hashtag arrays match their captions', () => {
  for (const video of T.INITIAL_VIDEOS) {
    for (const tag of video.hashtags) {
      assert.ok(video.caption.includes('#' + tag), `${video.id}: caption should contain #${tag}`);
    }
  }
});
