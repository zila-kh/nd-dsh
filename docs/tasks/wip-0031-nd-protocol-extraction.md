# WIP 0031 — Extract ND Protocol Contract

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **implementation complete; local validation pending**  
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

Implementation is complete. Local evidence still required:

- `cargo metadata --locked --no-deps`;
- `pnpm core:test`;
- `pnpm bench:contract`;
- confirm the existing Electron client completes its normal core handshake with no protocol semantic change.

No organization/business-domain migration is included.

## Handoff

See [Reference Architecture Local Validation Handoff](../plan/reference-architecture-local-validation-handoff.md).
