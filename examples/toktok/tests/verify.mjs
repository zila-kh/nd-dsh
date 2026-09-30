/**
 * Static verification for the TokTok clone.
 *
 * Checks everything that must hold for the app to work with NO server and
 * NO real URLs, now built with Vite 8:
 *   1. required files exist;
 *   2. index.html is a valid Vite entry pointing at main.js, which imports the
 *      four runtime files in dependency order;
 *   3. no http(s):// URLs anywhere in the runtime sources or build config;
 *   4. no network APIs (fetch / XHR / WebSocket / EventSource) in sources;
 *   5. every id app.js touches exists in index.html;
 *   6. key CSS classes emitted by app.js exist in styles.css;
 *   7. package.json scripts/devDependencies match the Vite workflow and the
 *      no-server objective (no `start` script);
 *   8. all runtime scripts parse (syntax check via import);
 *   9. `vite build` succeeds and the emitted dist/ boots without a server:
 *      classic (non-module) script, relative URLs only, no crossorigin, no
 *      external URLs, CSS bundled in.
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

console.log('\n[1/9] Required files');
const required = [
  'index.html',
  'styles.css',
  'main.js',
  'app.js',
  'data.js',
  'canvas-engine.js',
  'audio-synth.js',
  'package.json',
  'vite.config.js',
  'README.md',
  'tests/verify.mjs',
  'tests/data.test.mjs',
  'tests/canvas-engine.test.mjs',
  'tests/audio-synth.test.mjs',
  'tests/app-helpers.test.mjs',
  'tests/integration.test.mjs'
];
for (const file of required) {
  check(exists(file), `${file} exists`);
}

console.log('\n[2/9] index.html Vite entry + main.js import order');
const html = exists('index.html') ? read('index.html') : '';
const scriptSrcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const linkHrefs = [...html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);

check(scriptSrcs.length === 1, 'index.html loads exactly one script (Vite entry)', `found ${scriptSrcs.length}`);
check(/<script[^>]*type="module"/.test(html), 'entry script is type="module" (required by Vite)');
for (const src of scriptSrcs) {
  check(!/^[a-z]+:\/\//i.test(src), `script src is local: ${src}`);
  check(!src.startsWith('/'), `script src is relative (works under any base): ${src}`);
  check(exists(src.replace(/^\.\//, '')), `script file exists: ${src}`);
}
for (const href of linkHrefs) {
  check(!/^[a-z]+\/\//i.test(href), `link href is local: ${href}`);
  check(exists(href.replace(/^\.\//, '')), `linked file exists: ${href}`);
}

const mainSrc = exists('main.js') ? read('main.js') : '';
const imported = [...mainSrc.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const expectedOrder = ['data.js', 'canvas-engine.js', 'audio-synth.js', 'app.js'];
check(
  expectedOrder.every((file, i) => imported[i] === './' + file || imported[i] === file),
  'main.js imports the four runtime files in dependency order',
  imported.join(' → ') || 'no imports found'
);
check(imported.length === 4, 'main.js imports exactly the four runtime files', `found ${imported.length}`);
for (const spec of imported) {
  check(!/^[a-z]+:\/\//i.test(spec), `import is local: ${spec}`);
  check(exists(spec.replace(/^\.\//, '')), `imported file exists: ${spec}`);
}

console.log('\n[3/9] No external URLs in runtime sources');
const runtimeSources = ['index.html', 'styles.css', 'main.js', 'app.js', 'data.js', 'canvas-engine.js', 'audio-synth.js', 'vite.config.js'];
const urlPattern = /https?:\/\/[^\s"'`)]+/gi;
for (const file of runtimeSources) {
  if (!exists(file)) continue;
  const matches = read(file).match(urlPattern) || [];
  check(matches.length === 0, `${file} has no http(s) URLs`, matches.slice(0, 3).join(', '));
}

console.log('\n[4/9] No network APIs in runtime sources');
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

console.log('\n[5/9] DOM ids referenced by app.js exist in index.html');
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

console.log('\n[6/9] CSS classes emitted by app.js exist in styles.css');
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

console.log('\n[7/9] package.json scripts + Vite 8 devDependency');
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
    check(
      pkg.scripts && typeof pkg.scripts.dev === 'string' && /\bvite\b/.test(pkg.scripts.dev) && !/\bbuild\b/.test(pkg.scripts.dev),
      'dev script runs vite (development only)'
    );
    check(
      pkg.scripts && typeof pkg.scripts.build === 'string' && /\bvite\s+build\b/.test(pkg.scripts.build),
      'build script runs vite build'
    );
    check(!pkg.scripts || !pkg.scripts.start, 'no server start script (shipped app must need no server)');
    const viteRange = (pkg.devDependencies || {}).vite;
    const viteMajor = typeof viteRange === 'string' ? viteRange.match(/^\s*[~^]?(\d+)/) : null;
    check(!!viteRange, 'vite devDependency declared', 'add it with: npm install -D vite');
    check(viteMajor && viteMajor[1] === '8', 'vite is version 8.x', viteRange ? `found ${viteRange}` : 'missing');
    check(exists('vite.config.js'), 'vite.config.js exists');
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

console.log('\n[8/9] Runtime scripts parse as modules');
for (const file of ['data.js', 'canvas-engine.js', 'audio-synth.js', 'app.js', 'main.js']) {
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

console.log('\n[9/9] vite build succeeds and dist/ is server-free');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
let buildOk = false;
if (!exists('node_modules/vite/bin/vite.js')) {
  check(false, 'vite is installed', 'run npm install first');
} else {
  const res = spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000
  });
  buildOk = res.status === 0;
  check(buildOk, 'vite build exits 0', ((res.stdout || '') + (res.stderr || '')).trim().split('\n').slice(-5).join(' | '));
}

if (buildOk) {
  check(exists('dist/index.html'), 'dist/index.html exists');
  const distHtml = exists('dist/index.html') ? read('dist/index.html') : '';
  const distScripts = [...distHtml.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

  check(!/type="module"/.test(distHtml), 'dist script is classic (type="module" is blocked on file://)');
  check(/<script[^>]*\bdefer\b/.test(distHtml), 'dist script is deferred (preserves module load timing)');
  check(!/crossorigin/.test(distHtml), 'dist has no crossorigin attributes (would fail on file://)');
  check(!/modulepreload/.test(distHtml), 'dist has no modulepreload links');
  check((distHtml.match(urlPattern) || []).length === 0, 'dist/index.html has no http(s) URLs');
  check(distScripts.length >= 1, 'dist/index.html references its bundle', `found ${distScripts.length}`);

  for (const src of distScripts) {
    check(!/^[a-z]+:\/\//i.test(src), `dist script src is local: ${src}`);
    check(!src.startsWith('/'), `dist script src is relative: ${src}`);
    const rel = src.replace(/^\.\//, '');
    check(exists(path.join('dist', rel)), `dist script file exists: ${src}`);
    if (exists(path.join('dist', rel))) {
      const bundle = read(path.join('dist', rel));
      check((bundle.match(urlPattern) || []).length === 0, `bundle ${src} has no http(s) URLs`);
      check(bundle.includes('scroll-snap-type'), `bundle ${src} includes the app stylesheet (CSS is bundled)`);
      check(!/\bimport\s*['"]/.test(bundle.split('//# sourceMappingURL')[0]), `bundle ${src} has no runtime module imports (classic script)`);
    }
  }
} else {
  console.log('  (skipping dist checks because the build failed)');
}

console.log(`\nResult: ${passed} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('All verification checks passed. Built app is self-contained: no server, no external URLs, runs from file://.');
}
