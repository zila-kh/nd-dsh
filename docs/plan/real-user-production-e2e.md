# Real-user production E2E (vibe-coder journey)

Status: **implemented on `feat/real-user-prod-e2e`; local validation results recorded in “Local validation evidence” below**
Driver: `e2e/real-user-prod.mjs` · Evidence helper: `e2e/lib/prod-evidence.mjs` · Orchestrator: `scripts/e2e-prod.mjs`

## Goal

Prove ND the way a real vibe coder would experience it — someone coming from Codex, Cursor or Claude Code who opens ND, uses it like a normal single coding agent, and only then grows into running several tiny software projects across several AI companies and autonomy modes, including genuinely parallel work, switching around while workers continue, restarting the desktop app, and still ending with correctly isolated, reviewed, integrated, tested repositories.

This complements — it does not replace — the three existing layers documented in [multi-company-portfolio-e2e.md](./multi-company-portfolio-e2e.md):

| Layer | Command | Question it answers |
| --- | --- | --- |
| 1 — deterministic portfolio | `e2e:portfolio` | Is ND's company/project/workspace/task isolation correct? |
| 2 — live 3-model portfolio | `e2e:portfolio:models` | Can three real model routes execute isolated work across companies/projects with worktree/review/integration evidence? |
| 3 — autonomous stress loop | `e2e:models` | Can ND distribute a larger single-project workload across multiple live routes in parallel? |
| **4 — real-user production journey (this doc)** | `e2e:prod:user` | Can a real user run the whole multi-company, multi-mode, parallel, restartable journey end-to-end as one coherent session? |

## Test topology

```text
SoloForge                     (default level 2 — normal single-agent usage)
└── Notes Mini                workbench journey · Builder-less; chat route → E2E_MODEL_1

SwiftCab Labs                 autonomy 3 — Workflow
├── Dispatch Mini             AI-PM planned · Builder   → E2E_MODEL_1 · Reviewer → E2E_MODEL_3
└── Driver Mini               AI-PM planned · Builder 2 → E2E_MODEL_2 · AI PM → E2E_MODEL_2

TinyCart Studio               autonomy 4 — Autopilot
├── Catalog Mini              Task A: catalog-item formatter   · Builder   → E2E_MODEL_3
│                             Task B: inventory-count formatter · Builder 2 → E2E_MODEL_1
│                             Reviewer → E2E_MODEL_2
└── Checkout Mini             checkout-total formatter         · Builder   → E2E_MODEL_3
                              (+ one extra task added in Phase F as the restart victim)
```

Every writable project gets its own **fresh real temporary Git repository** with a baseline commit, `package.json` (`"type": "module"`) and a passing `node --test` smoke file, so ND machine verification always has a green baseline inside every task worktree. The developer's own `nd-dsh` checkout is never a target. Projects are created with `testCommand: node --test`, which makes ND's machine-verification gate real for every task.

## Modes and sequencing (why the order matters)

ND's production guards shape the journey, and the driver respects them instead of working around them:

1. **Default autonomy is 2 (Internal).** At level 2 an explicit AI-PM plan completes but cannot auto-start execution (`runNext(non-explicit)` returns null below level 3). The driver therefore plans *both* SwiftCab projects at level 2, confirms the plans, and only then raises the company to **3 — Workflow** through the visible Autonomy control. The level-2 hold-back is asserted after each plan.
2. **Context mutations are refused while any run is active.** `company.create`, `project.create`, `company.activate` and `project.activate` all pass a fail-closed guard (`Cannot switch projects or workspaces while … is running`). Consequences the driver encodes honestly:
   - all three companies and all five projects are created during the quiet setup phase;
   - Phase C/E **attempt the real switcher during live work and record the refusal** (including the disabled-option marker the UI shows) rather than pretending the switch happened;
   - work is started by project id (`runNext(projectId)` — the exact IPC the visible **Run next** button calls), which does not require changing the active context.
3. **Raising a company to level 4 autostarts it.** `company.update → autonomyLevel 4` triggers ND's own autopilot start for an incomplete project of that company. The driver raises TinyCart to 4 **while SwiftCab executions are already live**, so TinyCart work starts during live SwiftCab work through the product's own rule; it then dispatches Checkout explicitly. All starts are unconditional scripted dispatches — never conditional retries.
4. **`planProject` rebinds the shared harness workspace when roots differ**, which would kill another project's live turn; planning two projects back-to-back while one executes is therefore done only in the quiet phase, exactly as the guard design intends.

Recorded deviations from a naive reading of the handoff, with reasons:

- SwiftCab's autonomy is raised to 3 *after* both plans (level 2 is required so planning cannot auto-start execution and the project switcher stays usable between plans). End state and explicit-start semantics are unchanged.
- TinyCart's `company.create` happens in the quiet setup phase (the product refuses company creation during live runs — guard evidence is captured instead); TinyCart's **work** starts during live SwiftCab work as required.

## Journey phases (implemented order)

| Phase | What runs | Key proof |
| --- | --- | --- |
| A | Fresh profile → Settings verifies seeded provider + 3 models → SoloForge/Notes created via the visible dialog and project form → Agent workbench: composer turns on the default `E2E_MODEL_1` route, model picker exercised on the live session, explorer shows the created files, terminal runs `node --test`, Source Control shows the pending change | gate 1, 17 |
| Setup | SwiftCab + plans (UI **AI PM plan**) at level 2 → level 3 via UI; TinyCart + explicit Catalog A/B + Checkout tasks; forged cross-company `task.create` probes rejected at the store | gates 2, 3, 9(pre) |
| Start | UI **Run next** starts Dispatch; `runNext(driverId)` starts Driver; TinyCart → 4 autostart + explicit dispatch start Catalog and Checkout while SwiftCab runs are live | gates 4, 5, 6 |
| E | Every switch attempt from the handoff (via the real COMPANY/PROJECT switchers) during live runs + board scoping + memory section + Agent/Settings navigation; per attempt: refusal recorded, active context unchanged, every running task's `workspaceRoot`/`branch` unchanged, no running run failed | gates 7, 8 |
| D | All four pipelines monitored to 100%: interval overlap, routes, checkpoints, fresh review sessions, integrations, exact artifacts in base repos, `node --test` everywhere | gates 5, 6, 9, 10, 11, 12, 13, 14 |
| F | One more Checkout task started, quit Electron mid-execution, relaunch on the same profile, assert `Interrupted:` run failure, blocked task with interruption note, released worker, preserved worktree/branch, clean base checkout, restored active context, completed tasks preserved, then retry through ND to completed+integrated and Checkout 100% | gates 15, 16 |
| Engine (optional) | If a Codex engine (`codex-cli`/`codex`) is installed+available: assign SoloForge Builder, run one boundary task → engine receipt → checkpoint → ND reviewer → integration. Missing/unauthenticated engines are **recorded as skipped** and never fail the `.env.e2e` matrix | bonus evidence (`engine-compat.json`) |

## Parallelism definition

Parallelism is **never inferred from final state**. For every `task-execution` run the durable receipt's `startedAt`/`completedAt` interval goes into `concurrency.json`; overlap pairs are recomputed from those intervals plus a sweep-line maximum:

- **crossProjectOverlap** (required minimum gate): ≥2 executions from different projects intersect in wall-clock time;
- **crossCompanyOverlap** (stronger claim): intersecting executions from different companies — achieved by raising TinyCart to 4 while SwiftCab executions are live;
- **sameProjectParallelism** (Catalog gate): two Catalog executions intersect with different workers, different `workspaceRoot`s and different branches;
- `liveObservations` in the same file records the poll-time moments the same overlaps were seen running simultaneously, as corroboration.

No timers, no sleeps faking overlap.

## No hidden rescue logic

The driver contains **zero** nudge/repair paths (unlike the older beta drivers): it never creates missing tasks after a PM failure, never marks tasks completed, never repairs model assignments mid-run, never mutates blocked tasks into success, and never re-issues `runNext` because a wait looked idle. Every wait is bounded (timeout + stall detector) and fails with a state diagnostic. The only state-conditional retry in the whole driver is the Phase F scenario step itself: the explicit `runTask` retry of the interrupted task, which is the behaviour under test. All dispatch actions are logged to `actions.json` for audit.

## Commands

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm core:test
corepack pnpm build

corepack pnpm e2e:portfolio          # layer 1 (offline, deterministic)
corepack pnpm e2e:portfolio:models   # layer 2 (live)
corepack pnpm e2e:prod:user          # this journey (live, ~15-60 min)
corepack pnpm e2e:models             # layer 3 (live)

# whole local production matrix in one command (stops at first failing stage):
corepack pnpm e2e:prod

# full Playwright sweep afterwards
corepack pnpm exec playwright test
```

`.env.e2e` is required for `e2e:prod:user` (all five `E2E_MODEL_*` variables, all-or-none). Exit codes: `0` pass · `1` test/provider failure · `2` configuration missing. No GitHub Actions are added for this work; validation is local/manual.

Known non-green signal: the intermittent Playwright worker-teardown watchdog (`Worker teardown timeout of 120000ms exceeded` after all tests passed) still exists — distinguish it from an actual test failure and record whichever happened.

## Evidence schema

One directory per run, `e2e-results/real-user-prod-<timestamp>/` (gitignored):

```text
summary.json         terminal result, all 20 acceptance gates, phase results, counts
companies.json       companies + autonomy levels exercised
projects.json        projects, owner, status, progress, workspace, testCommand
tasks.json           tasks, status, worker, integration + session ids
runs.json            every run receipt: engine, workspace, branch, baseline,
                     checkpoint, permit, timestamps, parsed route + verification
routes.json          expected (agent) vs actual (execution receipt) model routes
concurrency.json     task-execution intervals, overlap pairs, maxima, live observations
guard-probes.json    forged-ownership rejections + every switch attempt during live runs
actions.json         full scripted action log (audit trail for the no-nudge rule)
workbench.json       Phase A route/files/terminal/git evidence
restart.json         Phase F interruption/recovery check table
engine-compat.json   optional codex probe outcome (passed/skipped/failed)
workspaces.json      throwaway repo paths + baseline heads + smoke-test results
environment.json     OS/Node/date + configured model ids (never the key)
final-state.json     full final organization snapshot
driver.log           redacted driver transcript
errors.log           renderer/page errors and evidence-write problems
screenshots/         milestone screenshots (settings, phases, restart, final)
```

The API key is redacted at write time and a full evidence-directory secret scan runs at the end (`secretLeaks` in `summary.json` must be 0).

## Acceptance gates

The driver evaluates gates 1–19 itself (gate 20 is external) and writes them into `summary.json.gates` with per-gate evidence; `terminal: pass` requires every implemented gate to pass:

1. Fresh user can use ND like a normal single-agent coding tool.
2. Exactly the intended company/project topology is created.
3. Company/project state stays isolated (incl. forged cross-company probes rejected).
4. All three configured E2E models observed in actual execution evidence.
5. ≥2 task executions overlap across different projects.
6. Catalog Mini proves same-project parallel execution with two separate workers/worktrees.
7. Project/company switching cannot redirect a running task workspace.
8. Background work continues while the user navigates elsewhere.
9. Workflow level 3 completes explicit-start work through execution and review.
10. Autopilot level 4 completes happy-path work without hidden test-driver nudges.
11. Every execution has durable run receipt/workspace/checkpoint evidence.
12. Independent review uses fresh review sessions.
13. Integrated repos contain the expected changes.
14. Each tiny project passes its own test/build commands.
15. Restart during active work produces correct explicit interruption recovery.
16. Retried interrupted work can subsequently complete.
17. No renderer/page errors remain.
18. No API credential is logged or persisted.
19. Evidence directory is produced even on failure.
20. Existing E2E suites remain green — evaluated by the local validation commands below, not by the driver.

## Local validation evidence

Filled in after each real local run on this branch. **Nothing below is claimed before it was executed.**

_(pending — see the handoff report for this branch's run)_

### Known limitations / not exercised

- The review-interruption restart branch (`interrupted review → returned to review`) is not hit by this journey: the quit lands during an execution, which is the primary interruption case. Recorded as not-exercised in `restart.json` rather than claimed.
- The optional engine probe only runs when a Codex engine is installed and reports `available`; otherwise it is recorded as skipped.

## Why the journey is ordered this way (summary)

The product's isolation model is fail-closed: active-context mutations are refused while work runs, plans rebind the shared runtime workspace, and level-4 raises autostart. A production-realistic user session therefore *plans quietly, starts explicitly, navigates without needing context switches, and proves every claim from durable receipts* — which is exactly what this driver does, with every refused switch and every guard interaction recorded as evidence instead of being engineered away.
