# TODO 0028 — Unified browser policy, permissions, trusted leases and audit

> Priority: P0
> Owner: ND control plane/security
> Status: todo
> Depends on: 0021, 0023

## Objective

Make browser actions obey the same trusted company/project/task policy boundary
for both built-in and Chrome targets.

## Scope

- trusted tab lease creation by ND control plane;
- company/project/task/run/session binding;
- cross-task/cross-company rejection;
- normalized browser action envelope;
- ALLOW/ASK/DENY integration;
- high-impact mappings for publish/deploy/spend/destructive/upload/download/history/credential use;
- durable browser receipts without secrets.

## Acceptance

An agent cannot claim another task/company tab by supplying ids, and a governed
high-impact browser action reaches the main-process approval gate before execution.
