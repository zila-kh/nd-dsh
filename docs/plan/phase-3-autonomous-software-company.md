# Phase 3 — Autonomous Software Company and Shipping

Status: execution plan  
Updated: 2026-08-25  
Goal: make ND-DSH capable of operating a software company workflow from business objective to reviewed release with bounded human oversight.

## Product end state

The target experience is:

```text
Create Company
        |
        v
Describe product/business objective
        |
        v
ND researches + plans + designs
        |
        v
Parallel AI teams implement
        |
        v
Tests + browser/device QA
        |
        v
Independent reviews + rework
        |
        v
Security/release checks
        |
        v
PR / CI / preview / deploy approval
        |
        v
Release + durable company knowledge
```

The user should supervise outcomes and policy boundaries rather than micromanage every implementation step.

## P3.1 — Complete ship pipeline

ND should not stop at "code generated".

Target release flow:

```text
Task completion
    -> integration branch/worktree
    -> automated test matrix
    -> independent release review
    -> pull request
    -> CI status
    -> preview environment
    -> human/policy approval when required
    -> production deployment
    -> post-deploy verification
    -> release notes
    -> memory + audit receipt
```

Capabilities:

- branch/PR creation through policy gates
- CI status ingestion and failure triage
- preview deployment integration
- release checklist
- deployment approval and policy enforcement
- rollback plan and rollback action
- post-deploy smoke verification
- release notes generated from actual changes/evidence
- version/tag/release handling

Sensitive actions such as external publish and production deploy must remain explicit policy actions.

## P3.2 — Normalized action/policy envelope

All engines and tools should emit enough metadata for ND to govern actions consistently.

Target envelope:

```text
action
target
scope
risk
externality
destructive_level
cost
credential_scope
engine
model
agent
task
provenance
requested_at
```

Policies evaluate normalized actions, not prompt wording.

Examples:

- source.read
- source.write
- shell.execute
- git.commit
- git.push
- pull_request.create
- browser.external_write
- message.send
- deployment.preview
- deployment.production
- data.destructive
- money.spend

Required properties:

- fail closed when required metadata is missing
- durable decision receipt
- actor/engine/model/tool provenance
- approval identity and timestamp
- result/evidence linked to the decision

## P3.3 — Scheduled and conditional company workflows

Companies should operate over time, not only while the user is actively prompting.

Examples:

- Run dependency/security review every week.
- Check production health after a release.
- Triage new GitHub issues each morning.
- Re-run failed QA when a dependency fix lands.
- Watch CI for a release branch and open a rework task if it fails.
- Prepare a daily engineering status summary.

Requirements:

- bounded retries
- duplicate-run prevention
- policy-aware execution
- budget controls
- clear ownership and audit trail
- human escalation for risky/ambiguous actions

## P3.4 — Portfolio and cross-project planning

Company-level intelligence should work across projects.

The company can manage:

```text
Company objective
├── Project A
│   ├── milestone
│   └── tasks
├── Project B
│   ├── milestone
│   └── tasks
└── Shared platform work
```

Capabilities:

- cross-project objectives
- shared dependency detection
- workforce/resource allocation
- priority balancing
- company-wide budgets
- project health/SLO reporting
- identify duplicated work across projects
- shared architecture/design policies
- company-level release calendar

## P3.5 — Autonomous issue and feedback operations

At maturity, ND should continuously turn real product signals into work.

Sources can include:

- customer/support feedback
- GitHub issues
- crash/error reports
- product analytics summaries
- QA failures
- security alerts
- design review notes
- user-submitted screenshots

Target loop:

```text
Signal
 -> classify
 -> correlate with Company Brain
 -> reproduce/validate
 -> estimate impact
 -> create objective/task
 -> schedule/assign
 -> implement
 -> verify/review
 -> prepare release
```

Low-confidence or high-impact product decisions should escalate to the user instead of guessing.

## P3.6 — Multi-user and enterprise controls

When ND moves beyond a single-user desktop product, add:

- user/team accounts
- organization roles
- administrative controls
- enterprise identity/SSO
- managed policy/configuration
- audit export
- retention controls
- organization backup/restore
- remote supervision
- approval from trusted secondary clients
- secrets/credential governance
- quotas and budgets

The company control plane remains the source of truth regardless of which coding engine executes a task.

## P3.7 — Cost, quality, and SLO management

Every run should produce measurable operational data:

```text
engine
model
agent
role
task type
tokens
cost
latency
tests
review result
rework count
human interventions
final success
```

Use this to manage:

- company/project budgets
- cost per completed task
- cost per successful release
- first-pass review rate
- rework rate
- delivery latency
- engine reliability
- model quality by task type
- worker/team SLOs

The PM/CTO layer should optimize for business constraints, not only raw model quality.

## P3.8 — ND Real Software Benchmark

ND needs its own benchmark to prove the product thesis.

Primary metric:

> **Idea-to-Verified-Software Success Rate**

Run the same real-world projects with:

```text
Claude Code alone
Codex alone
Gemini CLI alone
goose alone
ND Harness alone
ND + each supported engine
ND multi-worker company mode
```

Measure end-to-end outcomes rather than only coding benchmark scores.

Core metrics:

| Metric | Long-term target |
| --- | ---: |
| Idea -> verified working software | > 95% benchmark suite |
| Tasks completed without human implementation | > 95% |
| False completed tasks | < 0.5% |
| Final CI green | > 99% |
| Browser acceptance passed | > 98% supported UI tasks |
| Successful automatic rework | > 95% |
| Recovery from defined interruption cases | 100% |
| Risky external actions without required approval | 0 |
| Wrong project/workspace destructive edits | 0 |

Benchmark cases should include:

- greenfield app
- existing-code feature
- ambiguous customer feedback
- reproducible bug
- UI/design change
- backend/data migration
- dependency-heavy multi-task feature
- reviewer rejection/rework
- restart/recovery
- full release candidate

## P3.9 — The final UX

A new user should be able to do something like:

```text
Company: Acme
Mission: Build software for small restaurants

Project idea:
"Build a SaaS where restaurants create QR menus and customers order from their phones."
```

ND should be able to handle, within configured policy/autonomy:

```text
research
requirements
architecture
design
planning
task dependencies
worker assignment
parallel implementation
database/frontend/backend
testing
browser QA
independent review
automatic rework
security/release review
Git/PR
CI
preview
release approval
post-release verification
```

The final user-facing result should look more like:

```text
Project ready for approval

27 tasks completed
348 tests passing
12 browser flows verified
0 console errors
responsive QA passed
review passed
release checks passed

Cost: $X

[Open App] [Review Evidence] [Ship]
```

than a chat message claiming the code is done.

## Phase 3 exit criteria

Phase 3 is complete when:

1. ND can take a product objective through a complete reviewed release workflow.
2. Parallel teams, engine routing, Company Brain, policy, and evidence work together reliably.
3. External/release actions are governed by normalized policies and durable audit receipts.
4. Scheduled/conditional workflows can safely operate a company over time.
5. Cross-project planning and budgets are functional.
6. ND's real-software benchmark shows a material end-to-end advantage over using individual harnesses alone.

At that point ND's differentiated claim is not "best coding model". It is:

> **ND is the software-company operating system that turns ideas and feedback into verified shipped software using the best available AI workers.**
