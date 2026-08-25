# Phase 1 — Beta Reliability and Verified Delivery

Status: execution plan  
Updated: 2026-08-25  
Goal: make ND-DSH reliable enough that a user can give it a real software idea, bug, or feedback and trust the result.

## North star

Phase 1 is not about adding the largest number of features. It is about making the existing company workflow dependable.

> A user creates a company and project, gives ND an objective in normal language, and ND can plan, implement, test, review, rework, recover, and present a verified result with minimal supervision.

## Required user journey

```text
Idea / bug / feedback
        |
        v
Company + Project
        |
        v
AI PM plan
        |
        v
Goal -> milestones -> dependency-aware tasks
        |
        v
Assigned worker
        |
        v
Real workspace + shell + browser
        |
        v
Evidence-based independent review
        |
        +--> PASS -> memory -> next task
        |
        +--> FAIL -> bounded rework
        |
        v
Verified project result
```

## P1.1 — Fix beta blockers first

- Make the full repository CI gate green on the release commit.
- Fix Playwright/Electron teardown so E2E failures represent product failures, not fixture shutdown bugs.
- Require clean `verify`, `typecheck`, unit, build, and desktop E2E before a beta tag.
- Add installed-app E2E for supported platforms before public beta.
- Package every runtime dependency required by ND Harness and browser automation.
- Add signed/notarized installers and safe update behavior.
- Add engine health/onboarding so an unavailable engine cannot be assigned as if it were ready.

## P1.2 — Evidence-based completion

A task must never be completed only because an agent says it is done.

Each task should produce an evidence pack when relevant:

```text
Task evidence
├── changed files / diff
├── build result
├── type / lint result
├── unit tests
├── integration or E2E tests
├── browser actions
├── screenshots
├── console errors
├── network errors
├── acceptance-criteria checks
├── reviewer verdict
└── rework history
```

Reviewer rules:

- Reviewer uses a fresh independent session.
- Reviewer receives acceptance criteria plus implementation evidence.
- Reviewer checks the real workspace, not only the worker summary.
- UI tasks require running-app/browser evidence when available.
- Reviewer may fail work even when tests pass if acceptance criteria are not met.
- A failed review cannot silently become completed.

## P1.3 — Recovery and safe interruption

The following must be boring and reliable:

- User stops an active worker.
- User closes ND during execution.
- ND crashes during a run.
- Primary organization state becomes corrupt but backup is valid.
- Engine disappears or becomes unhealthy.
- User edits files manually while AI work is paused.

Expected recovery:

```text
work on disk survives
+
run is not falsely successful
+
worker is not permanently busy
+
task state is recoverable
+
company/project state remains valid
```

## P1.4 — Human takeover without losing automation

The user must be able to intervene at any time.

- Pause or stop an agent.
- Edit source manually.
- Change a task or acceptance criteria.
- Change design manually.
- Run terminal commands manually.
- Resume the company workflow afterward.

ND should detect workspace changes, refresh context, and continue from current truth instead of overwriting the user's work or assuming stale state.

## P1.5 — Feedback as a first-class input

Support normal product inputs, not only implementation prompts:

- product idea
- feature request
- bug report
- customer feedback
- screenshot
- design feedback
- failed test
- console error

Initial Phase 1 behavior can be simple, but the PM should turn these inputs into scoped work automatically.

Example:

```text
"Customers say signup is confusing"
        |
        v
inspect current signup
        |
        v
create hypothesis + acceptance criteria
        |
        v
plan task
        |
        v
implement
        |
        v
browser verify
        |
        v
independent review
```

## P1.6 — Manual real-world beta gate

Use `docs/qa/manual-beta-real-world.md` as the human acceptance suite.

Minimum beta gate:

- Run all 10 scenarios on the primary development environment.
- Mandatory passes: bug-fix scenario, dependency workflow, reviewer rejection/rework, restart recovery, and full release-candidate scenario.
- Repeat key flows from fresh workspaces.
- Record engine/model, intervention count, failure step, screenshot/evidence, and final result.

## Phase 1 product metrics

Track at minimum:

| Metric | Phase 1 target |
| --- | ---: |
| Idea -> working application | >= 90% on beta suite |
| Final tests green | >= 98% |
| False completed tasks | < 1% |
| Restart recovery | 100% on defined recovery suite |
| Browser acceptance checks passed | >= 95% |
| Autonomous rework success | >= 90% on supported cases |
| Wrong-workspace/wrong-file destructive edits | 0 critical incidents |

## Exit criteria

Phase 1 is complete when:

1. Release CI is green.
2. Installed beta can run without developer tooling.
3. Core company workflow reliably completes real small projects.
4. Review decisions are evidence-backed.
5. Restart/interruption recovery is proven.
6. Manual QA suite passes at the agreed beta threshold.
7. A user can still take over manually and safely resume automation.

Only then should ND optimize for scale and competitive differentiation in Phase 2.
