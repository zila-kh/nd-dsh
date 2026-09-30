# Milestone and delegation desktop checks — 2026-10-01

Follow-up to the [desktop exploration](real-world-desktop-2026-10-01.md), using its isolated Northstar Software Operations / Service Desk profile and real Git workspaces. This is bounded agent-operated evidence, not human acceptance or a 24-hour soak.

## Delivery focus

- The native board changed from 22 tasks in All work to four tasks in Foundation and design, with 18 other tasks collapsed. Screenshots `18-milestone-focused` and `19-milestone-task-reordered` are retained in the ignored local evidence directory.
- The native queue controls moved Architecture and data-flow design ahead of Ticket domain model and validation. Persisted task ranks were scaffold 0, architecture 1, research 2, domain 3.
- Through the existing visible renderer's public API, Run next returned no receipt and created no running worker when the focused milestone had no eligible task, although an unassigned recurring task was ready. This confirms that automatic selection respects delivery focus.
- Store regression tests cover persisted focus/order, dependencies, completed-milestone holds, explicit scope changes, invalid cross-project assignments, duplicate/partial reorder rejection, and compatibility with existing projects that have no selected milestone.
- The first planned milestone is selected for new plans. A manager chooses the next milestone; completed milestones do not silently activate later work. Existing workers remain visible while a different milestone is selected.

## Actual subagent execution

The previously blocked architecture task was retried with one bounded native child on the configured model route. The child received a read-only assignment to inspect schema, storage recovery, and module contracts, with no edits, shell/browser actions, additional children, or external actions.

- Parent execution: `4221b506-7bad-4457-862f-8a80191db2b2`.
- Parent session: `session-9e0e8bc1-2742-4282-b3ca-15a6c1e21674`.
- Actual child: `44100a8d-f27d-4ede-940c-7e0531d8279b`, with the parent relationship and `origin: subagent` reported by the runtime.
- The native sessions sidebar displayed the parent with one expandable subagent. The child's transcript contained file inspection and its actual findings.
- Runtime history confirmed the child's tool calls were `glob`, `read`, `grep`, and `report`, with no shell, browser, write, or delegation calls. Native evidence is retained as `20-real-subagent-completed`.
- The child finished. The parent wrote both declared architecture artifacts and passed artifact verification, moving the task to review.
- Independent review: `3c97ba0f-509b-476b-9807-063e625dacb2`. It inspected artifacts, ran project checks, attempted browser checks, and investigated stored child evidence. It had not returned a verdict at the 20-minute bound, so the trial operator cancelled it through ND's public API. ND marked the review failed with its cancellation message and the task blocked with integration pending. **No review pass or architecture integration is claimed.** Both produced documents are retained in the task worktree.

The runtime can delegate; this does not prove every task should spawn a child, cancellation of an active child, all engine adapters, or a stronger model route. No model upgrade or recurring overnight automation was enabled.

## Validation

On the final implementation: `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed. Tests: **1,059 passed, 9 skipped**, with 136 files passed and five skipped. Test shutdown checks used a permitted command environment so they could stop their own child processes.

The Service Desk business application remains unfinished. Its scaffold and design evidence do not establish working create/edit/filter/persistence behavior or 24/7 stability. The isolated company remains at autonomy level 2, with no active organization workers, and its bounded schedule has reached its two-run limit. Final state: two completed/integrated tasks, two blocked tasks, 17 backlog tasks, and one ready unassigned recurring task.

Next acceptance work is to give independent reviewers a scoped session-evidence interface so verifying a child's actual result does not require browsing compressed runtime storage, then rerun this architecture review. Active-child cancellation, worktree chat recovery after a full restart, and a genuine overnight soak still need dedicated checks.
