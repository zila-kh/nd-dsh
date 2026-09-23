# WIP 0032 — Canonical Execution and Effect Journal

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P0  
> Status: **implementation complete; local validation pending**  
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

Implementation is complete. Local crash/restart and benchmark evidence remain to be recorded.

## Handoff

See [Reference Architecture Local Validation Handoff](../plan/reference-architecture-local-validation-handoff.md).
