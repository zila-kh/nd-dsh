# Compute Budget Correctness — Validation Evidence

**Branch:** `feat/compute-budget-correctness`  
**Base:** `main`  
**Scope:** PLAN-XX P0 compute-budget correctness foundation  
**Validation status:** implementation and test coverage committed; local command execution pending operator validation.

## Implemented

- First-class `ComputeAccount`, provider-native meter, usage-record, reservation, and budget-pressure contracts.
- Append-only compute usage ledger with duplicate protection.
- Durable account/reservation state with restart recovery.
- Separation of `actualCashUsd` from `providerValueUsd`.
- PAYG cash reservation, settlement, release/expiry behavior.
- Account-level cash hard-cap checks include active reservations.
- Daily organization cash cap enforced from settled actual cash.
- Monthly organization cash cap enforced independently.
- Existing bounded-turn budget behavior preserved.
- Unknown/unreadable accounting fails closed when a cash cap is configured.
- Organization management projection exposes actual cash, held cash, active reservations, and stale/exhausted account state.
- Existing AI Budget UI exposes daily/monthly actual-cash caps without fabricating quota dollar equivalents.

## Automated coverage added

`tests/compute-ledger.test.ts`

- concurrent shared-account reservations cannot exceed remaining account cash;
- settlement records actual cash and releases unused held headroom;
- included/provider-value usage does not increase actual cash;
- duplicate usage ingestion is idempotent and conflicting duplicate IDs are rejected;
- held reservations survive restart.

`tests/organization-control-plane.test.ts`

- daily cash limit derives from compute ledger;
- monthly cash limit is enforced independently;
- included provider-value does not enter organization actual cash;
- cash-capped work fails closed if compute accounting is unavailable;
- existing daily turn-budget tests remain in place.

## Local validation commands

Repository requirements currently declare Node 24+ and pnpm 11+.

```bash
git switch feat/compute-budget-correctness
git pull --ff-only

corepack pnpm install
corepack pnpm typecheck
corepack pnpm test -- tests/compute-ledger.test.ts tests/organization-control-plane.test.ts
corepack pnpm test
corepack pnpm build
```

The P0 code does not intentionally change Rust protocol/runtime contracts. If the local checkout or dependency graph indicates otherwise, additionally run:

```bash
corepack pnpm core:test
```

## Manual checks

1. Configure a project daily actual-cash cap of `1.00` and monthly cap of `2.00`.
2. Ingest/settle `0.40` then `0.35` actual PAYG usage.
3. Verify management shows `0.75` actual cash while provider-value-only usage leaves cash unchanged.
4. Verify work is blocked once settled actual cash reaches the daily cap.
5. With a compute account hard cap of `1.00`, issue two concurrent `0.70` reservations and verify only one is held.
6. Restart ND while a held reservation exists and verify the reservation remains held until settlement, release, or expiry.
7. Verify ordinary `dailyTurnLimit` behavior is unchanged.

## Not in this PR

Per PLAN-XX sequencing, this branch intentionally does not implement:

- OpenCode entitlement adapter;
- Codex entitlement adapter;
- Antigravity entitlement adapter;
- dynamic task profiling/routing;
- cross-engine fallback/escalation;
- Balanced AI Development Team preset;
- evidence-aware routing learning.

Those depend on trustworthy accounting and belong in follow-up PRs.

## Validation truthfulness

No GitHub Actions were added. This chat environment did not execute the repository-local pnpm/cargo commands, so this document does not label them PASS. The branch is prepared for the operator's local validation using the commands above.
