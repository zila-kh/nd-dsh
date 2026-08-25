# Phase 1 — Beta Reliability and Verified Delivery

Status: execution plan  
Updated: 2026-08-25  
Goal: make ND-DSH reliable enough that a user can give it a real software idea, bug, or feedback and trust the result.

## North star

Phase 1 is not about adding the largest number of features. It is about making the existing company workflow dependable.

> A user creates a company and project, gives ND an objective in normal language, and ND can plan, implement, test, review, rework, recover, and present a verified result with minimal supervision.

Primary metrics:

- **Idea-to-Verified-Software Success Rate**
- **Human Attention per Verified Outcome**

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
ND Task Control Kernel
        |
        v
Assigned worker / coding engine
        |
        v
Real workspace + shell + browser
        |
        v
Evidence receipt + independent review
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
- Add organization/company snapshots before risky migrations or runtime upgrades.

## P1.2 — ND Task Control Kernel and typed turns

Do not let prompts or chat prose become the source of task lifecycle truth.

Every execution slice should enter through a small typed decision contract and return a typed result.

Suggested pre-execution routes:

```text
ready
repair_required
replan_required
human_action_required
wait
blocked
contract_error
```

Suggested post-execution results:

```text
validated_progress
validated_completion
repair_required
replan_required
human_action_required
wait
engine_failure
validation_failed
writeback_failed
budget_failed
```

Rules:

- A coding engine performs one bounded execution slice; it does not own durable task truth.
- ND owns the goal/task state, policy/gates, evidence, continuation decision, recovery, and handoff.
- `validated_completion` must be impossible without required evidence.
- Failure kinds remain first-class states rather than being collapsed into a generic failed chat turn.
- A restart reconstructs task state from durable ND records, not from model conversation memory.

## P1.3 — Exact-diff evidence receipts

A task must never be completed only because an agent says it is done.

Each task should produce an evidence receipt when relevant:

```text
Task evidence receipt
├── task / goal / worker / engine / model
├── workspace revision + Git base
├── exact diff fingerprint
├── changed files
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

Critical invariant:

```text
review PASS
    -> source changes
    -> diff fingerprint changes
    -> old receipt becomes STALE
    -> verified/merge status is removed until requalified
```

Reviewer rules:

- Reviewer uses a fresh independent session.
- Reviewer receives acceptance criteria plus implementation evidence.
- Reviewer checks the real workspace and current diff, not only the worker summary.
- UI tasks require running-app/browser evidence when available.
- Reviewer may fail work even when tests pass if acceptance criteria are not met.
- A failed review cannot silently become completed.
- A stale receipt cannot authorize merge, release, or project completion.

## P1.4 — Human Action is not always a Human Gate

ND should distinguish routine human follow-up from a decision that actually blocks execution.

Examples:

```text
Choose final logo
kind: human_action
blocks: none

Choose pricing model
kind: human_gate
blocks: pricing/**

Approve production credentials
kind: human_gate
blocks: payments.production
```

Required behavior:

- A scoped human gate blocks only the dependent action/task lane.
- Independent safe tasks continue when possible.
- The user sees one concrete question or decision instead of a vague "waiting for owner" state.
- Company Home should expose an initial `Needs You` queue even before the richer Phase 2 management surface.
- The user should not have to be the scheduler for ordinary safe work.

## P1.5 — Provider credential isolation

Secure storage is necessary but not sufficient if a powerful autonomous shell can later read the same credential from its environment.

Target boundary:

```text
OS secure store
     |
     v
ND main process / provider gateway
     |
     v
engine receives local route or non-secret runtime credential
     |
     v
model provider
```

Requirements:

- Do not copy upstream provider API keys into worker shell/tool environments when an ND-owned gateway can mediate the request.
- Treat environment filtering as defense in depth, not the primary secret boundary.
- Keep provider credentials outside child execution namespaces where supported.
- Record credential source/readiness metadata without returning secret values to the renderer or agent.
- Fail closed if a requested execution mode cannot satisfy its configured credential/security boundary.

## P1.6 — Recovery, snapshots, and safe interruption

The following must be boring and reliable:

- User stops an active worker.
- User closes ND during execution.
- ND crashes during a run.
- Primary organization state becomes corrupt but backup is valid.
- Engine disappears or becomes unhealthy.
- User edits files manually while AI work is paused.
- A runtime or schema migration fails halfway through.

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
+
old evidence is invalidated when truth changed
```

Company/project snapshots should cover durable ND control state such as projects, tasks, goals, memory, policies, skills, engine assignments, run receipts, and session metadata. Git remains the source of source-code history; ND snapshots protect the orchestration state that Git does not own.

## P1.7 — Human takeover without losing automation

The user must be able to intervene at any time.

- Pause or stop an agent.
- Edit source manually.
- Change a task or acceptance criteria.
- Change design manually.
- Run terminal commands manually.
- Resume the company workflow afterward.

ND should detect workspace changes, invalidate stale evidence, refresh context, and continue from current truth instead of overwriting the user's work or assuming stale state.

User corrections should become durable candidate operating lessons when appropriate rather than remaining only in chat.

## P1.8 — Feedback as a first-class input

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

The richer Signal Inbox and prioritization layer belongs in Phase 2.

## P1.9 — Manual real-world beta gate

Use `docs/qa/manual-beta-real-world.md` as the human acceptance suite.

Minimum beta gate:

- Run all 10 scenarios on the primary development environment.
- Mandatory passes: bug-fix scenario, dependency workflow, reviewer rejection/rework, restart recovery, and full release-candidate scenario.
- Repeat key flows from fresh workspaces.
- Record engine/model, intervention count, human-attention minutes, failure step, screenshot/evidence, and final result.
- Add at least one test that proves a previously valid evidence receipt becomes stale after a manual source edit.
- Add at least one test that proves a scoped human gate does not freeze an independent task lane.

## Phase 1 product metrics

| Metric | Phase 1 target |
| --- | ---: |
| Idea -> working application | >= 90% on beta suite |
| Final tests green | >= 98% |
| False completed tasks | < 1% |
| Stale receipt accepted as verified | 0 |
| Restart recovery | 100% on defined recovery suite |
| Browser acceptance checks passed | >= 95% |
| Autonomous rework success | >= 90% on supported cases |
| Provider secret exposed to autonomous worker shell | 0 supported secure-mode incidents |
| Wrong-workspace/wrong-file destructive edits | 0 critical incidents |
| Human attention per verified outcome | measured from beta and decreases release over release |

## Exit criteria

Phase 1 is complete when:

1. Release CI is green.
2. Installed beta can run without developer tooling.
3. Core company workflow reliably completes real small projects.
4. Task transitions are typed and durable rather than inferred from chat prose.
5. Review decisions are exact-diff and evidence-backed.
6. Scoped human gates do not unnecessarily stop safe independent work.
7. Restart/interruption recovery and snapshot restore are proven.
8. Worker credential isolation is fail-closed for supported secure modes.
9. Manual QA suite passes at the agreed beta threshold.
10. A user can take over manually and safely resume automation.

Only then should ND optimize for scale and competitive differentiation in Phase 2.
