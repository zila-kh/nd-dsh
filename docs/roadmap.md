# ND-DSH roadmap

This roadmap is ordered by release risk. ND-DSH is coding-first; broader business-company templates come after the software-company loop is reliable.

## Shipped foundation

The `ai-company-workflow` branch already contains the product vertical slice:

- Secure Electron/React desktop shell with one canonical visible browser target.
- Pinned Harness runtime behind an ND adapter and loopback gateway.
- Provider-neutral model routing with DeepSeek as a compatibility default rather than product architecture.
- OS-backed encrypted provider credentials when a secure key store exists.
- Existing provider credentials are write-only from React: Settings sees `has credential`, can replace/clear, and never receives the stored decrypted key.
- Multi-company and multi-project durable organization state.
- Teams, roles, AI employees, scoped skills, workflows, goals, milestones, tasks, memory, policies, activities, and run receipts.
- AI PM → assigned worker → independent reviewer workflow.
- Dependency-aware progression, autonomy 3 continuation, bounded autonomy 4 rework.
- Correct cancellation, restart/interruption recovery, backup organization state, and isolated parallel task-run ownership with project/role/team/review capacity pools.
- Global runtime approval/question UI.
- Product-owned coding-engine catalog.
- Product-owned worker routing across ND Harness, direct Codex/ZCode/Claude Code/Cursor/Antigravity/Pi and registered installed CLI adapters, with delegated Codex fallback.
- Durable per-employee engine routing in the Workforce UI.
- Main-process company policy gate for approval-bearing organization runs.
- Production renderer fails closed when the trusted runtime is missing; no mock company/session/workspace fallback.
- Product browser starts blank rather than depending on a localhost development server.

## Public Beta P0 — release the desktop safely

These are blockers for a downloadable public beta, not optional polish.


### Active implementation — PRD 0002 Rust Shared Core + Parallel Agent Runtime MVP

- PRD: [0002-rust-sidecar-mvp-migration.md](prd/0002-rust-sidecar-mvp-migration.md) — **MVP merged; reconverging on open deltas** (see §5.0).
- Task: [wip-0002-rust-sidecar-mvp-migration.md](tasks/wip-0002-rust-sidecar-mvp-migration.md) — P0, merged as PR #20 (`588f3ed`).
- Benchmark contract: [performance-benchmark-suite.md](plan/performance-benchmark-suite.md) — implemented at runtime level; §12 records what is still unmeasurable.
- Parallel-agent scope: [parallel-work-distribution.md](plan/parallel-work-distribution.md) — D1-D3 implemented; see the open-delta list.
- Agent fast path: [agent-fast-path.md](plan/agent-fast-path.md) — proposed; **gated on measurement, not started**.

This approved MVP is the active implementation vehicle for the runtime-distribution, PTY/process, Git/worktree, parallel-worker capacity, packaged Windows smoke, and reproducible performance-proof portions of the roadmap. Organization/business truth remains TypeScript-owned; nd-core owns shared runtime permits, native process/resource lifecycle, and system-heavy services.

**Status:** the shared core, permits, PTY/Git/process migration, parallel distribution, and the benchmark suite all merged and run. The remaining work is convergence, not construction, and it is listed with file-level evidence in [PRD 0002 §5.0.2](prd/0002-rust-sidecar-mvp-migration.md#502-genuinely-open-deltas--the-remaining-mvp-work). Task 0006 closed the runtime-contract deltas — the `workspace.*` layer has a product consumer, core-side deadlines and per-request cancellation exist, `terminal.restart`/`terminal.state` exist, a revision-keyed cache backs `git.status`/`git.log`, and bounded search exists — with the decisions recorded in [PRD 0002 §5.0.3](prd/0002-rust-sidecar-mvp-migration.md#503-decision-record--nd-core-runtime-contract-task-0006-2026-09-21). Still open there: node-pty removal (0007), the legacy backend switch (0007), the autopilot dispatch heuristic (0007), and benchmark evidence gaps (0004/0005).

**CI reality check (post-PR #21):** PR #21 merged to `main` as `101a855b`. The ConPTY benchmark/client fix, evidence-identity gates, agent-task baseline, and runtime-contract work are now on main. The first post-merge CI run (`35640378484`) still did **not** go green: Ubuntu `validate` failed inside `pnpm core:test` because `workspace_primitives_are_bounded_reject_escapes_and_are_the_only_ones_exposed` hit `workspace path is unavailable: No such file or directory (os error 2)`; the remaining validate steps were skipped. The Windows job was canceled during dependency installation, so its new benchmark/package gates did not execute, and `performance-evidence` was skipped. Treat the local Windows/package evidence as useful but keep CI/release proof open until a non-draft run completes all gates. See task 0004 and [performance-benchmark-suite.md §12](plan/performance-benchmark-suite.md#12-remaining-gaps--agent-task-metrics-baselines-and-fast-path-proof).

#### Current direction — four deliverables

1. **`nd-core` Rust sidecar MVP** — finish the open deltas above. The goal is a fast native execution layer, not a TypeScript-to-Rust translation.
2. **Remaining TODOs + [parallel-work-distribution.md](plan/parallel-work-distribution.md)** — integrated into that MVP rather than cut as a separate project.
3. **Benchmark/performance suite** — extend the existing runtime-level suite (which is real and shipped) with agent-task metrics, committed baselines, and backend-identity assertions: [performance-benchmark-suite.md §12](plan/performance-benchmark-suite.md#12-remaining-gaps--agent-task-metrics-baselines-and-fast-path-proof). Agent-task metrics and the committed normal-loop baseline landed with task 0005 (`pnpm bench:tasks`, `pnpm bench:tasks:check`); the backend-identity assertions remain in task 0004.
4. **Typed fast-agent path + escalation** — [agent-fast-path.md](plan/agent-fast-path.md). Cheap decision tier over a typed action space, composite core operations, escalation to a powerful model only when reasoning is required. Its action vocabulary must reuse the P3.2 normalized action envelope rather than forking a second one.

Target: **fast native runtime + minimal round trips + structured agent actions + a powerful model only when reasoning is actually required.** Benchmark evidence decides what moves next; TypeScript stays where it is not the bottleneck.

#### Task board — PRD 0002 breakdown

| Task | Pri | Owner | What it unblocks |
| --- | --- | --- | --- |
| [wip-0004](tasks/wip-0004-restore-green-ci-and-evidence.md) | P0 | ZCode | CI actually runs its gates on Windows; performance claims become verifiable and swap-proof |
| [wip-0007](tasks/wip-0007-retire-legacy-paths-and-dispatch.md) | P1 | ZCode | one terminal runtime path; legacy backend switch scheduled out; autopilot capacity decided by query |
| [wip-0009](tasks/wip-0009-windows-cli-shim-prompt-truncation.md) | P1 | ZCode | implementation landed in PR #21; keep open until CI evidence is reconciled |
| [todo-0010](tasks/todo-0010-desktop-smoke-teardown.md) | P1 | unassigned | names the desktop-smoke teardown leak so `validate` can go green |
| [todo-0008](tasks/todo-0008-agent-fast-path.md) | P2 | unassigned | one action vocabulary (unblocked), then the router and composite ops once measurement exists |
| [done-0005](tasks/done/done-0005-agent-task-measurement.md) | P1 | ZCode | **done, verified** — task cost measurable: result kind, offline fixture and normal-loop baseline |
| [done-0006](tasks/done/done-0006-nd-core-runtime-contract.md) | P1 | ZCode | **done, verified locally** — sidecar declared scope delivered; post-merge Linux CI exposed a workspace-path contract failure that task 0004 must reconcile |
| [todo-0011](tasks/todo-0011-agent-team-task-workspace-isolation.md) | P1 | ChatGPT | **implementation complete; CI gate pending** — engine-neutral task workspace/session isolation, coordination provenance and conflict-aware integration; PRD 0003 |

Claim a task by setting `Owner` and taking the prefix to `wip-`; the full per-task detail, acceptance criteria, and evidence references live under [docs/tasks/](tasks/).


### 1. Runtime distribution

- Package a Node-compatible runtime required by the Harness launcher, or remove the external Node dependency from the packaged path.
- Bundle the pinned Harness build and every runtime package required by the selected profile.
- Bundle/resolve agent-browser per supported platform.
- Make bootstrap a developer workflow only; an installed app must not require Git, pnpm, a submodule checkout, or a developer toolchain.
- Verify licenses and notices for redistributed runtime dependencies.

Success criterion: a clean supported machine can install ND-DSH and start the real agent runtime offline from developer tooling.

### 2. Signed installers and updates

- Choose the production packager (Electron Forge or electron-builder) and lock configuration in-repo.
- macOS signing + hardened runtime + notarization.
- Windows code signing.
- Release/update signature verification and channel policy.
- App icons, bundle identifiers, version metadata, uninstall behavior, and migration strategy.

Success criterion: downloaded installers are trusted by the OS and update without replacing user organization/session state.

### 3. Installed-app E2E

At minimum, automate this smoke path on supported platforms:

```text
install -> launch -> preload bridge -> open workspace -> browser target bound
-> configure fixture provider -> create company/project
-> PM plan -> worker edits fixture -> reviewer pass -> project 100%
-> close -> reopen -> organization + engine assignment + sessions survive
```

Add negative coverage for cancellation, crash/restart recovery, missing engine, corrupted primary organization state, rejected policy approval, and missing credentials.

Success criterion: source build success is no longer the only proof that a release artifact works.

### 4. Policy/action normalization

The current main-process gate is a real hard boundary for Harness approval frames, but the upstream frame exposes only tool name/reason. Before enterprise GA:

- Define an ND action envelope (`action`, target, risk, externality, destructive scope, cost, provenance).
- Emit it from ND-owned MCP/tools and engine adapters.
- Map browser external writes, deployments, remote Git mutations, destructive data actions, purchases, and messaging to company policy before execution.
- Store durable decision/audit receipts.
- Preserve fail-closed behavior when an engine cannot supply enough metadata.

Success criterion: sensitive actions are governed consistently across Harness, Codex, browser/MCP, and future engines rather than inferred from prompt text.

### 5. Engine onboarding and health

- Add Codex installed/authenticated/project-trust health checks without copying native Codex credentials into ND provider storage.
- Distinguish engine availability, authentication, degraded health, and rate limiting in Settings.
- Surface actionable remediation before a user assigns an unavailable/unhealthy engine to an AI employee.

Success criterion: users can tell why an engine is not ready before starting work and ND never fabricates readiness.

## P1 — engine-neutral agent teams and task workspace isolation

- PRD: [0003-engine-neutral-agent-teams-and-task-workspace-isolation.md](prd/0003-engine-neutral-agent-teams-and-task-workspace-isolation.md) — **approved 2026-09-22; implementation complete on feature branch, CI gate pending**.
- Task: [todo-0011-agent-team-task-workspace-isolation.md](tasks/todo-0011-agent-team-task-workspace-isolation.md) — P1, implementation complete; archive after green CI.
- Reference/benchmark matrix: [agent-orchestration-reference-matrix.md](plan/agent-orchestration-reference-matrix.md).

This work formalizes the existing per-task worktree/checkpoint/review/integration foundation as an engine-neutral company contract. The direct ZCode-assisted PR #21 shared-checkout episode is retained as a regression story, **not** as an ND organization-run failure or a claim about ZCode architecture. Target invariant: teams share knowledge and structured handoffs; independent durable writable tasks keep independent transaction/workspace lineage.

## Public Beta P1 — best-in-class AI development environment

### Editor and code intelligence

- Monaco editor with controlled write IPC and optimistic conflict detection.
- LSP supervisor per workspace: diagnostics, symbols, definitions, references, rename, code actions.
- Problems/Output panels linked to agent runs.
- Git status/diff/staging/commit surface with company-policy gates for remote mutations.

### Terminal and processes

- PTY terminal with process-group cleanup.
- Explicit terminal permission mode and organization action tagging.
- Attach running jobs/test output to task/run receipts.

### Browser engineering surface

- Multi-tab UI backed by known CDP target ids.
- Console/network drawers.
- Device/viewport presets and screenshot history.
- Element highlight/inspect overlays.
- Action timeline tying browser state to agent tool calls.
- Per-origin privacy controls and browser-data reset/private mode.

Success criterion: a software team can implement, debug, visually verify, review, and ship a normal application change without leaving ND-DSH.

## P1 — ND Skills and MCP control plane

ND should own reusable capability definitions even when an engine implements the protocol.

- Durable MCP server registry with transport, command/URL, encrypted credential references, health, company scope, and agent allowlists.
- ND skill schema with scope, instructions, required capabilities, allowed tools/MCP, and engine hints.
- Harness compiler for ND skills/MCP.
- Codex compiler when the direct adapter can honor equivalent capability controls.
- Capability inspector showing the exact resolved skills/tools/MCP/policies for a run.

Success criterion: changing coding engine does not require rebuilding the company's skills/integration configuration.

## P1 — provider/model routing

- Provider templates for common vendors without vendor conditionals in organization code.
- Live model discovery where supported.
- Company/project/role/agent/task model-route inheritance.
- Capability metadata: context, reasoning, vision, computer use, tool calling.
- Cost/token/latency metadata and budgets.
- Provider health, rate-limit circuit breakers, fallback routes, and explicit audit of every routing decision.
- Credential-source metadata (`secure-store`, `environment`, `ambient`) so Settings can explain what can and cannot be cleared locally without exposing a secret value.

Success criterion: ND can choose a model based on job requirements, budget, latency, and health without changing the employee/workflow identity.

## P2 — enterprise company operations

- Durable policy/audit ledger with actor, engine, model, tool/action, approval, evidence, and result.
- Organization budgets, token/cost limits, quotas, and SLOs.
- Scheduled and conditional workflows with bounded retries.
- Cross-project objectives, resource allocation, and portfolio planning.
- Team/user accounts, roles and administrative controls when ND moves beyond single-user desktop beta.
- Enterprise identity, managed configuration, export/retention controls, and organization backup/restore strategy.
- Remote supervision so a desktop execution host can be steered/approved from another trusted client.

## P2 — richer coding engines

- Direct persistent Codex app-server adapter with thread/resume/progress if the delegated one-shot route becomes limiting.
- Claude Code or other coding-engine adapters behind the same ND contract.
- Local/offline engine adapter.
- Remote/cloud workers with the same company/task/policy receipts.

No engine should require vendor-specific fields in Company, Project, Task, Role, Skill, or Workflow objects.

## Release labels

Until P0 distribution/signing/E2E gates are complete, use **ND-DSH Developer Preview / Private Beta** for source builds.

After those P0 gates pass, ship **ND-DSH Public Beta** with clear supported-OS/provider/engine limits.

Reserve **enterprise-ready / GA** claims for the normalized action-policy layer, audit/administrative controls, release operations, and support commitments—not merely for a successful desktop build.