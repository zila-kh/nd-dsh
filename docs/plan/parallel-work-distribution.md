# Parallel work distribution and specialist engineering roles

Status: **draft — folded into PRD 0002 for human review.** No tasks scaffolded, no implementation started.
Updated: 2026-09-21
Related: [`../prd/0002-rust-sidecar-mvp-migration.md`](../prd/0002-rust-sidecar-mvp-migration.md) · [`../prd-full.md`](../prd-full.md) · [`ai-company-os.md`](../ai-company-os.md) · [`phase-2-agent-company-scale.md`](phase-2-agent-company-scale.md) (P2.1, P2.2, P2.6) · [`../roadmap.md`](../roadmap.md)

This draft is now incorporated into PRD 0002 as the parallel-agent/runtime slice of the Rust Shared Core MVP. The organization semantics remain TypeScript-owned while nd-core provides the shared execution-permit/process/resource enforcement layer. It still refines the broader Phase 2 roadmap rather than replacing it. P2.1 already delivers part of the safety half of parallel work — per-task Git worktrees, branch integration with conflict refusal, review checkpoints, and task leases — but not its full target model (per-task dev-server/port/secret isolation is still unimplemented). What is missing is the **management half**: which agent receives a task, how many workers may run at once, and what shape the engineering workforce should have so that several workers of one discipline run at the same time.

## 1. Evidence from the multi-model beta round (2026-09-21)

Setup: company *Polyglot Systems* (Product / Engineering / Quality), five agents — AI PM, Builder, Builder 2, Reviewer, Researcher — autonomy 4, one provider exposing exactly three routes (`combo-free`, `combo-free1`, `combo-free-2`) with per-agent model assignment.

What worked as designed:

- A PM plan on `combo-free1` produced 14 dependency-aware tasks.
- Independent tasks executed in parallel, each in its own Git worktree ([`task-worktree.ts`](../../src/main/organization/task-worktree.ts)), two to three runs concurrently.
- Per-agent model routing held: `Builder@combo-free`, `Builder 2@combo-free-2`, `AI PM@combo-free1`, review runs on `combo-free1`.
- Review was a separate run with its own agent and route; failures returned to the owning worker.

What did not work:

- **Every engineering task was assigned to the first idle agent of its role at plan time.** `createTask` calls `pickAgent(companyId, role)` ([`store.ts`](../../src/main/organization/store.ts)), which returns the first idle agent of the hinted role: of 14 tasks, 10 went to `Builder`, 3 to `Reviewer`, 1 to `AI PM`, and `Builder 2` and `Researcher` received none. `combo-free-2` was unused until the driver manually rebalanced 4 backlog tasks to `Builder 2` and 2 documentation tasks to `Researcher`.
- Parallelism therefore existed, but **worker diversity did not** — the second route sat idle while one worker's queue serialized behind its own capacity.

## 2. Problem statement

ND's parallel unit is the task, not the agent — stated explicitly in [`orchestrator.ts`](../../src/main/organization/orchestrator.ts): *"Agent records are logical employees, not single OS worker slots. The control plane owns bounded capacity; isolated task worktrees own safety."* Consequently:

- Adding `Engineering 2/3` today buys **specialization, routing, and accountability**, not throughput. Nothing in the plan intake or the autopilot fill uses the extra agents.
- A plan that names one role concentrates that role's entire backlog on one employee, which contradicts how a real company staffs work and hides idle capacity from the operator.
- There is no way to express "two frontend engineers, one backend engineer, one DevOps" as anything other than free-text role names the PM may or may not use.

## 3. Goals

1. Distribute work across same-role agents instead of stacking it on the first idle one.
2. Let a company declare specialist engineering roles (FE / BE / DevOps / QA) whose agents run on different model routes.
3. Give operators bounded capacity control per role or per team, not only the current global autopilot cap.
4. Keep the subagent boundary explicit: subagents are tactical fan-out inside one task, never organisational identity.

### User stories

- As a company owner, when three engineers share a role, plan tasks are spread across them so two or more progress at once.
- As an owner, I can define a Frontend Engineer role with its own prompt, skills, and default model, and staff it with two agents on different routes.
- As an operator, I can cap a role or team (for example "at most 2 concurrent DevOps tasks") so parallelism stays inside my budget and review capacity.
- As a reviewer of ND's evidence, I can see which employee executed which task on which route without reading worktrees.

## 4. Proposed design

### D1 — Assignment and distribution policy

Replace first-idle with a distribution policy applied at task creation and re-evaluated by the autopilot fill:

- **least-open-work** (recommended default): among agents of the hinted role, pick the one with the fewest unfinished tasks; tie-break by creation order for determinism.
- **round-robin** as an explicit alternative for teams that want strict rotation.
- **pinned**: a plan may name a specific employee for ownership-heavy work; the PM prompt already receives the roster.
- **operator rebalance**: `task.update { assignedAgentId }` already exists and stays the manual override (used successfully during the beta round).

The same policy must cover **review assignment**: `pickAgent(companyId, 'review')` is first-idle today, so two or three reviewers would not rotate either.

Distribution must not change the dependency graph, worktree isolation, or review ownership. Reassigning a task that is already `in_progress` or `review` should be rejected rather than silently moved.

### D2 — Specialist roles and agents

Keep the existing separation, which already supports this:

- **Role** = discipline (`role.create` carries responsibility, systemPrompt, skillIds, and default provider/model).
- **Agent** = an employee of that discipline with its own model route and session history.

Seed optional FE / BE / DevOps / QA roles when a company is created, and teach the PM plan prompt to use them as role hints (it already lists available roles, so the hint path exists). No engine-specific fields enter the organization state machines.

### D3 — Capacity: extend the existing budget instead of inventing a new cap

A capacity gate already exists and is enforced in [`control-plane.ts`](../../src/main/organization/control-plane.ts): the company/project budget carries `maxParallelWorkers` (**default 2**), `dailyTurnLimit`, and `dailyCostUsd`, and every explicit run request passes through `assertRunnable` before dispatch. `MAX_AUTOPILOT_PARALLEL_FILL = 16` is only the fill loop's iteration bound, not the product cap.

Two extensions are needed for a real project shape (for example 3 BE, 4 FE, 1 UX, 3 reviewers):

- **Per-role and per-team pools.** `maxParallelWorkers` is one pool for the whole project and counts every running run that owns a task — executions *and* reviews — so reviewers compete with builders for the same slots. Add optional per-role/team limits alongside the existing budget fields.
- **A distinct review pool.** Verification capacity should be configurable separately, because a review backlog starves delivery just as a worker backlog does.

Enforcement must be consistent across both dispatch paths (see G1 in §9): today the IPC path consults the control plane, the autopilot fill does not.

### D4 — Subagent boundary (unchanged, documented)

Subagents stay inside a single worker's task for breadth — the harness exposes native delegation, and the Codex engine already routes implementation through `subagent_codex` ([`coding-engines.ts`](../../src/shared/coding-engines.ts)). Subagents carry no org identity, no model assignment in Settings, and no durable audit trail, so they must never stand in for employees; the extension surface for `subagent` is a capability, not a roster.

## 5. Non-goals

- Replacing per-task worktrees, branch integration, or the review checkpoint (P2.1 owns those).
- Auto-scaling agent count from backlog pressure, or an agent marketplace.
- Cross-company or cross-project pools; company isolation stays absolute.
- Any provider- or engine-specific behaviour in assignment logic.

## 6. Acceptance criteria

This is the single authoritative list; §9's grilling findings feed it and must not be restated elsewhere.

Assignment and distribution:

- [ ] With two idle agents of one role, a PM plan of N independent tasks assigns neither agent more than `ceil(N / 2)` (unit test over the store).
- [ ] A single-agent company produces identical assignment behaviour to today's first-idle policy (no behavioural regression).
- [ ] Reassigning a task that is `in_progress` or `review` is rejected.
- [ ] The existing beta round driver (`e2e/beta-multimodel.mjs`) exercises every configured route without the manual rebalance step.

Execution, capacity, and verification:

- [ ] Autopilot never exceeds the configured `maxParallelWorkers` (regression test that fails on today's bypass — see G1).
- [ ] Per-role caps hold under autopilot: with two FE agents capped at one each, a third FE task waits while a BE task proceeds.
- [ ] Review capacity is configurable separately from execution capacity, and a full review pool does not stall executions.
- [ ] Autopilot 4 starts two ready tasks owned by different agents concurrently, each with its own worktree, and both appear as `running` in the snapshot.
- [ ] Every task's execution route (provider + model) is readable from its run evidence, and no task executes on a route other than its assigned agent's.
- [ ] Reviewers rotate, and a reviewer never shares a model route with the worker whose work it verifies.

Conflicts and non-code work:

- [ ] Two builders whose tasks touch the same file either avoid dispatch together (scope-aware planning) or resolve through conflict-aware rework without exhausting all three attempts.
- [ ] A non-code specialist task cannot be marked complete on a code-only evidence path.

## 7. Risk tier and rollback

**Risk tier: Medium.** Assignment logic touches the hot path of every plan and every autopilot fill, and a bad policy can starve a worker or thrash assignments.

- Rollback: keep first-idle as a selectable policy and ship least-open-work as the default behind one policy value, so reverting is a setting change rather than a code revert.
- Caps fail open when misconfigured (unknown role, zero agents) rather than deadlocking a project.
- Reassignment of in-progress or in-review tasks is rejected, so a policy bug cannot move work out from under a running session.

## 8. Open questions for review

1. Should the distribution policy live on the company (uniform) or on the project (per-deliverable)? Company-level is simpler; project-level matches how real teams differ per initiative.
2. Should review assignments rotate across reviewers, and should a reviewer ever share a route with the worker it verifies? The beta round deliberately kept review off both builder routes.
3. Is a per-role cap owned by policy (`policy.set`) or by the team record? Policy already has the main-process gate and audit receipts.
4. How should caps interact with branch integration when completed worktrees compete for the same files (see G3's conflict-aware rework)?
5. Should the PM be allowed to pin employees by name, or only by role, to keep plans portable across companies?

## 9. Grilling — adversarial review of this draft

Pressure-tested against the real-world shape *3 BE + 4 FE + 1 UX + 2–3 reviewers, parallel where independent, ordered where dependent*. Verdicts are evidence-based, from code inspection on 2026-09-21.

### What holds (verified in code)

| Requirement | Evidence | Verdict |
| --- | --- | --- |
| Independent tasks run in parallel | `fillParallelReadyTasks` starts ready tasks concurrently, each in its own worktree | Holds |
| Dependent tasks wait for order | `refreshProject`: a backlog task becomes `ready` only when every `dependsOn` task is `completed` ([`store.ts`](../../src/main/organization/store.ts)) | Holds |
| Work cannot silently corrupt the base checkout | `integrate()` merges `--no-ff`, refuses to merge over human/uncommitted changes, aborts on conflict and leaves the task branch intact | Holds — stronger than the AWS sample, which relies on "do not edit outside your scope" convention and has no worktrees |
| Review is real verification | Reviewer prompt forbids assuming success; a red machine check cannot be overridden by prose; `assertUnchanged` voids a review if the worktree moved after the checkpoint | Holds |
| Bounded rework | `MAX_EXECUTION_ATTEMPTS = 3` with autonomy ≥4 auto-rework, then the task blocks | Holds — comparable to the AWS sample's 3-cycle PASS/FAIL budget |
| Specialist agents with distinct routes | Roles carry prompt/skills/default model; agents carry their own `providerId`/`modelId` | Holds — richer than the AWS sample's TOML agent files |

### Findings (gaps this draft must close)

**G1 — Two capacity authorities, only one enforced.** `assertRunnable` gates the IPC paths (`internal.plan`, `task.execute`, `task.review`, `workflow.continue`), so an operator-set `maxParallelWorkers` binds explicit runs. The autopilot's `fillParallelReadyTasks` calls the orchestrator directly, and the orchestrator holds no control-plane dependency (`assertPolicy` only handles allow/ask/deny) — so automatic parallelism is bounded by the fill loop's 16 and worktree assertions, not by the configured budget. An operator who sets `maxParallelWorkers: 2` cannot rely on it during autopilot. *Fix: route the fill through `assertRunnable` and let a `wait` decision end the fill round.*

**G2 — One shared pool for builders and reviewers.** The `maxParallelWorkers` count includes every running run that owns a task, reviews included. With 7 builders and 3 reviewers on one project, reviews and builds compete for identical slots, and the default of 2 means a real project runs two workers total. *Fix: D3's per-role pools plus a distinct review pool.*

**G3 — No file-scope partitioning at plan time.** The AWS sample partitions work into "file-disjoint waves" before spawning, which is why its agents rarely collide. ND plans by dependency only, then discovers collisions at integration. With 7 builders on one repository, merge conflicts are the expected failure mode; each conflict fails the review, consumes an execution attempt, and after three attempts blocks the task for explicit operator action. *Fix: an advisory file/scope field on plan tasks, and conflict-aware rework (rebase or re-plan) instead of a blind retry of the same change.*

**G4 — UX and other non-code specialists have no evidence contract.** The execution path is code-shaped: worktree, project test command as machine verification, merge-back integration. A UX task producing design specs, tokens, or ND Pencil artifacts has no way to satisfy "verification" or "integration", and `.op` files are explicitly not production source. *Fix: either declare UX out of scope for this increment, or define a design-artifact verification contract (artifact path + human acceptance) rather than pretending a test command covers it.*

**G5 — Reviewer independence is a convention, not a rule.** Nothing prevents two reviewers sharing one route, or a reviewer running on the same route as the worker whose code it verifies. The beta round kept review off the builder routes by operator choice. *Fix: make route diversity a review-assignment constraint, and rotate reviewers (D1).*

**G6 — Worktree cost is unaccounted.** Every parallel task gets a full checkout with disposable directories (`node_modules`, `dist`, caches) excluded. Seven concurrent builders each installing dependencies and running suites is a real CPU/disk/network cost with no per-worktree budget or measurement. *Fix: measure it in the acceptance test, and surface it in the budget card.*

**G7 — "Leases" exist but are not the concurrency mechanism.** Active leases cause a `wait` route, yet the autopilot fill path never consults them (same root cause as G1). The draft should not imply leases bound parallelism until G1 is fixed.

### What the AWS sample has that is worth copying

1. **Explicit pools with caps per discipline** (coding ≤6, devops ≤2, review ≤4, sa ≤1) — maps onto D3, but ND should keep one budget surface rather than a second config system.
2. **File-disjoint waves before dispatch** — maps onto G3.
3. **A terminal cycle budget** (3 PASS/FAIL, then BLOCKED, never cycle 4) — ND already has this as `MAX_EXECUTION_ATTEMPTS`; no change needed.

### What ND should not copy

Its coordination model — repo-local spec files, prompts, and main-thread consolidation, explicitly with no shared task database — is weaker than ND's durable organization store, dependency graph, review verdicts, and integration evidence. ND should keep its store as the authority and treat spec files, if adopted, as artifacts rather than coordination state.

### Acceptance criteria added by the grill

Folded into §6 (capacity, conflict, and non-code items). Do not restate them here; update §6 instead.
