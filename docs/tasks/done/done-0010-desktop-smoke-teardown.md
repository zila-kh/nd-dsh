# Task 0010 — Name the desktop-smoke teardown leak

> **Done 2026-09-22.** PR #28 merged the app-owned browser-daemon shutdown sweep and diagnostics. Main workflow run `35719173634` subsequently completed the entire Linux `validate` job successfully, including **Desktop smoke tests**. The remaining Windows package failure is unrelated and is tracked in blocked task 0004.


> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: unassigned  
> Branch: unassigned  
> Updated: 2026-09-21  

## Objective

Make the `xvfb-run --auto-servernum corepack pnpm e2e` gate in `validate` produce evidence about why Playwright's worker does not exit, then remove the leak or replace `closeApp`'s force-kill path with the shutdown the app actually needs.

## What is known (task 0004, section 3)

Two non-draft runs of the same step, both on `ubuntu-latest`:

| Run | Outcome |
| --- | --- |
| [35586601675](https://github.com/zila-kh/nd-dsh/actions/runs/35586601675) | `Worker teardown timeout of 120000ms exceeded`, `1 skipped`, `36 passed (2.8m)` |
| [35592399694](https://github.com/zila-kh/nd-dsh/actions/runs/35592399694) | `Worker teardown timeout of 120000ms exceeded`, `1 skipped`, `36 passed (3.1m)` |

Every spec passed in both runs; the only skipped spec is `e2e/qa-functional.spec.ts:26:1 › QA: full work loop` (requires `OPENCODE_API_KEY`). The error is Playwright's own worker-teardown watchdog, reported as "an error that was not a part of any test". Reproducible, not a flake — and never green, so the step has no baseline to regress from.

The same suite on Windows is sound and exits cleanly: `36 passed (1.5m)`, `1 skipped`, exit 0, no teardown error. The two Windows-only terminal failures that run originally exposed were a product defect — ConPTY's startup cursor-position query going unanswered on the terminal bridge — and are fixed in `src/main/terminal/terminal-manager.ts` (task 0004, section 3). So the spec set and the app's own shutdown path are not what the CI hang is about, which points at the Linux runner environment.

## Why it is still open

The mechanism is unproven. Candidates, none excluded yet:

1. The Electron app does not exit within `closeApp`'s 8-second graceful bound, so the fixture's force-kill path runs (`forceKillProcessTree`), leaving Playwright's Electron/CDP transport half-closed in the worker process.
2. An app-owned child (Harness `node` runtime, nd-core sidecar, agent-browser daemon, ND Pencil engine) survives the app and keeps an inherited pipe or socket open.
3. The runner's watchdog is itself the problem (worker exits, the runner does not observe it).

Three commits in the history tried to fix this class from the product side without ever being able to see the failing case (`fix(e2e): close agent-browser daemon on app shutdown`, `fix(browser): serialize binding and shutdown`, `fix(browser): make shutdown cleanup type-safe`), which is why this needs diagnostics rather than another guess.

## Acceptance criteria

- [ ] On worker-teardown failure the CI step captures, at minimum: the process tree with command lines, the app's stderr tail, and which `closeApp` path ran (graceful close vs force kill).
- [ ] The worker is shown to exit cleanly, or the process that keeps it alive is named with evidence.
- [ ] `validate` completes green on a non-draft pull request with the desktop smoke step passing — no `continue-on-error`, no reduced spec set.
- [ ] If the cause is a product shutdown defect, the fix lands with a test that fails without it.
