---
id: "0003"
title: "Engine-Neutral Agent Teams and Task Workspace Isolation"
status: approved
last-audit: 2026-09-22
approved: 2026-09-22
---

# Product Requirement Document (PRD): Engine-Neutral Agent Teams and Task Workspace Isolation

## 1. Context

ND-DSH is the company/control plane. ZCode, Codex, Claude Code, Cursor, Antigravity, Pi, ND Harness, and future coding products are replaceable execution engines.

PR #21 ("feat: land the shared workspace for tasks 0004-0009") is a useful reference incident, but it was **not** produced by ND's organization runner. The work was performed while using ZCode directly. One physical checkout accumulated uncommitted output belonging to multiple independently tracked tasks, so task ownership existed in planning/documentation but not at the Git transaction boundary.

That incident demonstrates a general requirement:

> A coding-engine session is not a task transaction. ND must supply durable task ownership, workspace isolation, checkpoint, verification, review, and integration semantics around every engine.

ND already has substantial protection through TaskWorktreeManager, task leases/capacity, checkpoint commits, machine verification, independent review, rollback, and fail-closed integration. This PRD formalizes those guarantees as an engine-neutral contract and extends them to teams/subagents.

## 2. Goals

1. Make one independently completable writable ND task the default transaction/isolation unit.
2. Keep team coordination, task ownership, engine sessions, and filesystem isolation as separate concepts.
3. Preserve one ND control-plane model across all coding engines.
4. Bind every writable organization run to an inspectable task, lease, execution workspace, engine session, baseline, and checkpoint lineage.
5. Permit parallel execution without allowing one task's rollback, cleanup, or failed attempt to destroy another task's output.
6. Let read-only research/review subagents share context cheaply while keeping a single-writer rule for mutable task workspaces unless child isolation is explicit.
7. Add team communication/handoff semantics without requiring team members to share one dirty checkout.
8. Preserve centralized ND authority for verification, review, integration, dependencies, and task completion.
9. Reuse existing ND worktree/runtime infrastructure instead of building a second isolation system.
10. Keep comparative benchmark/reference research against relevant open-source systems.

## 3. Non-goals

- Do not make "agent = worktree" a domain invariant.
- Do not force every interactive chat into a worktree.
- Do not recreate vendor-native team systems.
- Do not make every subagent an ND employee or durable task.
- Do not require one OS process or VM per task when a shared engine service is safe.
- Do not automatically resolve unknown merge/semantic conflicts.
- Do not treat declared file scopes as a security boundary.
- Do not move organization/business truth into Rust.
- Do not replace TaskWorktreeManager; extend/formalize it.

## 4. Product model

ND owns:

~~~text
Company
Project
Goal
Task graph
Team
Employee assignment
Lease
Execution workspace
Dependency state
Verification
Review
Integration
Memory
Human attention
~~~

Engines execute implementation/research/analysis/tool use/tests/review evidence.

Core rule:

> **Teams share knowledge. Independent writable tasks do not share uncheckpointed writable state.**

### 4.1 Project workspace

The canonical user checkout/repository attached to the project.

### 4.2 Execution workspace

The environment/directory in which one execution lane is permitted to operate. Initial kinds: git-worktree, shared-readonly, sandbox, remote.

### 4.3 Task workspace

An execution workspace durably bound to one ND task. For Git-backed software tasks this normally means an ND-created worktree/branch.

### 4.4 Team

A durable coordination grouping across multiple employees/tasks contributing to one objective. Team membership does not imply a shared mutable filesystem.

### 4.5 Engine session

The vendor/runtime execution context. A writable organization engine session is bound to one execution workspace for its lifetime unless ND performs an explicit transfer/recovery action.

### 4.6 Subagent

A tactical worker delegated beneath a task/session. It has no independent authority over ND task state unless ND promotes its work into another durable task.

## 5. Core invariants

For every writable organization run ND must be able to answer:

~~~text
Which task is this?
Who owns the lease?
Which engine/session is executing?
Which workspace may mutate?
Which commit did the attempt start from?
Which checkpoint is under verification/review?
Which changes belong to this task?
Can this task be rolled back independently?
~~~

Required binding:

~~~text
Task
  <-> Lease
  <-> ExecutionWorkspaceBinding
  <-> Engine Session
  <-> Attempt baseline
  <-> Checkpoint
~~~

A task may change employee or engine without losing its workspace/checkpoint lineage.

## 6. Workspace policy

| Work type | Default |
| --- | --- |
| Read-only research | shared/read-only |
| Read-only architecture/review | shared/read-only or frozen task checkpoint |
| One writer for one durable task | isolated task worktree |
| Independent writable tasks | distinct task worktrees |
| Multiple writers inside one task | serialize, or explicit child isolated workspaces |
| High-risk/destructive experiment | worktree or stronger sandbox |
| Different dependency/runtime environment | sandbox/remote workspace |
| Non-Git artifact task | artifact-specific isolated execution/evidence contract |

File-scope analysis remains useful for scheduling and integration risk, but it does not replace task transaction isolation.

## 7. Engine-neutral session binding

The common direct workspace-engine boundary must enforce:

1. a writable organization session starts with the exact ND task workspace root;
2. that root is immutable for the session unless an explicit ND transfer/recovery action occurs;
3. a later turn cannot silently re-root the same session to the base checkout;
4. runtime/app-server restart may resume the vendor session, but ND's workspace binding remains authoritative;
5. run evidence records engine id, engine session id, task id, workspace identity, baseline/checkpoint, and runtime permit where available.

### 7.1 ZCode

ND may keep one long-lived ZCode app-server and host many isolated task sessions inside it:

~~~text
one ZCode app-server
      |
      +-- session A -> task worktree A
      +-- session B -> task worktree B
      +-- session C -> task worktree C
~~~

Isolation must not imply one ZCode process per task.

### 7.2 Engine failover

A retry/failover may change engine while preserving ND task lineage:

~~~text
Task T42
  attempt 1 -> ZCode -> transient failure
  rollback to known boundary
  attempt 2 -> Codex
  same ND task/workspace lineage
~~~

Vendor session state supports execution; it is not authoritative task truth.

## 8. Task execution lifecycle

~~~text
planned
 -> ready
 -> leased
 -> workspace-preparing
 -> executing
 -> checkpointed
 -> verifying
 -> review
 -> merge-queued
 -> integrating
 -> done
~~~

Alternative exits include failed/retry, canceled, rework, integration-conflict, and blocked.

Worker completion is not task completion:

~~~text
worker finishes mutation
 -> ND checkpoint
 -> ND verification
 -> independent review when configured
 -> ND integration
 -> ND marks task done
~~~

Workers/subagents return evidence. ND owns dependencies, lease/version, verification state, review state, integration state, and project completion.

## 9. Subagent and team rules

Safe same-task default:

~~~text
Task T
  researcher   read-only
  architect    read-only
  implementer  writer
  reviewer     read-only
~~~

One mutable task workspace can support this while there is only one writer.

If two lanes need independent write authority, ND must serialize them or provide explicit child isolation.

Teams coordinate multiple tasks and may exchange structured events such as progress, blocker, interface-change, artifact-ready, handoff, review-request, and dependency-unblocked. The first implementation does not require a general-purpose agent chat product.

## 10. Scope/conflict policy

Declared scopes are scheduling hints. Separate task workspaces remain the default even for apparently disjoint files.

Low expected overlap may run concurrently. High overlap may be serialized or require an explicit shared-interface contract. Scope hints do not become a security boundary.

## 11. Integration queue

Verified outputs enter an authoritative integration queue. Before integration ND checks the exact reviewed checkpoint, base cleanliness, mergeability, whether base advanced, and verification freshness required by policy.

A merge conflict is an integration-conflict, not automatically an engine failure. Preserve the task branch and route to rebase/replan/contract update/human decision rather than repeatedly spending the same execution retry budget.

## 12. Destructive Git operations

reset --hard, clean, worktree removal, branch deletion, and restore-over-modifications are allowed automatically only when ND can prove the target is an ND-owned isolated workspace with a known recovery boundary.

They must never be applied to a dirty human/base checkout as part of automatic retry or cleanup.

## 13. Durable state vs Git

~~~text
Git/source truth:
  code
  task branch
  checkpoint
  diff

ND organization truth:
  task status
  employee/lease
  dependency graph
  workspace binding
  run receipts
  verification
  review
  integration state
~~~

Markdown task/roadmap files are useful reviewed/exported records, but live company truth must not exist only as uncommitted documentation in a working tree.

## 14. UI requirements

Task details should expose employee, engine, isolation mode, branch, baseline/checkpoint, verification, and integration state. Worktree filesystem paths can remain advanced details.

Team view should prioritize outcome:

~~~text
Taxi MVP
5 active - 2 blocked - 3 complete

Rider       T002 running
Driver      T003 review
Backend     T004 running
Realtime    T005 complete
Payments    T006 blocked
~~~

## 15. Reliability acceptance criteria

### Isolation/provenance

- Two writable ND tasks in one Git project receive distinct task workspaces.
- This holds for two ZCode tasks and for mixed engines.
- One task rollback cannot modify another task workspace or the human base checkout.
- Every writable run records task/employee/engine-session/workspace binding.
- Reassignment does not change task workspace lineage.
- Review binds to an exact checkpoint commit.

### Engine binding

- An organization session cannot silently move to a different workspace.
- A ZCode app-server restart can resume without losing ND task/workspace binding.
- Multiple ZCode task sessions can share one app-server while using distinct worktrees.

### Verification/review

- Engine-reported success is insufficient for task completion.
- Verification runs against the exact task checkpoint/workspace.
- Reviewer/tooling mutation after checkpoint is detected.

### Integration/recovery

- Dirty human base work pauses integration.
- Merge conflicts preserve the task branch and enter explicit conflict handling.
- Interrupted runs never become completed tasks.
- Retry starts from a known boundary.
- Existing task worktrees/checkpoints are recoverable after restart.

## 16. Performance/scale requirements

Isolation must not duplicate the entire runtime stack.

Target:

~~~text
1 project
1 nd-core
1 shared long-lived engine service where supported
N logical sessions
N Git worktrees for N concurrent writable durable tasks
~~~

Benchmark 1/2/4/8/10 task sessions, worktree create/recovery latency, disk delta, shared process count, incremental memory, checkpoint/verification/integration overhead, cancellation cleanup, conflict/rework cost, and human attention.

Comparative references and future benchmark questions live in [agent-orchestration-reference-matrix.md](../plan/agent-orchestration-reference-matrix.md).

## 17. Implementation workstreams

1. Formalize execution-workspace binding around existing TaskWorktreeManager.
2. Harden engine-session cwd binding at the common router/direct-engine boundary.
3. Persist task/lease/workspace/session/baseline/checkpoint provenance.
4. Add lightweight team coordination state/events above the task graph.
5. Define subagent writer authority and enforce a single-writer default.
6. Make integration conflict first-class rather than generic retry.
7. Expose workspace/checkpoint/engine provenance in task/team UI.
8. Add the PR #21 regression scenario: five independent tasks in one repository remain five independently recoverable transactions.
9. Add comparative benchmark/research updates against the maintained reference set.

## 18. Reference architecture decision

ND deliberately combines ideas rather than cloning one system:

- workspace UX from Orca;
- explicit scope/handoff discipline from AWS sample-codex-agent-team;
- leader/control-plane checkpoint authority from Gajae Code;
- team-vs-subagent distinction from LazyCodex;
- task/control-plane/atomic ownership concepts from Paperclip;
- durable worker identity/messaging/isolation concepts from QM;
- repository-owned performance proof discipline inspired by jcode.

See [agent-orchestration-reference-matrix.md](../plan/agent-orchestration-reference-matrix.md).

## 19. Implementation status

Approved on 2026-09-22. The implementation is carried by `feat/engine-neutral-agent-teams` and deliberately extends the existing task-worktree/control-plane path rather than creating a second scheduler.

Implemented surfaces:

- organization run provenance now records engine, workspace kind/root/branch, baseline, checkpoint and runtime permit identity;
- direct engine sessions have an ND-owned immutable workspace binding and fail closed if an adapter reports a different cwd;
- ZCode keeps one app-server while multiple native sessions retain distinct task workspaces; restart/resume keeps the session workspace;
- organization state carries structured team/task coordination events and explicit integration pending/integrated/conflict state;
- integration conflicts preserve the task branch/checkpoint and route to explicit rework instead of generic stale retry;
- Company task/run UI exposes engine, workspace kind, task branch, baseline/checkpoint and integration-conflict provenance;
- regression coverage proves five writable tasks in one repository remain independently rollbackable;
- mixed-engine contract coverage proves Codex/ZCode task sessions retain distinct ND worktree roots;
- the existing `scheduler-multi-agent` benchmark already records 1/2/4/8/10 workers, core/child memory, permit latency, process/workspace counts and worktree disk growth;
- the maintained external reference/benchmark set remains in [agent-orchestration-reference-matrix.md](../plan/agent-orchestration-reference-matrix.md).

Verification remains governed by repository CI and the separate full performance-evidence policy; approval of this PRD does not turn an unrun external-engine benchmark into a performance claim.

## 20. Rollback

This work is additive around current organization/worktree execution. If new team coordination or extended binding regresses behavior, disable the new fan-out and fall back to current dependency-aware scheduling while preserving per-task worktrees and recorded evidence. Never fall back to one shared dirty checkout for independent writable company tasks.
