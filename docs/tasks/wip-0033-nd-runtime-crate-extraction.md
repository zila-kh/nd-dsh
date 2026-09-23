# TODO 0033 — Extract ND Runtime Services

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **implementation complete; local validation pending**  
> Depends on: TODO 0031 and TODO 0032  
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

Implementation is complete. Local clippy/tests plus cold-start/runtime benchmark comparison remain required before merge to `main`.

## Handoff

See [Reference Architecture Local Validation Handoff](../plan/reference-architecture-local-validation-handoff.md).
