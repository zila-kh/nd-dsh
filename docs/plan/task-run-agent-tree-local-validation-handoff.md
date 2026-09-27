# Local Agent Handoff — Task Run Agent Tree + Engine Hardening

## Repository

- Repository: https://github.com/zila-kh/nd-dsh
- Feature branch: `feat/task-run-agent-tree`
- Implementation head before this handoff-only documentation commit: `3b980f752d72cdc975822afe66b90f3b682f34da`
- Base branch: `main`
- Base head: `a6f6816e13e1817a52b1c9541247ba181245ed14`
- Ahead/behind at handoff authoring: `41/0`
- Open PR: #57 — `Feat/task run agent tree`
- PR state at handoff authoring: open, non-draft, mergeable/clean
- GitHub Actions/status checks: no statuses and no workflow runs on the feature head
- Important: this handoff file is committed after the implementation head above, so the branch HEAD will advance by one documentation commit. On checkout, record the actual current HEAD with `git rev-parse HEAD` and use repository truth.

## Mission

Finish local validation of the ND task/session execution work without reopening the architecture unless a concrete defect is demonstrated. The branch adds a collapsible main-agent → subagent session projection, hardens engine/session workspace ownership, keeps ND-owned task worktrees visible and skill-capable, fails closed on invalid engine/workspace routing, and adds a company-level **Subagents: Auto / Off** policy so normal tickets are never forced into child-agent execution.

The implementation is complete enough for validation, but it is **not merge-ready yet** because the required local commands and manual desktop smoke have not been executed in this GPT-Web environment.

## Critical rules

- Never work directly on `main`. Fix demonstrated defects only on `feat/task-run-agent-tree` (or a child feature branch if the operator explicitly asks).
- Do not silently rebase, merge `main`, force-push, enable/restore GitHub Actions, or merge PR #57.
- GitHub Actions are currently absent/parked for this branch. Missing CI is not evidence of PASS; local validation is authoritative.
- Preserve ND's ownership boundaries:
  - Company/Project/Task/Run remain durable ND control-plane records.
  - A subagent is a child execution session inside a worker run, not an employee, team member, or task.
  - Team/parallel-task orchestration is separate from in-ticket subagent delegation.
  - Task/worktree identity stays immutable for an engine session.
  - Runtime/vendor session metadata is projected into ND; do not fork or patch the pinned Harness to implement the UI.
- `Subagents = Auto` is the default, including older snapshots with no stored field. It means delegation is optional, not mandatory.
- `Subagents = Off` applies to organization worker execution. It does not remove upstream subagent tools from unrelated personal/interactive chat.
- Delegated engine id `codex` requires `subagent_codex`; with Subagents Off, ND must fail closed and tell the operator to use direct `codex-cli` or re-enable Auto.
- Direct `codex-cli` and other direct workspace engines remain valid while Subagents is Off.
- Do not claim a test/build/benchmark passed unless the command was actually run and its result captured.

## Implemented

### 1. Parent/child agent session projection

- Added `src/shared/session-tree.ts`.
- Harness session rows with `origin: 'subagent'` and `parentSessionId` are projected under their parent.
- Ordinary forks that happen to have a parent id are not misclassified as subagents.
- Nested children are supported recursively.
- Missing parents and cyclic/malformed lineage fail soft by leaving affected sessions visible at root level.
- `ChatPanel` renders collapsible parents, indented children, child counts, active-child counts, and a subagent marker.
- Parent activity uses both persisted/runtime `running` state and the live busy-session set.

### 2. Project/session isolation

- Subagent project attribution inherits through the parent chain only for rows explicitly marked `origin: 'subagent'`.
- Child/grandchild sessions therefore stay with the owning project.
- Ordinary manual forks remain globally visible unless they have their own explicit run attribution.
- Archive filtering is applied after lineage/project resolution so a hidden/archived parent does not accidentally break child attribution.

### 3. Engine/session workspace ownership

- Session working directory is treated as immutable ND-owned session state.
- Direct engines and Harness-backed sessions carry the exact bound cwd through subsequent turns.
- Existing sessions reject attempts to re-root them to a different workspace.
- Prompt metadata now reports the actual task worktree as `workingDirectory`, while retaining the owning company/project identity.
- Gateway-created Harness sessions cache their cwd so direct `session.create` users do not lose the binding.
- Unknown coding-engine ids fail closed instead of silently falling through to Harness.

### 4. ND-owned task worktrees

- Harness session-list scoping accepts exact additional roots owned by `TaskWorktreeManager`; arbitrary sibling folders remain hidden.
- The same ND-owned worktree guard is installed in the shared engine router and Harness session-list boundary.
- Organization worker/reviewer turns propagate the actual task worktree root.
- Explicit ND skills are allowed inside exact ND-owned task worktrees.
- Browser access is injected once on the shared router path; the direct-Harness fallback injects it only when the router is absent.

### 5. Optional subagent policy

- `Company.subagentMode?: 'auto' | 'off'` was added as a backward-compatible field.
- New companies default to `auto`.
- Existing snapshots with the field missing behave as `auto`.
- Company UI exposes **Subagents → Auto / Off** beside Autonomy.
- The UI title explicitly states that this controls in-ticket child agents only; teams, parallel tasks, and independent review are separate.
- Worker prompts enforce:
  - `AUTO`: keep straightforward work in the main worker; delegate only when materially useful or when the explicitly selected engine requires it.
  - `OFF`: do not call subagent/delegation/swarm/child-agent tools or hand implementation to another agent.
- Delegated `codex` fails closed when Off because its implementation is `subagent_codex`.
- Direct `codex-cli` remains allowed when Off.

### 6. Focused regression suite

`package.json` now contains:

```bash
pnpm test:engines
```

It covers the engine catalog/routing path plus the session/workspace/subagent regressions added by this branch.

## Intentionally not changed

- Subagents are not promoted into organization employees, teams, tasks, leases, or independent worktrees.
- Collapse/expand UI state is renderer-local; this branch does not add persistence for disclosure state.
- The company Subagents toggle does not dynamically unload upstream Harness subagent packages from personal/interactive chat. It governs organization worker policy and engine admission.
- There is no separate `Team` subagent mode in this branch. ND teams already model organization-level task coordination/parallelism and should not be conflated with child sessions.
- MiniMax remains an interactive/chat-only route when it cannot satisfy the writable ND workspace contract; this branch does not convert MiniMax into a mandatory task engine.
- No vendor Harness source is modified.
- No performance improvement is claimed by this branch.

Reopen any item above only when the operator explicitly expands scope or validation demonstrates a correctness defect.

## Validation status

### Already established from repository/GitHub inspection

- Feature branch exists remotely and PR #57 is open.
- At the implementation head, branch was 41 commits ahead / 0 behind `main`.
- PR #57 was reported mergeable with `mergeable_state=clean`.
- No GitHub status checks or workflow runs existed on the implementation head.
- The pinned Harness source was inspected and confirms persisted session summaries expose `parentSessionId`, `origin: 'subagent'`, and child cwd inheritance.

These are repository/source facts, **not executable test results**.

### Still pending locally

- `pnpm verify`
- `pnpm typecheck`
- focused engine tests
- full unit suite
- Rust core gate
- production build
- desktop manual smoke below

Do not mark this branch ready based only on source inspection.

## Local correctness gates

Run from the repository root, in this order. Preserve the first failing output before running anything else.

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse main
git rev-list --left-right --count main...HEAD

corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test:engines
corepack pnpm test
corepack pnpm core:test
corepack pnpm build
```

If dependencies are already installed from the exact lockfile and the operator wants a no-network validation pass, record that fact and skip only the install command.

### Failure classification

- A new failure in a touched path or a new focused regression test is a branch regression until disproved.
- A failure reproduced unchanged on `main` is pre-existing; record both commands/results.
- Missing Node 24+, pnpm 11+, Rust toolchain, platform SDK, engine binary, credentials, or unavailable external service is environment/tooling unless source evidence shows otherwise.
- Do not repeatedly rerun the full suite hoping for green. Reproduce the smallest failing test first, fix only the demonstrated defect, then rerun the focused check and affected gate.

## Manual smoke

Use a disposable test company/project/workspace. Do not use production credentials or a valuable dirty checkout.

1. **Default Auto does not force subagents**
   - Create/open a company with the new Subagents control left on **Auto**.
   - Run a small ND Harness task that is clearly single-worker work.
   - Confirm the ticket has one ND task/run and does not create fake organization employees/tasks for child execution.
   - If no child is needed, the session list should remain a normal single main row.

2. **Auto child-session projection**
   - Run a task where the Harness intentionally delegates one child.
   - Confirm the child appears nested under the main session with a disclosure chevron.
   - Confirm collapse/expand does not alter task/run state.
   - Confirm a nested child can be opened/inspected as a normal session.

3. **Off keeps normal execution single-worker**
   - Change Company → Subagents to **Off**.
   - Run a normal ND Harness organization task.
   - Confirm it executes/reviews normally without child-agent delegation.
   - Confirm company team assignment, independent reviewer, and parallel task policy are unaffected.

4. **Off + delegated Codex fails closed**
   - Assign the worker to delegated engine `codex`.
   - With Subagents Off, Run must reject with the explicit delegated-Codex/subagent incompatibility.
   - Confirm no successful task-execution run receipt is invented.
   - Reassign to direct `codex-cli` (when installed/authenticated) and confirm the task can start without `subagent_codex`.

5. **Project isolation**
   - Create/open Project A and Project B.
   - Spawn a child under a Project A session.
   - Switch to Project B.
   - Confirm the Project A parent/child rows do not leak into Project B.
   - Switch back and confirm they reappear.

6. **Ordinary fork is not a subagent**
   - Create a normal session fork with lineage but no `origin: 'subagent'`.
   - Confirm it remains a normal root row and is not given the subagent chip/tree placement.

7. **Task worktree visibility**
   - Start an organization task that receives an ND-managed worktree located beside the repository.
   - Confirm the task session remains visible in the Agent sidebar despite its cwd not being a descendant of the base checkout.
   - Confirm an unrelated sibling directory is not admitted.

8. **Skills inside a task worktree**
   - From an eligible task session, invoke a known explicit ND skill such as `/review`.
   - Confirm it is accepted inside the exact ND-owned worktree and does not fail the active-workspace check.

9. **Workspace re-root protection**
   - Resume an existing task session normally and confirm it retains the same cwd.
   - Attempt a debug-only call that supplies a different cwd for that same session.
   - Confirm the router rejects it rather than silently moving the worker.

10. **Cancellation/event fan-out**
    - Start two independent task workers if the project supports parallel worktrees.
    - Cancel one run.
    - Confirm only that engine session stops and the unrelated worker remains active.
    - Confirm organization state, renderer activity and task metrics still receive the shared event vocabulary.

11. **Restart/recovery**
    - With at least one completed parent/child Harness lineage, restart ND.
    - Confirm session lineage is still readable from the runtime session list and does not become a flat set of fake organization tasks.
    - If a run is interrupted by the restart, verify the existing organization interruption/recovery behavior remains authoritative.

Record each scenario as PASS / FAIL / BLOCKED. A skipped scenario is not PASS.

## Performance evidence

This branch makes no performance claim and does not require a new benchmark baseline solely for merge readiness. If manual validation reveals a measurable sidebar/session-list regression, capture it before optimizing and use the repository's existing benchmark tooling rather than inventing a new metric.

Optional smoke only when investigating a suspected runtime regression:

```bash
corepack pnpm bench:smoke
```

Do not report an improvement/regression percentage without a reproducible before/after artifact on the same machine.

## Defect handling

1. Save the failing command and the first useful error/output.
2. Classify it as branch regression, pre-existing issue, or environment/tooling issue.
3. Reproduce it with the smallest focused check.
4. Fix only the demonstrated defect on `feat/task-run-agent-tree`; do not redesign unrelated architecture.
5. Add or strengthen regression coverage.
6. Rerun the focused check, then the affected full gate.
7. Commit using the repository's normal convention. Do not enable noisy CI or push to `main`.
8. If a fix changes an invariant documented here, update this handoff and PR #57 before declaring readiness.

## Known issues / caveats

- GitHub currently reports no status checks/workflow runs for this branch. This is expected under the project's current parked/noisy-CI posture, but it means there is no remote green badge to substitute for local evidence.
- This GPT-Web session could inspect and write the GitHub branch but could not execute the required Node/pnpm/Rust desktop toolchain. All executable gates remain pending.
- `Subagents Off` is an organization-worker policy/admission control, not a global uninstall of every upstream subagent-capable tool in interactive chat.
- The delegated `codex` engine is intentionally incompatible with Off; direct `codex-cli` is the non-delegating Codex route.
- Engine/provider authentication and installed CLI availability remain machine-specific and may make individual live-engine smokes BLOCKED; record the exact prerequisite instead of faking a pass.

## Required final report

### Branch

Report:

- branch
- final SHA
- base SHA
- ahead/behind
- PR #57 head/base and mergeable state

### Correctness gates

Report `PASS`, `FAIL`, or `BLOCKED` separately for:

- `corepack pnpm verify`
- `corepack pnpm typecheck`
- `corepack pnpm test:engines`
- `corepack pnpm test`
- `corepack pnpm core:test`
- `corepack pnpm build`

Never label an unrun command PASS.

### Manual smoke

Report each of the 11 smoke scenarios separately with PASS / FAIL / BLOCKED and one sentence of evidence.

### Performance evidence

If no performance investigation was needed, state: `Not required; no performance claim in this branch.`

If a regression was investigated, report artifact paths plus measured values and the comparison baseline.

### Defects fixed

For each fix, report:

- symptom
- root cause
- files changed
- regression test added/updated
- commit SHA

### Remaining known issues

Do not hide unrelated or machine-specific blockers.

### Merge readiness

Use exactly one factual state:

- `READY FOR MERGE`
- `NOT READY FOR MERGE`

At handoff creation the factual state is:

`NOT READY FOR MERGE`

Reason: implementation/source review is complete, but the required local correctness gates and manual smoke have not yet been recorded.
