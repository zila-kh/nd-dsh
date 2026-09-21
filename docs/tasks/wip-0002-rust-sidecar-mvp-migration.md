# Task 0002 — Rust Shared Core + Parallel Agent Runtime MVP

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ChatGPT  
> Branch: feat/rust-shared-core-mvp  
> Updated: 2026-09-21  

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
- [ ] Input, output, resize, restart, close, and multi-terminal session ownership behave the same from the renderer point of view.
- [ ] Terminal output sequencing remains ordered under sustained output.
- [ ] Terminal output buffering is bounded and does not grow without limit.
- [ ] Closing ND-DSH terminates Rust-owned PTY child trees.
- [ ] Restarting ND-DSH never claims the old shell survived; recovery messaging/state remains truthful.
- [ ] node-pty is no longer required by the packaged runtime after Rust PTY acceptance passes.
- [ ] electron-builder.yml no longer needs the node-pty ASAR unpack rule.

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
- [ ] Autopilot cannot exceed maxParallelWorkers; the existing direct-orchestrator capacity bypass is removed.
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
- [ ] pnpm bench:smoke runs in normal CI and validates benchmark schema plus deterministic invariants.
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
