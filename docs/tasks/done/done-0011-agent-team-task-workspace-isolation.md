## Final closure gate (2026-09-22)

This archive is intentionally prepared on `chore/finalize-prd-0003-evidence`. **Do not merge this archive unless the final ready-for-review pull-request run is green.** That run must execute the normal Linux `validate` gate and Windows packaging gate; task 0004 additionally requires the full `performance-evidence` job.

Already-established evidence on the merged implementation tree (`main` at `9e894dd7`):
- GitHub Actions run **#800 / 35685765665**, validate rerun attempt 2: **success**, including nd-core checks, benchmark smoke, identity gates, repository invariants, typecheck, unit tests, desktop build, renderer isolation, and **Desktop smoke tests**.
- The prior teardown diagnostic run named the surviving native `agent-browser` daemon with its process tree; the shutdown fix now retains daemon ownership even when another app-owned client started the session, with focused regression coverage in `tests/agent-browser-shutdown.test.ts`.
- The finalization PR is the release/evidence gate. If any required job is red or cancelled, this archive remains unmerged and the task is not considered closed.

# Task 0011 — Engine-neutral teams and task workspace isolation

> PRD: [PRD-0003](../prd/0003-engine-neutral-agent-teams-and-task-workspace-isolation.md)  
> Priority: P1  
> Status: done — merge-gated by final repository CI/evidence  
> Owner: ChatGPT  
> Updated: 2026-09-22

## Objective

Turn the existing per-task worktree/review/integration behavior into an explicit engine-neutral company execution contract, then add the minimum team/subagent coordination needed for safe multi-worker projects.

PR #21 is the regression story: direct ZCode-assisted work accumulated several independently tracked tasks in one dirty checkout. ND organization execution must make that state structurally unnecessary for independent writable tasks.

## Existing foundation to reuse

- src/main/organization/task-worktree.ts
- organization leases/run receipts and execution coordinator
- checkpoint -> verification -> review -> integration flow
- engine router worktree guard and preserved session cwd
- ZCode one-app-server/many-native-session adapter
- nd-core shared scheduler/process/Git/workspace infrastructure

Do not build another parallel worktree manager beside these.

## Workstreams

### 1. Durable workspace/session binding

- [x] Add/confirm durable run evidence linking task, lease, employee, engine, engine session, workspace, baseline and checkpoint.
- [x] Define an engine-neutral execution-workspace binding shape.
- [x] Ensure writable organization sessions cannot silently change workspace roots on a later turn.
- [x] Preserve the binding through engine/app-server restart and recovery.

### 2. ZCode multi-task proof

- [x] Run two concurrent ND tasks through one ZCode app-server and distinct task worktrees.
- [x] Prove each task can checkpoint/rollback independently.
- [x] Prove restarting the ZCode app-server does not lose ND's task/workspace binding.
- [x] Prove one ZCode app-server hosts multiple task sessions; use the repository scheduler benchmark for deterministic process/memory/worktree-disk scaling rather than requiring a locally installed ZCode binary in CI.

### 3. Mixed-engine proof

- [x] Run at least two concurrent writable tasks in one project through different engines.
- [x] Prove both still follow the same checkpoint/verification/review/integration semantics.
- [x] Prove task reassignment/failover does not silently switch to the base checkout.

### 4. Team/subagent authority

- [x] Add the minimum durable team/member/task coordination state.
- [x] Define structured progress/blocker/interface-change/handoff events.
- [x] Keep ND as task/checkpoint/integration authority.
- [x] Enforce single-writer-by-default inside one task workspace unless child isolation is explicit.

### 5. Integration conflict state

- [x] Treat merge conflict as integration rework/replan, not the same as engine execution failure.
- [x] Preserve successful task evidence/checkpoint while conflict is resolved.
- [x] Avoid spending the normal engine retry budget on an unchanged stale-base conflict.

### 6. UI provenance

- [x] Task details show employee, engine, workspace isolation, branch, baseline/checkpoint and verification/integration state.
- [x] Team view summarizes active/blocked/review/complete work without requiring users to reason about worktree paths.

### 7. Regression + benchmark

- [x] Five independent writable tasks in one repository produce five independent task transactions.
- [x] Rolling back/cleaning/canceling one cannot change another task or the human base checkout.
- [x] Record 1/2/4/8/10 task-session scaling.
- [x] Keep reference/competitor observations and future comparisons in [agent-orchestration-reference-matrix.md](../plan/agent-orchestration-reference-matrix.md).

## Implementation evidence

- `src/shared/organization.ts` — engine-neutral workspace/integration/coordination contracts.
- `src/main/organization/store.ts` — durable run provenance, coordination events, integration state.
- `src/main/organization/orchestrator.ts` — baseline/checkpoint provenance and conflict-aware integration.
- `src/main/organization/ipc.ts` — runtime permit identity persisted to the run ledger.
- `src/main/engines/engine-session-router.ts` — immutable ND task-workspace binding across direct engines.
- `src/main/engines/zcode/zcode-cli-engine.ts` — ZCode cwd immutability and resume on the original workspace.
- `src/renderer/src/components/OrganizationDashboardLegacy.tsx` — engine/workspace/checkpoint/integration provenance.
- `tests/task-worktree.test.ts` — five-task independent rollback regression.
- `tests/zcode-cli-engine.test.ts` — one app-server, two isolated task sessions, restart/resume binding.
- `tests/engine-session-router.test.ts` — mixed-engine worktree binding and adapter-drift failure.
- `tests/organization-workspace-provenance.test.ts` — persisted provenance, coordination handoff and integration-conflict lifecycle.
- `benchmarks/run-suite.mjs` / `benchmarks/lib/budgets.mjs` — deterministic 1/2/4/8/10 scheduler/worktree scale evidence contract.

Main run #800 validate rerun is green. This archival move is only valid if the finalization PR's required CI remains green before merge.

## Acceptance

- Independent durable writable tasks never rely on one shared dirty working tree for transaction provenance.
- Teams can coordinate without sharing uncheckpointed mutable state.
- ZCode, Codex and future engines remain adapters; no vendor concept leaks into task/team domain truth.
- Existing task worktree safety remains intact.
- Performance claims are accompanied by repository-owned benchmark evidence.
