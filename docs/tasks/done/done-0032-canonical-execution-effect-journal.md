# WIP 0032 — Canonical Execution and Effect Journal

> Plan: [Reference-Inspired Runtime and Company Evolution](../../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **done — local validation recorded 2026-09-24; app smoke, restart replay and contract benchmark green**  
> Owner: unassigned

## Objective

Add a durable ND-owned journal for autonomous company execution/effect intent, outcome, uncertainty, and recovery.

## Implemented

- added `nd-runtime::effect_journal`;
- append is JSONL + flush + `sync_data` before acknowledgement;
- stable sequence/record/idempotency identities;
- explicit `intent | complete | failed | uncertain` states;
- recovery query returns `notStarted | inProgress | knownComplete | knownFailed | outcomeUncertain`;
- known-complete effects are deduplicated after restart;
- repeated in-progress intents are deduplicated;
- uncertain outcomes reject a fresh intent until explicitly reconciled to complete/failed;
- an unmatched persisted `intent` loaded after process restart is promoted to `outcomeUncertain`, so a dead process is never mistaken for still-running work;
- per-record and data payload bounds plus a fail-closed 64 MiB canonical-journal retention bound;
- replay/stats RPCs and metrics exposure;
- crash/restart fixtures for known-complete dedupe and uncertain recovery;
- runtime lease acquire/release intent/outcome journaling when the desktop has configured the journal;
- desktop startup configures `effect-journal.jsonl` under Electron user data;
- organization lifecycle writes durable receipts for workspace allocation, engine session, checkpoint, machine verification, review, integration, sanitized decision support, and policy decisions;
- automatic ALLOW falls back to the human gate if its policy receipt cannot be persisted; DENY never becomes permissive;
- contract benchmark now measures append/replay latency, bytes, dedupe, and uncertainty state.

## Invariants preserved

- task completion still requires existing verification/review/integration rules;
- worktree/checkpoint provenance remains authoritative for writable output;
- provider credentials and raw prompts are not persisted in decision receipts;
- uncertain external/effect state stays explicit instead of being silently retried.

## Acceptance status

Implementation is complete. Local crash/restart and benchmark evidence recorded
2026-09-24 on the Windows reference machine, commit `d3de5be`:

- **Contract benchmark** (`pnpm bench:contract`, bundle `benchmark-results/2026-09-24T09-20-59-580Z-win32-x64/`):
  `contract-effect-journal` — append p50 2.38 ms / p95 3.90 ms, replay p50 0.78 ms /
  p95 0.97 ms, 10 records / 2 493 bytes, `duplicateSuppressed: true`,
  `uncertainState: outcomeUncertain`.
- **Durable app smoke** (new `e2e/effect-journal.spec.ts`, live E2E model route):
  one real task through worker → machine verification → independent review →
  integration produced 16 receipts — `workspace.allocate`, `engine.session` ×2,
  `checkpoint`, `verification.receipt`, `review.result`, `integration` ×2 (intent
  before complete), `lease.acquire` ×4, `lease.release` ×4 — each carrying
  company/project/task/run identity where applicable, with the integration intent
  ordered before its outcome. Bundle:
  `benchmark-results/effect-journal-smoke/effect-journal-first-task.json`.
- **Restart/replay smoke** — relaunched on the same profile, all 16 known-complete
  record ids survived, sequence numbers continued monotonically (16 → 32) while a
  second task completed and integrated. Bundle:
  `benchmark-results/effect-journal-smoke/effect-journal-restart-replay.json`.
- **Secret absence** — the journal contains no provider API key, no `Authorization`
  header, and no raw provider request payload; asserted on both legs.
- Rust crash/restart fixtures (known-complete dedupe, unmatched intent promoted to
  `outcomeUncertain`, blind-retry refusal) pass inside `pnpm core:test`.

## Handoff

See [Reference Architecture Local Validation Handoff](../../plan/reference-architecture-local-validation-handoff.md).
