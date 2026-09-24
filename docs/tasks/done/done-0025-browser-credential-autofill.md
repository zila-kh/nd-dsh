# TODO 0025 — Browser credential vault and autofill mediation

> Priority: P1
> Owner: ND security/browser
> Status: merged to main via PR #41 — implementation complete; OS secure-storage/autofill validation pending
> Depends on: 0020, 0022

## Objective

Provide password-save/autofill behavior for the built-in browser without exposing
stored secrets to models, page snapshots, logs, or ordinary renderer state.

## Scope

- reviewed secure credential store;
- save/update/delete credentials;
- user-visible credential controls;
- autofill mediation;
- policy/approval hook for sensitive use;
- redaction guarantees in snapshots, audit and diagnostics;
- secure-store-unavailable failure behavior.

## Acceptance

A saved test credential can fill a login form while the raw password is absent
from model-visible output, logs, IPC snapshots and run receipts.

## Implementation evidence

- `src/main/browser/browser-credential-vault.ts` stores passwords encrypted with
  Electron `safeStorage`; renderer state exposes summaries only.
- origin binding prevents filling a credential on a different origin.
- `browser.autofill` is policy-classified as `credential.use`.
- built-in autofill happens inside the browser target without returning the raw
  password through model-visible results.
- Settings exposes save/remove controls using trusted IPC.

Local validation must confirm the target OS secure-storage backend and test that
no password appears in snapshots, logs, receipts or returned tool payloads.
