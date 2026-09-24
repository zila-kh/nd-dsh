# WIP 0031 — Extract ND Protocol Contract

> Plan: [Reference-Inspired Runtime and Company Evolution](../../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **done — local validation recorded 2026-09-24; all gates green**  
> Owner: unassigned

## Objective

Extract the Rust-owned ND core wire contract from `nd-core` into a dedicated `nd-protocol` crate and make TypeScript/Rust contract drift machine-detectable.

## Implemented

- added `crates/nd-protocol`;
- moved MessagePack request/response/event framing and protocol limits into the crate;
- moved the typed protocol error vocabulary into the crate;
- kept protocol version and frame limit unchanged;
- made `nd-core` and `nd-runtime` depend on `nd-protocol`;
- added Rust-side parity tests against `src/main/core/core-protocol.ts` for version, frame size, required frame fields, and error codes;
- retained the existing protocol queue/decode tests instead of weakening them;
- updated `pnpm core:test` so `nd-protocol`, `nd-runtime`, and `nd-core` are all clippy/test gates.

## Acceptance status

Implementation is complete. Local evidence recorded 2026-09-24 on the Windows
reference machine, commit `d3de5be` (Windows 10.0.26100, rustc 1.98.1, node v24.16.0,
pnpm 11.7.0):

- `cargo metadata --locked --no-deps` — PASS; `Cargo.lock` unchanged.
- `cargo fmt --all --check` — PASS.
- `pnpm core:test` — PASS across all three crates (`nd-protocol`, `nd-runtime`,
  `nd-core`; fmt + clippy `-D warnings` + tests).
- `pnpm bench:contract` — PASS; bundle `benchmark-results/2026-09-24T09-20-59-580Z-win32-x64/`
  with all nine contract documents including `contract-revision-marker`,
  `contract-git-status-cache`, `contract-git-log-cache`, `contract-search`,
  `contract-stop-latency`, and `contract-deadline-expiry`.
- Electron client handshake with no protocol semantic change: `pnpm dist:win:portable`
  staged core protocol v1 and the packaged runtime smoke completed its terminal and
  Git round trips against the packaged `nd-core` (196 ms); `pnpm bench:runtime` and the
  live e2e organization loops both completed their normal core handshakes the same day.

No organization/business-domain migration is included.

## Handoff

See [Reference Architecture Local Validation Handoff](../../plan/reference-architecture-local-validation-handoff.md).
