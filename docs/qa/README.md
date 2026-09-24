# QA notes

This folder mixes dated evidence with operator manuals; only the first is a snapshot.

- [`beta-v1-handoff.md`](beta-v1-handoff.md) — **historical (2026-08-28, PR #12).** Its CI baseline predates the Rust runtime migration, the unified browser platform, and the decision to park Actions; do not treat it as current verification. Kept for audit context.
- [`manual-beta-real-world.md`](manual-beta-real-world.md), [`agent-capabilities-manual.md`](agent-capabilities-manual.md), [`token-saver-manual.md`](token-saver-manual.md) — operator-facing manuals; check them against current behavior before relying on them.

Current validation evidence lives in dated task records (`docs/tasks/`, `docs/tasks/done/`) and their plans:

- [real-user-production-e2e.md](../plan/real-user-production-e2e.md) — Layer-4 real-user journey across companies, modes and restart.
- [blocked-0004-windows-release-validation.md](../tasks/blocked-0004-windows-release-validation.md) — runner-only release validation state.
- [beta-release-readiness.md](../plan/beta-release-readiness.md) — ordered gap list to Public Beta.
- [reference-architecture-local-validation-handoff.md](../plan/reference-architecture-local-validation-handoff.md) — protocol, runtime, and effect-journal evidence.
- [unified-browser-local-validation-handoff.md](../plan/unified-browser-local-validation-handoff.md) — browser platform evidence and the remaining real-Chrome smoke.
