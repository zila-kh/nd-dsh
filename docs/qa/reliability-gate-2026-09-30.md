# Reliability gate — recorded live-turn failure triage and drill status

Date: 2026-09-30. Candidate: `main` @ `0373960` plus the uncommitted
waterfall fix described below (gates: typecheck ✓, 1,070 unit tests ✓,
production build ✓). Companion: [market audit](../research/market-audit-2026-09-30.md),
[release checklist](../plan/release-0.0.1-checklist.md) (row A10).

## 1. Recorded failure, lifecycle captured

Evidence: [e2e-results/real-user-prod-2026-09-29T04-19-17-804Z](../../e2e-results/real-user-prod-2026-09-29T04-19-17-804Z)
plus the run's surviving Harness profile
(`%TEMP%\nd-prod-e2e-profile-o2goDf`), including the runtime's own session
journal (`session.v3.jsonl.zstd`, 61 records, decoded 2026-09-30).

Timeline (all times UTC, from `logs/nd-dsh.log` and the session journal):

| Time | Event |
| --- | --- |
| 04:19:21.5 | nd-core ready |
| 04:19:32 | Renderer session-list request times out (toast). The DSH runtime had not finished spawning — it started at 04:19:35 and its gateway became ready at 04:19:43. Boot race, already mitigated by the coalesced refresh + inline Retry work. |
| 04:19:43.69 | Follow socket opens for `session-aa15db2c…`; the workbench session was created and its journal adopted |
| 04:19:43.87 | One benign `stdin backpressure` line (single not-accepted write); not the hang |
| 04:20:07–04:20:16 | Turn 1 runs **normally for 8 steps**: glob, read ×3, write ×2, edit — all journaled by the Harness itself |
| 04:20:16 | Step 9: agent calls `pwsh` with `node --test`; permission policy `ask` escalates; Harness journals `approval/asked` (id `56757d19…`, reason "escalated…") and **blocks the turn on the approval** |
| 04:20:16 → 04:29:29 | Journal silent (last write 04:20). No approval card ever rendered; the driver's approval loop found nothing to click for 10 minutes; harness status stayed `running` |
| 04:29:29 | Driver gives up at its 10-minute bound. Follow socket closed `1006` by teardown, not by failure |

`runs.json` recorded zero organization runs: the journey never progressed past
phase A. The turn did not crash; it was **legitimately waiting for a human
decision that ND never delivered to a human**.

## 2. Root cause

The pinned Harness runtime (`0.1.7-rc.2`, commit `21638c5`) delivers answerable
approvals and user questions as **waterfall remote events** (`approval/request`,
`user-questions/request`) on the `/api/remote.mux` `$events` stream, each with an
`eventId` that the client must answer through the `$events/result` RPC
(`packages/api/remotes/src/remote-events.ts`, `packages/api/gateway/src/stream-protocol.ts`).
An unanswered waterfall never settles — the tool call waits, the turn waits.

ND's remote-face handler (`openRemoteEvents` in `src/main/dsh/gateway-client.ts`)
translated only `emit` items (`api-session/status|error|removed|added`). The
`ready`, `waterfall`, and `cancel` items were silently dropped, and ND's legacy
`approval/requested` translation targets a mux-frame contract that no longer
exists anywhere in the pinned runtime source. So on any 0.1.2+ runtime, an
approval ask could never reach the renderer's "Runtime requests" card — the
recorded hang. This also explains why the same journey passed on the older
`0.1.5-rc.2` runtime: it still served legacy answerable frames.

Audit instruction honored: the runtime update was **not** assumed as the cause;
the lifecycle was captured first (section 1), and the code path was verified
against the pinned runtime source before the fix.

## 3. Fix (uncommitted at the time of writing)

`src/main/dsh/gateway-client.ts`:

- `openRemoteEvents` now handles `$events` `ready` (captures `clientId`),
  `waterfall` (translates `approval/request` → answerable `approval-requested`
  frame with a minted `wf-<eventId>` rpcId; `user-questions/request` →
  `question-requested`), and `cancel` (withdraws the pending ask and resolves
  the card).
- `respond()` routes waterfall pendings through `$events/result`
  (`{clientId, eventId, outcome}`); approval outcomes map onto the runtime's
  closed vocabulary and fail closed to `rejected`; legacy `/api/respond`
  remains for older runtimes.
- Pendings clear on socket close so replies can never target a dead
  generation's `clientId`.
- Session attribution comes from a resolver (`setWaterfallSessionResolver`)
  wired in `HarnessService` to the active session, because the runtime's
  waterfall payloads carry no session id.

Regression tests: `tests/gateway-remote-waterfall.test.ts` (4 cases: delivery +
result mapping, fail-closed outcome mapping, question answer mapping,
withdrawal). Repo gates on the fixed tree: `typecheck` ✓, `pnpm test` 1,070
passed / 0 failed / 9 skipped ✓, `pnpm build` ✓.

## 4. Reproduction on the current candidate

| Run | Result |
| --- | --- |
| Recorded (2026-09-29, pre-fix) | First turn stuck `running` 10 min; approval ask invisible; A10 FAIL. Evidence: `real-user-prod-2026-09-29T04-19-17-804Z`. |
| Re-run (2026-09-30, pre-fix tree) | Not repeated; the gap is present by construction — `src/main/dsh/`, `src/main/harness/`, and the pinned runtime were untouched between `1608057` and `0373960`. |
| Re-run #1 (2026-09-30, fixed candidate) | **The recorded hang did not recur.** The turn's lifecycle now completes: provider transport failed on the free-tier route (`combo-free-1`, `Connection error.` after 2 in-runtime retries) and the Harness emitted a typed `turn/end` error plus an `agent-error` frame within ~4 s; `waitForChatIdle` returned and the driver's stall detector bounded the remaining artifact wait at 5 min. Evidence: `real-user-prod-2026-09-30T07-13-09-888Z` (journey `fail`, class: provider outage surfaced as actionable failure — the audit's "actionable failure within declared deadlines" category, not an indefinite hang). |
| Re-run #2 (2026-09-30, fixed candidate) | **Journey PASS — terminal `pass`, 19/20 gates, 14.3 min** (`real-user-prod-2026-09-30T07-21-12-497Z`). Phase A's first turn completed with two live approval round-trips (`approval/asked` → card → `allowed-once` → `turn/end completed`) — the exact sequence that hung 10 minutes on 09-29. The run further passed: all 3 configured models observed, cross-project parallel execution, same-project dual-worker isolation, company/project-switch refusal while running, board scoping, independent review sessions, integration with expected changes, **restart during active work → correct interruption recovery → retried task completes** (gates 15–16), zero renderer errors, zero secret leaks. Gate 20 (existing E2E suites) is the separate `pnpm e2e` meta-check, not part of this run. |

Note: run #2 exercised the live approval round-trip end-to-end (escalated
`pwsh` → renderer card → `allowed-once` → turn completion), closing the
observation left open by run #1's provider outage; the contract is also pinned
by `tests/gateway-remote-waterfall.test.ts`.

## 5. Recovery drills — automated coverage and status

Drills required by the audit's P0 "recovery/review integrity" row, with the
automated evidence that already exists on this tree (all green in today's
1,070-test run):

| Drill | Automated evidence | Status / gap for the RC |
| --- | --- | --- |
| Cancel | `tests/organization-orchestrator.test.ts` — user cancellation is a failed blocked run, not successful work; `HarnessService.stop()` marks cancel intent before the RPC so an early `running:false` cannot be lost. In-app cancel of a live turn exercised by the e2e suites (A8). | Covered in automation; re-verify interactively on the packaged RC. |
| Restart (app + core) | `tests/organization-recovery.test.ts` — stale running work marked failed/retryable after restart; `tests/core-client-restart-policy.test.ts` — exactly one bounded auto-restart, fail-closed budget, stable-window reset; `SessionEventHub.rehydrate()` rebuilds journals after core restarts. **Passed live in journey re-run #2 (gates 15–16): restart during active work recovered correctly and the retried task completed.** | Covered; 24-hour soak still pending (checklist row 17). |
| Network interruption | Provider/runtime transport failures return structured results (`gateway-unreachable`), never raw errors; stream sockets reconnect with replay. **Journey re-run #1 live-observed a provider transport outage surfacing as a typed agent-error within ~4 s with the turn lifecycle closed (`turn/end`, error reason) — no indefinite running.** | Partial: needs an explicit offline drill on the RC artifact. |
| Stale review / checkpoint | `tests/worktree-evidence.test.ts` — receipt fingerprints change with tracked/untracked edits, fail closed when the worktree cannot be observed; control plane invalidates verification evidence on drift (`control-plane.ts`). | Covered in automation; RC human inspection pending (checklist row 15). |
| Dirty human checkout | `tests/task-worktree.test.ts` — no new task branch is created from a dirty human workspace; dirty human changes are never reset or overwritten by task retry/integration. | Covered in automation; RC human inspection pending. |
| Merge conflict | `tests/task-worktree.test.ts` — integration fails closed on conflict and keeps the task worktree intact. | Covered in automation; RC human inspection pending. |

Honest limitation: the six drills above are automated at the unit/integration
layer. The audit gate asks for them **on the exact candidate artifact**
(packaged RC). The drill protocol for that pass is the checklist's P6/P8 list;
run it after the next portable build.

## 6. What would still block a supervised pilot

1. The 20-journey matrix on two supported engine routes (audit P0: ≥ 18 of 20
   acceptance-checked). Today's evidence: one full pass (re-run #2) and one
   fast actionable provider failure (re-run #1) on one route.
2. Packaged-RC drill pass (checklist P6/P8) and the 24-hour soak.
3. Playwright suite's known worker-teardown exit-1 (A8) still needs a fix or a
   classification before GO — and gate 20 of the journey requires it.
