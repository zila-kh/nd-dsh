# QA notes

This folder mixes dated evidence with operator manuals; only the first is a snapshot.

- [`beta-v1-handoff.md`](beta-v1-handoff.md) — **historical (2026-08-28, PR #12).** Its CI baseline predates the Rust runtime migration, the unified browser platform, and the decision to park Actions; do not treat it as current verification. Kept for audit context.
- [`beta-three-layer-validation.md`](beta-three-layer-validation.md) — current Beta Stable operator handoff: Unit + E2E + Human evidence, with a machine-checked release record.
- [`beta-three-layer-evidence.example.json`](beta-three-layer-evidence.example.json) — copyable evidence template consumed by `pnpm beta:gate`.
- [`manual-beta-real-world.md`](manual-beta-real-world.md), [`agent-capabilities-manual.md`](agent-capabilities-manual.md), [`token-saver-manual.md`](token-saver-manual.md) — operator-facing manuals; check them against current behavior before relying on them.
- [`quick-launcher-manual.md`](quick-launcher-manual.md) — PR #55 three-layer launcher gate: deterministic unit contracts, real Electron E2E, and Windows manual P0/P1 checks. Its manual rows supply the Human layer for the `quick-launcher` beta feature row.
- [`nd-extensions-home-manual.md`](nd-extensions-home-manual.md) — PRD 0006 extensions/ND Home gate: unit + integration + Electron E2E recorded locally 2026-09-27; operator manual P0/P1 pass and the agent-side bridge remain. Its manual rows supply the Human layer for the `native-extensions` and `nd-home` beta feature rows.

Current validation evidence lives in dated task records (`docs/tasks/`, `docs/tasks/done/`) and their plans:

- [real-user-production-e2e.md](../plan/real-user-production-e2e.md) — Layer-4 real-user journey across companies, modes and restart.
- [blocked-0004-windows-release-validation.md](../tasks/blocked-0004-windows-release-validation.md) — runner-only release validation state.
- [beta-release-readiness.md](../plan/beta-release-readiness.md) — ordered gap list to Public Beta.
- [reference-architecture-local-validation-handoff.md](../plan/reference-architecture-local-validation-handoff.md) — protocol, runtime, and effect-journal evidence.
- [unified-browser-local-validation-handoff.md](../plan/unified-browser-local-validation-handoff.md) — browser platform evidence and the remaining real-Chrome smoke.
