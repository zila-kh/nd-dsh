# WIP 0033 — Extract ND Runtime Services

> Plan: [Reference-Inspired Runtime and Company Evolution](../../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **done — local validation recorded 2026-09-24; clippy/tests, composition boundary and runtime benchmarks green**  
> Depends on: WIP 0031 and WIP 0032  
> Owner: unassigned

## Objective

Move system-heavy implementations behind a focused `nd-runtime` crate while keeping `nd-core` as the shipped thin composition binary.

## Implemented

`crates/nd-runtime` now owns:

- scheduler;
- process lifecycle;
- terminal;
- workspace;
- Git/search/revision;
- deadlines/cancellation;
- response cache and runtime metrics;
- session journal;
- workspace snapshot;
- platform process-tree support;
- canonical effect journal;
- typed decision kernel.

`crates/nd-core/src` now contains only `main.rs`: startup, service composition, protocol dispatch, and shutdown.

The old implementation copies were removed from `nd-core`; this is a real extraction rather than duplicated modules.

## Rules preserved

- `nd-protocol` does not depend on runtime implementations;
- `nd-runtime` imports no Electron/product UI concepts;
- Company/Project/Task business truth remains TypeScript-owned;
- packaging still builds one normal `nd-core` binary;
- no transport change was introduced by the crate split.

## Acceptance status

Implementation is merged to `main`. Local clippy/tests plus cold-start/runtime
benchmark comparison recorded 2026-09-24 on the Windows reference machine,
commit `d3de5be`:

- `pnpm core:test` — PASS for `nd-protocol`, `nd-runtime`, and `nd-core`
  (fmt + clippy `-D warnings` + tests).
- Composition boundary confirmed: `crates/nd-core/src` contains only `main.rs`.
- `pnpm bench:runtime` — PASS (bundle `benchmark-results/2026-09-24T09-21-42-507Z-win32-x64/`).
  Every budget class shared with the committed baseline holds on this host:
  Electron event-loop p95 excess ≤ 0.72 ms against the 16 ms-above-floor budget,
  terminal event delivery p95 3 ms against ≤ 16 ms, cancel→tree-exit p95 370 ms
  against the 3 000 ms hard-cleanup bound. Condition caveat: the committed baseline
  `benchmarks/baselines/win11-x64.json` was recorded on a different reference machine
  (i7-10700), so this is a budget-class comparison, not a cross-machine speed claim.
- `pnpm bench:tasks:check` — PASS; 136 expectations checked with zero deviations
  against `benchmarks/baselines/agent-task-normal-loop.json`.
- Packaged cold start: the portable artifact's smoke reports bundled core protocol v1
  with a 1 270 ms usable mark and a 196 ms runtime handshake.

## Handoff

See [Reference Architecture Local Validation Handoff](../../plan/reference-architecture-local-validation-handoff.md).
