/**
 * Integration smoke test for the BUILT app.
 *
 * Runs `vite build`, loads the emitted dist/index.html into jsdom, executes the
 * built classic script bundle, and drives the core interactions. This proves
 * the Vite output boots with no server: relative URLs, non-module script,
 * bundled CSS, guarded canvas/WebAudio/localStorage, and persisted state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/* Always rebuild so this test can never run against a stale bundle. */
const build = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000
});
if (build.status !== 0) {
  throw new Error('vite build failed:\n' + String(build.stdout || '') + String(build.stderr || ''));
}

const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const scriptSrc = (html.match(/<script[^>]*\bsrc="([^"]+)"/) || [])[1];
assert.ok(scriptSrc, 'dist/index.html must reference a script bundle');
const bundle = fs.readFileSync(path.join(distDir, scriptSrc.replace(/^\.\//, '')), 'utf8');

const STORAGE_KEY = 'toktok_state_v1';

/** Boot the built page in jsdom and return handles plus captured script problems. */
function boot({ seed } = {}) {
  const problems = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => problems.push('jsdomError: ' + (err && err.message)));
  vc.on('error', (...args) => problems.push('console.error: ' + args.join(' ')));

  const dom = new JSDOM(html, {
    url: 'https://toktok.local/', // real origin so localStorage behaves like a hosted page
    runScripts: 'outside-only', // we eval the bundle ourselves (classic script semantics)
    pretendToBeVisual: true, // provide requestAnimationFrame
    virtualConsole: vc
  });
  // jsdom ships no canvas backend and reports every getContext() call as a
  // "Not implemented" jsdomError. Stub it to return null: that is exactly what
  // the app must tolerate (its null-canvas guard), minus the advisory noise.
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  if (seed) dom.window.localStorage.setItem(STORAGE_KEY, seed);
  dom.window.eval(bundle);
  return { dom, problems };
}

function click(win, el, init = {}) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

function press(win, key) {
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('built HTML ships a classic, relative, server-free page', () => {
  assert.doesNotMatch(html, /type="module"/, 'no module scripts (blocked on file://)');
  assert.doesNotMatch(html, /crossorigin/, 'no crossorigin attributes');
  assert.doesNotMatch(html, /https?:\/\//, 'no external URLs');
  assert.match(html, /<script[^>]*\bsrc="\.\/[^"]+"/, 'bundle src is relative');
});

test('built app boots with no script errors, renders the feed, injects CSS', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { document } = dom.window;

  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
  assert.equal(document.querySelectorAll('.video-slide').length, 5, 'five seed videos render');
  assert.match(document.getElementById('ariaAnnouncer').textContent, /TokTok ready\. 5 videos/, 'boot announced');
  const styles = [...document.querySelectorAll('style')];
  assert.ok(
    styles.some((s) => (s.textContent || '').includes('.video-slide')),
    'bundled stylesheet is injected at runtime'
  );
  assert.equal(typeof dom.window.TokTok.renderCanvasScene, 'function', 'runtime namespace is exposed');
});

test('like button toggles state and persists it', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const doc = window.document;

  const likeBtn = doc.querySelector('.video-slide .like-btn');
  assert.ok(likeBtn, 'like button exists');
  assert.equal(likeBtn.getAttribute('aria-pressed'), 'false');

  click(window, likeBtn);
  assert.ok(likeBtn.classList.contains('liked'), 'liked class applied');
  assert.equal(likeBtn.getAttribute('aria-pressed'), 'true');

  const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  assert.equal(saved.videos[0].userState.liked, true, 'like persisted to localStorage');

  click(window, likeBtn);
  assert.ok(!likeBtn.classList.contains('liked'), 'second click unlikes');
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).videos[0].userState.liked, false);
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('double-tap on the canvas likes the active video', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const canvas = window.document.querySelector('.video-slide .video-canvas');
  assert.ok(canvas, 'canvas exists');

  const opts = { bubbles: true, cancelable: true, clientX: 40, clientY: 60 };
  click(window, canvas, opts);
  click(window, canvas, opts); // second tap within the 260ms window => like

  assert.ok(canvas.closest('.video-slide').querySelector('.like-btn').classList.contains('liked'), 'double-tap liked');
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('follow badge toggles following state', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const doc = window.document;

  const followBtn = doc.querySelector('.video-slide .follow-badge-btn');
  assert.equal(followBtn.getAttribute('aria-pressed'), 'false');
  click(window, followBtn);
  assert.ok(followBtn.classList.contains('following'), 'following class applied');
  assert.equal(followBtn.getAttribute('aria-pressed'), 'true');
  assert.match(doc.getElementById('appToast').textContent, /^Following @/, 'toast confirms follow');
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).videos[0].creator.isFollowing, true);
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('comment drawer opens and posts a comment', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const doc = window.document;

  click(window, doc.querySelector('.video-slide .comment-btn'));
  assert.ok(doc.getElementById('commentDrawer').classList.contains('open'), 'drawer opened');
  assert.ok(doc.getElementById('commentBackdrop').classList.contains('open'), 'backdrop opened');

  const list = doc.getElementById('commentList');
  const before = list.querySelectorAll('.comment-item').length;
  assert.ok(before > 0, 'seed comments render');

  const input = doc.getElementById('commentTextInput');
  input.value = 'Integration test comment!';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.getElementById('commentSubmitBtn').disabled, false, 'submit enabled by input');

  doc.getElementById('commentForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const after = list.querySelectorAll('.comment-item').length;
  assert.equal(after, before + 1, 'comment appended');
  assert.ok(list.textContent.includes('Integration test comment!'), 'comment text rendered');

  const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  assert.ok(
    saved.videos[0].comments.some((c) => c.text === 'Integration test comment!'),
    'comment persisted'
  );
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('search filters the feed and the clear button restores it', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const doc = window.document;

  const input = doc.getElementById('searchInput');
  input.value = 'zzz-no-such-video';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(doc.querySelector('.empty-feed'), 'empty state shown');
  assert.equal(doc.querySelectorAll('.video-slide').length, 0);

  click(window, doc.getElementById('searchClearBtn'));
  assert.equal(doc.querySelectorAll('.video-slide').length, 5, 'feed restored');
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('For You / Following tabs switch feeds', (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const { window } = dom;
  const doc = window.document;

  click(window, doc.getElementById('tabFollowing'));
  assert.equal(doc.querySelectorAll('.video-slide').length, 1, 'seed data follows exactly one creator');
  assert.ok(doc.getElementById('tabFollowing').classList.contains('active'));
  assert.equal(doc.getElementById('tabFollowing').getAttribute('aria-selected'), 'true');

  click(window, doc.getElementById('tabForYou'));
  assert.equal(doc.querySelectorAll('.video-slide').length, 5, 'For You feed restored');
  assert.ok(doc.getElementById('tabForYou').classList.contains('active'));
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('keyboard navigation moves through the feed', async (t) => {
  const { dom, problems } = boot();
  t.after(() => dom.window.close());
  const announcer = dom.window.document.getElementById('ariaAnnouncer');
  // goTo() commits the active index through IntersectionObserver, or a 350ms
  // fallback timer when scrolling is a no-op (as in jsdom) — wait it out.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

  press(dom.window, 'ArrowDown');
  await settle();
  assert.match(announcer.textContent, /Video 2 of 5/, 'ArrowDown advances to video 2');

  press(dom.window, 'ArrowDown');
  await settle();
  assert.match(announcer.textContent, /Video 3 of 5/, 'ArrowDown advances again');

  press(dom.window, 'ArrowUp');
  await settle();
  assert.match(announcer.textContent, /Video 2 of 5/, 'ArrowUp goes back');
  assert.equal(problems.length, 0, 'no script errors: ' + problems.join('; '));
});

test('state survives a reload of the built app', (t) => {
  const first = boot();
  t.after(() => first.dom.window.close());
  const firstDoc = first.dom.window.document;
  click(first.dom.window, firstDoc.querySelector('.video-slide .like-btn'));
  const seed = first.dom.window.localStorage.getItem(STORAGE_KEY);
  assert.ok(seed, 'state persisted before reload');

  const second = boot({ seed });
  t.after(() => second.dom.window.close());
  const btn = second.dom.window.document.querySelector('.video-slide .like-btn');
  assert.ok(btn.classList.contains('liked'), 'liked state restored after reload');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(second.problems.length, 0, 'no script errors: ' + second.problems.join('; '));
});
