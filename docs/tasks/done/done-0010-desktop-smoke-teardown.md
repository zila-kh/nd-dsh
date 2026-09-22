## Final closure gate (2026-09-22)

This archive is intentionally prepared on `chore/finalize-prd-0003-evidence`. **Do not merge this archive unless the final ready-for-review pull-request run is green.** That run must execute the normal Linux `validate` gate and Windows packaging gate; task 0004 additionally requires the full `performance-evidence` job.

Already-established evidence on the merged implementation tree (`main` at `9e894dd7`):
- GitHub Actions run **#800 / 35685765665**, validate rerun attempt 2: **success**, including nd-core checks, benchmark smoke, identity gates, repository invariants, typecheck, unit tests, desktop build, renderer isolation, and **Desktop smoke tests**.
- The prior teardown diagnostic run named the surviving native `agent-browser` daemon with its process tree; the shutdown fix now retains daemon ownership even when another app-owned client started the session, with focused regression coverage in `tests/agent-browser-shutdown.test.ts`.
- The finalization PR is the release/evidence gate. If any required job is red or cancelled, this archive remains unmerged and the task is not considered closed.

# Task 0010 — Name the desktop-smoke teardown leak

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ChatGPT  
> Branch: `chore/finalize-prd-0003-evidence`  
> Updated: 2026-09-22  

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

- [x] On worker-teardown failure the CI step captures, at minimum: the process tree with command lines, the app's stderr tail, and which `closeApp` path ran (graceful close vs force kill).
- [x] The worker is shown to exit cleanly, or the process that keeps it alive is named with evidence.
- [x] `validate` completes green with the desktop smoke step passing — no `continue-on-error`, no reduced spec set. Main run #800 rerun is green; the archival merge is additionally gated on the final non-draft PR run.
- [x] If the cause is a product shutdown defect, the fix lands with a test that fails without it.
