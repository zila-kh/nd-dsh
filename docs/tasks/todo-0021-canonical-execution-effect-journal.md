# TODO 0021 — Canonical Execution and Effect Journal

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: todo  
> Owner: unassigned

## Objective

Add a durable ND-owned journal for autonomous company execution/effect intent, outcome, uncertainty, and recovery.

## Scope

Record stable identities and lifecycle events for:

- task lease acquire/release;
- workspace allocation/reconciliation;
- engine session request/bind/resume;
- external effect intent/result/uncertain outcome;
- checkpoint;
- verification receipt;
- review result;
- integration intent/result;
- policy/approval decision.

## Invariants

- externally visible/irreversible effect intent is committed before execution when practical;
- restart distinguishes not-started, known-complete, known-failed, and outcome-uncertain;
- uncertain effects are reconciled rather than blindly retried;
- records carry company/project/task/run identity where applicable;
- retention of prompt/tool payloads remains bounded and policy-aware;
- worktree/checkpoint provenance remains authoritative for writable task output.

## Acceptance

- deterministic crash/restart fixtures prove no duplicate known-complete effect;
- uncertain outcomes remain explicit and recoverable;
- journal growth/replay cost is measured;
- task completion still requires machine verification/review/integration rules.
