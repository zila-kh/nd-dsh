# RC 0.1.1 stability plan — remaining fixes to GO

Date: 2026-09-30. Scope lock is in force (`rc-0.1.1-candidate-1`): **P0/P1
fixes and release-test changes only**; no features. This is the ordered fix
plan from the frozen candidate to a recordable GO/NO-GO. Evidence targets map
to [release-0.0.1-checklist.md](release-0.0.1-checklist.md) and
[beta-release-readiness.md](beta-release-readiness.md).

Test capacity note: the e2e provider exposes three free models
(`combo-free-1/2/3`), observed working in journey re-run #2 (gate 4). The
20-journey matrix therefore costs no provider cash and can rotate model
routes per run; one free-tier transport outage (run #1) already demonstrated
the failure path surfaces as an actionable typed error, which the audit
counts in the denominator.

## F1 — Fix the Playwright worker-teardown exit-1 (A8) — release-test fix

Status: **tests green, suite exit flaky.** Three stale selectors fixed
(Settings split into Extensions/Plugins tabs by `dbf9fcd`; Strategy card
renamed to "Automation & Agent Routines" by `146f906`) — three consecutive
full runs report **60 passed / 0 failed / 3 skipped**. The remaining
worker-teardown timeout is intermittent (~1 in 2 full runs): an abandoned
Playwright Electron dispose leaves the ref'd driver pipe + CDP sockets open.
`closeApp` bounds the dispose at 60 s with one bounded retry and sweeps dead
transport handles (f76169b); product-side shutdown is proven clean on every
close (graceful quit, `exited=true`, zero survivor processes, enforced by the
fixture). Classified as a Playwright transport leak, not a product defect.
Residual options before GO: characterize the stall with
`ND_E2E_TEARDOWN_DIAG=1` full runs, or gate A8 on "tests green" + a recorded
classification. Unblocks: `beta:automated` fully green + journey gate 20.

## F2 — Build the packaged artifact from the frozen tag

- `corepack pnpm dist:win:portable` from `rc/0.1.1` (decide D3 artifact name first — keep `ND-DSH-0.1.1-private-beta-x64.exe` unless renamed).
- Record SHA-256 into `beta-three-layer-evidence-rc-0.1.1.json` (replaces the placeholder).
- Re-run `release:smoke:core-crash` (A15) and `release:smoke:packaged` (A16) on this artifact.
- Re-run the live journey (`e2e:prod:user`) against the packaged artifact to move A10 from "fixed on source" to "verified on artifact".

## F3 — 20-journey matrix over the three free model routes (audit P0)

Design: 20 bounded `e2e:prod:user` runs, rotating the primary model route by
reordering `E2E_MODEL_1/2/3` in the environment per run (the journey already
reads these from `.env.e2e` — no script change needed). Record per run:
model route, terminal status, duration, failure class. Gate: ≥ 18 of 20
produce an acceptance-checked result; ≥ 19 of 20 reach success **or
actionable failure** within declared deadlines; **none** remain indefinitely
running. Free-tier outages count as actionable failures only when they fail
fast and visibly (run #1 is the reference); an invisible hang is a defect
against this gate.

## F4 — Packaged-RC drills and negative cases (checklist P6/P8)

On the exact artifact: cancel a running task; kill nd-core mid-task and
reopen; unavailable engine; provider down / offline; corrupted primary
organization state; rejected approval; missing credential; merge conflict;
stale-checkpoint review; dirty human checkout. Six of these have green
automated coverage (see [reliability-gate-2026-09-30.md](../qa/reliability-gate-2026-09-30.md) §5);
this pass records them on the artifact with a human tester.

## F5 — 24-hour soak (P10)

`corepack pnpm beta:soak` on the RC machine; gate rejects < 1440 minutes.
Watch: memory growth, idle CPU, orphan workers, stale leases, zombie
sidecars, progressive UI slowdown. Diagnostics at start/midpoint/end.

## F6 — Clean-machine install (P5) + docs (P11/P12)

- Install/run the exact artifact on a clean Windows VM without dev tooling; decide whether Git/Node are bundled or documented prerequisites.
- Write rollback/recovery instructions for testers (P11) and the supported OS/providers/engines + known-limitations doc (P12) — the checklist's "Known limitations to publish" section is the starting text.

## F7 — Gate and decision (P13)

`corepack pnpm beta:gate -- docs/qa/beta-three-layer-evidence-rc-0.1.1.json`,
then a human release owner records GO/NO-GO. Non-core failing areas are
disabled for beta rather than delaying the core.

## Explicitly parked until after GO (freeze)

Native-agent fast path, ND Pencil outcome work, extra engine adapters, cloud
admin, marketplace, workflow-template UI exposure, all parked feature
branches (`feat/rust-parallel-runtime-v2` etc.). In parallel with F2–F7 and
off the RC: founder-led problem interviews per
[design-partner-recruitment-kit.md](../research/design-partner-recruitment-kit.md)
— no code required.

## Sequencing

F1 → F2 → (F3 ∥ F4 → F5 → F6 → F7). F3 is the long pole (20 live runs,
~15 min each ≈ 5 hours spread over days); F4/F5 need the artifact but not the
matrix; F6/F7 are documentation and decision. If any F-step exposes a P0/P1
product defect: fix on `main`, move the tag to `rc-0.1.1-candidate-2`, and
restart the affected evidence from the new tag.
