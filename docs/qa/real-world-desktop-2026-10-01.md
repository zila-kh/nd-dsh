# Real-world ND desktop exploration — 2026-10-01

This was an agent-operated Windows UI exploration with a real configured model route and real Git workspaces. It is not a human acceptance sign-off, packaged-release certification, or a 24-hour soak. The session crossed midnight in Asia/Bangkok; local evidence is in `output/real-world/2026-09-30-session-1/`.

## Environment and scope

- Started from `94fb9e4`, then rebuilt the desktop app with the fixes below.
- Used a separate persistent Electron profile, a newly created **Northstar Software Operations** company, and a **Service Desk** project. Existing user companies and projects were not modified.
- The live PM planned a vanilla JavaScript ticket manager with validation, local persistence, responsive UI, tests, independent review, and later bug/feature work: 21 planned tasks plus one recurring task.
- Git worktrees and model-generated files were real. No task completions, reviewer verdicts, or delivery results were manually fabricated.
- Used native UI controls for company/project creation, planning, scheduling, pause/resume, autonomy, signal capture/triage, task retry, cancellation, and task inspection. Used the existing visible ND renderer's API for inspected one-time `npm test` approvals, test-command configuration, diagnostic reads, and one renderer reload. No hidden browser was launched.
- Credentials came from local environment configuration and were stored through Electron `safeStorage`. The trial profile and generated workspaces are excluded from Git. Saved accessibility text redacts ND browser capability tokens.

## Observed rounds

| Round | Actual result | Limit of the evidence |
| --- | --- | --- |
| Fresh company and workspace | Company/project created through the UI and bound to a real Git repository. | One company and one active project; the second fresh repository was not exercised. |
| Live planning | PM completed in about 135 seconds and created the delivery board. | A useful plan is not delivered software. Bug/feature placeholder tasks still need concrete later reports. |
| Scheduling | A one-minute schedule stayed at zero runs while paused, resumed, dispatched twice, and stopped at `maxRuns: 2`. Only one recurring task remained open. | Schedule `success` describes dispatch; the recurring maintenance task itself was still ready. No 24/7 uptime claim. |
| Concurrent delivery | Builder plus two Researchers had overlapping running receipts and distinct worktrees. Navigating ND surfaces did not stop them. | Concurrency alone does not prove each task completed correctly. |
| Machine gate and review | Scaffold produced actual modules/tests, passed its checks, received independent review, and merged into the base project (`8898af2`, worker checkpoint `9b8aed7`). Base-project `node --test` independently passed 4/4. | These are scaffold checks, not full ticket-manager behavior tests. |
| Artifact failure | Research produced a document at an undeclared path. Architecture omitted its second declared artifact. ND blocked both. | The gate behaved correctly; workers were missing the exact paths in their instructions. |
| Feedback control | An observed management feature request was captured in the Signal Inbox and triaged as evidence. | It was explicitly identified as an ND management issue, not automatically turned into Service Desk business logic. |
| Restart | Company, board, schedule run limit, test command, and integrated source persisted across two clean app restarts. | Initially chat listing was slow and recovered after retry. Only the base-project PM chat was initially listed; worktree chat visibility needs further restart coverage. |
| Targeted cancellation | The first cancellation exposed competing rollback attempts and a Git lock error. After the fix, a second domain-worker cancellation left its worktree clean, produced one blocked record, and left Researcher run `98f0a550-97ee-4ac1-89c1-9889c1dde9b1` running. | Checked a bounded cancellation/retry scenario, not power-loss recovery or all engine adapters. |
| Corrected delivery instructions | Live retry used the declared `docs/research/ux-a11y-i18n.md` path, passed artifact verification and independent review, and integrated into the base repository (`13a25aa`, worker checkpoint `629f262`). The new task-details panel visibly displayed the same requirement. | Research records its failed live-browser/search attempts; review does not establish that its external sources were independently verified. |

## Implemented improvements

1. **One cancellation cleanup per session.** The cancel RPC response and terminal engine events now share a finalization promise. Cancellation remains recognized until cleanup finishes; delayed callers check whether the run is still active. This prevents competing Git rollbacks and duplicate task blocking.
2. **Explicit delivery requirements in worker/reviewer prompts.** Artifact tasks receive their exact relative output paths and artifact-verification contract. Code tasks receive the configured machine command, or an explicit statement that machine verification will be skipped. Reviewers inspect declared artifacts without being instructed to edit them.
3. **Visible task verification requirements.** Task details show required artifacts or the project's machine command, including the skipped-verification case. The dialog scrolls within the viewport.
4. **Named cancellation control.** The company header names the task it will cancel and exposes task/run/session context in its accessible label and tooltip. It still targets the current project run shown by ND, independently of the chat selected on the left.
5. **Local trial-data exclusion.** `/output/real-world/` is ignored so desktop profiles, credentials, generated repositories, and raw evidence cannot be accidentally staged with the fixes.

## Verification

- `pnpm verify`: passed, including upstream/product boundaries.
- `pnpm typecheck`: passed.
- `pnpm test`: **1,051 passed, 9 skipped**; 136 test files passed and 5 skipped. Windows shutdown tests ran outside the restrictive command sandbox so they could stop their own test children.
- `pnpm build`: passed.
- Added regression coverage for overlapping cancel response/stop/error events, exact artifact paths with negative and positive delivery checks, reviewer requirements, configured test commands, and explicit skipped verification.
- Visually checked the actual rebuilt task dialog and named cancellation button. Preserved screenshots and text under `ui/`; snapshots `12-two-retry-workers.json` and `13-targeted-cancel-fixed.json` prove the cancellation scope.

## Remaining real-world work

| Priority | Next work | Acceptance evidence |
| --- | --- | --- |
| P1 | Make runtime approvals identify their worker/workspace and exact action. Current concurrent cards show only tool and justification. | A manager can distinguish two simultaneous approval requests and inspect each intended action with secrets redacted. |
| P1 | Make schedule outcomes distinguish dispatch from successful work completion. | UI and receipts show the scheduled task, its verification/review outcome, holds/failures, and the next retry without implying an open task is complete. |
| P1 | Complete the ticket manager's first usable workflow. | Create/edit/filter tickets in ND's embedded browser; persist and reload data; inject corrupted storage; run meaningful behavior checks and independent review. Current scaffold is not a usable app. |
| P1 | Run a genuine overnight/24-hour soak after the bounded flows work. | Elapsed-time evidence, missed ticks, restart recovery, sleep/network/provider interruptions, retry bounds, cost limits, and orphan-process checks. No soak pass was claimed here. |
| P2 | Restore and inspect all worktree chat history after restart. | Every persisted task run can reopen its transcript and its correct workspace without starting a new task first. |
| P2 | Improve Windows test execution within governed workers. | Standard child-process tests run with an explicit scoped permission flow; no repeated unexplained approvals or false green fallback. |

## Trial state before the milestone/delegation follow-up

Later milestone and actual-child checks are recorded in [the follow-up QA report](milestones-and-delegation-2026-10-01.md). The state below describes this first exploration round.

The isolated Service Desk project is retained for inspection with autonomy at **2 Internal** and no active workers. Two tasks are completed and integrated: scaffold and UX/accessibility/i18n research. The architecture task remains blocked, the domain task was deliberately cancelled during verification, the recurring maintenance task is still ready, and 17 tasks remain in backlog. The full business application is unfinished.

Research execution `98f0a550-97ee-4ac1-89c1-9889c1dde9b1` passed artifact verification. Independent review `9c275cd9-499a-4944-a1f5-2870101ef79f` completed, and ND marked the task `completed` with integration state `integrated`. Git confirms base merge `13a25aa` and worker checkpoint `629f2623f54ee3757992a303ee237210e39ad3c9`. Local snapshot `17-final-reviewed.json` records the final task/run/schedule states. The bounded schedule remains completed at two runs; no future recurring automation was enabled by this exploration.
