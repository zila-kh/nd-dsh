# ND-DSH Beta v1 Improvement Plan

Status: proposal · 2026-08-27
Evidence base: three completed end-to-end acceptance runs (Todo Beta, Tic-Tac-Toe Beta Acceptance, Kla-Klok Khmer Dice Game) on dev build `b150a551b8d4` harness. Instrumented phase timings and failure modes are recorded in this document.

---

## 1. Why: AI-era speed is the product

Three demo companies finished 3-for-3, but the wall clock is dominated by serialization and dead time, not by model latency:

| Measured (Kla-Klok, 8 tasks) | Duration |
|---|---|
| PM plan | ~20 s |
| Task execution (healthy) | 5–12 min (one 23 min outlier) |
| Independent review | 1–3 min |
| Phase auto-chain gap | ~1 min |
| **Provider 502 outage penalty** | **~60 min lost (blocked task + wedged session + 1 h lease)** |

Real software teams run lanes in parallel: PM planning, designer in the design surface, and dev scaffolding starter tech all start on day zero. Existing projects run sprint loops with demo handoffs. ND-DSH currently runs a single serialized pipeline (`Plan → Execute → Review`, `DEFAULT_MAX_PARALLEL_WORKERS = 1` at `src/main/organization/control-plane.ts:26`). The plan below reorganizes the org around parallel lanes and dead-time elimination.

---

## 2. Workstream A — New projects: parallel lane startup

**Today:** one pipeline; planner, builder, reviewer run strictly in sequence; the workspace must already exist and be correct (Tic-Tac-Toe inherited the todo workspace and nearly clobbered it).

**Target state (day-zero, three lanes in parallel):**

1. **PM lane** — `pm-plan` produces goals/milestones/tasks as today.
2. **Design lane** — a **Designer role** (new; `defaults.ts` currently has PM / Software Engineer / Reviewer only) drives **ND Pencil** (`src/main/design/nd-pencil-controller.ts`) in design mode: Freeform `.op` mockups for screens, flow, states, and a11y annotations, targeting the active project's real source. Design artifacts land as tasks inputs (`designRef` on task or milestone).
3. **Dev lane** — a **Scaffold role** (or the PM's first worker task) prepares starter tech from `repoUrls` or a template: clone/scaffold, dependency install, CI skeleton, lint/test harness, git init + initial commit. This runs while planning and design are still in flight.

**Changes required:**

- A2.1 Add `Designer` role + design-mode pipeline kind (`design-mockup`) that talks to the Pencil editor/MCP bridge instead of filesystem tools (per AGENTS.md Pencil boundary).
- A2.2 `project.create` gains a bootstrap step: template/`repoUrls` clone or empty-dir scaffold, validated by preflight (non-empty? existing repo? write access?) before any agent runs. Adds workspace-path editing + preflight UI to the project view (currently only the Add-project form has a workspace field).
- A2.3 Orchestrator (`src/main/organization/orchestrator.ts`) supports lane concurrency: lane-aware scheduler where `pm-plan`, `design-mockup`, and `scaffold` phases of the *same* project can run concurrently, converging at `build` gates.
- A2.4 Planner prompt/contract: emit `dependsOn` edges that actually enable parallelism (independent tasks: tests, i18n, a11y, docs should not serialize). Current plans serialized 8 tasks with only 1–2 real edges.

## 3. Workstream B — Existing projects: sprint loop + demo handoff

**Today:** no sprint concept anywhere in the org model; "existing project" means re-running the same plan pipeline; demo handoff is manual (runtime panel Start button, UNREACHABLE badge until a human checks).

**Target state:**

1. **Sprint entity** (new, alongside milestone): time-boxed goal set with sprint planning (`pm-plan` scoped to `sprint.backlog`), sprint goal, capacity budget (`budget.maxParallelWorkers`, `dailyTurnLimit` already exist in the control plane — reuse them as sprint capacity).
2. **Sprint flow**: intake → plan → parallel build → integrate → demo → retro.
   - *Intake* (new project kind `existing`): analyze the repo (structure, test command, start command, target URL — the project runtime fields already exist), produce a codebase map goal, then sprint-plan from the backlog.
   - *Integrate*: task worktrees (already exist: `TaskWorktreeManager`, `task-worktree.ts`) merge via rebase + evidence run (`worktree-evidence.ts`) before review.
3. **Demo handoff (automated)**: on sprint/demo gate — start project runtime, poll target URL health (loopback), capture screenshot via the embedded browser, generate release notes from merged task summaries, and present a **demo sign-off card** (approval gate at autonomy ≤ 3; auto at Autopilot). The acceptance-runtime pieces (start command, health-check path, target URL) already exist in the runtime panel — wire them into the pipeline as a `demo-verify` run kind instead of leaving them manual.

**Changes required:**

- B3.1 `Sprint` in org store + IPC (`sprint.plan`, `sprint.start`, `sprint.demo`, `sprint.close`), surfaced in Work tab.
- B3.2 `demo-verify` run kind: runtime start → health poll → screenshot → release-note generation → sign-off (approval-gate integration).
- B3.3 Intake analyzer: repo profile (language, package manager, test cmd, start cmd) auto-filled into project runtime config at project creation.

## 4. Workstream C — Safety net: cancel, checkpoint, rollback (P0 gate)

Observed failures all landed here; this is the beta gate.

- C4.1 **Stop/cancel run** IPC + orchestrator support: kill session, break lease, release worker slot. (Today: impossible; a wedged session held slot 1/1 for 45+ min.)
- C4.2 **Lease break**: allow `runTask` to supersede an expired-or-stalled lease (`control-plane.ts` lease check) with confirmation at autonomy ≤ 3.
- C4.3 **Task-bound commits**: auto `git commit` (or snapshot for non-git workspaces via `snapshot-manager.ts`) at every task transition, tagged `task/<id>` — today entire demos existed as uncommitted working-tree changes one bad task away from destruction.
- C4.4 **Stall detection**: no agent output / no workspace writes for N minutes → surfaced event + auto-retry policy instead of silent blocked state.
- C4.5 **Blocked-task auto-retry**: Autopilot retries `blocked` tasks N times via `runTask` (currently only `fail` verdicts rework; both blocked demo tasks needed manual `runTask`).

## 5. Workstream D — Provider resilience (P0 gate)

- D5.1 Multi-route failover: provider store (`src/main/providers.ts`) gains ordered routes; harness runtime falls through on 5xx/empty-stream (the observed `502 … reset after 1h 14m` failure mode).
- D5.2 Bounded retry with backoff around task execution turns; a route outage should cost seconds-minutes, not an hour.
- D5.3 Model-per-role routing: reviews consistently took 1–3 min (cheap, fast model is fine); executions need the strong model. Route by role/pipeline kind.

## 6. Workstream E — Speed & parallelism mechanics

- E6.1 Raise `DEFAULT_MAX_PARALLEL_WORKERS` (control-plane.ts:26) to ≥ 2–4; keep budget override. Ensure task worktrees are created for git workspaces so parallel writes never collide (worktree path exists — verify it engages for `examples/*`-style workspaces nested in the parent repo).
- E6.2 Kill residual dead time: review→next-execution handoff is ~1 min; target < 10 s via immediate orchestration event instead of polling.
- E6.3 Review stays cheap: keep 1–3 min reviews; promote **verify-evidence** (test/build run — `qa/`, `worktree-evidence.ts`) to the hard acceptance gate so reviews validate rather than contradict passing suites (both demo "blocked" verdicts were false negatives against green tests).

## 7. Workstream F — Observability

- F7.1 Phase timeline with per-phase durations in the Work tab (the data this plan measured via CDP scraping should be native: run start/end, queue gaps, workspace-write heartbeats).
- F7.2 Streaming agent output per run in Agent console.
- F7.3 Turn/cost accounting per task/project against the budget plane.
- F7.4 Loopback telemetry endpoint so external harnesses (e2e drivers) don't scrape `window.ndDshOrganization` via CDP.

---

## 8. Phasing

**v1 beta gate (block external users):** C4.1, C4.3, D5.1, D5.2, E6.3
**v1.1 (speed):** E6.1, E6.2, C4.4, C4.5, A2.4, F7.1
**v1.2 (real-world flows):** Workstream A lanes (A2.1–A2.3), Workstream B sprints + demo handoff (B3.1–B3.3), F7.2–F7.4

## 9. Success metrics

- Wall-clock per 8-task project: from ~95–185 min → **< 45 min** (parallel lanes + no dead time).
- Provider outage cost: from ~60 min → **< 2 min** (failover + bounded retry).
- Human interventions per project: from 2–3 (workspace fix, blocked retry, stall) → **0** at Autopilot.
- Zero unrecoverable workspace states (task-bound commits, 100 % coverage).

## 10. Open questions

- Do design-lane artifacts gate build tasks (hard dependency) or inform them (soft ref)? Default proposal: soft ref with a `design-ready` gate only for UI tasks.
- Sprint length default for AI teams (suggest: no calendar time; sprint = fixed task budget, e.g. 8 tasks or `dailyTurnLimit`).
- Parallel merge strategy when two worktree tasks touch the same file (rebase-order vs PM arbitration).
