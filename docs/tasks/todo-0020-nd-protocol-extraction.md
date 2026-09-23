# TODO 0020 — Extract ND Protocol Contract

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: todo  
> Owner: unassigned

## Objective

Extract the Rust-owned ND core wire contract from `nd-core` into a dedicated `nd-protocol` crate and make TypeScript/Rust contract drift machine-detectable.

## Scope

- request/response/event envelopes;
- protocol versioning and frame limits;
- error vocabulary;
- stable resource/sequence identity;
- generated or machine-checked TypeScript/schema bindings;
- compatibility tests for version/field/enum/limit drift;
- preserve existing MessagePack framing, queue bounds, deadlines and cancellation unless evidence supports a change.

## Acceptance

- Electron client behavior is unchanged.
- Contract drift fails local validation.
- Existing protocol correctness tests move or are extended rather than weakened.
- Existing benchmark suite shows no material protocol regression.
- No organization/business-domain migration is included.
