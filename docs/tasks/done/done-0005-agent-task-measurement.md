## Verification record (2026-09-22)

Verified by `ZCode` before archiving. Basis: the working tree at commit `588f3ed` **plus its
uncommitted changes** — the work was never committed, so this record is only as durable as the
eventual commit.

| Gate | Command | Result |
| --- | --- | --- |
| Rust format | `cargo fmt --check` | clean (no diff) |
| Rust lint | `cargo clippy -p nd-core --all-targets -- -D warnings` | clean |
| Rust tests | `cargo test -p nd-core` | 16 passed, 0 failed (was 9 before this work) |
| Repo invariants | `pnpm verify` | passed |
| Types | `pnpm typecheck` | passed |
| Unit tests | `pnpm test` | 748 passed, 8 skipped (was 719) |

Substantive criteria were checked against the tree, not against the checkboxes. What that covers is
listed per ticket below; the remaining boxes were accepted on the strength of the gates above rather
than audited individually.

**Limit of this verification:** no review of the client-side call sites beyond compile and test
coverage, and no packaged-app or Linux-CI run. Work is uncommitted.
# Task 0005 — Agent-task measurement: make the cost of a task measurable

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ZCode  
> Branch: main (uncommitted working tree)  
> Updated: 2026-09-22  
> Depends-on: todo-0004  

## Objective

The benchmark suite measures the runtime — startup, memory, terminal, Git, event-loop lag, cancellation — and cannot measure the agent. Nothing in `benchmarks/` records what a task costs, so the premises behind every proposed agent optimization ("fewer model calls", "fewer round trips", "fewer boundary crossings") are unverifiable today.

This task creates the measurement. It lands before any router or fast-path work, otherwise that work produces unfalsifiable architecture claims of exactly the kind PRD 0002 §8.17 rules out.

## Metrics

Per task:

- `totalWallMs` — task start to terminal state.
- `modelRoundTrips` — the primary cost claim.
- `toolCalls` — distinguishes fewer model calls from fewer tools per call.
- `ipcCrossings` — the basis for any composite core operation.
- `bytesToModel` / `tokensToModel`.
- `escalations` — how often a cheap tier could not decide; meaningful once task 0008 exists, so the counter is added now.
- `completionRate` — guards against measuring "faster" by doing less.

## Acceptance criteria

- [x] A task-level result kind exists alongside the runtime result kinds, with a schema and a fixture producing deterministic results offline.
- [x] Each metric is emitted per task and aggregated as a summary, with raw samples preserved.
- [x] A task counts as completing only when its machine verification passed; a task that stops early is not silently scored as cheap.
- [x] A normal-loop baseline is recorded with the same provenance discipline as existing evidence (commit, build profile, fixture revision, environment).
- [x] Metrics are collected from production code paths, with no benchmark-only branch.
- [x] A documented command reproduces the baseline locally.
- [x] Counters may use a live-model fixture because they do not depend on model latency; wall-time claims may not.
- [x] Collection goes through a client that behaves like a real consumer, per the caution in [performance-benchmark-suite.md §12.6](../plan/performance-benchmark-suite.md#126-benchsmoke-is-red-on-windows-and-the-client-is-the-reason).

## What was built

| Piece | Path |
| --- | --- |
| Always-on per-run counters | `src/main/metrics/task-metrics.ts` |
| In-app driver (production dispatch) | `src/main/perf/agent-task-benchmark.ts` |
| Result kind, aggregation, schema validation | `benchmarks/task-metrics.mjs`, `benchmarks/lib/task-metrics.mjs`, `benchmarks/lib/json-schema.mjs` |
| Schema | `benchmarks/schema/task-metrics.schema.json` |
| Deterministic offline CLI fixture | `benchmarks/fixtures/agent-task-cli.mjs`, `benchmarks/lib/fixture-workspace.mjs` |
| Committed baseline | `benchmarks/baselines/agent-task-normal-loop.json` (re-recorded 2026-09-23 by [done-0016](done-0016-agent-task-baseline-fast-path-budgets.md) once the §12.4 comparison became schema-required) |
| Tests | `tests/task-metrics.test.ts`, `tests/agent-task-metrics.test.mjs` |

Commands: `pnpm bench:tasks` (record), `pnpm bench:tasks:baseline` (record + refresh the committed baseline), `pnpm bench:tasks:check` (offline: schema, summary recomputation, fixture-expectation re-check). `bench:tasks:check` runs in the `validate` CI job.

### Where each counter comes from (production, no benchmark branch)

| Counter | Seam |
| --- | --- |
| `totalWallMs`, `outcome`, `verification`, `completedTask` | `OrganizationStore.beginRun`/`completeRun`/`reconcileInterruptedRuns` plus the orchestrator's machine-verification result |
| `modelRoundTrips`, `tokensToModel` | harness `assistant/message` events (one per model call), or a CLI's own wire step boundary (`step_finish`); `roundTripSource` records which |
| `toolCalls`, `escalations` | the single engine frame fan-out in `src/main/index.ts` |
| `ipcCrossings` | `CoreClient.sendRequest`, attributed through the runtime permit active on the async context (`ExecutionCoordinator`) |
| `bytesToModel` | the shared engine boundary (`EngineSessionRouter.run`) |

`UsageLedger` and the engines' transcript bookkeeping carry the same events but are not read as the measurement: the task record counts engine events itself.

## Evidence

Baseline recorded on this Windows x64 machine with `pnpm bench:tasks:baseline` — 5 tasks across 4 passes, commit `588f3ed`, `buildProfile: debug`, `backend: rust-core`, `fixtureRevision: agent-task-v1`, fixture CLI sha256 `d18e1745…191edae` — then re-checked offline:

~~~text
pnpm bench:tasks:check
{ "status": "pass", "schema": "valid", "summaryRecomputed": true,
  "completedTasks": 2, "tasks": 5, "completionRate": 0.4,
  "perCompletedTask": { "modelRoundTrips": 3, "toolCalls": 4, "ipcCrossings": 17,
    "bytesToModel": 3384, "tokensToModel": 3000, "escalations": 0, "totalWallMs": 1630 },
  "expectations": { "checked": 30, "deviations": [] } }
~~~

| Pass | Recorded outcome | Verification | `completedTask` | round trips | tool calls | ipc crossings | wall ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `verified` (2 tasks) | completed | passed | true | 3 | 4 | 18 / 16 | 1934 / 1326 |
| `verification-failed` | failed | failed | false | 2 | 2 | 11 | 1228 |
| `engine-failed` | failed | not-run | false | 2 | 2 | 14 | 368 |
| `canceled` | canceled | not-run | false | 2 | 2 | 4 | 543 |

Two runs with the same fixture produced identical `modelRoundTrips`, `toolCalls`, `escalations`, `tokensToModel`, `verification`, `outcome`, `completedTask` and `roundTripSource` for all five tasks. `ipcCrossings` and `totalWallMs` are measured rather than asserted: they vary with Git subprocess and verification timing, and the baseline keeps the raw samples instead of a smoothed number.

Not covered by this task:

- Live-model counter recording. The rule is implemented and documented (`wallTimeScope`), but no live-model pass is recorded; the offline fixture is the baseline because it is the deterministic one.
- `escalations` is 0 in every pass because the fixture never requests approval. The counter is wired and unit-tested; it becomes meaningful when task 0008 introduces a cheap tier that can fail to decide.
- Wall-time claims. `wallTimeScope: excludes-model-latency` marks the offline baseline as product overhead, not user-visible latency.

## Product defects found while making the path measurable

Both were fixed here, because the measurement cannot reach the production task path without them. Neither is a benchmark-specific branch: each restores behaviour the surrounding code already assumed.

1. **Isolated task worktrees were rejected by the engine router.** `EngineSessionRouter.run` refused any session whose cwd was not inside the active workspace root, and `TaskWorktreeManager` places worktrees beside the repository (`<parent>/.nd-dsh-worktrees/<repo-key>/<task>`), so every organization task assigned to a direct CLI engine failed with "Session belongs to a different project workspace" before it started. Fixed by admitting exactly the roots ND itself created (`TaskWorktreeManager.ownsRoot` via `EngineSessionRouter.setWorktreeGuard`) — a fail-closed check, not a path-shape rule.
2. **A direct engine's turn was re-rooted at the base checkout.** The same method passed `cwd: workspace.root` on every turn, overriding the worktree root the session was created with. A worker therefore edited the *base* checkout while ND checkpointed and verified an empty task worktree — which defeats per-task isolation and would let two parallel workers write the same tree. Fixed by keeping the session's own allowed root, with the workspace root only as the default for a session that has none.

A third defect was found and is **not** fixed here, because it is not this task's: [todo-0009](todo-0009-windows-cli-shim-prompt-truncation.md) — on Windows an npm-style CLI resolved through a `.cmd` shim receives only the first line of ND's multi-line prompt.

## Notes

- Nearest existing neighbours that must **not** be repurposed as this metric: `UsageLedger` per-model token totals (`src/main/usage/usage-ledger.ts`) and the engine's transcript bookkeeping (`src/main/engines/agent-cli/structured-cli-engine.ts`). They may be sources, but a benchmark must not read a UI summary and call it a task measurement.
- Gated on task 0004 so any terminal-involving task is measured through a client that can actually see terminal output. This measurement does not use the headless core client at all — it drives the real desktop app — so it is not blocked by §12.6's client gap, and no fixture task uses a terminal.
- This task is the gate for task 0008: without a baseline, a fast path cannot be proven to help. The baseline, its fixture revision and its pass definitions are now the reference a fast-path claim must be compared against.
