# PM full-stack delivery journey — first live result

Date: 2026-09-30. Driver: [e2e/pm-fullstack.mjs](../../e2e/pm-fullstack.mjs).
Evidence: `e2e-results/pm-fullstack-2026-09-30T11-00-44/` (summary, final
state, run receipts, driver log, integrated test output).

## What ran

One fresh profile, one company (**FullStack Labs**), one project (**Notes
Web**) in a seeded git workspace, with a bounded full-stack objective:
dependency-free Node HTTP backend (`GET/POST /api/notes`), static frontend,
`node:test` API coverage, README. The driver only created the company/project
through the visible UI, clicked the visible **AI PM plan** button, set
autonomy 4 (Autopilot), and auto-answered approval prompts — everything else
was the product.

## Result — 8/8 gates pass

| Gate | Result |
| --- | --- |
| Workspace bound to the seeded project repo | PASS |
| AI PM planned a multi-task graph | PASS — 5 coherent tasks: HTTP server + static handler → frontend → test suite → README → delivery/constraint verification |
| All planned tasks completed | PASS — 5/5 `completed`, ~10 min build time (11.2 min wall incl. setup) |
| Integration into the base checkout | PASS — all 5 tasks `integrationState: "integrated"` with merge-back commit heads |
| Independent review ran | PASS — 5 review runs |
| Declared artifacts exist in the integrated workspace | PASS — server.js, public/index.html, public/app.js, server.test.js, README.md |
| `node --test` passes in the integrated workspace | PASS — exitCode 0 |
| No renderer/page errors | PASS |

## Notes

- One harness gate initially failed because it read `integrationState` from
  runs instead of tasks (where ND records integration, with `integratedHead`);
  corrected post-run and verified against the captured final state. The
  product behavior was correct; the assertion was not.
- This is the audit's "activation" demonstration on a single bounded task: a
  lead-shaped input (ticket + repo) produced a tested, reviewed, integrated
  deliverable with no founder steering. It is one run of one task class — the
  design-partner pilot (4 of 5 first accepted tasks; 4-week retention) remains
  the actual evidence bar.

## Fixtures note (A8)

`closeApp` now bounds Playwright's Electron dispose at 60 s with one bounded
retry and sweeps dead driver-transport handles (pipe + CDP sockets) — the
worker-teardown watchdog flake is a Playwright transport leak, not product
shutdown (product exit verified graceful with zero survivors on every close).
