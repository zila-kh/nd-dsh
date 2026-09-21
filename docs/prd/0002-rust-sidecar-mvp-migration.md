---
id: "0002"
title: "Rust Shared Core MVP Migration"
status: draft
last-audit: 2026-09-21
---

# Product Requirement Document (PRD): Rust Shared Core MVP Migration

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
process.spawn
process.write
process.cancel
process.kill
terminal.create
terminal.write
terminal.resize
terminal.close
terminal.restart
terminal.state
git.status
git.log
git.exec
workspace.stat
workspace.realpath
workspace.read
workspace.list
workspace.atomicWrite
~~~

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

The MVP only has to migrate callers needed by the Rust terminal and Git paths. Migrating every coding-engine adapter to Rust process supervision is not required by this PRD.

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

### Out of Scope

- Rewriting React, preload, or Electron UI code in Rust.
- Rewriting BrowserWindow, WebContentsView, CDP, browser automation ownership, or Electron permission handling.
- Moving safeStorage or provider secret decryption into Rust.
- Rewriting organization/company/project/task orchestration in Rust.
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
  |-- provider + engine product routing
  |
  '-- ND Core client
          |
          | stdio RPC
          v
      nd-core (Rust)
        |-- process supervisor
        |-- PTY / terminal
        |-- Git CLI + parsing
        '-- workspace filesystem primitives
~~~

ND remains the product/control plane. Rust is an implementation boundary, not a new product domain.

### 4.2 One-shot MVP migration rule

This feature is delivered in one feature PR.

Within that PR, implementation should proceed in this order:

1. Add Rust workspace, protocol types, build scripts, and core.health.
2. Add Electron CoreClient supervision and dev/package binary resolution.
3. Add Rust process supervisor.
4. Port terminal/PTY service and switch the existing TS terminal IPC adapter to it.
5. Port Git CLI execution/parsing and switch the existing TS Git adapter to it.
6. Port only the workspace filesystem primitives required by migrated services.
7. Add crash/restart/process-cleanup coverage.
8. Wire release staging and electron-builder resources.
9. Remove node-pty production dependency and unpack configuration after parity tests pass.
10. Run full ND verification and packaged smoke tests.

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
3. foreground input/cancel while output is saturated.

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

## 5. Acceptance Criteria (Required for Convergence)

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

### Performance and scaling

- [ ] Startup benchmark reports p50/p95 and meets the agreed release budget on the reference machine.
- [ ] Memory benchmark reports the actual OS metric used and separates nd-core from external engine children.
- [ ] Average incremental nd-core memory for idle sessions 2-10 is <= 8 MB, with <= 5 MB kept as the optimization target.
- [ ] Shared workspace-resource counts do not scale linearly with logical session count.
- [ ] Terminal/Git stress tests record Electron main event-loop lag and meet the p95 target.
- [ ] High-priority cancel/input is not starved by saturated terminal/background event traffic.

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
| Phase-2 project bootstrap/design lanes/delivery-cycle features | **Defer** | product workflow scope, not backend migration. |

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

## 9. Human Approval Gate

This PRD is **draft**.

Per kb-spec-feature, stop here for product-owner review. Per kb-task-triage, do not invent a task-board record while this repository has no canonical docs/tasks board and the PRD is still draft. Do not create a task file, mark this PRD approved, update the roadmap, or begin implementation until the product owner explicitly approves this draft.
