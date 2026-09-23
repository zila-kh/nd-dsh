# TODO 0022 — Extract ND Runtime Services

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: todo  
> Depends on: TODO 0020; coordinate with TODO 0021  
> Owner: unassigned

## Objective

Move system-heavy implementations behind a focused `nd-runtime` crate while keeping `nd-core` as the shipped thin composition binary.

## Scope

Candidate runtime services:

- scheduler;
- process lifecycle;
- terminal;
- workspace;
- Git/search/revision;
- deadlines/cancellation;
- cache/metrics.

## Rules

- protocol types do not depend on runtime implementations;
- runtime code does not import Electron/product UI concepts;
- organization/business truth remains TypeScript-owned;
- no behavior change is accepted merely to complete the move;
- do not create additional feature crates unless an independent contract/security/durability boundary justifies them.

## Acceptance

- `nd-core` composes services and owns startup/shutdown/dispatch only;
- current correctness tests remain green locally;
- cold start, memory, terminal/workspace/Git benchmarks show no unjustified regression;
- packaging remains one normal ND Core binary.
