# Task 0007 — Retire legacy runtime paths and unify dispatch

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ZCode  
> Branch: fix/retire-legacy-paths-and-dispatch  
> Updated: 2026-09-22  

## Claim status (2026-09-22)

Claimed for this session (`ZCode`) on branch `fix/retire-legacy-paths-and-dispatch`. **No work has started** — the ticket is blocked in practice by tree contention, not by a dependency.

A concurrent session holds substantial uncommitted changes in the same working tree: 69 modified/untracked paths, 2,293 insertions and 396 deletions across 35 tracked files, with **no commits to fall back on**. Every file this ticket needs is a file that session is actively editing:

| Section | Overlapping file | Concurrent change |
| --- | --- | --- |
| 1 — node-pty | `package.json` | `bench:tasks*` scripts added |
| 1, 2 | `src/main/index.ts` | edits around the legacy-mode path |
| 3 — autopilot dispatch | `src/main/organization/orchestrator.ts`, `execution-coordinator.ts` | cost attribution (`currentPermit()`) |

None of the three sections is implemented yet: node-pty remains at `package.json:79`, `electron-builder.yml:15`, and `src/main/terminal/terminal-manager.ts:289-298`; `fillParallelReadyTasks` is unchanged; the `legacyCoreBackend` branch still exists. So the work is open, only unstartable here without risking another session's uncommitted output.

**Section ordering is not free: decide section 2 before section 1.** `ND_DSH_CORE_BACKEND=legacy` leaves `core` undefined, and the terminal manager's fallback to node-pty is what gives legacy mode a terminal at all. Removing node-pty without first deciding the legacy switch's fate removes the legacy arm of the benchmark suite's terminal comparison — which the `relative-terminal` budget depends on.

Resume once the concurrent session has committed its work.

### Section 2 — proposed decision (drafted here, not yet recorded in the PRD)

PRD 0002 review decision 11 permits the switch as a temporary soak affordance and never says what ends the soak. The switch has exactly two jobs today: produce the legacy arm of the benchmark comparison, and act as a rollback if the Rust path fails in the field. Both argue for a trigger tied to evidence rather than a calendar date:

1. **Trigger:** the switch is removed in the first release *after* a reviewed `bench:record` bundle exists on the reference machine — which requires todo-0004 sections 2 and 4 (staging fixed so the evidence job runs, and a committed baseline with backend-identity assertions). Until that bundle exists there is no baseline to compare a future regression against, and the legacy arm is the only way to produce one.
2. **Consequence to record:** after removal, legacy-mode numbers are historical only. The `relative-terminal` budget cannot be recomputed, because legacy mode's terminal depends on node-pty (see the coupling above). Either that budget is retired with the switch, or the terminal comparison is recorded as Rust-only from that point.
3. **Scope to state in the PRD:** the switch is a benchmark and rollback affordance only, is unsupported in packaged builds, and takes no part in normal dispatch.

This is a decision to *record*, not necessarily to enact: if the evidence bundle does not exist by the time this ticket is worked, the correct outcome is to land the trigger text and leave the switch in place.

## Objective

Three places where a second code path still exists beside the shipping one. None is large; together they mean every runtime-touching change must stay correct on a path users never exercise, and one of them makes capacity a matter of guessing.

## 1. Remove node-pty from the developer path, dependencies, and packaging

PRD 0002 commit 6 and review decision 12 require this once Rust PTY parity is verified. The packaged app already excludes it (`electron-builder.yml:15`) and the Rust PTY is the default, but the dependency and a live fallback remain: `package.json:76`, and `src/main/terminal/terminal-manager.ts:286-298` still carries a node-pty spawn path plus a `unixTerminal.js` resolution hack.

This is a two-runtime-path hazard in exactly the subsystem where platform behaviour differs most, and Windows ConPTY quirks have already proved able to hide there.

- [ ] No reference to node-pty remains in `src/`, `package.json`, or `electron-builder.yml`; the lockfile is refreshed.
- [ ] Terminal create, input, output, resize, and close all work through the Rust PTY in a development run.
- [ ] A missing or unstartable nd-core produces an actionable terminal error, not a silent fallback and not a crash.
- [ ] The ASAR exclusion rule is removed if nothing else needs it.
- [ ] `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- [ ] `docs/terminal.md` describes one runtime path.
- [ ] Verified with a real open/close cycle in the app, not only unit tests.

## 2. `ND_DSH_CORE_BACKEND=legacy` needs a removal trigger

`src/main/index.ts:123-137` still honours the switch, disabling the Rust core entirely. PRD 0002 review decision 11 permits this as a temporary soak and rollback affordance, and the benchmark suite uses it for the legacy-versus-Rust comparison. What is missing is a trigger and a date, which means it survives indefinitely by default.

- [ ] A removal trigger and date are recorded in the PRD, replacing the open-ended "may remain temporarily".
- [ ] Either the switch is removed, or the recorded trigger states precisely what it waits for and when that is assessed.
- [ ] If removed: no `ND_DSH_CORE_BACKEND` handling remains and the app still fails closed with an actionable error when nd-core is absent.
- [ ] If removed: the benchmark suite's legacy-comparison path is replaced by a recorded procedure, or the comparison requirement is formally closed.
- [ ] Documentation no longer describes a legacy backend as available.

## 3. Autopilot acquires capacity through the coordinator, not an error regex

Parallel work distribution landed, but the autopilot fill path still decides how many tasks to launch without consulting the coordinator:

- `src/main/organization/orchestrator.ts:670-693` — `fillParallelReadyTasks` loops to the fixed bound `MAX_AUTOPILOT_PARALLEL_FILL` (16) and stops by matching an error message against `/capacity|active|isolated|worktree|leased/i`.
- `src/main/organization/orchestrator.ts:85` — the orchestrator holds the coordinator only as `Pick<ExecutionCoordinator, 'releaseSession'>`, so it has no availability to consult.

The cap holds, because `runTask` acquires capacity internally. What remains is that the dispatch *decision* is reactive: it attempts work, reads a failure string as "no capacity", and unwinds. This is finding G1 from [parallel-work-distribution.md](../plan/parallel-work-distribution.md) — the direct-orchestrator capacity bypass — still present in weaker form.

- [ ] `fillParallelReadyTasks` decides by querying coordinator availability; no dispatch decision matches on an error message.
- [ ] Autopilot cannot exceed `maxParallelWorkers`, per-role caps, per-team caps, or the review pool, verified with each as the binding constraint.
- [ ] Filling resumes when capacity is released, without needing a new trigger event.
- [ ] A capacity shortfall produces no failed-task record and no run failure surfaced to the user.
- [ ] The fixed loop bound remains only as an iteration guard, made explicit by a comment or test.
- [ ] Existing parallel-distribution tests pass, with new tests for the binding-constraint cases.
- [ ] Closes the task-record box: "Autopilot cannot exceed maxParallelWorkers; the existing direct-orchestrator capacity bypass is removed."

## Notes

- Section 3 is the one with correctness consequences today: the error-regex stop also hides genuine failures whose message happens to contain those words.
- Sections 1 and 2 are independent of each other and can be done in either order.
- Section 2 may legitimately conclude "keep it, trigger is X". A documented decision is the deliverable; removal is one outcome.
