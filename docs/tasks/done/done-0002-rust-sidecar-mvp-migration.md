# Task 0002 — Rust Shared Core + Parallel Agent Runtime MVP

> **Closed 2026-09-22.** The implementation backlog is complete: shared Rust runtime, runtime contract, task metrics, single-runtime cleanup, deterministic fast path, Windows shim hardening, and engine-neutral task isolation are implemented. Release-platform validation that cannot be truthfully inferred without a new Windows run is isolated in [blocked-0004](../blocked-0004-windows-release-validation.md), so it does not keep implementation work falsely marked WIP. This branch intentionally uses `[skip ci]` per operator request.


> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ChatGPT  
> Branch: feat/rust-shared-core-mvp  
> Updated: 2026-09-21  

## Status reconciliation (2026-09-21)

**The MVP was implemented and merged** — PR #20, merge commit `588f3ed`. The branches and handoff notes below are historical.

The acceptance checkboxes were authored before implementation and were never reconciled with the merge. Read an unchecked box as **not individually recorded**, not as **not done**. What is verified, and what is genuinely still open, is enumerated with file-level evidence in [PRD 0002 §5.0](../prd/0002-rust-sidecar-mvp-migration.md#50-status-reconciliation-2026-09-21). Boxes below that are known-open carry an inline **OPEN** marker.

Two findings from the reconciliation that change the state of this task:

1. **`pnpm bench:smoke` fails on Windows — the terminal benchmark hangs and the suite exits 1.** Reproduced locally; it is the repository's own smoke gate, and the first benchmark gate any PR runs. Root cause is a benchmark-harness defect, not a product defect: Windows ConPTY emits an initial Device Status Report (`ESC[6n`) and withholds the child's output until the client answers it. A real terminal answers automatically (xterm.js does), but `benchmarks/lib/core-rpc.mjs` is a headless byte collector that never replies, so the PTY stalls, `MARKER` output never arrives, no `terminal.exit` is emitted, and the 30-second wait times out. Answering the query with a cursor-position report makes the same command complete normally (`exit code 0`, full output). CI runs `bench:smoke` on `ubuntu-latest` only, where no such handshake exists, which is why this has never been caught.
2. **CI has never been green on this work.** Run `35592399694` (the MVP PR, non-draft) failed all three jobs: `validate` failed at "Desktop smoke tests" (`xvfb-run pnpm e2e`) with everything before it — including "Benchmark smoke" and "Unit tests" — passing; `windows-package` and `performance-evidence` both failed earlier, at release staging (`Release runtime file is missing: .release/harness/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/index.js`). Because staging failed first, **the packaged Windows smoke that asserts a terminal marker never executed**, and no performance-evidence bundle was ever produced. The post-merge `main` run `35621569827` was cancelled after 1m26s.

Consequence for this task: the packaged-Windows and benchmark-proof acceptance criteria are not merely unrecorded, they are **unproven**, and the gates that would prove them did not run. Closing this task now requires CI to go green on Windows, not just a doc update.

## Task breakdown (2026-09-21)

This task is now the umbrella record for the merged MVP. Its remaining acceptance criteria have been distributed into five claimable tickets, which are the source of truth for work in progress. The acceptance list below is retained as the original contract; where it and a ticket disagree, the ticket wins.

The breakdown is deliberately coarse — one ticket per deliverable, not per technical finding. Each ticket carries its findings as internally ordered sections with a checklist, so partial progress is still visible without fragmenting the board. A finer-grained split (16 tickets) was drafted and then consolidated; if a ticket below proves too large to finish in one sitting, split it at a section boundary and give the new ticket the next free id.

| Task | Pri | What it covers |
| --- | --- | --- |
| [wip-0004](wip-0004-restore-green-ci-and-evidence.md) | P0 | Green CI on Windows and trustworthy evidence: benchmark terminal handshake, release staging, desktop smoke, baselines/backend identity/binary hash |
| [todo-0005](todo-0005-agent-task-measurement.md) | P1 | Agent-task metrics — makes the cost of a task measurable |
| [wip-0006](wip-0006-nd-core-runtime-contract.md) | P1 | Finish the nd-core contract: workspace-RPC decision, core-side deadlines, protocol completeness, cache/revision, search — **implemented**, decisions in PRD 0002 §5.0.3 |
| [todo-0007](todo-0007-retire-legacy-paths-and-dispatch.md) | P1 | Retire legacy runtime paths (node-pty, legacy backend switch) and unify autopilot dispatch |
| [todo-0008](todo-0008-agent-fast-path.md) | P2 | Agent fast path: envelope conformance (unblocked), router + escalation, composite core operations (gated on 0005/0006) |

## Objective

Implement the approved PRD 0002 as one reviewable MVP: a shared Rust core for system/runtime work, unified parallel-agent execution permits, process/PTY/Git/workspace migration, packaged runtime distribution, and reproducible performance proof.

## Implementation order

1. Scaffold the Rust workspace, protocol, CoreClient, packaging hooks, and health handshake.
2. Add nd-core scheduler/runtime permits plus the TypeScript ExecutionCoordinator.
3. Route manual, Autopilot, retry/failover, review, rework, and workflow continuation through the unified permit path.
4. Implement same-role least-open-work distribution, reviewer rotation, role/team execution pools, and a separate review pool.
5. Migrate process supervision, PTY/terminal, Git/worktree primitives, and required workspace filesystem operations.
6. Move compatible organization-run CLI child processes onto the shared Rust supervisor while retaining engine protocol logic in TypeScript.
7. Add conflict/resource-aware parallelism and non-code artifact evidence.
8. Add the repository-owned benchmark suite and legacy-vs-Rust proof.
9. Wire release staging, Windows packaging, packaged-app smoke, CI, and cleanup/node-pty removal.
10. Run all acceptance and regression gates before proposing merge.

## Acceptance Criteria

### Architecture and startup

- [ ] crates/nd-core builds successfully on MVP development/CI hosts used by the repository.
- [ ] Electron launches exactly one nd-core process per ND-DSH app instance.
- [ ] Creating ten logical sessions still uses that same nd-core process.
- [ ] Ten sessions sharing one workspace do not allocate ten workspace service instances/Git state holders.
- [ ] Electron and Rust complete a versioned health handshake before Rust-backed services report ready.
- [ ] A protocol-version mismatch fails closed with an actionable runtime error.
- [ ] Killing nd-core manually does not crash the Electron shell.

### Terminal parity

- [ ] Creating a terminal opens a real interactive shell through the Rust PTY backend.
- [ ] Input, output, resize, restart, close, and multi-terminal session ownership behave the same from the renderer point of view. **OPEN** — `terminal.restart` is listed in PRD §4 but does not exist in the nd-core method table.
- [ ] Terminal output sequencing remains ordered under sustained output.
- [ ] Terminal output buffering is bounded and does not grow without limit.
- [ ] Closing ND-DSH terminates Rust-owned PTY child trees.
- [ ] Restarting ND-DSH never claims the old shell survived; recovery messaging/state remains truthful.
- [ ] node-pty is no longer required by the packaged runtime after Rust PTY acceptance passes. **OPEN** — excluded from packaging (`electron-builder.yml:15`) but still a devDependency at `package.json:76` with a live developer path at `src/main/terminal/terminal-manager.ts:286-298`.
- [ ] electron-builder.yml no longer needs the node-pty ASAR unpack rule. **OPEN** — see above.

### Git parity

- [ ] Existing ND Git status UI works through the Rust backend.
- [ ] Existing stage/unstage/discard/commit operations covered by current product tests still work.
- [ ] Existing branch/worktree flows covered by current product tests still work.
- [ ] Git history parsing returns the same externally consumed fields as the current TypeScript implementation.
- [ ] Authentication/prompt behavior remains non-interactive and failures remain visible.
- [ ] ND continues to execute the real Git CLI rather than substituting libgit2.

### Workspace/security parity

- [ ] Migrated filesystem calls reject paths outside the active workspace root.
- [ ] Symlink/realpath escape cases are covered by tests.
- [ ] Oversized protocol payloads and terminal inputs are rejected safely.
- [ ] No renderer API gains arbitrary filesystem or process access.

### Crash isolation and process cleanup

- [ ] Unexpected Rust exit rejects/finishes outstanding requests instead of hanging them indefinitely.
- [ ] Electron performs at most one automatic restart for a single crash event and stops on repeated failure.
- [ ] Managed child processes do not remain after normal app exit.
- [ ] Managed child processes do not remain after forced sidecar termination in the supported Windows MVP path.
- [ ] No silent fallback reports a Rust-backed operation as successful when the sidecar is unavailable.


### Parallel work distribution and execution pools

- [ ] With two idle agents of one role, N independent newly planned tasks are distributed so neither receives more than ceil(N / 2).
- [ ] A single-agent company preserves current assignment behavior.
- [ ] In-progress or review tasks cannot be silently reassigned by the distribution policy.
- [ ] Review assignment rotates when multiple reviewers are available.
- [ ] When multiple healthy reviewer routes exist, the selected reviewer does not use the same route as the worker being reviewed.
- [ ] Manual Task Execute, manual Review, Autopilot fill, retry/failover, and rework all acquire an nd-core runtime permit through the same ExecutionCoordinator path.
- [ ] Autopilot cannot exceed maxParallelWorkers; the existing direct-orchestrator capacity bypass is removed. **OPEN** — the cap holds because `runTask` acquires capacity, but dispatch is still decided by the fixed loop bound plus error-message matching in `src/main/organization/orchestrator.ts:670-693` rather than by consulting coordinator availability.
- [ ] Per-role/per-team execution caps hold under Autopilot.
- [ ] Review capacity is independently configurable; a full review pool does not consume all execution slots.
- [ ] Required project + role/team + kind pool slots are acquired atomically; partial capacity acquisition never dispatches a worker.
- [ ] Canceling one run releases only that run's permit/resources and leaves unrelated runs active.
- [ ] A sidecar crash invalidates runtime permits and blocks new organization dispatch until durable-run reconciliation completes.
- [ ] Dedicated CLI engine child processes migrated in this MVP are owned by the permit/process supervisor and leave no orphan process tree after cancel/exit.
- [ ] The multi-model beta driver exercises every configured same-role route without a manual rebalance step.
- [ ] Ten logical agents sharing one workspace still use one nd-core process and shared workspace/Git infrastructure.
- [ ] Worktree/process resource measurements are captured for a parallel run benchmark.
- [ ] Declared overlapping advisory file scopes are not blindly launched together when the scheduler has enough information to detect the conflict.
- [ ] Integration conflicts enter conflict-aware rework/replan rather than immediately repeating the same stale attempt until the retry budget is exhausted.
- [ ] A non-code specialist task can satisfy a typed artifact-evidence contract without pretending a code test command verified it.

### Performance and scaling

- [ ] Startup benchmark reports p50/p95 and meets the agreed release budget on the reference machine.
- [ ] Memory benchmark reports the actual OS metric used and separates nd-core from external engine children.
- [ ] Average incremental nd-core memory for idle sessions 2-10 is <= 8 MB, with <= 5 MB kept as the optimization target.
- [ ] Shared workspace-resource counts do not scale linearly with logical session count.
- [ ] Terminal/Git stress tests record Electron main event-loop lag and meet the p95 target.
- [ ] High-priority cancel/input is not starved by saturated terminal/background event traffic.


### Benchmark suite and measured proof

- [ ] A repository-owned benchmarks/ suite exists and covers core startup, packaged app startup, memory scaling, terminal, Git, scheduler/multi-agent, cancellation/process cleanup, and Electron responsiveness.
- [ ] package.json exposes bench:smoke, bench:record, bench:compare, and bench:check.
- [ ] pnpm bench:smoke runs in normal CI and validates benchmark schema plus deterministic invariants. **PARTIAL, and red on the release platform** — it runs in `validate` on `ubuntu-latest` and passes there, but fails on Windows: the terminal benchmark hangs because the headless RPC client never answers ConPTY's Device Status Report. See the status reconciliation above and [performance-benchmark-suite.md §12.6](../plan/performance-benchmark-suite.md#126-benchsmoke-is-red-on-windows-and-the-client-is-the-reason).
- [ ] Full benchmark results are emitted as machine-readable JSON containing raw samples, summary statistics, machine metadata, commit/backend identity, and schema version.
- [ ] Benchmark runs are isolated from the developer's real ND workspace/state/cache.
- [ ] The MVP PR contains same-machine legacy-vs-Rust measurements; performance claims in the PR are generated from those results.
- [ ] Final startup/short-latency evidence uses at least 10 measured runs and reports p50/p95.
- [ ] Memory reports separate nd-core, Electron, and external coding-engine child processes.
- [ ] Session-scaling report includes 1/2/4/8/10 logical-session points.
- [ ] Parallel-agent benchmark includes 1/2/4/8/10 worker points and reports permit latency, resource counts, memory delta, and worktree disk cost.
- [ ] Terminal benchmark detects dropped/reordered bytes rather than reporting throughput alone.
- [ ] Cancellation benchmark proves canceling one worker leaves unrelated workers alive and leaves zero orphan process trees.
- [ ] Packaged-app startup benchmark runs against the actual packaged Windows artifact.
- [ ] bench:check fails non-zero when an absolute/relative performance budget is violated.
- [ ] No README/PR performance percentage is accepted unless its underlying JSON artifact and methodology are available.

### Packaging

- [ ] Release staging builds/copies the correct nd-core executable.
- [ ] Windows portable packaging includes nd-core in app resources.
- [ ] A packaged ND-DSH build resolves the bundled sidecar without requiring Rust/Cargo on PATH.
- [ ] Release manifest records nd-core version and SHA-256.
- [ ] Packaged Windows smoke launches the real packaged executable/core and verifies health + terminal + Git using the bundled binary.
- [ ] Packaged terminal and Git smoke tests pass using the bundled binary.

### Regression gates

- [ ] pnpm verify passes.
- [ ] pnpm typecheck passes.
- [ ] pnpm test passes.
- [ ] pnpm build passes.
- [ ] Rust formatting/lint/unit tests pass: cargo fmt --check, cargo clippy with project-agreed warnings policy, and cargo test.
- [ ] CI uses a pinned stable Rust toolchain and builds nd-core on Linux validation plus Windows packaging jobs.
- [ ] Existing Electron security invariants remain intact: context isolation on, renderer sandbox on, web security on, trusted-main-frame IPC checks retained.
- [ ] Existing company/project/task/provider/engine semantics are unchanged unless separately documented.


## Handoff / review notes

- PRD approval: human-approved on 2026-09-21.
- Do not work directly on `main`.
- Implementation branch should be `feat/rust-shared-core-mvp` unless intentionally changed before work starts.
- The benchmark suite is a release gate; architecture claims without same-machine evidence do not satisfy this task.
- TypeScript remains authoritative for organization/business state; nd-core is authoritative for runtime permits/process/resource occupancy.
