# TODO 0030 — Unified browser validation and performance evidence

> Priority: P1
> Owner: ND QA/runtime
> Status: merged to main via PR #41 — local correctness/performance evidence recorded 2026-09-24; real-Chrome companion smoke and companion RTT/memory remain manual
> Depends on: 0022-0029

## Objective

Produce the correctness, privacy, restart and performance evidence required before
the unified browser platform is called merge/release ready.

## Correctness matrix

Validate both built-in and companion targets for:

- tabs and explicit target selection;
- snapshot/click/fill/press/scroll/navigation/screenshot;
- stale-reference handling;
- downloads;
- credentials/autofill privacy;
- built-in extension install/load/enable/disable/uninstall;
- extension persistence across restart;
- extension content-script targeting of the exact visible ND tab;
- approved background/runtime messaging behavior;
- unsupported extension/API failure reporting;
- WebMCP/site tools;
- tab lease isolation;
- organization approval;
- restart/reconnect;
- browser/profile data clearing.

## Performance

Record 1/2/4/8-tab evidence including:

- target/tab creation;
- snapshot/click/navigation/screenshot p50/p95;
- WebMCP discovery/call;
- Electron main RSS/heap;
- browser process RSS;
- companion native-host RSS;
- extension install/load latency and startup overhead;
- extension-on versus extension-off browser action latency where meaningful;
- restart/reconnect time.

## Acceptance

Evidence is reproducible, secrets never appear in collected artifacts, the
required built-in extension baseline is demonstrated, and no README/product
performance or compatibility claim exceeds what the evidence proves.


## Implemented validation surface

- `benchmarks/unified-browser-platform.mjs`
- `src/main/perf/browser-platform-benchmark.ts`
- focused tests:
  - `tests/browser-access-tokens.test.ts`
  - `tests/browser-history-store.test.ts`
  - `tests/browser-policy-classification.test.ts`
  - `tests/unified-browser-leases.test.ts`
- benchmark correctness checks include stale semantic refs and password redaction.
- the benchmark records 1/2/4/8-tab process/memory observations plus snapshot,
  click, navigation, screenshot and site-tool latency summaries.
- companion measurements remain correctly classified as manual evidence because
  they require the installed Chrome extension/native host.

Implementation is complete. This task becomes fully done only when the local
handoff records correctness gates, real Chrome/extension smoke and reproducible
performance artifacts.

## Local evidence recorded (2026-09-24)

Windows reference machine, commit `d3de5be` (fix `c1c3e78`), node v24.16.0, pnpm 11.7.0.

- `corepack pnpm browser:platform:test` — typecheck plus 4 focused suites
  (`unified-browser-leases`, `browser-policy-classification`, `browser-history-store`,
  `browser-access-tokens`), 17 tests passed.
- `corepack pnpm bench:browser-platform` — pass; bundle
  `benchmark-results/2026-09-24T10-01-18-231Z-unified-browser/unified-browser-platform.json`.
  Built-in latencies: snapshot p50 1.49 ms, click p50 1.14 ms, navigate p50 19.97 ms,
  screenshot p50 0.03 ms, site-tool discovery p50 1.54 ms / call p50 0.56 ms.
  1/2/4/8-tab points record tab-create time plus Electron-main RSS, process count,
  working-set and private bytes per scale point.
- Correctness block: `passwordRedacted: true`, `staleRefRejected: true`
  (`outcome: rejected`, `STALE_BROWSER_REFERENCE: Page changed after the snapshot`).
- Companion leg is correctly classified `manual-evidence-required`: RTT and memory
  need the real installed extension/native host and are recorded during the manual
  Chrome smoke tracked in [wip-0019](wip-0019-browser-companion-mvp.md).

**Defect found by the first evidence run and fixed in `c1c3e78`:** a stale-reference
rejection thrown inside the page reached the main process only as Electron's generic
"Script failed to execute" message, so the benchmark's rejection matcher saw
`staleRefRejected: false` and nothing else could distinguish a real rejection from a
crash. `BrowserController.semanticAction` now returns the driver outcome as a value
and re-throws it with its code and message preserved; the benchmark records why the
check passed, failed, or was skipped and fails the run on any correctness violation
instead of writing a document with `status: pass`.
