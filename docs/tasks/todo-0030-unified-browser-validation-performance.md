# TODO 0030 — Unified browser validation and performance evidence

> Priority: P1
> Owner: ND QA/runtime
> Status: implementation complete — local correctness/performance evidence handoff pending
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
