# TODO 0028 — Unified browser policy, permissions, trusted leases and audit

> Priority: P0
> Owner: ND control plane/security
> Status: merged to main via PR #41 — implementation complete; organization-policy smoke pending
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

## Implementation evidence

- `src/main/browser-platform/browser-tab-leases.ts` enforces one writable owner
  per target/tab and trusted scope binding.
- `src/main/browser-platform/browser-access-tokens.ts` prevents agent callers
  from self-asserting organization scope.
- `src/main/browser-platform/browser-policy-service.ts` normalizes reads,
  navigation, interactions, history, credentials, downloads/uploads, publishing,
  deployment, spending and destructive actions.
- approvals and durable browser receipts are tracked by the platform service.
- agent-triggered download side effects are separately gated by
  `file.download`.
- tests cover access tokens, lease isolation and policy classification.

Local validation still needs a full organization ALLOW/ASK/DENY smoke with real
task/run/session identity.
