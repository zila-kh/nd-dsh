---
id: "0002"
title: "Rust Core Sidecar MVP Migration"
status: draft
last-audit: 2026-09-21
---

# Product Requirement Document (PRD): Rust Core Sidecar MVP Migration

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

The protocol must be explicitly versioned.

Minimum handshake:
- Electron sends supported protocol version.
- Rust responds with protocol version, binary version, platform, architecture, and capability list.
- Electron rejects incompatible versions.

Every request must have:
- unique request id,
- method,
- bounded params.

Every response must have exactly one of:
- result,
- structured error.

Events must include:
- event type,
- owning resource id where applicable,
- monotonic sequence when ordering matters.

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

### 4.7 Performance and responsiveness evidence

The PR must include a repeatable local benchmark/smoke script for at least:

1. sustained terminal output,
2. Git status/log on a repository with thousands of files/changes,
3. sidecar startup/handshake.

The goal is not a marketing benchmark. Required proof:
- Electron main remains responsive during high-volume terminal/Git activity,
- no unbounded memory growth,
- protocol throughput does not become the new bottleneck,
- idle sidecar resource use is reasonable for a desktop background process.

Any claimed performance percentage in the implementation PR must include measurement methodology.

### 4.8 Observability

Add structured Electron-side logging for:
- sidecar launch path,
- protocol handshake,
- sidecar version,
- unexpected exit,
- restart attempt,
- request timeout/error class.

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

### Packaging

- [ ] Release staging builds/copies the correct nd-core executable.
- [ ] Windows portable packaging includes nd-core in app resources.
- [ ] A packaged ND-DSH build resolves the bundled sidecar without requiring Rust/Cargo on PATH.
- [ ] Packaged terminal and Git smoke tests pass using the bundled binary.

### Regression gates

- [ ] pnpm verify passes.
- [ ] pnpm typecheck passes.
- [ ] pnpm test passes.
- [ ] pnpm build passes.
- [ ] Rust formatting/lint/unit tests pass: cargo fmt --check, cargo clippy with project-agreed warnings policy, and cargo test.
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

## 7. Review Decisions Required Before Approval

The product owner should explicitly approve or change these points before task breakdown/implementation:

1. **MVP migration boundary** — Rust owns terminal + Git + supporting workspace/process primitives, but not organization/provider/browser/product orchestration.
2. **One-shot delivery** — one feature PR, no partial merge of mixed default backends.
3. **Transport** — local stdio RPC only for MVP; no socket/daemon.
4. **Git implementation** — keep real Git CLI; do not adopt libgit2 in this migration.
5. **Packaging target** — current Windows portable release path is the required packaged MVP target.
6. **Crash policy** — one automatic Rust-sidecar restart, then fail visibly.
7. **Rollback** — revert is primary; explicit developer-only legacy switch may remain temporarily for soak.
8. **node-pty removal** — remove from production only after Rust PTY parity tests pass in the same feature PR.

## 8. Human Approval Gate

This PRD is **draft**.

Per kb-spec-feature, stop here for product-owner review. Do not create docs/tasks/todo-0002-rust-sidecar-mvp-migration.md, mark this PRD approved, update the roadmap, or begin implementation until the product owner explicitly approves this draft.
