/**
 * Static verification for the TokTok clone.
 *
 * Checks everything that must hold for the app to work with NO server and
 * NO real URLs:
 *   1. required files exist;
 *   2. index.html references existing local assets only (classic scripts);
 *   3. no http(s):// URLs anywhere in the runtime sources;
 *   4. no network APIs (fetch / XHR / WebSocket / EventSource) in sources;
 *   5. every id app.js touches exists in index.html;
 *   6. key CSS classes emitted by app.js exist in styles.css;
 *   7. package.json scripts point at files that exist;
 *   8. all runtime scripts parse (syntax check via import).
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let passed = 0;

function check(ok, label, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

console.log('\n[1/8] Required files');
const required = [
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'canvas-engine.js',
  'audio-synth.js',
  'package.json',
  'README.md',
  'tests/verify.mjs',
  'tests/data.test.mjs',
  'tests/canvas-engine.test.mjs',
  'tests/audio-synth.test.mjs',
  'tests/app-helpers.test.mjs'
];
for (const file of required) {
  check(exists(file), `${file} exists`);
}

console.log('\n[2/8] index.html asset references');
const html = exists('index.html') ? read('index.html') : '';
const scriptSrcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const linkHrefs = [...html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);

check(scriptSrcs.length >= 4, 'index.html loads the four app scripts', `found ${scriptSrcs.length}`);
check(!html.includes('type="module"'), 'scripts are classic (ES modules are blocked on file://)');
for (const src of scriptSrcs) {
  check(!/^[a-z]+:\/\//i.test(src), `script src is local: ${src}`);
  check(exists(src), `script file exists: ${src}`);
}
for (const href of linkHrefs) {
  check(!/^[a-z]+\/\//i.test(href), `link href is local: ${href}`);
  check(exists(href), `linked file exists: ${href}`);
}
const expectedOrder = ['data.js', 'canvas-engine.js', 'audio-synth.js', 'app.js'];
const orderOk = expectedOrder.every((file, i) => scriptSrcs[i] === file);
check(orderOk, 'scripts load in dependency order', scriptSrcs.join(' → '));
check(html.includes('app.js'), 'app.js is referenced');

console.log('\n[3/8] No external URLs in runtime sources');
const runtimeSources = ['index.html', 'styles.css', 'app.js', 'data.js', 'canvas-engine.js', 'audio-synth.js'];
const urlPattern = /https?:\/\/[^\s"'`)]+/gi;
for (const file of runtimeSources) {
  if (!exists(file)) continue;
  const matches = read(file).match(urlPattern) || [];
  check(matches.length === 0, `${file} has no http(s) URLs`, matches.slice(0, 3).join(', '));
}

console.log('\n[4/8] No network APIs in runtime sources');
const forbidden = [
  { re: /\bfetch\s*\(/, name: 'fetch()' },
  { re: /XMLHttpRequest/, name: 'XMLHttpRequest' },
  { re: /new\s+WebSocket/, name: 'WebSocket' },
  { re: /EventSource/, name: 'EventSource' },
  { re: /\bimportScripts\b/, name: 'importScripts()' }
];
for (const file of runtimeSources) {
  if (!exists(file)) continue;
  const src = read(file);
  for (const { re, name } of forbidden) {
    check(!re.test(src), `${file} does not use ${name}`);
  }
}

console.log('\n[5/8] DOM ids referenced by app.js exist in index.html');
if (exists('app.js') && exists('index.html')) {
  const appSrc = read('app.js');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = new Set();
  // el('id') helper calls and el("id")
  for (const m of appSrc.matchAll(/\bel\(\s*['"]([^'"]+)['"]\s*\)/g)) usedIds.add(m[1]);
  // object literal: key: el('id') already covered; also getElementById('id')
  for (const m of appSrc.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) usedIds.add(m[1]);
  check(usedIds.size >= 15, 'collected DOM id references', `found ${usedIds.size}`);
  for (const id of [...usedIds].sort()) {
    check(htmlIds.has(id), `#${id} exists in index.html`);
  }
}

console.log('\n[6/8] CSS classes emitted by app.js exist in styles.css');
if (exists('app.js') && exists('styles.css')) {
  const css = read('styles.css');
  const criticalClasses = [
    'video-slide',
    'video-canvas',
    'action-sidebar',
    'like-btn',
    'liked',
    'bookmark-btn',
    'saved',
    'follow-badge-btn',
    'following',
    'comment-drawer',
    'open',
    'modal-backdrop',
    'search-overlay',
    'empty-feed',
    'burst-heart',
    'play-badge',
    'show',
    'music-disc',
    'paused',
    'video-caption',
    'expanded',
    'hashtag',
    'app-toast',
    'show'
  ];
  for (const cls of new Set(criticalClasses)) {
    check(css.includes('.' + cls), `styles.css defines .${cls}`);
  }
}

console.log('\n[7/8] package.json scripts');
if (exists('package.json')) {
  let pkg = null;
  try {
    pkg = JSON.parse(read('package.json'));
    check(true, 'package.json is valid JSON');
  } catch (err) {
    check(false, 'package.json is valid JSON', err.message);
  }
  if (pkg) {
    check(pkg.scripts && pkg.scripts.test, 'test script defined');
    check(pkg.scripts && pkg.scripts.verify, 'verify script defined');
    check(!pkg.scripts || !pkg.scripts.start, 'no server start script (objective: without server)');
    if (pkg.scripts && pkg.scripts.test) {
      const m = pkg.scripts.test.match(/(tests\/\S+)/);
      if (m) {
        const testPattern = m[1];
        if (testPattern.includes('*')) {
          const dir = testPattern.split('*')[0].replace(/[\/\\]$/, '') || '.';
          const prefix = testPattern.split('*')[1].replace(/^\./, '');
          const found = exists(dir)
            ? fs
                .readdirSync(path.join(root, dir))
                .filter((f) => f.endsWith('.' + prefix))
            : [];
          check(found.length > 0, `test glob matches files (${testPattern})`, `found ${found.length}`);
        } else {
          check(exists(testPattern), `test file exists: ${testPattern}`);
        }
      }
    }
    if (pkg.scripts && pkg.scripts.verify) {
      const m = pkg.scripts.verify.match(/(?:node\s+)?(\S+\.mjs)/);
      if (m) check(exists(m[1]) || exists('tests/' + path.basename(m[1])), `verify entry exists: ${m[1]}`);
    }
  }
}

console.log('\n[8/8] Runtime scripts parse as modules');
for (const file of ['data.js', 'canvas-engine.js', 'audio-synth.js', 'app.js']) {
  if (!exists(file)) {
    check(false, `${file} parses`);
    continue;
  }
  try {
    await import(pathToFileURL(path.join(root, file)).href);
    check(true, `${file} parses and evaluates in a DOM-less runtime`);
  } catch (err) {
    check(false, `${file} parses and evaluates in a DOM-less runtime`, err.message);
  }
}

console.log(`\nResult: ${passed} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('All static verification checks passed. The app is self-contained: no server, no external URLs.');
}
