# Pilot measurement plan

Date: 2026-09-30. Companion to the [market audit](market-audit-2026-09-30.md)
and the [recruitment kit](design-partner-recruitment-kit.md). This defines how
the five supervised design partners are measured during the four-week pilot
and which numbers open which roadmap gates.

## Primary outcome

**Accepted client tasks per active partner per week.** A task counts only when
all of the following hold:

1. Acceptance criteria were declared before the work started.
2. Required checks (test command, build, lint as declared) ran and passed.
3. An explicit human reviewer accepted the result. A green agent review or a
   completed run alone is weaker evidence and is recorded separately.

## Decision gates

| Gate | Threshold | Consequence if missed |
| --- | --- | --- |
| Activation | 4 of 5 partners complete a first accepted task | Fix onboarding/job fit before any roadmap expansion |
| Retention | 3 of 5 partners run ND in each of 4 consecutive weeks | Fix recurring friction; do not broaden the roadmap |
| Value | ≥ 20% lower median human active time on matched task classes, no increase in seven-day defects | Re-examine the job before claiming productivity |
| Trust | Zero observed cross-client leaks, human work loss, unapproved external actions | Any incident pauses the pilot and is root-caused first |
| Reliability | Failures, cancellations, timeouts retained in the denominator of every rate reported | — (reporting rule) |

Small-sample honesty: five partners is directional evidence only. Report
numerator/denominator and spread; never present a pilot result as statistical
proof.

## Capture fields (per task)

Anonymized partner ID and task ID; date; build/version and OS; engine and
model version (fixed per partner where feasible); ticket class; baseline tool
used for the matched comparison; start/end timestamps; human active minutes
(setup, supervision, review, rework tracked separately); checks run and
results; retries; cancellations; failures and timeouts (with cause class);
integration state; reviewer verdict (accept/rework); actual cash cost and
estimated provider value, disclosed separately; defects discovered within
seven days.

Prefer opt-in local export from ND's diagnostics; no client code or secrets
leave the partner machine in the measurement file.

## Baseline rules

- The primary baseline is the partner's **actual existing workflow** for the
  same task class, measured before or alongside the pilot.
- Match total scope when comparing parallelism; rotate comparable task classes
  across partners.
- Never re-use an already solved task as if it were new work.
- Where engine/model/budget configurations differ, label the comparison a
  workflow comparison, not an engine benchmark.

## Weekly reporting format

One row per partner per week in the tracking workbook: tasks attempted,
accepted, rework-requested, failed/cancelled (counts, in the denominator),
median human active minutes per accepted task, seven-day defects, and one
verbatim partner quote about what nearly stopped them.

## Gates for broadening the roadmap (audit)

Broader engine, cloud, and native-agent investment stays deferred until both:

1. 4 of 5 partners complete a first accepted task, **and**
2. at least 3 return for four consecutive weeks.

Then reopen, in order: delivery receipt depth, cost-per-accepted-task
reconciliation, the second pilot engine route, external handoff integration,
and only after those, ND Pencil outcome work and the native-agent fast path.
