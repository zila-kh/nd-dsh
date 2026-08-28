# ND-DSH Beta v1 Improvement Plan

Status: implementation plan · revised 2026-08-28
Branch: `feat/improve-beta-v1`

Evidence base: three completed end-to-end acceptance runs (Todo Beta, Tic-Tac-Toe Beta Acceptance, Kla-Klok Khmer Dice Game) plus a code-level reconciliation against current `main` (`6683eb0`). The original proposal correctly identified the product bottlenecks, but several reliability/parallelism primitives were implemented after the measurements were taken. This revision treats those primitives as the baseline and focuses the beta gate on the missing safety boundaries.

---

## 1. Product goal

AI-era software delivery should be limited by useful model work, not by ND orchestration dead time, wedged sessions, provider outages, unsafe retries, or manual demo handoff.

Measured baseline from the acceptance runs:

| Measured (Kla-Klok, 8 tasks) | Duration |
|---|---:|
| PM plan | ~20 s |
| Task execution (healthy) | 5–12 min (one 23 min outlier) |
| Independent review | 1–3 min |
| Phase auto-chain gap | ~1 min |
| Provider 502 outage penalty | ~60 min lost |

Beta target:

- A provider/session failure never leaves the project in an unknown workspace state.
- A user can cancel one organization run without stopping unrelated workers.
- Autopilot retries only from a known attempt boundary and only within a bounded policy.
- Machine-verifiable checks are owned by ND, not inferred from reviewer prose.
- Parallel execution is limited by explicit worker capacity and isolated worktrees.
- Existing functionality is reused instead of rebuilt.

---

## 2. Current baseline — already implemented

The following items from the original proposal already exist on current `main` and must be preserved:

### 2.1 Isolated task worktrees and task checkpoints

`TaskWorktreeManager` already:

- creates deterministic per-task Git worktrees,
- bootstraps a truly empty project directory as Git,
- checkpoints worker results into task commits,
- verifies that review did not mutate the checkpoint,
- integrates verified task branches without auto-resolving merge conflicts,
- refuses to merge over dirty human/local changes.

Therefore the beta task is **not** “add task commits”. The missing boundary is **attempt rollback before retry/failover**.

### 2.2 Parallel task filling

The orchestrator already:

- permits concurrent isolated task execution/review,
- fills multiple ready tasks in Autopilot,
- rejects unsafe parallel work when worktree isolation is unavailable.

The remaining limitation is that a company normally has one Builder agent and the same agent cannot own two active tasks. Raising `DEFAULT_MAX_PARALLEL_WORKERS` alone does not create useful parallelism.

### 2.3 Cancellation primitives

Harness supports `session.cancel`; Codex supports stopping an individual session internally. Organization event handling already understands canceled runs.

The missing product primitive is **organization run-specific cancellation routed to the engine that owns that session**, exposed over organization IPC/UI.

### 2.4 Review integrity evidence

The control plane already fingerprints exact task worktree state and invalidates stale review evidence.

That proves source integrity, but it does **not** prove tests/build/runtime checks passed. Beta needs a separate machine-verification receipt.

### 2.5 Project runtime

The project runtime service already owns:

`validate workspace → start command → health poll → target ready → browser handoff`

This is the base for the later `demo-verify` flow; do not build another dev-server manager.

---

## 3. Beta gate P0 — reliability before external users

### P0.1 Run-specific cancel and lease release

**Goal:** one wedged task must never block unrelated organization work.

Required behavior:

1. Add `organization.cancelRun(runId)`.
2. Resolve the active run and its owning engine/session.
3. Cancel only that session/turn.
4. Mark the run failed/canceled through the existing event path.
5. Release agent ownership and task lease through reconciliation.
6. Leave other task worktrees/runs untouched.
7. Cancellation is idempotent: canceling an already-finished run is a no-op/error with a clear message, never a global stop.

### P0.2 Attempt-bound recovery boundary

A post-execution checkpoint is too late for safe retries. Every task execution attempt must begin from a known Git state.

For isolated Git worktrees:

```text
attempt start
  ↓
record attempt baseline HEAD
  ↓
run agent
  ├─ success → checkpoint result → review
  └─ cancel/engine/provider failure
        ↓
      reset --hard baseline
      clean generated untracked files for this worktree
        ↓
      bounded retry/failover
```

Rules:

- Never reset the real/base project checkout.
- Never destroy human/local dirty changes.
- Retry only inside ND-owned task worktrees.
- Preserve the failed run receipt and error for observability.
- Review failures are **rework**, not rollback: the reviewed checkpoint is useful evidence and should remain available to the next attempt.

For non-Git existing workspaces, beta should fail closed instead of pretending snapshots exist. ND may auto-initialize Git only for a truly empty workspace until a dedicated safe baseline-import flow is implemented.

### P0.3 Bounded automatic retry

Autopilot retry policy:

- execution engine/provider failures: up to 3 total execution attempts per task,
- review failures: existing bounded rework policy remains,
- cancellation by user: never auto-retry,
- deterministic workspace/integration errors: do not spin; surface the blocker,
- backoff for transient engine/provider errors: short bounded delay, never an hour-long lease wait.

A retry must call P0.2 rollback before redispatch.

### P0.4 Stall detection

A running organization task needs a heartbeat independent of model prose.

Track at minimum:

- last engine/session event,
- last workspace mutation/fingerprint change when available,
- run start time.

When there is no meaningful progress for the configured stall window:

1. mark the run as stalled in management state,
2. cancel the owning session,
3. rollback the attempt worktree,
4. retry only if bounded retry policy permits,
5. otherwise block the task with a concrete reason.

Do not use the 30-minute task lease as a stall detector.

### P0.5 Provider resilience via route policy

Do not overload `ModelProvider` into a failover abstraction. Keep it as one configured provider endpoint and add an execution route/profile above it.

Target model:

```text
Role / Agent
  ↓
Execution profile
  ↓
ordered routes
  1. provider A / model strong
  2. provider B / model strong
  3. provider C / model fallback
```

Required behavior:

- fail over only on retryable transport/provider failures (5xx, unreachable, empty/aborted stream class),
- never silently fail over authentication/permission/configuration errors,
- each failover is a **new attempt after rollback**, not continuation from partial files,
- record which route each attempt used,
- role-specific routing remains supported; reviewers can use cheaper/faster models than builders.

Beta can ship with a simple ordered route list; adaptive routing is not required.

### P0.6 Machine verification evidence

Separate two evidence classes:

**Integrity evidence** (already mostly implemented)

- Git HEAD,
- changed files,
- exact fingerprint,
- stale/verified state.

**Verification evidence** (beta addition)

- command/suite id,
- working directory/worktree,
- started/completed timestamps,
- exit code/status,
- duration,
- bounded stdout/stderr summary,
- optional runtime/browser result.

Acceptance rule:

- deterministic configured checks are a hard gate when available,
- independent reviewer evaluates semantic correctness and requirements,
- reviewer prose cannot override a red machine check to PASS,
- reviewer false negatives against green machine evidence can be surfaced/reworked without losing the machine receipt.

---

## 4. Beta speed P1 — after P0 is green

### P1.1 Worker-pool capacity

Do not create fake permanent employees merely to gain concurrency. Add execution capacity to roles/teams or an equivalent worker-slot abstraction.

Example:

```text
Engineering
  Software Engineer
    capacity: 3
```

Scheduler requirements:

- one logical role may own multiple ephemeral worker slots,
- each slot still gets isolated task/session/worktree ownership,
- `maxParallelWorkers` remains the control-plane ceiling,
- effective concurrency = minimum of budget capacity, role/team capacity, ready dependency-safe tasks, and safe engine capacity.

Start beta defaults conservatively at 2; allow explicit 3–4.

### P1.2 Dependency-aware PM planning

Planner prompt should minimize fake serialization:

- use `dependsOn` only for real data/code ordering,
- tests, docs, i18n, accessibility, fixtures, and independent components should remain parallel when safe,
- validate dependency references and reject cycles.

### P1.3 Immediate phase chaining

Remove residual polling-style handoff where possible. Completion events should enqueue the next eligible execution/review immediately, targeting <10 s orchestration gap.

### P1.4 Native phase timeline

Work tab should expose:

- queued/start/end timestamps,
- execution/review duration,
- retry/failover route,
- stall/cancel reason,
- verification duration,
- idle orchestration gap.

---

## 5. Real-world workflow P2 — post beta gate

### P2.1 Project bootstrap run

Do **not** make `project.create` clone/install/scaffold synchronously. Keep creation as a fast durable state mutation and dispatch a cancellable/retryable `project-bootstrap` run:

```text
project.create
  ↓
project-bootstrap
  ├─ workspace preflight
  ├─ clone repo / apply starter template
  ├─ detect language/package manager
  ├─ install dependencies when policy allows
  ├─ establish Git baseline
  ├─ detect test/start commands
  └─ persist runtime profile
```

### P2.2 New-project parallel lanes

Once bootstrap has produced a safe workspace, start parallel lanes:

1. PM lane — plan milestones/tasks.
2. Design lane — Designer drives ND Pencil and emits design references.
3. Scaffold lane — starter technical foundation/CI/test harness where it does not conflict with bootstrap.

Design references are soft dependencies by default; UI tasks may opt into a `design-ready` gate.

### P2.3 Existing-project intake

Add a repo intake/profile step:

- structure/language/package manager,
- test/lint/typecheck/build commands,
- start command/target URL/health path,
- architecture map and known risks,
- backlog seed.

### P2.4 Delivery Cycle (Sprint) model

Use a lightweight AI-native Delivery Cycle rather than requiring calendar sprints:

`intake → plan → parallel build → integrate → demo → retro`

Default capacity can be a fixed task/turn budget. Calendar duration is optional metadata.

### P2.5 Automated demo handoff

Build `demo-verify` on the existing `ProjectRuntimeService`:

1. start/check runtime,
2. wait for healthy target,
3. open embedded browser,
4. capture runtime/browser evidence,
5. generate release notes from integrated task receipts,
6. present demo sign-off card,
7. require approval at lower autonomy; allow configured Autopilot completion at level 4.

---

## 6. Observability and external automation

Post-P0/P1 additions:

- streaming run output in Agent console,
- turn/cost accounting per task/project,
- execution route/attempt history,
- loopback telemetry endpoint for E2E/automation consumers instead of scraping renderer internals,
- verification receipts visible from task details.

---

## 7. Shipping order

### Beta gate — must be green before broad external beta

1. P0.1 run-specific cancel
2. P0.2 attempt rollback
3. P0.3 bounded engine/provider retry
4. P0.4 stall detection
5. P0.5 ordered provider failover
6. P0.6 machine verification evidence

Existing worktree checkpoint/integration and review-integrity evidence are retained and tested as regression coverage.

### Beta speed follow-up

1. P1.1 worker-pool capacity
2. P1.2 dependency-aware planning
3. P1.3 immediate chaining
4. P1.4 phase timeline

### Post-beta workflow

P2 project bootstrap, design/scaffold lanes, existing-project intake, Delivery Cycles, and demo handoff.

---

## 8. Success metrics

Beta reliability:

- provider/session outage recovery: <2 min when a healthy fallback route exists,
- user cancellation releases the affected task slot promptly and never kills unrelated task runs,
- 100% automatic execution retries begin from a verified attempt baseline,
- zero automatic retries on user cancellation,
- zero completed tasks with failed configured machine verification,
- zero unrecoverable workspace states in the beta acceptance suite.

Speed:

- 8-task project wall clock: target <45 min where dependency graph/model latency permits,
- orchestration handoff gap: <10 s,
- Autopilot human interventions for healthy demo projects: 0.

---

## 9. Beta acceptance scenarios

The beta gate is not complete until automated tests cover at least:

1. cancel one of two parallel task runs; the other continues,
2. cancel/retry leaves task worktree at the recorded baseline before redispatch,
3. simulated provider 502 → rollback → fallback route → success,
4. auth/config provider error does not fail over forever,
5. stalled run is detected, canceled, rolled back, and bounded-retried,
6. red test/build evidence prevents completion even when reviewer says PASS,
7. green verification + exact integrity evidence unlocks dependent work,
8. merge conflict fails closed and preserves task branch/worktree,
9. dirty human base workspace is never overwritten/reset,
10. app restart reconciles running receipts and releases organization capacity.

---

## 10. Architectural rules

- ND owns orchestration, safety, retries, evidence, routing policy, and workspace recovery.
- Engines/models are disposable executors, never the authority for task state.
- Never retry on top of unknown partial writes.
- Never increase concurrency without isolation and explicit capacity.
- Never equate reviewer prose with machine verification.
- Never put slow/network bootstrap side effects inside the durable `project.create` mutation.
- Prefer extending existing TaskWorktree, control-plane, project-runtime, QA, and engine-router seams over parallel implementations.
