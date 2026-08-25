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
        |
        v
Signals / feedback / production evidence
        |
        +-----------------------> next governed company loop
```

The user should supervise outcomes, priorities, budget, and policy boundaries rather than micromanage every implementation step.

ND should follow three long-horizon rules:

1. If safe valuable work exists, keep working.
2. If no verified useful transition exists, stop spending.
3. If human judgment is required, surface one concrete decision and continue unrelated safe lanes when possible.

## P3.1 — Complete ship pipeline

ND should not stop at "code generated".

Target release flow:

```text
Task completion
    -> integration branch/worktree
    -> exact-diff evidence qualification
    -> automated test matrix
    -> independent release review
    -> pull request
    -> CI status
    -> preview environment
    -> human/policy approval when required
    -> production deployment
    -> post-deploy verification
    -> release notes
    -> Company Brain + audit receipt
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
- release receipt linked to the exact reviewed diff and deployment evidence

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
capability/provider
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
- actor/engine/model/tool/capability provenance
- approval identity and timestamp
- result/evidence linked to the decision
- scoped gates block only the affected authority/write scope when possible

## P3.3 — `shouldRun()` compute governance

Autonomy and compute budget solve different problems.

```text
Autonomy
What is ND allowed to do?

Compute/Budget
How much automatic work may ND consume?
```

Before every automatic continuation, ND should evaluate one machine-readable scheduling contract:

```text
scheduler wakes
      |
      v
ND shouldRun(goal/task/lane)
      |
      +--> health / engine ready?
      +--> policy / authority?
      +--> human gate scope?
      +--> dependency ready?
      +--> task lease valid?
      +--> evidence wait?
      +--> useful advancement available?
      +--> budget / quota available?
      |
      +--> RUN bounded turn
      +--> WAIT until condition/time
      +--> ASK user
      +--> REPAIR/REPLAN
      +--> QUIET NO-OP
```

A scheduler tick is never permission by itself.

Requirements:

- company/project/goal compute quotas
- monetary/token/runtime budgets when measurable
- max parallel worker limits
- task-class-aware routing so monitor-only work does not consume delivery budget without material change
- validated writeback before accounting a successful delivery turn
- idempotent budget/spend receipts
- pause/resume controls
- engine/rate-limit-aware backoff
- quiet no-op when nothing useful changed

Example operator policy:

```text
Project: Restaurant SaaS
Autonomy: 4
Daily budget: $20
Max parallel workers: 4

Research: 20%
Implementation: 55%
Review: 15%
QA: 10%
```

## P3.4 — Scheduled and conditional company workflows

Companies should operate over time, not only while the user is actively prompting.

Examples:

- Run dependency/security review every week.
- Check production health after a release.
- Triage new GitHub issues each morning.
- Re-run failed QA when a dependency fix lands.
- Watch CI for a release branch and open a rework task if it fails.
- Prepare a daily engineering status summary.
- Revisit deferred work only when its evidence/gate changes.

Requirements:

- `shouldRun()` immediately before execution
- bounded retries
- duplicate-run prevention
- policy-aware execution
- budget controls
- clear ownership and audit trail
- human escalation for risky/ambiguous actions
- no-spend quiet monitoring when there is no material transition
- explicit stop conditions so autonomous loops do not run forever because a timer exists

## P3.5 — Long-horizon company state and recovery

A company objective may outlive any one thread, agent, engine, plan, or application session.

ND should treat durable goals as lifetime intentions with bounded execution authority.

Durable company state should preserve:

- objective and current scope
- current plan/dependencies
- user actions and scoped gates
- task leases/ownership
- evidence receipts and freshness
- run history/handoffs
- budgets/quota
- operating lessons
- current blockers/waits
- latest verified result

Executors remain replaceable. If Claude/Codex/Harness disappears, a new engine should be able to resume from ND truth rather than reconstructed chat memory.

Recovery acceptance must include:

- process/app restart
- host reboot
- engine crash
- expired task lease
- stale task writer
- duplicate scheduler wake
- partially committed spend/writeback
- company snapshot restore

## P3.6 — Portfolio and cross-project planning

Company-level intelligence should work across projects.

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
- strategic anchors that prevent the company from chasing every incoming signal

## P3.7 — Autonomous signal and feedback operations

At maturity, ND should continuously turn real product signals into reviewed work only when they are worth promoting.

Sources can include:

- customer/support feedback
- GitHub issues
- crash/error reports
- product analytics summaries
- QA failures
- security alerts
- design review notes
- user-submitted screenshots
- CI/deployment/production evidence

Target loop:

```text
Signal
 -> classify
 -> correlate with Company Brain
 -> reproduce/validate when needed
 -> estimate impact/confidence
 -> ignore / evidence / ask / todo / objective / anchor
 -> schedule/assign when promoted
 -> implement
 -> verify/review
 -> prepare release
 -> observe outcome
```

Low-confidence or high-impact product decisions should escalate to the user instead of guessing.

## P3.8 — Multi-user and enterprise controls

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

## P3.9 — Cost, quality, attention, and SLO management

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
human questions
human approvals
manual corrections
attention minutes
final success
```

Use this to manage:

- company/project budgets
- cost per completed/verified task
- cost per successful release
- first-pass review rate
- rework rate
- delivery latency
- engine reliability
- model quality by task type
- human attention per verified feature
- worker/team SLOs

The PM/CTO layer should optimize for verified business outcomes under quality, cost, latency, privacy, and human-attention constraints.

A worker that completes many tasks but repeatedly asks avoidable questions or creates rework is not a high-value employee.

## P3.10 — Long-horizon soak testing

Short demos are not proof of an autonomous software company.

Add controlled soak suites that run real ND workflows over longer elapsed lifetimes:

```text
1-hour repeated task/recovery loop
24-hour company workflow
72-hour multi-project workflow
7-day controlled soak before stronger autonomy claims
```

Soak scenarios should exercise:

- scheduled wakes and quiet skips
- budget exhaustion/resume
- human gate waiting and later continuation
- task lease expiry/recovery
- engine health loss/failover
- CI/evidence waiting
- restart and snapshot restore
- stale evidence invalidation
- multiple signal arrivals
- bounded replan/rework

Measure elapsed lifetime separately from actual model execution time; do not market a 72-hour goal as 72 hours of continuous compute.

## P3.11 — ND Real Software Benchmark

ND needs its own benchmark to prove the product thesis.

Primary metrics:

> **Idea-to-Verified-Software Success Rate**

> **Human Attention per Verified Outcome**

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
| Stale evidence accepted as current | 0 |
| Final CI green | > 99% |
| Browser acceptance passed | > 98% supported UI tasks |
| Successful automatic rework | > 95% |
| Recovery from defined interruption cases | 100% |
| Risky external actions without required approval | 0 |
| Wrong project/workspace destructive edits | 0 |
| Human attention per verified feature | materially lower than best single-harness baseline |

Benchmark cases should include:

- greenfield app
- existing-code feature
- ambiguous customer feedback
- reproducible bug
- UI/design change
- backend/data migration
- dependency-heavy multi-task feature
- reviewer rejection/rework
- scoped human gate while unrelated tasks continue
- restart/recovery
- scheduled/conditional follow-up
- full release candidate

## P3.12 — The final UX

A new user should be able to do something like:

```text
Company: Acme
Mission: Build software for small restaurants

Project idea:
"Build a SaaS where restaurants create QR menus and customers order from their phones."

Quality: Maximum
Budget: $25
Autonomy: Workflow
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
feedback/signal intake
```

The Company Home should feel like supervising a software organization:

```text
ACME SOFTWARE

Needs You                     2
Approve production deployment
Choose subscription pricing

AI Team
4 working · 1 reviewing · 1 waiting

Today
12 verified tasks
3 reviews
1 rework
$8.42 spent
6 human-attention minutes

Projects
Restaurant SaaS         72%
Inventory App           91%
Website                 100%

Ready to Review              3
Watching                     2
```

The final project result should look more like:

```text
Project ready for approval

27 verified tasks completed
348 tests passing
12 browser flows verified
0 console errors
responsive QA passed
independent review passed
release checks passed

Cost: $X
Human attention: Y minutes
Evidence: current exact diff

[Open App] [Review Evidence] [Ship]
```

than a chat message claiming the code is done.

## Phase 3 exit criteria

Phase 3 is complete when:

1. ND can take a product objective through a complete reviewed release workflow.
2. Parallel teams, engine routing, Company Brain, policy, leases, budgets, and evidence work together reliably.
3. External/release actions are governed by normalized policies and durable audit receipts.
4. Automatic continuations pass through a deterministic `shouldRun()`/quota contract instead of timer or prompt logic alone.
5. Scheduled/conditional workflows can safely operate a company over time without wasting compute when no useful transition exists.
6. Long-horizon recovery is proven across restarts, lease expiry, engine failure, duplicate wakes, and state restore.
7. Cross-project planning, strategic anchors, and budgets are functional.
8. Human attention is measurable and materially reduced while verification quality stays high.
9. ND's real-software benchmark shows a material end-to-end advantage over using individual harnesses alone.

At that point ND's differentiated claim is not "best coding model". It is:

> **ND is the software-company operating system that turns ideas, feedback, and real-world signals into verified shipped software using the best available AI workers while minimizing the human attention required to supervise them.**
