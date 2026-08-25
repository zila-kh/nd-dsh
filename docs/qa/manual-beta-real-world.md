# ND-DSH Manual Beta QA — Real-World Development Scenarios

Status: beta acceptance playbook

Purpose: prove that ND-DSH can take a normal user's company/project idea, feedback, or bug report and carry the work through planning, implementation, review, verification, and recovery with minimal manual intervention. Human intervention remains allowed and should also be tested.

## How to run this playbook

Run every scenario from a fresh workspace unless the scenario explicitly says to use an existing project. Use a real configured model/provider and a real coding engine. Prefer Company autonomy level 3 for normal autonomous tests and level 4 only for the bounded automatic-rework test.

For each scenario record:

- Date and ND-DSH commit
- OS
- Model/provider
- Coding engine
- Autonomy level
- PASS / FAIL
- Failed step
- Screenshot or recording
- Whether a restart was required
- Whether the user had to manually repair source code

A scenario is not a pass merely because the agent says it is done. The resulting software must run and satisfy the acceptance criteria.

## Global beta acceptance rules

Every scenario should demonstrate, where applicable:

1. The user can begin with a product idea or feedback instead of manually creating implementation tasks.
2. The AI PM creates a useful goal, milestones, dependency-aware tasks, and acceptance criteria.
3. Assigned workers operate only in the selected project's workspace.
4. The real files, shell, tests, browser, Git state, skills, and project context are used.
5. A reviewer independently checks completed implementation work.
6. Failed review does not silently become completed work.
7. Project/task state remains understandable to the human and can be manually overridden when needed.
8. The visible application is verified in the built-in browser when it is a web project.
9. Restarting ND-DSH does not corrupt company/project/task state.
10. Final completion means the product actually works, not just that generation stopped.

---

# QA-01 — Idea to working SaaS landing page

## User story

A non-technical founder has only a product idea and wants ND-DSH to create the first usable web presence without manually planning development.

## Setup

- New company: `Acme Notes`
- Mission: `Build a simple collaborative notes SaaS.`
- New empty project/workspace
- Autonomy: 3 — Workflow

## Paste-ready user request

> Create a polished responsive marketing website for a collaborative notes product called Acme Notes. It needs a hero section, feature section, pricing with Free and Pro plans, FAQ, mobile navigation, call-to-action buttons, and a professional light/dark theme. Choose an appropriate React/TypeScript stack, create the project, run it, test it in the built-in browser, and review the result before marking it complete.

## Expected autonomous behavior

- PM turns the idea into a coherent implementation plan.
- Worker bootstraps the app instead of waiting for the user to create files manually.
- App starts successfully.
- Browser verification happens on the real local application.
- Reviewer checks functionality, responsiveness, and obvious visual issues.

## Manual checks

- Desktop and narrow/mobile widths are usable.
- Navigation works.
- Pricing and FAQ content render correctly.
- Theme switching works if implemented.
- No obvious console/rendering error.
- Reloading the page keeps the app functional.
- Source Control shows the created project files.

## PASS

The founder can start with one idea and end with a real running website without manually writing code or creating implementation tasks.

---

# QA-02 — Idea to full CRUD business application

## User story

A small business owner wants an internal customer tracker, not a demo page.

## Setup

- New company: `Northwind Services`
- Mission: `Build internal tools for a small service business.`
- New empty project/workspace
- Autonomy: 3

## Paste-ready user request

> Build a small customer-management web app. Users must be able to create, edit, delete, search, and filter customers. Each customer needs name, company, email, phone, status, and notes. Include form validation, an empty state, confirmation before delete, responsive layout, and persistence using a simple local development database or another appropriate local persistence approach. Add tests for the important business behavior. Run and verify the complete app.

## Expected autonomous behavior

- PM separates data model, CRUD UI, validation, persistence, tests, and verification into sensible work.
- Worker chooses a practical implementation without requiring the user to specify every dependency.
- Reviewer tests both normal and edge cases.

## Manual checks

- Create two customers.
- Edit one customer.
- Search for it.
- Filter by status.
- Reload and confirm persistence.
- Attempt invalid email/required fields.
- Delete one customer and verify confirmation.
- Run the project's tests from ND QA/terminal.

## PASS

All CRUD paths work and data behavior survives normal reload/restart according to the chosen persistence model.

---

# QA-03 — Existing codebase: feature request from plain feedback

## User story

A developer already has a working project and gives ND only product feedback instead of an implementation specification.

## Setup

- Open an existing small React application with a list/table screen.
- Create/import it as an ND project.
- Autonomy: 3

## Paste-ready user request

> User feedback says: “It is hard to find old items and I cannot tell what is important.” Improve this experience. Decide what should change, implement it without breaking existing behavior, test it, and show me the result.

## Expected autonomous behavior

- ND interprets feedback into concrete requirements instead of asking the user to manually design every task.
- Likely improvements may include search/filter/sort, status/priority visibility, or another defensible UX solution.
- Existing architecture and components are reused rather than replaced unnecessarily.
- Reviewer checks regressions.

## Manual checks

- Existing functionality still works.
- New UX directly addresses the feedback.
- Search/filter behavior has sensible empty/no-result states.
- Changes are localized and understandable in Git diff.

## PASS

ND converts ambiguous product feedback into a useful, working, reviewed change without the human creating technical tasks.

---

# QA-04 — Bug report to diagnosis, fix, and regression test

## User story

A user reports a real bug but does not know the cause.

## Setup

Use an existing project with an intentionally introduced bug, for example a cart total that fails after quantity is changed twice or a form that loses a value on edit.

## Paste-ready user request

> Bug report: when I change an item's quantity more than once, the total sometimes becomes wrong. Reproduce the bug, find the root cause, fix it, add a regression test, run the relevant test suite, and verify the behavior in the app. Do not mark the task complete unless you can demonstrate the bug no longer occurs.

## Expected autonomous behavior

- Worker investigates before blindly editing.
- Root cause is identified.
- Fix is minimal and appropriate.
- Regression test fails before/fixes after where practical.
- Reviewer validates the reported reproduction path.

## Manual checks

- Reproduce original behavior before/against known broken version if practical.
- Change quantity repeatedly.
- Confirm totals remain correct.
- Inspect test added for the bug.

## PASS

The bug is actually fixed, a meaningful regression test exists, and unrelated behavior remains intact.

---

# QA-05 — Design feedback to real source-code change

## User story

A founder sees the running product and gives visual feedback rather than editing CSS manually.

## Setup

Use the application created in QA-01 or another existing web app.

## Paste-ready user request

> The dashboard feels too plain. Make it feel like a polished modern product: improve hierarchy and spacing, make the primary action obvious, improve the empty state, and ensure the mobile layout is excellent. Keep all existing functionality and use the project's existing design tokens/components where possible. Verify the result in Design Mode and the live app.

## Expected autonomous behavior

- Design Mode/live browser is used against the real project.
- Existing components/tokens are reused.
- Agent edits production source, not a detached mock page.
- Functional behavior remains unchanged.

## Manual checks

- Select at least one UI element with the inspector and ask for a targeted change.
- Confirm the agent changes the expected source/component.
- Test desktop and narrow width.
- Test all original controls after redesign.

## PASS

A normal visual-feedback request produces a real, targeted, functioning source change with no lost behavior.

---

# QA-06 — Multi-task feature with dependencies and independent review

## User story

A product owner requests a feature large enough that ND must coordinate multiple dependent tasks.

## Setup

Use a small existing application.

## Paste-ready user request

> Add user onboarding to this product. New users should see a three-step onboarding flow, be able to skip it, resume if they close the app halfway through, and never see it again after completion unless they reset onboarding in Settings. Add appropriate persistence and automated tests. Plan this as multiple tasks with dependencies and have an independent reviewer verify each implementation stage.

## Expected autonomous behavior

- PM creates more than one sensible task.
- Dependency ordering is correct.
- Tasks unlock only after prerequisites complete.
- Reviewer uses a separate review run/session.
- Failed work returns to blocked/rework rather than advancing.

## Manual checks

- Start onboarding.
- Close/reload halfway through and resume.
- Skip it.
- Complete it and reload.
- Reset from Settings and confirm it appears again.
- Inspect board transitions and run receipts.

## PASS

The workflow proves ND can coordinate a real multi-task feature rather than only execute one giant chat prompt.

---

# QA-07 — Reviewer rejection and autonomy-4 automatic rework

## User story

The company should detect inadequate implementation and repair it automatically within bounded limits.

## Setup

- New or existing web project.
- Autonomy: 4 — Autopilot.
- Give acceptance criteria that are easy to verify and intentionally demanding.

## Paste-ready user request

> Build a password-strength component with a live strength meter. Requirements: minimum 12 characters, uppercase, lowercase, number, symbol, clear unmet-requirement indicators, keyboard accessibility, and unit tests covering weak and strong examples. The reviewer must reject the implementation if any requirement or test is missing. If review fails, automatically rework it until it passes or the rework limit is reached.

## Expected autonomous behavior

- Implementation is reviewed against explicit criteria.
- If reviewer finds a real omission, task becomes blocked/rework rather than completed.
- Level-4 automatic rework is bounded.
- No infinite execution loop.

## Manual checks

- Test multiple weak passwords.
- Test a qualifying strong password.
- Keyboard-only interaction works.
- Inspect number of execution attempts.
- Verify a maximum of the configured bounded attempts is respected.

## PASS

Review/rework state is truthful and bounded, and final completed state satisfies all acceptance criteria.

---

# QA-08 — Human interrupts autonomous work and finishes manually

## User story

ND must remain useful to developers who want automation but occasionally take control themselves.

## Setup

Use a project with a moderate feature request.

## Paste-ready user request

> Add CSV export for the current table, including only the currently filtered rows and using human-readable column headers. Add a test and verify the downloaded CSV.

## Procedure

1. Let ND plan and begin implementation.
2. Stop the running worker while it is in progress.
3. Confirm the task is not falsely completed.
4. Manually edit one relevant project file in the editor or external editor.
5. Return to ND and tell it:

> I made a manual change to the export implementation. Inspect the current workspace, preserve my change if it is correct, finish the feature, run tests, and send it to review.

## Expected behavior

- Cancellation is recorded as interrupted/failed work, not success.
- Manual filesystem changes remain present.
- The next agent inspects current code instead of assuming its old state.
- Human changes are not gratuitously overwritten.

## Manual checks

- CSV contains only filtered records.
- Headers are readable.
- Manual change remains if valid.
- Git diff clearly shows combined human + AI work.

## PASS

ND supports mixed human/agent development without corrupting task state or discarding valid manual work.

---

# QA-09 — Restart/crash recovery during active company work

## User story

Desktop software will be closed, restarted, or crash. Company state must remain trustworthy.

## Setup

Start any multi-task project with a worker actively running.

## Procedure

1. Start a task that writes multiple files.
2. While the worker is active, close ND-DSH normally. Repeat once using a forced termination if safe in the QA environment.
3. Reopen ND-DSH.
4. Open the same company and project.
5. Inspect the task, agent, run receipt, memory, and workspace.
6. Resume/retry the work.

## Expected behavior

- Partial workspace files remain as normal filesystem state.
- Persisted `running` work is reconciled as interrupted rather than successful.
- Worker/reviewer is not stuck permanently busy.
- Execution work is recoverable from blocked state and review work returns to an appropriate review state.
- Company/project store loads without corruption.
- No silent auto-resume of an unknown partial execution.

## PASS

After restart, the human can understand exactly what happened and safely continue without repairing ND's internal state manually.

---

# QA-10 — Idea to releasable small product with Git and final QA

## User story

A solo developer wants ND to behave like a small software team from initial idea through release candidate.

## Setup

- New company: `Focus Tools`
- Mission: `Ship small, high-quality productivity software.`
- New empty project/workspace
- Autonomy: 3

## Paste-ready user request

> Build a complete Pomodoro productivity app suitable for a small beta release. It needs configurable focus/break durations, start/pause/reset, automatic focus/break transitions, completed-session count, browser notification support when permission is available, persisted settings, responsive design, accessible keyboard controls, tests for timer/state logic, and a concise README with setup instructions. Use Git sensibly, run all checks, verify the app in the built-in browser, and have a reviewer perform final release-candidate QA.

## Expected autonomous behavior

- PM plans the product from the high-level idea.
- Workers implement application, tests, and documentation.
- Browser verification covers the actual app.
- Reviewer performs final acceptance against the complete requested behavior.
- Git status is clean or clearly explains any intended uncommitted state according to the test setup.

## Manual checks

- Configure short test durations.
- Start, pause, resume, reset.
- Verify automatic phase transition.
- Verify completed-session count.
- Reload and confirm settings persist.
- Test keyboard controls.
- Confirm notification behavior is graceful when permission is denied.
- Run all project tests/checks.
- Follow README setup from a fresh shell if practical.

## PASS

A user can provide a product idea and receive a coherent, running, tested, documented release candidate while still retaining normal manual developer control.

---

# Final beta scorecard

Run all ten scenarios at least once. Before a public beta, repeat QA-03, QA-04, QA-06, QA-09, and QA-10 on a second machine/OS if available because they exercise the highest-risk existing-code, orchestration, recovery, and release paths.

Recommended release threshold:

- 10/10 scenarios have a successful run on the primary beta environment.
- No P0 data-loss, workspace-boundary, false-completion, or unrecoverable-state defect.
- No scenario requires manually editing ND-DSH's own internal state to recover.
- At least 8/10 can complete without the tester manually editing application source code.
- QA-04 bug fixing, QA-06 dependency workflow, QA-09 restart recovery, and QA-10 release candidate are mandatory passes.
- Any repeated failure in the same subsystem becomes a beta blocker even if another run happens to pass.

## What this suite is proving

The real product promise under test is:

> A user can create a company, connect or create a project, describe an idea, feature, bug, or feedback in normal language, and let ND-DSH organize and execute most of the software-development lifecycle automatically—while keeping the project transparent and fully controllable for a developer who wants to intervene manually.

That is a stronger beta criterion than “the chat works” or “the UI opens.” It tests whether ND-DSH functions as an AI software company control plane in real development work.
