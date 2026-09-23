# Task 0016 — Re-record the agent-task baseline and settle the router placement

> **Done 2026-09-23.** `pnpm bench:tasks:baseline` re-recorded on the reference machine (bundle `benchmark-results/2026-09-23T06-03-30-272Z-win32-x64/`, verdict `pass`), the reviewed document committed as [`benchmarks/baselines/agent-task-normal-loop.json`](../../../benchmarks/baselines/agent-task-normal-loop.json) with the `artifact` field the policy requires, `pnpm bench:tasks:check` green offline, and [agent-fast-path.md §9](../plan/agent-fast-path.md) §9.1 settled — the router stays in main-process TypeScript — on the measured IPC-crossing counts.

> PRD: [PRD-0002](../../prd/0002-rust-sidecar-mvp-migration.md)
> Priority: P1
> Owner: agent measurement
> Status: done — baseline current, §9.1 decided; runner-produced bundle still [blocked-0004](../blocked-0004-windows-release-validation.md)
> Branch: main
> Updated: 2026-09-23

## Objective

Two halves of the same gap. [Task 0008](done-0008-agent-fast-path.md) wired the §12.4 fast-path budgets into `compareFastPath()` and made the comparison a **required** part of a recorded result, which left the committed agent-task baseline (task 0005) unable to satisfy the schema it is checked against — `pnpm bench:tasks:check` was red by design until a new recording replaced it. Separately, [agent-fast-path.md](../plan/agent-fast-path.md) §9.1 was still open on purpose: *"Where does the router live — main process TypeScript, or nd-core? … Decide with the IPC-crossing metric in hand, not before."* The metric did not exist when the question was written.

## What was done

### 1. The baseline was re-recorded, not hand-edited

`pnpm bench:tasks:baseline` ran the six fixtures through the production task path and wrote a document that its own verdict accepted (`status: pass`, `fastPathComparison.status: pass`, 58 fixture checks, 0 deviations). The baseline is that document verbatim, plus the `artifact` object described below.

### 2. The recorded machine changed, and that is stated rather than implied

The replaced baseline was recorded on a 36-core Xeon E5-2686 v4 (Windows 10.0.26100, Node v24.16.0) at commit `588f3ed`; the new one is from the same reference machine as the runtime baseline — 16-core i7-10700, Windows 10.0.26200, Node v24.19.0 — at commit `029725f`. Only the counters are a comparable claim across machines, and the counters are what the budgets are written against. The wall times are stamped `wallTimeScope: excludes-model-latency` and are product overhead on one machine, not a user-facing latency claim. The old document also predated the fast-path arms entirely (its passes were `verified`, `verification-failed`, `engine-failed`, `canceled`) and carried the pre-[done-0009](done-0009-windows-cli-shim-prompt-truncation.md) shim note, so no like-for-like normal-read arm existed to carry forward.

### 3. The baseline now carries an `artifact` field

[performance-baseline-policy.md](../plan/performance-baseline-policy.md) requires every baseline to say where its raw bundle is attached and what that attachment's retention is. The agent-task baseline had `notes` but no `artifact`. It now has the same shape as the runtime baseline: `{kind: 'local-recording', bundle, ciRun: null, retention}` — `ciRun: null` because Actions is parked and nothing on a runner produced it.

### 4. §9.1 was decided on the numbers

The matched arms are recorded inside one run, so the delta between them is attributable to the router rather than to drift between recording days.

| Per verified completion | `normal-read` | `fast-read` |
| --- | --- | --- |
| Model round trips | 2 | **0** |
| Model-visible tool calls | 3 | **0** |
| nd-core IPC crossings | 12.5 | **9** |
| Completion rate | 1.0 | 1.0 |
| Escalations | 0 | 0 |

The decision tier contributes **zero** crossings: `parseFastActionPlan()` is pure parsing over the task's typed plan, and `prepareFastPath()` takes no core client at all — it reaches only the injected main-process policy gate and the durable audit sink. All native state the fast path needs arrives in **one** composite crossing (`workspace.snapshot`), which `tests/fast-path.test.ts` asserts by counting the injected request function. What is left — dispatch, run records, worktree preparation, runtime permit, verification evidence — is scaffolding every task pays regardless of where the router lives, so relocating the router into nd-core could not remove those crossings; it would add crossings for the plan and its policy/audit outcome and move the company policy gate into the Rust runtime. Recorded in [agent-fast-path.md §9](../plan/agent-fast-path.md).

### 5. A stale schema test was repaired, and it was the only thing left red

The schema tightening that made the committed baseline stale did the same to an in-memory fixture: `tests/agent-task-metrics.test.mjs` still asserted that a document **without** `fastPathComparison` validates, which was true before task 0008 wired the comparison in and false after. `pnpm test` was therefore red on `main`, and with Actions parked nothing but the local gate could say so. The fixture now carries a well-formed comparison, and the test asserts the negative case — a document missing it must fail — so the next tightening cannot ship with a stale fixture.

## Recorded evidence

| Item | Value |
| --- | --- |
| Bundle | `benchmark-results/2026-09-23T06-03-30-272Z-win32-x64/` |
| Verdict | `pass` — `fastPathComparison: pass`, 58 fixture checks, 0 deviations |
| Commit / profile / fixture | `029725fa53916685e2250ffec6a7eda93ab614ce` · debug · `agent-task-v1` |
| nd-core | `1059b7593d6487b333a8d0ac57000dbc83e88e7e0bfadf087377fa4cd31f49a5` (binary, 6,919,680 bytes) |
| Reference machine | win32 10.0.26200 x64 · Intel Core i7-10700 (16 logical) · 31.8 GiB · Node v24.19.0 |
| Tasks | 9 recorded, 6 verified completions (2 normal-read, 2 fast-read, 2 verified), 2 failed, 1 canceled |
| Per completed task (all passes) | 1.67 model round trips · 2.33 tool calls · 12.33 IPC crossings · 2,391 bytes to model · 1,527 ms wall |

## Acceptance criteria

- [x] The committed baseline satisfies the schema its own check enforces, proved by running the check. — `pnpm bench:tasks:check` exits 0: schema valid, summary and comparison recomputed from the raw samples and matching.
- [x] The baseline is a reviewed bundle that passed its own verdict before it replaced the previous one. — `--baseline` refuses to write when the run fails; this run passed, and the written file is byte-identical to the recorded `agent-task-metrics.json` apart from the added `artifact` object.
- [x] §9.1 is answered with the metric the question named, and the answer is falsifiable. — The decision rests on counted crossings (12.5 vs 9, and 0 attributable to the decision tier) and states the condition that would reverse it.
- [x] The machine and provenance change is explicit in the baseline and in this record. — `environment`, `commit`, `ndCore.sha256` and `artifact` all differ from the replaced document, and the difference is described above rather than left for a reader to notice.
- [x] The local gates pass. — `pnpm verify`, `pnpm typecheck`, `pnpm bench:tasks:check` and `pnpm test` (99 files passed, 4 skipped) all exit 0. One gate failure was repaired rather than explained away (see §5), and one unrelated teardown flake found on the way is implementation-fixed and awaiting local Windows confirmation as [WIP 0017](../wip-0017-windows-worktree-test-ebusy-flake.md).
- [ ] A runner-produced bundle. — Same open item as [done-0015](done-0015-runtime-evidence-baseline.md); it belongs to [blocked-0004](../blocked-0004-windows-release-validation.md).

## Notes

- **What the numbers do not show:** the 12.5 → 9 difference is not a clean measurement of the composite operation alone, because the fast arm also stops paying for model-visible tool calls. §8's criterion "any composite core operation is justified by a measured IPC-crossing reduction" therefore stays open: the composite is *asserted* to be one crossing for the whole read set, but the counterfactual — the same reads and searches issued as separate `workspace.*` calls — has not been counted. A per-call-site crossing measurement is what would close it.
- `buildProfile` is `debug`: the recording measures the dev core, as it did before. The runtime evidence bundle measures the release binary; the two baselines answer different questions and keep their own profiles.
- The recording needs `pnpm core:build:dev` and `pnpm build` and no packaging, so it has no Pencil or VS-toolchain dependency and can be re-recorded cheaply.
