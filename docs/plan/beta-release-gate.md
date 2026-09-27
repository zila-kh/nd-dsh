# Beta release gate — checklist and current standing

> Updated: 2026-09-27 · Last fully attested baseline: `feat/token-tool-routing` (`8ad0782`) on 2026-09-26 (`pnpm typecheck` clean; **855 passed / 8 skipped** unit tests). The current beta-hardening branch adds new gates/tests that are **implemented but not yet locally attested**; the local-PC handoff in [beta-three-layer-validation.md](../qa/beta-three-layer-validation.md) must produce fresh RC evidence before any GO.
>
> Purpose: the pass/fail definition for **Beta Stable** — what must be predictable and recoverable before inviting users. Companion documents: [beta-release-readiness.md](beta-release-readiness.md) (ordered work plan to close the gaps), [roadmap.md](../roadmap.md) (gate definitions per release label), [../qa/README.md](../qa/README.md) (evidence index).
>
> Rule of the gate: don't require every planned feature to be finished — require every **beta-exposed feature** to be predictable and recoverable.

## Beta Stable criteria

Beta Stable is declared when, on the release candidate build:

1. **0 P0** — crash, data loss, security leak, wrong-company/project execution.
2. **0 known P1** in the core workflow — create project → agent work → review → git/result.
3. **Every beta-exposed feature passes all three layers: Unit + E2E + Human.**
4. **≥95% repeated scenario pass rate** on the main beta scenarios. A 99% target may be configured for a larger repeated-run sample; do not present it as a literal probability that the product is bug-free.
5. The exact packaged artifact passes the release journey, not only the source checkout.
6. Non-core incomplete features stay **Beta/Experimental behind a feature flag**.

## Three-layer release rule

The release gate now uses three independent validation layers:

- **Layer 1 — Unit:** deterministic rules, isolation, safety, recovery and failure-handling behavior.
- **Layer 2 — E2E:** the real Electron/Rust/provider/Git/browser integration, including packaged-app journeys.
- **Layer 3 — Human:** a real tester checks usability, state truthfulness, recovery, desktop behavior and failures that automation can miss.

No beta-exposed feature can be declared ready by only one or two layers. Human evidence must include the tester and date; an agent must not fabricate the Human PASS.

The machine-readable evidence template is [beta-three-layer-evidence.example.json](../qa/beta-three-layer-evidence.example.json), the operator handoff is [beta-three-layer-validation.md](../qa/beta-three-layer-validation.md), and the local gate is:

```sh
corepack pnpm beta:gate -- docs/qa/beta-three-layer-evidence-<rc>.json
```

## Checklist legend

- **Automated** — regression-tested in this tree; a green local run is standing evidence.
- **Partial** — automated coverage exists; a named gap remains.
- **Manual** — no automation; requires a real-machine/human run before the gate.

## Gate checklist

| # | Gate item | Status | Evidence in tree | Open gap |
|---|-----------|--------|------------------|----------|
| 1 | Fresh install / upgrade | Partial | `tests/app-paths.test.ts`, `tests/dsh-package-update.test.ts` (install/repair/upgrade, orphan cleanup, manifest rewrite), `tests/harness-runtime-setup.test.ts`, `scripts/stage-release.mjs` + `scripts/verify-release.mjs` + `scripts/packaged-runtime-smoke.mjs` | No config-schema migration tests across app versions; runner-based release validation blocked ([blocked-0004](../tasks/blocked-0004-windows-release-validation.md)) |
| 2 | App startup / sidecar lifecycle | Partial | `tests/harness-startup-lifecycle.test.ts` (partial-launch cleanup), `tests/agent-browser-shutdown.test.ts` (zombie sweep, pid-file race), `crates/nd-runtime/src/windows_job.rs` (kill-on-job-close), `benchmarks/windows-core-crash-cleanup.mjs` (descendant cleanup after core crash), `benchmarks/app-startup.mjs`, `tests/execution-coordinator.test.ts` (permits invalidated on core exit) | No automatic nd-core restart/backoff policy test |
| 3 | Core agent flow (company → project → task → agent/model → execute → result) | Automated | `tests/organization-orchestrator.test.ts` (PM→worker→review autopilot, rework cap, cancellation), `tests/organization-store.test.ts`, `tests/capability-assignment-store.test.ts`, `tests/coding-engine-routing.test.ts`, `tests/engine-session-router.test.ts`, `tests/beta-reliability.test.ts`, e2e `qa-functional.spec.ts` full work loop, `e2e:prod:user` 19/19 real-user journey | Repeatability (rate ≥95%) is a soak/day-scale property — item 17 |
| 4 | Workflow templates | Partial | Default workflow seeded in `src/main/organization/defaults.ts`; `tests/organization-workflow.test.ts` (project-scoped execute-only policy), `tests/workflow-plugin-store.test.ts` / `workflow-plugin-manifest.test.ts` / `workflow-service.test.ts` (install/enable/bindings, per-company isolation), `tests/workflow-board.test.ts` | No UI-level create/edit-template flow test; no explicit workflow-rerun test (only orchestrator rework loops) |
| 5 | Multi-company / multi-project isolation | Automated | e2e `organization-portfolio.spec.ts` (hard ownership boundaries, forged cross-company task/assignment rejection, full-restart persistence), `organization-portfolio-models.spec.ts` (2 companies / 3 projects / isolated models), `tests/organization-company-removal.test.ts`, `organization-project-removal.test.ts` (incl. stopping live work), `session-project-scope.test.ts`, `harness-session-scope.test.ts`, `nd-skill-service.test.ts` (cross-project/workspace scope rejection, junction escape), `workflow-service.test.ts` (bindings isolated between companies sharing a plugin) | Per-project credential isolation unproven (providers are global) — see item 14 |
| 6 | Parallel agents | Automated | `tests/execution-coordinator.test.ts` (atomic multi-pool acquire, typed over-capacity refusal, wait/deadline, review vs execution pool independence), `tests/compute-ledger.test.ts` (concurrent reservations cannot overspend one account; crash-safe restore), `tests/beta-reliability.test.ts` ("cancels one of two isolated parallel runs without stopping the other"), `tests/task-worktree.test.ts` (independent rollbackable worktrees, dirty-workspace refusal, conflict fail-closed), benchmarks rust-parallel-runtime-v2 scale contract (1–100 sessions) | — |
| 7 | LLM providers / failure handling | Automated | `tests/provider-runtime.test.ts` (bounded retry defaults, unsafe-URL rejection), `tests/provider-ping.test.ts` (auth vs unreachable vs transport fail-closed), `tests/beta-reliability.test.ts` (502 + explicit HTTP 429/rate-limit retry classification, rollback/failover, auth/config fail-closed), `tests/runtime-notices.test.ts`, `tests/gateway-client-stability.test.ts`, `e2e/beta-multimodel.mjs` | Fresh RC execution evidence pending |
| 8 | Budget / entitlement | Automated | `tests/compute-ledger.test.ts` (reservation/settlement, included-value excluded from cash, idempotent ingest), `tests/organization-control-plane.test.ts` (daily + monthly cash limits from settled usage only; fail-closed when accounting unavailable), `tests/usage-ledger.test.ts`, `tests/token-saver.test.ts` + `tests/tool-routing.test.ts` (Shadow/Assist/Enforce, fail-open fallback) — landed with the compute-budget-correctness and token-tool-routing branches | — |
| 9 | Git safety | Automated | `GitService.push()` and `pushBranch()` now fail closed on dirty trees **and** scan the committed tree before network mutation; high-confidence secrets and sensitive credential files are blocked without logging secret values. `tests/git-service.test.ts` covers clean allow, secret block, sensitive-file block, divergence and dirty-tree refusal; `tests/task-worktree.test.ts` covers isolated worktrees. | Fresh RC execution evidence pending |
| 10 | Terminal + filesystem | Automated | `tests/terminal-manager.test.ts` (chat-bound ops, ConPTY handling, bounded scrollback, restart persistence, malformed-state tolerance), `tests/nd-core-contract.test.ts` (terminal truthfulness/reconciliation, deadlines), inline tests in `crates/nd-runtime/src/terminal.rs`, `tests/path-utils.test.ts` (traversal rejection, Windows case-insensitivity, workspace scoping), e2e `smoke.spec.ts` real PTY through sandboxed bridge | — |
| 11 | Browser tools | Partial | Existing lease/token/policy/shutdown tests plus `bench:browser-runtime` exercise real Electron cookie set/read/clear and a real download; `e2e:companion:chrome` exercises the real Chrome/native-host path. `beta:automated` now includes the built-in runtime proof. | Chrome `captureVisibleTab` still requires a real toolbar invocation; final Human Chrome check remains mandatory |
| 12 | MCP / skills errors | Partial | Existing runtime/router/timeout/malformed coverage plus `tests/extension-example-mcp.test.ts` now proves a broken MCP child is contained and a repaired subsequent request succeeds without restarting ND. E2E config persistence remains in `agent-capabilities-mcp-config.spec.ts`. | Full interactive-agent-session recovery after MCP child failure remains a Human RC check |
| 13 | Persistence / recovery | Automated | `tests/organization-snapshot-manager.test.ts` (restore before stores load), `tests/organization-recovery.test.ts` (last-known-good backup on corrupt snapshot; stale running work marked failed/retryable after restart), `tests/core-session-journal.test.ts` + e2e `effect-journal.spec.ts` (journal replays after full app restart), `tests/compute-ledger.test.ts` reservation restore, `tests/terminal-manager.test.ts` restart persistence | — |
| 14 | Security boundaries | Partial | Existing log/diagnostics redaction, credential-env scrub, provider-secret preservation, approval gates, renderer hardening and release scans; product Git push has a fail-closed committed-secret guard. `scripts/verify.mjs` now fails if Electron CDP is not explicitly bound to `127.0.0.1`. | Provider API keys are desktop-global in Private Beta (not company/project isolated); fresh RC execution evidence pending |
| 15 | Failure drills (kill sidecar / no internet / provider down / merge conflict / disk full) | Partial | Core-crash cleanup: `benchmarks/windows-core-crash-cleanup.mjs`; provider down: `tests/beta-reliability.test.ts` failover/rollback; corrupt state: `tests/organization-recovery.test.ts`; merge conflict: `tests/task-worktree.test.ts` fail-closed; malformed terminal state: `tests/terminal-manager.test.ts` | No drills for internet disconnect, disk-full/invalid data folder, or sidecar kill mid-task (covered only indirectly) |
| 16 | Performance | Partial | `bench:app` (packaged startup), `bench:contract` 9/9, `bench:tasks:check` (136/0 vs committed baseline), `bench:runtime`, budget classes per [performance-baseline-policy.md](performance-baseline-policy.md) | No test asserting the UI doesn't progressively freeze under long chats / several concurrent agents |
| 17 | 24-hour soak | Partial | `e2e/beta-soak.spec.ts` + `e2e:beta:soak` keep one Electron lifetime active, switch a 3×2 portfolio, sample process working set/count, assert ownership/ID stability and write a JSON receipt. The final gate rejects soak evidence shorter than 1440 minutes. | The actual 24-hour RC run must happen on the local release machine |
| 18 | Real-user E2E (3 companies × 2 projects) | Partial | `e2e/beta-release-matrix.spec.ts` creates an explicit 3 companies × 2 projects matrix, rejects forged cross-company writes, repeats switching and proves full-restart persistence. Existing `e2e:prod:user` and multi-model tests cover live execution/parallel/provider behavior. | Human real-world matrix on the exact RC remains required |
| 19 | Observability / diagnostics export | Automated | Existing redaction/notice/evidence tests plus `e2e/qa-functional.spec.ts` now drives Settings → About → Copy diagnostics through the real UI, reads the clipboard from Electron, and asserts workspace/project identity is omitted. | Fresh RC execution evidence pending |
| 20 | Rollback one release version | Partial | `tests/dsh-package-update.test.ts` (upgrade/repair, never replaces org state by design), worktree/task-attempt rollback in `tests/beta-reliability.test.ts` + `tests/task-worktree.test.ts` | Release-level rollback (previous version + user state intact) is unproven until the update channel ships (readiness item 9) |

## Five highest-risk areas before inviting users

1. **State recovery** — best covered in the tree (snapshot manager, recovery tests, effect journal). Remaining risk is the packaged artifact, not the logic: close the gap via installed-app E2E (readiness item 6) and the soak (item 17).
2. **Parallel-agent isolation** — strongest area: execution coordinator, compute ledger, worktree independence, parallel cancel isolation all automated. Keep green under the current branch's token/tool-routing changes (`tests/tool-routing.test.ts`).
3. **Multi-company isolation** — automated for data/tasks/workspaces/workflows, including forged cross-company rejection. The open exposure is credentials: providers are global, so per-project credential isolation (checklist items 5/14) is the one thing that could produce a wrong-scope secret.
4. **Git/worktree safety** — refusal behaviors (dirty workspace, uncommitted changes, diverged branch) are well tested; the missing piece is secret scanning at the product boundary, not worktree mechanics.
5. **Credential/security boundaries** — strong unit base (redaction, env scrub, approval gate, write-only credentials from renderer). Gaps: product-level pre-push secret scan, per-project credential isolation, and loopback-CDP as an explicit test rather than an indirect one.

## Cross-cutting gate risks

These four appear across multiple checklist rows and are the shortest path to a P0 or unprovable gate:

- **Pre-push secret scanning** (items 9, 14) — implemented on this beta-hardening branch at the real Git push boundary; fresh local RC execution is still required.
- **Provider credential scope** (items 5, 14) — Private Beta explicitly treats provider API keys as **desktop-global operator resources**, not company/project secrets. Do not use one ND desktop for mutually untrusted tenants. True company/project/env secret isolation requires a shared-Harness/gateway runtime-boundary change and remains a later release-hardening item.
- **CI parked as `.github-bk/`** — all of the above evidence is locally attested, not runner-attested; restoring CI is readiness item 1 and gates item 1 (fresh install/upgrade) via blocked-0004.
- **Release-level rollback + update channel** (item 20, readiness items 8–9) — unsigned binaries and no staged update verification are the hard stop for distribution beyond hand-delivered copies.
