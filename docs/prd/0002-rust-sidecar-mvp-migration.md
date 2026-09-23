---
id: "0002"
title: "Rust Shared Core + Parallel Agent Runtime MVP"
status: in-progress
last-audit: 2026-09-21
mvp-merge: "PR #20 (feat/rust-shared-core-mvp), merge commit 588f3ed"
---

# Product Requirement Document (PRD): Rust Shared Core + Parallel Agent Runtime MVP

> **Convergence update — 2026-09-22:** implementation is complete on the active backlog branch. The production desktop now requires one bundled `nd-core`; the node-pty/legacy backend rollback path is retired. The agent fast path uses an explicit typed action block, company policy + durable action receipts, a bounded revision-aware `workspace.snapshot` composite operation, the existing verification/integration lifecycle, and deterministic escalation to the normal engine for non-mechanical actions. Release recording is Rust-only; historical legacy comparisons remain readable via `bench:compare`. The latest main Linux `validate` job is green, while Windows release validation is tracked separately because its latest `Verify ND Core` step failed and no new CI run is being triggered for this skip-CI convergence branch.


## 1. Goals & User Problem

ND-DSH currently runs substantial system-facing work inside the Electron main process: PTY lifecycle, Git subprocesses/parsing, workspace filesystem operations, engine/process supervision, durable state writes, and orchestration glue. The same process also owns Electron windows, browser lifecycle, permissions, IPC, and other latency-sensitive duties.

The MVP should prove a safer backend boundary without attempting a broad rewrite of product logic.

### Goals

1. Introduce a bundled Rust sidecar named **ND Core** (nd-core) as a supervised local child process of Electron.
2. Move the highest-value system work out of Electron main:
   - terminal/PTY ownership,
   - Git CLI execution and parsing,
   - workspace filesystem primitives needed by those services,
   - generic child-process supervision used by migrated services.
3. Keep the React renderer, preload surface, Electron/browser integration, organization domain, provider routing, and coding-engine product contracts in TypeScript.
4. Preserve user-visible behavior and existing renderer/preload contracts so this is an architectural migration, not a UI redesign.
5. Improve crash isolation and process cleanup: a Rust-side failure must not terminate Electron, and managed children must not become silent orphans.
6. Remove node-pty from the production runtime path once Rust PTY parity is verified.
7. Bundle nd-core in release artifacts so an installed app does not require a Rust toolchain.
8. Deliver the MVP as one reviewable feature PR. Implementation may be internally staged by commits, but the final merge must leave one coherent default runtime path.
9. Make nd-core a **single shared multi-session core**: creating more ND sessions/AI employees must not create more nd-core processes.
10. Share expensive workspace resources across agents: one canonical workspace service, Git state holder, watcher/index seam, and future MCP/search pools per safe scope.
11. Establish numeric startup, memory, latency, throughput, and Electron event-loop budgets before the Rust backend expands.
12. Preserve explicit seams for a future native ND agent runtime and reconnectable core without requiring daemon persistence in this MVP.
13. Fold the parallel-work distribution plan into this MVP: same-role work must distribute across available agents instead of concentrating on the first idle employee.
14. Add explicit execution/review capacity pools so project, role/team, and review limits are enforced consistently for manual, Autopilot, retry, and review dispatch.
15. Make nd-core the **runtime execution authority** for atomic capacity permits, process ownership, cancellation, and resource accounting while TypeScript remains the durable organization/business authority.
16. Add conflict/resource-aware parallelism so increasing agent count does not simply multiply worktrees, package installs, process trees, and merge failures without measurement.
17. Ship a first-class benchmark suite in this repository so performance claims are backed by reproducible before/after measurements, not architecture claims or manual impressions.

### Primary user problem

As ND-DSH adds terminals, Git, multiple coding engines, long-running agent jobs, browser tooling, and larger workspaces, Electron main becomes an increasingly expensive and fragile place to own OS-level process and filesystem work. Users should be able to run high-volume terminal/Git activity without making the desktop shell less responsive or increasing the blast radius of a native/runtime failure.

## 2. User Stories

- As a developer using ND-DSH, I want terminal output and Git operations to stay responsive without blocking the desktop shell.
- As a developer, I want closing ND-DSH or canceling a job to reliably clean up managed processes.
- As a developer, I want terminal sessions to recover predictably after an app restart, without pretending the previous shell process survived.
- As a developer, I want Git behavior to keep using the real Git CLI and preserve current repository/worktree/config semantics.
- As a contributor, I want one typed local protocol for system services instead of adding more direct Node/native dependencies to Electron main.
- As a release maintainer, I want the packaged app to carry the exact nd-core executable it needs, with no Rust installation required on the target machine.
- As a product owner, I want ND company/task/provider/engine semantics to remain independent of the Rust implementation boundary.
- As a multi-agent user, I want ten agents in one workspace to share infrastructure rather than allocate ten copies of the same watcher/index/Git state.
- As a contributor, I want performance regressions caught by repeatable budgets instead of discovered by feel.
- As a future ND-agent user, I want the native core to be capable of owning agent/runtime services later without replacing the Electron-to-core contract.
- As a company owner, when multiple agents share a role, I want independent tasks distributed across them instead of queued behind the first employee.
- As an operator, I want separate bounded execution and review capacity so reviewers do not consume every builder slot.
- As an operator, I want the same concurrency limits to hold whether work was started manually, by Autopilot, by retry/failover, or by rework.
- As a reviewer, I want every organization run tied to one runtime permit and one resource receipt so I can see which agent/route/process/worktree consumed capacity.

## 2.1 Performance-First Architecture Rules

These rules are part of the MVP contract, not optional later optimization.

### One core, many sessions

ND launches exactly one nd-core process per desktop app instance. Session and agent identifiers are logical resources inside that process.

The MVP does **not** keep nd-core alive after Electron exits. However, resource identifiers and protocol semantics must not depend on Node object identity so a reconnectable daemon mode can be added later without redesigning every service.

### Share by workspace, isolate by session

**Workspace-scoped shared resources**
- canonical root/path resolver,
- Git repository state/cache,
- future filesystem watcher,
- future search/symbol index,
- future shared MCP processes when semantics and policy permit.

**Session-scoped resources**
- terminal instances,
- cancellation tokens,
- event subscriptions,
- per-session permission context,
- future agent-turn/conversation state.

**Process-scoped resources**
- scheduler,
- process supervisor,
- metrics,
- protocol transport,
- bounded shared caches.

A second session in the same workspace must not automatically allocate a second workspace index, watcher, or Git cache.

### Bounded everything

Every high-volume path must define a bound or backpressure strategy:
- terminal buffers,
- event queues,
- pending requests,
- frame sizes,
- filesystem reads/listings,
- Git output,
- retained diagnostics,
- future tool/transcript materializations.

No unbounded queue, log, or cache is acceptable on a multi-agent hot path.

### Avoid duplicate large representations

Large output should have one canonical owner where practical. Renderer/provider views should be streamed or derived lazily, then released. The architecture must avoid retaining multiple full copies of terminal output, Git diffs, tool results, or future transcripts merely because they cross TS/Rust boundaries.

### Priority-aware scheduling

The core needs an explicit scheduler seam. MVP priority classes:

1. **High** — user input, cancellation, approvals, terminal input.
2. **Normal** — terminal output, process state, Git results.
3. **Background** — indexing, cache maintenance, diagnostics, future prefetch.

A noisy agent or background task must not starve cancellation or typing.

## 3. Scope & Non-Goals

### In Scope

#### A. Rust sidecar foundation

Create a Rust workspace with an MVP binary at:

~~~text
crates/
  nd-core/
    Cargo.toml
    src/
      main.rs
      protocol/
      runtime/
      scheduler/
      metrics/
      process/
      terminal/
      git/
      workspace/
~~~

nd-core is launched by Electron as one child process per app instance.

Electron main remains the authority for:
- app lifecycle,
- trusted renderer IPC,
- Electron permissions,
- BrowserWindow / WebContentsView,
- CDP binding to the canonical visible browser,
- safeStorage,
- product-level policy/orchestration.

#### B. Typed local RPC over stdio

Electron and nd-core communicate only over child-process stdin/stdout for the MVP.

Required envelope concepts:
- protocol version,
- request id,
- method,
- params,
- success result,
- structured error,
- asynchronous event.

Example method families:

~~~text
core.health
core.cancel
process.spawn
process.write
process.cancel
process.closeStdin
scheduler.acquire
scheduler.bind
scheduler.heartbeat
scheduler.release
scheduler.snapshot
terminal.create
terminal.write
terminal.resize
terminal.restart
terminal.state
terminal.close
git.status
git.log
git.exec
workspace.list
workspace.read
workspace.revision
workspace.search
metrics.snapshot
~~~

Reconciled against the implementation on 2026-09-21 by task 0006. Four methods that
were listed here are not part of the protocol, and the record of why is in
[task 0006 §1 and §3](../tasks/done/done-0006-nd-core-runtime-contract.md):

- `process.kill` — `process.cancel` is the operation, and a second name for the same
  call would be protocol surface with no distinct behaviour.
- `scheduler.configure` — pool limits arrive with each `scheduler.acquire` claim;
  a core-side configure would create a second, unsynchronized source of truth for
  the capacity the organization layer already owns.
- `workspace.realpath`, `workspace.stat` — no product caller needs a bare resolve or
  stat without reading or listing, and resolution already happens inside
  `workspace.read`/`workspace.list`; keeping them would be a method kept alive only
  to justify itself.
- `workspace.atomicWrite` — the product's durable writes are organization/registry
  state owned by TypeScript stores, and the renderer workspace API is read-only, so
  a general workspace write RPC has no consumer.

Requirements:
- stdout is protocol-only; sidecar logs go to stderr.
- malformed/oversized frames fail closed.
- protocol version mismatch produces an actionable ND runtime error.
- no TCP listener, WebSocket server, or externally reachable daemon is introduced.
- renderer code never talks directly to nd-core; all access remains behind Electron trusted main/preload boundaries.

#### C. Process supervision

Implement a Rust process supervisor that provides:
- cwd and environment control,
- stdin/stdout/stderr streaming,
- bounded output buffering where required,
- cancellation and timeout handling,
- process-tree cleanup,
- platform-appropriate process group / job-object ownership,
- exit status and structured failure events.

The MVP must migrate terminal/Git subprocess ownership and must also provide a generic organization-run process path that coding-engine adapters can use without moving their engine-specific protocol logic into Rust.

Required boundary:
- TypeScript engine adapters may continue to build argv, parse engine events, and implement engine semantics.
- nd-core owns OS child-process creation, process-tree/job-object lifetime, cancellation, exit/resource events, and filtered child environments for adapters migrated to the shared process path.
- organization runs that spawn a dedicated CLI process (for example Codex/Claude/OpenCode-style adapters) should use the core process supervisor in this MVP where the adapter contract permits.
- long-lived services such as Harness may remain product-managed in TypeScript for protocol/session semantics, but their OS process should adopt the shared supervisor when doing so does not break the one-shot migration.
- no organization task is considered safely canceled merely because TypeScript stopped listening; owned child process trees must be explicitly terminated or proven detached by design.

#### D. Terminal / PTY migration

Replace the production node-pty runtime path with Rust-owned PTYs while preserving current ND terminal semantics:

- create shell,
- write input,
- resize,
- close,
- restart,
- per-session ownership,
- output sequence ordering,
- bounded terminal buffer,
- terminal layout state remains product state exposed through current contracts,
- app restart marks the old process as ended and creates/restores a new shell only according to existing ND recovery behavior,
- no claim that a previous PTY survived a desktop restart.

The React xterm.js renderer remains unchanged except for fixes required to preserve behavior.

Once acceptance criteria pass:
- remove node-pty from production dependencies,
- remove node-pty ASAR unpack rules,
- remove Node-specific spawn-helper repair logic.

#### E. Git migration

Move Git subprocess execution and parsing behind nd-core.

The MVP must continue to use the real Git executable rather than replacing Git with libgit2.

Preserve current ND behavior for:
- repository root discovery,
- status,
- log/history parsing,
- branch/worktree operations used by the existing GitService,
- staging/unstaging/discard/commit flows already exposed by ND,
- existing error classification where practical,
- non-interactive credential behavior,
- workspace-relative path normalization.

TypeScript may retain a thin GitService adapter if needed for current shared contracts and renderer events, but OS process execution and high-volume parsing should live in Rust.

#### F. Workspace filesystem primitives

Move the filesystem primitives used by migrated services into Rust, including:
- stat,
- canonical/real path resolution,
- bounded reads,
- directory listing,
- atomic write/rename helpers,
- root containment checks needed for migrated workspace access.

Security invariants from current ND architecture remain mandatory:
- workspace root containment,
- symlink/realpath protection,
- bounded inputs,
- no arbitrary renderer filesystem access.

This PRD does not require moving organization state or provider secret persistence into Rust.

#### G. Electron integration

Add a small TypeScript supervisor/adapter layer, for example:

~~~text
src/main/core/
  core-process.ts
  core-client.ts
  core-protocol.ts
  core-health.ts
~~~

Responsibilities:
- resolve bundled/dev binary path,
- launch nd-core,
- perform handshake,
- route requests/events,
- expose service adapters,
- detect unexpected exit,
- surface health to existing runtime status/error handling,
- shut down cleanly with Electron.

#### H. Packaging and developer workflow

The Rust binary must be:
- built during release staging/build,
- copied into a predictable app resource path,
- included by electron-builder,
- resolved without relying on global PATH in packaged mode.

MVP packaged target follows the repository current release configuration: Windows portable builds. Other packaged targets are not added by this PRD.

Development mode may build or resolve a host-native nd-core binary through repository scripts.

#### I. Parallel work distribution and specialist roles

Fold docs/plan/parallel-work-distribution.md into this MVP.

TypeScript organization/control-plane responsibilities remain authoritative for business semantics:

- replace first-idle assignment with **least-open-work** as the default distribution policy for same-role agents,
- retain deterministic round-robin and pinned-agent policy options where configured,
- re-evaluate ownership for ready-but-not-started work without moving in-progress/review tasks,
- rotate reviewers,
- keep provider/model assignment on agents/roles rather than in nd-core,
- add optional per-role/per-team execution limits alongside the existing project limit,
- add a distinct review capacity pool,
- preserve manual task reassignment as an operator override before work starts,
- keep dependency truth and task lifecycle in the organization store.

Specialist roles such as Frontend, Backend, DevOps, QA, Research, and Design remain organization concepts. nd-core must not encode vendor/model/role business rules.

#### J. Unified execution coordinator and nd-core runtime permits

Every task-execution and task-review dispatch path must converge on one TypeScript execution coordinator before engine invocation:

~~~text
manual / Autopilot / retry / review / rework
                |
                v
      OrganizationControlPlane
      - gates / budgets / leases
      - assignment / route
                |
                v
       ExecutionCoordinator
                |
                | scheduler.acquire
                v
             nd-core
      - atomic runtime permit
      - project pool
      - role/team pool
      - review/execute pool
      - process ownership
      - metrics
~~~

A runtime permit is a native execution lease, not durable task truth.

Permit requirements:
- unique permit id,
- owning company/project/task/run/session/agent ids where applicable,
- kind: execution or review,
- generic pool keys and limits supplied by the TypeScript control plane,
- acquired/heartbeat/released timestamps,
- TTL/crash cleanup,
- optional process ids/resources owned by the permit.

All required pools are acquired atomically or the request returns wait/busy; partial acquisition is forbidden.

The process supervisor must be able to require a valid permit for organization-run child processes. This makes the runtime limit difficult to bypass accidentally even if a future TypeScript caller skips a UI path.

On nd-core restart, durable organization runs remain authoritative. Electron reconciles active runs, marks interrupted runtime permits dead, and either safely retries from existing attempt boundaries or surfaces interruption according to current recovery rules.

#### K. Parallel workspace and conflict/resource accounting

Parallel task safety continues to use per-task Git worktrees, but the Rust Git/workspace layer becomes the low-level implementation seam.

MVP requirements:
- task worktree create/status/baseline/reset/integration Git operations are eligible to use the Rust Git service while TypeScript retains organization semantics,
- worktree disk/process cost is measured per active run,
- disposable build/install directories are excluded from evidence as today,
- task plans may carry optional advisory work/file scopes,
- obviously overlapping declared scopes may be serialized or surfaced to the scheduler before dispatch,
- integration conflicts use conflict-aware rework/replan semantics rather than blindly consuming all retries with the same stale base,
- no scheduler claim implies that file-scope hints are a security boundary.

For non-code specialist work, define a minimal artifact verification path instead of forcing code-only test evidence:
- declared artifact/evidence paths,
- artifact existence/fingerprint where applicable,
- bounded human acceptance when machine verification is not meaningful,
- no silent completion merely because a process exited zero.

Reviewer route diversity remains a TypeScript assignment constraint: when multiple healthy review routes exist, avoid assigning the same reviewer/model route used by the worker under review.

#### L. Repository-owned performance benchmark suite

See [docs/plan/performance-benchmark-suite.md](../plan/performance-benchmark-suite.md) for the detailed benchmark contract.

Inspired by jcode's practice of keeping startup, memory, terminal, and budget-check scripts in the repository, ND must ship its own benchmark harness as part of this MVP.

This is implementation scope, not documentation-only scope.

Required repository layout:

~~~text
benchmarks/
  README.md
  schema/
    result.schema.json
  fixtures/
    generate-large-git-fixture.mjs
    synthetic-engine.mjs
  lib/
    process-metrics.mjs
    statistics.mjs
    benchmark-env.mjs
  core-startup.mjs
  app-startup.mjs
  memory-scaling.mjs
  terminal-throughput.mjs
  git-workload.mjs
  scheduler-multi-agent.mjs
  cancellation-latency.mjs
  compare.mjs
  check-budgets.mjs
  baselines/
    README.md
~~~

The implementation may adjust filenames if needed, but the same coverage must exist.

Required package scripts:

~~~text
pnpm bench:smoke
pnpm bench:record
pnpm bench:compare
pnpm bench:check
~~~

Definitions:
- **bench:smoke**: short deterministic run proving every benchmark harness works; suitable for normal CI.
- **bench:record**: full reference run that writes machine-readable JSON with environment metadata.
- **bench:compare**: runs or compares legacy TypeScript/native paths against Rust-core paths on the same machine and fixture.
- **bench:check**: evaluates a recorded result against absolute and relative budgets and exits non-zero on regression.

Benchmark code must not depend on a live model/provider network call. Use deterministic local fixtures/synthetic engine processes for performance gates. Real-provider/project acceptance may be reported separately but is not a stable speed gate.

The temporary benchmark workspace, runtime directory, cache directory, and organization state must be isolated from the developer's real ND data.

Checked-in baselines must record provenance:
- ND commit,
- backend mode,
- OS/version,
- architecture,
- CPU model/logical CPU count where available,
- physical memory,
- Node/Electron version,
- Rust toolchain,
- release/debug profile,
- run count,
- benchmark schema version.

Raw per-run samples plus p50/p95/p99/mean/min/max must be retained in JSON. README summaries may display only the most useful values.

#### Mandatory benchmark scenarios

1. **Core startup**
   - process spawn -> protocol handshake,
   - health RPC after ready.

2. **Packaged Electron startup**
   - process launch -> main ready,
   - preload bridge ready,
   - first renderer-ready marker,
   - first usable workspace shell.
   - Measure with the packaged build, not only Vite/dev mode.

3. **Memory scaling**
   - 1 logical session,
   - 2,
   - 4,
   - 8,
   - 10,
   - same-workspace and multi-workspace variants.
   - Report nd-core separately from Electron and external engine children.

4. **Terminal throughput/latency**
   - sustained output bytes/sec,
   - event -> Electron handler latency,
   - input -> PTY write latency,
   - 1 and 4 concurrent terminals,
   - cancellation/input while output is saturated,
   - dropped/reordered byte check.

5. **Git workload**
   - generated repository with thousands of files and deterministic dirty changes,
   - status,
   - log,
   - diff,
   - stage/unstage,
   - worktree create/baseline/reset/integration primitives.
   - Separate Git subprocess time, Rust parse time, and IPC time.

6. **Parallel-agent scheduler**
   - 1/2/4/8/10 logical workers,
   - permit acquire/release latency,
   - same-role distribution,
   - project/role/review pool enforcement,
   - shared-resource counts,
   - per-worker memory/resource delta,
   - worktree disk growth.

7. **Cancellation/process cleanup**
   - cancel one synthetic long-running worker among several,
   - cancellation request -> process-tree exit latency,
   - permit release latency,
   - assert unrelated workers continue,
   - assert zero orphan processes.

8. **Electron responsiveness under load**
   - main-process event-loop lag,
   - renderer input responsiveness where measurable,
   - terminal + Git + multi-agent load concurrently.

#### Before/after proof

The MVP PR must include a benchmark report from the same reference machine comparing:

~~~text
legacy backend
vs
Rust shared core backend
~~~

The comparison must use the same ND commit when practical, the same fixture data, the same run counts, and the same packaged/dev mode.

At minimum report:
- startup,
- memory,
- Electron main CPU/event-loop impact,
- terminal throughput/latency,
- Git workload time,
- cancellation latency,
- 1 -> 10 session scaling,
- parallel scheduler overhead.

Do not claim a percentage improvement if the benchmark does not measure it.

#### CI and reference-machine policy

Shared GitHub runners are too noisy for tight absolute timing budgets. Therefore:

- normal PR CI runs **bench:smoke** and validates invariants/schema,
- benchmark scripts always support a local/reference-machine **bench:check** mode,
- release/MVP acceptance requires one recorded full run on a documented reference Windows machine,
- if a stable self-hosted performance runner is added later, **bench:check** becomes an automated required status without changing benchmark formats.

Correctness invariants such as one-core-many-sessions, no dropped terminal bytes, pool caps, no orphan processes, and bounded resource counts may be hard CI gates even on shared runners.

### Out of Scope

- Rewriting React, preload, or Electron UI code in Rust.
- Rewriting BrowserWindow, WebContentsView, CDP, browser automation ownership, or Electron permission handling.
- Moving safeStorage or provider secret decryption into Rust.
- Rewriting organization/company/project/task orchestration in Rust. Assignment, roles, budgets, task lifecycle, and review semantics remain TypeScript-owned even though this MVP improves them.
- Rewriting provider HTTP/API integrations in Rust.
- Rewriting all coding-engine adapters in Rust.
- Replacing DeepSeek Harness, Codex, or other external engines.
- Replacing Git CLI with libgit2.
- Introducing a database solely for this migration.
- Introducing a network-accessible local daemon.
- Adding macOS/Linux production packaging or signing as part of this MVP.
- Large renderer refactors such as splitting ChatPanel.tsx; those are separate performance work.
- Claiming raw speed improvements without measurement. The primary MVP value is isolation, responsiveness under system workload, and a cleaner native/runtime boundary.

## 4. Technical & Architectural Requirements

### 4.1 Target process graph

~~~text
React renderer
      |
      v
context-isolated preload
      |
      v
Electron main (TypeScript)
  |-- windows / WebContentsView
  |-- browser + CDP ownership
  |-- permissions / safeStorage
  |-- organization orchestration
  |-- assignment / role / review policy
  |-- ExecutionCoordinator
  |-- provider + engine product routing
  |
  '-- ND Core client
          |
          | stdio RPC
          v
      nd-core (Rust)
        |-- scheduler / runtime permits
        |-- process supervisor
        |-- PTY / terminal
        |-- Git CLI + worktree primitives
        |-- workspace filesystem primitives
        '-- metrics / resource accounting
~~~

ND remains the product/control plane. Rust is an implementation boundary, not a new product domain.

### 4.2 One-shot MVP migration rule

This feature is delivered in one feature PR.

Within that PR, implementation should proceed in this order:

1. Add Rust workspace, protocol types, build scripts, and core.health.
2. Add Electron CoreClient supervision and dev/package binary resolution.
3. Add Rust process supervisor plus scheduler/runtime-permit service.
4. Add the TypeScript ExecutionCoordinator and route every manual/Autopilot/retry/review/rework dispatch through it.
5. Implement least-open-work distribution, reviewer rotation, per-role/team execution pools, and a separate review pool.
6. Port terminal/PTY service and switch the existing TS terminal IPC adapter to it.
7. Port Git CLI execution/parsing and task-worktree primitives and switch the existing TS Git/worktree adapters to them where contract-safe.
8. Port only the workspace filesystem primitives required by migrated services.
9. Move dedicated organization-run CLI child processes onto the shared Rust process supervisor without rewriting engine protocol logic.
10. Add advisory task scope/conflict-aware scheduling and minimal non-code artifact evidence.
11. Add crash/restart/permit-reconciliation/process-cleanup coverage.
12. Wire release staging and electron-builder resources.
13. Remove node-pty production dependency and unpack configuration after parity tests pass.
14. Run multi-agent scaling benchmarks, full ND verification, and packaged smoke tests.

No partial state may be merged where the default product requires old and new backends unpredictably.

### 4.3 Protocol requirements

The protocol must be explicitly versioned, multiplexed, bounded, and transport-independent behind a small adapter interface.

#### MVP transport

- Electron spawns nd-core and uses stdin/stdout.
- stdout is protocol-only; Rust diagnostic logs go to stderr.
- no network listener is introduced.

#### Framing and encoding

Use a **length-prefixed binary envelope**. MessagePack is the preferred MVP encoding unless implementation benchmarks demonstrate another serde-friendly encoding is materially better.

This replaces line-delimited JSON as the performance target because ND expects high-volume terminal/process/agent event traffic and should avoid repeated string parsing and binary expansion.

Required envelope concepts:
- protocol version,
- frame kind,
- request id where applicable,
- workspace/session/resource id where applicable,
- priority class,
- monotonic sequence where ordering matters,
- payload length,
- bounded payload.

Minimum handshake:
- Electron sends app version, supported protocol version, and supported capabilities.
- Rust responds with protocol version, binary version, platform, architecture, capability list, and negotiated limits.
- Electron rejects incompatible versions.

Every request must have:
- unique request id,
- method,
- bounded params,
- cancellation semantics when the operation can be long-running.

Every response must have exactly one of:
- result,
- structured error.

Events must include:
- event type,
- owning resource id where applicable,
- monotonic sequence when ordering matters.

#### Backpressure and batching

- pending request count is bounded,
- outbound event bytes/count are bounded and observable,
- terminal/process streams may batch for a very short interval to reduce IPC overhead,
- high-priority input/cancellation must bypass noisy background queues,
- overflow behavior must be explicit; silently growing memory is not allowed.

Terminal output ordering must not depend on Electron event-loop timing.

### 4.4 Failure behavior

#### Sidecar fails to start

- App shell may remain open.
- Rust-backed capabilities report unavailable with an actionable error.
- ND must not silently fabricate terminal/Git success.
- Renderer remains behind existing trusted IPC contracts.

#### Sidecar crashes

- Electron remains alive.
- CoreClient records the exit and invalidates outstanding requests.
- Rust-owned children are terminated through OS process-tree ownership.
- Existing terminal processes are considered ended.
- Electron may attempt one automatic sidecar restart.
- Restored terminal UI follows existing ND semantics: previous shell ended; a new shell may be started if session state requires it.
- Repeated crash loops stop retrying and surface a stable runtime error.

#### Electron exits

- It requests graceful nd-core shutdown.
- A forced Electron termination must still not leave managed child trees behind on supported MVP platforms.

### 4.5 Security requirements

- No externally listening socket.
- No renderer direct access to sidecar stdin/stdout.
- No provider API keys or decrypted secrets logged by Rust.
- Environment passed to child processes is explicit and testable.
- Workspace path validation is enforced again in Rust for filesystem operations; TypeScript validation alone is insufficient.
- Request sizes, path lengths, terminal input, and output buffers are bounded.
- Sidecar binary path in packaged mode resolves only to ND-bundled resources unless an explicit developer override is used.
- Developer overrides must be clearly named and ignored in normal packaged behavior.

### 4.6 Compatibility requirements

The migration must preserve current shared TypeScript contracts wherever possible.

Renderer/preload-facing contract changes require explicit justification in the PR because the MVP goal is backend substitution, not product redesign.

The following remain authoritative:
- ND company/project/task domain state,
- current coding-engine registry and assignments,
- current provider routing semantics,
- canonical visible Electron browser invariant,
- current policy/approval behavior.

### 4.7 Performance budgets and responsiveness evidence

The implementation PR must include repeatable benchmark scripts that emit machine-readable results. External coding-engine child-process memory is reported separately from nd-core so session overhead is not hidden by Codex/Harness/Claude process size.

jcode is a useful reference for shared-server scaling, but its TUI is not an apples-to-apples whole-product comparison with Electron. ND's target is therefore **backend scaling**, not claiming a smaller total desktop footprint than a native TUI.

#### Core startup

Release build, warm filesystem on the documented reference machine:

- nd-core process spawn to successful handshake: target p50 <= 50 ms, release gate p95 <= 120 ms.
- health round-trip after core is ready: p95 <= 5 ms.

Recorded 2026-09-23 on the Windows reference machine ([task 0015](../tasks/done/done-0015-runtime-evidence-baseline.md)): spawn p50 22.66 ms, p95 24.45 ms, health RTT p95 0.45 ms. A freshly linked binary's first launch is a cold-start artifact (file cache, first anti-malware scan) and is recorded as `coldSpawnMs` (31.1 ms) but excluded from the percentile, which would otherwise *be* that sample at n=10.

Report spawn time separately from core initialization/handshake time.

#### Idle core memory

With no external coding-engine children and no local embedding model:

- Linux reference target: nd-core PSS <= 30 MB for one workspace + one empty logical session.
- Windows reference target: private working-set/private-bytes metric <= 40 MB for the equivalent scenario.

Do not pretend different OS memory metrics are directly identical; record the metric name with results.

#### Incremental logical-session memory

Ten empty/idle logical sessions sharing one workspace, excluding external engine child processes:

- optimization target: <= 5 MB average additional nd-core memory per session for sessions 2-10.
- MVP hard regression gate: <= 8 MB average additional nd-core memory per session for sessions 2-10.

The benchmark must also assert that workspace watcher/index/Git shared-resource counts do not scale one-for-one with session count.

This target is intentionally more aggressive than jcode's currently published ~9.9 MB extra PSS per session reference with local embeddings disabled.

#### Shared-workspace scaling

Going from one to ten idle sessions in the same workspace must not create ten copies of shared workspace infrastructure. Before session-local transcript/terminal payloads are counted, shared workspace-service memory should grow by no more than 15%.

#### Terminal stress

Benchmark:
1. one sustained-output terminal,
2. four concurrent terminals,
3. foreground input/cancel while output is saturated,
4. at least four concurrent organization runtime permits with distinct task/worktree ownership,
5. ten logical agents attached to one shared workspace/core.

Requirements:
- no protocol-level dropped/reordered bytes,
- retained scrollback obeys configured bounds,
- p95 Rust event -> Electron handler delivery <= 16 ms under the documented sustained-output workload,
- foreground input/cancel remains responsive.

#### Git stress

On a documented large fixture repo, measure separately:
1. Git subprocess duration,
2. Rust parse duration,
3. IPC delivery duration.

Repeated status/log refresh must not cause unbounded core memory growth and must not block Electron main.

#### Electron responsiveness

During terminal and Git stress:
- sample Electron main event-loop lag,
- p95 target <= 16 ms on the reference machine,
- every >50 ms stall in the benchmark run must be reported/attributed.

Gate interpretation (task 0015): the target is the *app's* event-loop lag, but on Windows `monitorEventLoopDelay` is quantized by the ~15.6 ms system timer — an idle process already reports p95 ≈ 16.2 ms — so a raw "p95 ≤ 16 ms" is unattainable by construction. The runtime benchmark therefore samples the same histogram for 750 ms with nothing to service, records that `floorP95Ms`, and the gate scores the stress p95 **above the measured floor** against the same 16 ms. Raw p50/p95/p99/max and the >50 ms stall observation are reported unchanged. Recorded 2026-09-23: floor 16.21 ms, stress 17.12 ms, excess 0.91 ms, zero stalls >50 ms.

Any claimed performance percentage in the implementation PR must include exact methodology, platform, binary profile, and before/after values.

### 4.8 Observability

Add structured Electron-side logging for:
- sidecar launch path,
- protocol handshake,
- sidecar version,
- unexpected exit,
- restart attempt,
- request timeout/error class.

Add a bounded nd-core diagnostic snapshot for:
- process memory using the best supported platform metric,
- logical session count,
- workspace count,
- terminal count and retained terminal-buffer bytes,
- pending RPC count,
- queued event count/bytes,
- process count,
- Git cache/output bytes where practical,
- shared workspace-resource counts.

Diagnostics must be privacy-safe and must not include provider credentials, workspace contents, prompt text, or raw terminal output.

Rust logs go to stderr and must avoid secret values.

Support diagnostics should distinguish:
- Electron main error,
- Rust core unavailable,
- Git command failure,
- PTY spawn failure,
- protocol mismatch.

### 4.9 Parallel agent runtime contract

#### Authority split

**TypeScript is authoritative for:**
- company/project/task/role/team/agent state,
- assignment policy,
- dependency graph,
- configured budgets/caps,
- provider/model route selection,
- reviewer independence policy,
- task/review lifecycle,
- durable leases/evidence/recovery decisions.

**nd-core is authoritative for:**
- currently granted native runtime permits,
- atomic pool occupancy,
- OS process ownership,
- per-run child process trees,
- cancellation delivery to owned processes,
- runtime resource counters,
- bounded event queues.

Neither side may silently invent the other's state.

#### Capacity pools

For one organization run, the control plane may request several generic pool keys, for example:

~~~text
project:<projectId>:all
project:<projectId>:execution
project:<projectId>:role:<roleId>
team:<teamId>:execution
project:<projectId>:review
~~~

nd-core acquires all requested pool slots atomically.

The product cap is never the Autopilot fill-loop iteration count. The same permit path is required for:
- explicit Task Execute,
- explicit Review,
- Autopilot parallel fill,
- automatic retry/failover,
- automatic rework,
- workflow continuation.

#### No double scheduling authority

OrganizationControlPlane remains the source of configured limits. nd-core receives a limit snapshot/revision with permit requests and enforces the active runtime occupancy. Rust does not decide that a Frontend Engineer should receive a task; it only enforces the generic pools the product layer asks it to enforce.

#### Cancellation and recovery

Canceling run A:
- revokes run A permit,
- cancels/terminates resources owned by run A,
- does not revoke unrelated run B permits,
- releases pool occupancy promptly,
- preserves current attempt rollback/reconciliation semantics.

A core crash invalidates all in-memory permits. Electron reconciles durable running runs against the dead core generation before new organization work can dispatch.

#### Resource accounting

For each active organization permit, expose where supported:
- owned process count,
- child/private memory metric,
- CPU sample/time,
- worktree path identity hash or opaque resource id (not raw private path in copied diagnostics),
- elapsed time,
- queued output bytes,
- exit/cancel reason.

This data feeds performance diagnostics and future budget UX; it is not billing truth by itself.

### 4.10 Benchmark methodology and regression policy

Performance evidence must be reproducible enough that another developer can rerun it and understand why a result changed.

#### Measurement rules

- Use release builds for performance claims unless the metric explicitly targets development workflow.
- Warm-up runs are separated from measured runs.
- Use at least 10 measured runs for startup/short-latency benchmarks in the final MVP report.
- Use a long enough sample window for throughput/memory workloads to observe steady-state behavior.
- Record raw samples; do not publish only one best run.
- Report p50 and p95 at minimum; include p99 for event-loop/input/cancel latency where sample count supports it.
- Memory reports identify the OS metric: Linux PSS/RSS as available; Windows private bytes/private working set as available.
- Process-tree memory is reported separately from nd-core-only memory.
- Network/model latency is excluded from deterministic core speed gates.
- Benchmarks fail loudly when required measurement facilities are unavailable; they do not silently substitute fabricated zeros.

#### Relative migration gates

On the same reference machine and deterministic fixture, Rust-core mode must demonstrate:

- **Electron main work reduction:** terminal/Git stress must materially reduce main-process CPU/event-loop work versus legacy; target >= 25% reduction in measured main-process CPU time for at least one defined high-volume workload while still meeting absolute responsiveness gates.
- **No idle-memory explosion:** Electron + nd-core idle backend memory must not regress by more than 20% versus the comparable legacy backend without an explicitly approved explanation.
- **Better multi-session scaling:** total ND backend memory growth from session 1 -> 10 must be lower than legacy mode for the same synthetic workload.
- **Cancellation not slower:** p95 synthetic worker cancel -> process-tree exit must not regress by more than 10% and must remain inside the absolute cleanup budget.
- **Git/terminal no-regression:** no hot-path benchmark may regress by >10% p50 without a documented tradeoff approved in review.

These relative gates complement, rather than replace, the absolute budgets already defined in Section 4.7.

#### Benchmark artifact

The implementation PR must attach or commit a concise generated Markdown summary derived from the JSON result, including:
- baseline and candidate commit/backend,
- machine fingerprint,
- metric table,
- percent delta,
- PASS/FAIL budget result,
- notable outliers,
- links/paths to raw JSON artifacts.

The source of truth remains machine-readable JSON.

## 5. Acceptance Criteria (Required for Convergence)

### 5.0 Status reconciliation (2026-09-21)

The MVP was implemented and merged as PR #20 (`feat/rust-shared-core-mvp`, merge `588f3ed`). The checklist below was written before implementation and was never reconciled with the merge, so an unchecked box here means **not recorded**, not **not done** — with the explicit exceptions in §5.0.2, which are genuinely open.

#### 5.0.1 Verified against this revision

| Area | Evidence |
| --- | --- |
| Rust build + unit tests | `cargo test -p nd-core` — 9 passed, 0 failed (protocol framing/version rejection, secret-env filtering, workspace parent-escape rejection, atomic multi-pool permit acquire, terminal oversized-input rejection, Git porcelain + NUL log parsing). |
| Rust lint/format | `cargo clippy -p nd-core --all-targets -- -D warnings` clean; `cargo fmt --check` emits no diff. |
| JS/TS gates | `pnpm verify` passed; `pnpm typecheck` passed; `pnpm test` — 719 passed, 8 skipped (91 files passed, 4 skipped). |
| Sidecar startup + handshake | Live dev run: exactly one `[nd-core] launch` for the app instance, `[nd-core] ready v0.1.0 protocol=1 windows/x86_64`, Electron proceeds only after `core.health`. |
| Fail-closed on missing binary | Observed in the live log: after the binary disappeared mid-session, the automatic restart failed with an actionable error ("ND Core binary is missing at ... Run pnpm core:build:dev"), and no Rust-backed operation reported success. |
| Crash isolation + bounded restart | Same incident: the sidecar died, Electron main stayed alive, DevTools/CDP remained available, and the core restart was attempted exactly once rather than looping. |
| Process supervision and cleanup | Rust process supervisor with permit-linked auto-cancel, Job Object `KILL_ON_JOB_CLOSE` for Windows descendants, PTY process-group cleanup; Windows forced-kill cleanup receipt in `benchmarks/windows-core-crash-cleanup.mjs`, wired into the CI Windows packaging job. |
| Git through Rust | `git.exec`/`git.status`/`git.log` implemented and consumed by `GitCli` and task worktrees; real Git CLI (no libgit2). |
| Parallel distribution | Least-open-work assignment with deterministic tie-break (`src/main/organization/store.ts:605-621`), reviewer rotation ordering busy → same-route → review-count (`store.ts:625-645`), project execution pool + role/team pools + separate review pool (`src/main/organization/control-plane.ts:168-183`), permits acquired through `ExecutionCoordinator`. |
| Benchmarks + CI | `benchmarks/` suite, `bench:smoke|record|compare|check|app|runtime` scripts, budget checker, PR smoke in `ci.yml`, full evidence workflow `ci.yml#performance-evidence` and `benchmark-proof.yml`. |
| Renderer isolation | No renderer/preload access to nd-core anywhere; main-process only, behind the context-isolated preload bridge. |

#### 5.0.2 Genuinely open deltas — the remaining MVP work

1. **node-pty is still present — RESOLVED 2026-09-22 by task 0007.** The dependency, the `terminal-manager` fallback path, and the packaging metadata are gone; no reference to `node-pty` remains in `src/`, `package.json`, or `electron-builder.yml`.
2. **`workspace.*` has no product caller — RESOLVED 2026-09-21 by task 0006.** See §5.0.3. `workspace.list` and `workspace.read` are now the workspace filesystem the product uses; `realpath`, `stat`, and `atomicWrite` were removed from the protocol rather than kept alive for a caller invented to justify them.
3. **No search or indexing service — RESOLVED 2026-09-21 by task 0006.** `workspace.search` exists: ignore-aware, bounded on results/files/file size, explicit about truncation, and it runs on the requesting dispatcher thread so a deadline or cancel can stop the walk without leaving a scanner behind. It is a scan, not an index; the recorded measurement behind that choice is in §5.0.3.
4. **No core-side timeout and no per-request cancellation — RESOLVED 2026-09-21 by task 0006.** Requests carry a validated `deadlineMs`; `core.cancel` stops one request by id; `git.exec`, `git.status`, and `git.log` observe both, kill the process tree they own, and answer with a distinguishable code.
5. **Event streaming is limited to `process.*` and `terminal.*`.** Resolved for recovery, not for subscription: `terminal.state` reports the current generation's shell plus the retained output sequence, so a client that missed events reaches the same view without a subscription/ack protocol. The rationale is recorded in §5.0.3; `workspace` and `git` stay request/response.
6. **State/cache primitives are in-memory only — RESOLVED for the read path 2026-09-21 by task 0006.** Revision markers (`workspace.revision`) and a bounded, revision-keyed response cache now gate `git.status` and `git.log`. Still in-memory and process-lifetime: durable state remains out of scope.
7. **PRD-listed methods that do not exist.** Reconciled: `terminal.restart` and `terminal.state` now exist with tests; `process.kill` and `scheduler.configure` were removed from the method list with recorded reasons (see the method-family section above).
8. **Autopilot capacity is enforced reactively — RESOLVED 2026-09-22 by task 0007.** The dispatch decision now consults typed coordinator availability and release, rather than reading a failure string as "no capacity"; the old fixed loop bound survives only as an iteration guard.
9. **The legacy backend switch is still live — RESOLVED 2026-09-22 by task 0007.** The production legacy backend switch is removed: nd-core is mandatory for desktop system services, and the app still fails closed with an actionable error when the binary is absent. The benchmark suite is Rust-only; historical legacy comparison remains available through `bench:compare`.
10. **Benchmark evidence gaps — CLOSED 2026-09-23.** Tooling: agent-task metrics and the committed normal-loop baseline landed with task 0005, the backend-identity plus core-binary-identity gates with the swap proof with task 0004 ([performance-benchmark-suite.md](../plan/performance-benchmark-suite.md) §12.1-§12.3), the fast-path agent-level budgets (§12.4) with task 0008. Evidence: the reviewed runtime evidence baseline was recorded on the reference machine and committed as `benchmarks/baselines/win11-x64.json` ([task 0015](../tasks/done/done-0015-runtime-evidence-baseline.md)), and the agent-task baseline was re-recorded against the §12.4 comparison and committed with its measured fast-path delta ([task 0016](../tasks/done/done-0016-agent-task-baseline-fast-path-budgets.md)). Both baselines are local recordings — `artifact.ciRun` is `null` — so the runner-produced bundles remain [blocked-0004](../tasks/blocked-0004-windows-release-validation.md)'s exit criterion, not an implementation gap.

Items 1-9 define what "finish the Rust-sidecar MVP" means; item 10 was Phase 3 of the current direction and is now closed as well. Items 1-9: 2, 3, 4, 6, and 7 by task 0006 on 2026-09-21; 1, 8, and 9 by task 0007 on 2026-09-22; and 5 as a recorded decision (recovery through `terminal.state`, subscriptions deliberately not built). Item 10: tooling by tasks 0005 and 0004, the runtime evidence baseline by task 0015, and the fast-path budgets plus the agent-task baseline re-record by task 0016 — all on 2026-09-23. The only thing left in this section is runner-produced evidence, which is [blocked-0004](../tasks/blocked-0004-windows-release-validation.md)'s exit criterion rather than implementation work.

#### 5.0.3 Decision record — nd-core runtime contract (task 0006, 2026-09-21)

These are the calls that must not be re-litigated. Evidence for each is in
[task 0006](../tasks/done/done-0006-nd-core-runtime-contract.md).

| Decision | Choice | Why, and what would change it |
| --- | --- | --- |
| Which workspace primitives stay | `workspace.list` and `workspace.read` are product-facing; `realpath`, `stat`, and `atomicWrite` are removed | The workspace browser (`WorkspaceService`) is the only real consumer of per-file filesystem work, and it needs exactly list and read. A bare resolve or stat is always followed by a read in practice, and resolution already happens inside both kept methods. Writes are owned by the TypeScript stores. Revisit only if a product feature needs a workspace write path of its own. |
| Where the deadline lives | On the request frame, not per method | Every method can then be bounded without a second convention, and `deadlineMs` is validated against core-side bounds before a request is queued. A method-specific parameter would have left every other method unbounded. |
| Default deadline | The client's own tolerance minus 250 ms | The core has to lose the race, otherwise a client timer fires first and the caller sees an untagged timeout while Rust keeps working — the exact defect this closes. Sub-300 ms control calls send no deadline, and the client timer stays as the backstop for a sidecar that stopped answering. |
| Cancellation granularity | Per request id (`core.cancel`), plus the existing process/terminal/permit cancels | A deadline that only abandons the response is not a deadline. Killing is done by the thread that owns the child handle, so no other thread can ever kill a recycled pid. |
| Event model | The existing uniform envelope stays; recovery comes from `terminal.state`, not from subscriptions | The client is a single trusted local process whose subscriptions are fixed at startup, and the bounded priority output queues already provide backpressure — so a subscribe/ack protocol would add a second flow-control mechanism with no consumer. What was genuinely missing was recovering from *missed* events, which per-terminal sequence numbers plus a bounded retained tail answer directly. Revisit if a second concurrent client, event batching, or cross-resource replay is needed. |
| Cache target | `git.log` against the refs marker, `git.status` against the worktree marker | Both are reads the product repeats on every workspace event, git action, and engine turn. Status also depends on the worktree, so it needs the full stat fingerprint; history depends only on refs, so it takes the much cheaper metadata-only marker. |
| Revision semantics | A stat fingerprint (path, kind, size, mtime) over Git's own ignore-filtered file set, plus Git metadata | It is the same signal Git's index uses to decide a path needs re-reading, computed without a process spawn, and it moves for external adds, deletes, and content edits. A marker that could not be computed faithfully (truncated walk, unreadable entry) is reported non-authoritative and the cache is bypassed rather than serving an unverified hit. |
| Staleness visibility | Every cached response carries `cached` and `revision`; a stopped search carries `stopReason` | A caller can always tell a served response from a computed one, and a capped result from a complete one. `metrics.snapshot.cache` reports hits, misses, invalidations, evictions, entries, and bytes. |
| Search: scan or index | Scan, bounded and ignore-aware, on the requesting thread | Measuring first: a 123-file fixture returns 122 matches in 30 ms (p50), which is the same order as the stat-only revision read that guards a cache — an index would add a second source of truth and a background process to keep in step for a latency that is not yet the bottleneck. Revisit when a measured search on a real workspace is the dominant cost of a task. |
| Search deadline behaviour | Partial result with `stopReason`, not an error | A search has partial value; a caller that wants an error can branch on `truncated`. `git.exec` reports an error instead, because a half-finished Git command has no partial result to return. |

### Architecture and startup

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

## 6. Risk Tier & Rollback Path

### Risk Tier: High

Reason:
- introduces a second implementation language and build toolchain,
- changes terminal native integration,
- changes Git execution/parsing boundary,
- adds a new packaged binary,
- changes process ownership and shutdown semantics,
- affects core developer workflows even if UI contracts stay stable.

### Main risks

1. **Protocol overhead** — chatty request/event design could offset responsiveness gains.
2. **PTY parity** — ConPTY/Unix PTY behavior differs and terminal edge cases are easy to regress.
3. **Process cleanup** — incorrect job/process-group ownership can leave orphaned engine/shell processes.
4. **Packaging mismatch** — wrong architecture or missing binary can make the app appear healthy in dev but fail when installed.
5. **Duplicate policy/security logic** — path/security checks can drift if TypeScript and Rust boundaries are unclear.
6. **Migration scope creep** — moving organization/provider/renderer logic in the same PR would make rollback and review substantially harder.
7. **Debug complexity** — failures now cross an RPC boundary and require correlated logs.
8. **Dual-authority drift** — configured organization limits and native pool occupancy could diverge if the ExecutionCoordinator contract is bypassed.
9. **Parallel resource amplification** — more workers can multiply installs, test runners, worktrees, and engine memory faster than user value if budgets are not measured.
10. **Assignment regression** — least-open-work/reviewer rotation changes the hot path of plan and review assignment and can starve or misroute work if implemented inconsistently.

### Rollback path

The preferred rollback is a clean revert of the feature PR because renderer/preload contracts are intentionally preserved.

For the initial soak period only, the implementation may retain the legacy TypeScript terminal/Git backend behind an explicit developer-only environment switch such as:

~~~text
ND_DSH_CORE_BACKEND=legacy
~~~

Guardrails:
- production/default path is Rust once the feature PR is accepted,
- fallback is never automatic or silent,
- fallback does not change renderer-visible contracts,
- the legacy path should be removed after the Rust path survives the agreed soak/release window,
- no new features should be added only to the legacy path.


## 7. Existing Remaining-Work Triage

The repository currently has **no canonical docs/tasks/ todo-/wip-/blocked- board**, so kb-task-triage cannot rank task files by metadata. For this draft, docs/roadmap.md plus the active beta plans are treated as the current priority evidence. No new task IDs are invented at this stage.

Relevant remaining work is folded into this MVP only when it directly strengthens the shared-core migration or prevents a regression in the packaged runtime.

| Existing remaining work | MVP disposition | How PRD 0002 handles it |
| --- | --- | --- |
| Runtime distribution / installed app must not require dev tooling | **Include** | nd-core is staged, hashed, packaged, health-checked, and requires no Cargo on the user machine. |
| Packaged Windows E2E | **Include** | packaged executable must launch the bundled core and smoke health + terminal + Git. |
| Performance telemetry | **Include** | startup, memory/session scaling, terminal/Git latency, queue sizes, and Electron event-loop lag become explicit budgets. |
| Reproducible performance benchmark suite | **Include** | repo-owned benchmark scripts, fixtures, JSON results, legacy-vs-Rust comparison, CI smoke, and hard budget checker are mandatory MVP deliverables. |
| PTY terminal + process-group cleanup | **Include** | Rust PTY + process supervisor is core MVP scope. |
| Terminal permission mode / organization action tagging | **Include at boundary** | migrated terminal/process requests must carry session/workspace/origin metadata and preserve current policy decisions; full universal action normalization remains separate. |
| Provider credential isolation from autonomous child processes | **Include at boundary** | ProcessService receives explicit child environments; provider secrets must not be inherited accidentally or logged by Rust. |
| Git status/diff/staging/commit backend | **Include** | real Git CLI execution/parsing moves to Rust while renderer contracts remain stable. |
| Engine health/onboarding | **Partial** | nd-core/process health becomes typed and observable; provider-specific Codex auth/trust/onboarding UX remains a separate product task. |
| Main-process IPC decomposition | **Partial** | new core IPC is isolated under a narrow CoreClient/module; broad refactor of existing Electron IPC is not required. |
| Policy/action normalization across all engines/browser/MCP | **Defer, preserve seam** | core requests carry enough provenance/resource identity to support later normalized action envelopes; this PR does not rebuild every policy integration. |
| Organization/company snapshots before risky migrations | **Defer** | important Phase-1 reliability work, but Rust MVP does not migrate organization state or schema ownership. |
| Renderer route-level code splitting / ChatPanel decomposition | **Defer** | separate renderer performance project; Rust cannot solve Chromium/React parse/reconciliation cost. |
| Inactive-view mount lifecycle / keep-alive cleanup | **Defer** | separate renderer lifecycle project. |
| Signing/notarization/update channel | **Defer** | release/security work independent of Rust-core architecture. |
| Richer phase timeline/receipt rendering | **Defer** | observability UI follow-up; core supplies structured metrics/events needed later. |
| Parallel work distribution / specialist engineering roles | **Include** | same-role assignment, reviewer rotation, role/team/review caps, unified execution permits, conflict/resource accounting, and non-code artifact evidence are part of this MVP. |
| Phase-2 project bootstrap/design lanes/delivery-cycle features | **Defer** | product workflow scope outside the parallel-runtime slice, not backend migration. |

### Existing reliability behavior that must not regress

The beta-v1 reliability primitives are treated as baseline and must survive the migration:

- run-specific cancellation,
- attempt rollback before retry/failover,
- bounded retry,
- stall detection,
- ordered provider failover,
- machine verification receipts,
- isolated task worktrees,
- dependency validation,
- worker capacity and event-driven continuation.

The Rust core should provide stronger process/cancellation primitives underneath these features, not create a second organization state machine.

### Action/provenance seam

Every Rust-owned process/terminal operation must be attributable to:
- workspace,
- logical session/agent when applicable,
- operation kind,
- owning ND request/run when available.

This metadata is not permission by itself. Electron/ND policy remains authoritative in the MVP, but the native core must not erase the provenance needed for later universal policy/action normalization.

### Child-environment seam

ProcessService must default toward explicit/filtered environments for ND-owned autonomous children. Provider API keys and decrypted secret values must not become ambient child environment merely because Electron main can access them.


## 8. Review Decisions Required Before Approval

The product owner should explicitly approve or change these points before task breakdown/implementation:

1. **Core identity** — one shared nd-core process owns multi-session native infrastructure; it is not a per-agent helper.
2. **MVP migration boundary** — Rust owns terminal + Git + supporting workspace/process/metrics/scheduler primitives, but not organization/provider/browser/product orchestration.
3. **Future-agent seam** — protocol/resource ownership must allow SessionService/AgentRuntime/provider/MCP/index services to move into the same core later without replacing the Electron boundary.
4. **One-shot delivery** — one feature PR, no partial merge of mixed default backends.
5. **Transport** — local stdio for MVP with a length-prefixed binary protocol; no socket/daemon in MVP.
6. **Performance budgets** — accept measured startup/memory/session/terminal/event-loop gates as convergence requirements, not optional benchmarks.
7. **Git implementation** — keep real Git CLI; do not adopt libgit2 in this migration.
8. **Remaining-work boundary** — include the items marked Include/Partial in Section 7; deferred renderer/signing/Phase-2 work does not block PRD 0002 implementation.
9. **Packaging target** — current Windows portable release path plus packaged executable/core smoke is the required packaged MVP target.
10. **Crash policy** — one automatic Rust-core restart, then fail visibly.
11. **Rollback** — revert is primary; explicit developer-only legacy switch may remain temporarily for soak.
12. **node-pty removal** — remove from production only after Rust PTY parity tests pass in the same feature PR.
13. **Parallel-work inclusion** — docs/plan/parallel-work-distribution.md is part of PRD 0002 scope, not a later standalone Phase-2 implementation.
14. **Authority split** — TypeScript owns assignment/roles/budgets/durable task truth; nd-core owns runtime permits/processes/resource occupancy.
15. **Capacity model** — one project execution pool plus optional role/team pools and a distinct review pool, all enforced through one coordinator path.
16. **Conflict/non-code minimum** — include advisory work scopes, conflict-aware rework, and a typed artifact-evidence path so parallel specialist roles are not code-only.
17. **Benchmark proof** — performance acceptance requires the repository-owned benchmark suite and same-machine legacy-vs-Rust evidence; architecture claims alone cannot satisfy the MVP.

## 9. Human Approval Gate

**Closed — this PRD was approved and implemented.**

The §8 review decisions were approved by the product owner on 2026-09-21; task 0002 was created, claimed, and implemented on `feat/rust-shared-core-mvp`, and merged as PR #20 (`588f3ed`). The frontmatter `status` is `in-progress` because the §5.0.2 deltas remain, not because approval or implementation is pending.

The earlier text of this section instructed readers that the PRD was a draft and that no task file, roadmap entry, or implementation should be created. That instruction was satisfied historically and is now **superseded** — it is retained here only so the contradiction is not reintroduced by a future reader. Do not re-apply it.

Any future scope added to this PRD (for example a search/indexing service, core-side deadlines, or composite core operations) is new work against a merged baseline and should be cut as its own task rather than reopening this gate.
