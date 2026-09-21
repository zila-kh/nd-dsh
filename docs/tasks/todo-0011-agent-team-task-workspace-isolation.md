# Task 0011 — Engine-neutral teams and task workspace isolation

> PRD: [PRD-0003](../prd/0003-engine-neutral-agent-teams-and-task-workspace-isolation.md)  
> Priority: P1  
> Status: todo  
> Owner: unassigned  
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

- [ ] Add/confirm durable run evidence linking task, lease, employee, engine, engine session, workspace, baseline and checkpoint.
- [ ] Define an engine-neutral execution-workspace binding shape.
- [ ] Ensure writable organization sessions cannot silently change workspace roots on a later turn.
- [ ] Preserve the binding through engine/app-server restart and recovery.

### 2. ZCode multi-task proof

- [ ] Run two concurrent ND tasks through one ZCode app-server and distinct task worktrees.
- [ ] Prove each task can checkpoint/rollback independently.
- [ ] Prove restarting the ZCode app-server does not lose ND's task/workspace binding.
- [ ] Record process count, memory delta and workspace disk delta.

### 3. Mixed-engine proof

- [ ] Run at least two concurrent writable tasks in one project through different engines.
- [ ] Prove both still follow the same checkpoint/verification/review/integration semantics.
- [ ] Prove task reassignment/failover does not silently switch to the base checkout.

### 4. Team/subagent authority

- [ ] Add the minimum durable team/member/task coordination state.
- [ ] Define structured progress/blocker/interface-change/handoff events.
- [ ] Keep ND as task/checkpoint/integration authority.
- [ ] Enforce single-writer-by-default inside one task workspace unless child isolation is explicit.

### 5. Integration conflict state

- [ ] Treat merge conflict as integration rework/replan, not the same as engine execution failure.
- [ ] Preserve successful task evidence/checkpoint while conflict is resolved.
- [ ] Avoid spending the normal engine retry budget on an unchanged stale-base conflict.

### 6. UI provenance

- [ ] Task details show employee, engine, workspace isolation, branch, baseline/checkpoint and verification/integration state.
- [ ] Team view summarizes active/blocked/review/complete work without requiring users to reason about worktree paths.

### 7. Regression + benchmark

- [ ] Five independent writable tasks in one repository produce five independent task transactions.
- [ ] Rolling back/cleaning/canceling one cannot change another task or the human base checkout.
- [ ] Record 1/2/4/8/10 task-session scaling.
- [ ] Keep reference/competitor observations and future comparisons in [agent-orchestration-reference-matrix.md](../plan/agent-orchestration-reference-matrix.md).

## Acceptance

- Independent durable writable tasks never rely on one shared dirty working tree for transaction provenance.
- Teams can coordinate without sharing uncheckpointed mutable state.
- ZCode, Codex and future engines remain adapters; no vendor concept leaks into task/team domain truth.
- Existing task worktree safety remains intact.
- Performance claims are accompanied by repository-owned benchmark evidence.
