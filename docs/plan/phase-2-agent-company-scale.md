# Phase 2 — Agent Company Scale and Differentiation

Status: execution plan  
Updated: 2026-08-25  
Goal: move ND-DSH from a reliable autonomous developer into a true multi-worker AI software company that is better than using any individual harness alone.

## Product thesis

Phase 2 is where ND stops competing as another coding agent.

> Claude Code, Codex, Gemini CLI, goose, ND Harness, and future systems are workers. ND owns the company, project, task graph, authority, memory, verification, routing, durable state, and human-attention surface around them.

The user should manage outcomes, priorities, budget, and judgment. ND should manage workers, contexts, leases, evidence, routing, and continuation.

## P2.1 — Parallel AI teams with per-task leases

Replace the one-active-run ceiling with safe parallel project execution.

Target model:

```text
Project
├── Task A -> lease A -> worktree A -> Worker 1
├── Task B -> lease B -> worktree B -> Worker 2
├── Task C -> lease C -> worktree C -> Worker 3
└── Task D -> lease D -> worktree D -> Worker 4
                                    |
                                    v
                               Review queue
                                    |
                                    v
                               Merge queue
```

Each parallel task needs:

- isolated Git worktree or equivalent workspace isolation
- isolated process/dev-server lifecycle
- isolated browser target/session
- unique port allocation
- scoped secrets and credentials
- scoped MCP/tools/skills
- resource/cost budget
- cancellation and cleanup
- conflict detection before merge
- deterministic merge/rebase/rework state

A task lease should include at minimum:

```text
task_id
owner_agent
lease_version
lease_epoch
TTL / expiry
write_scope
workspace/worktree
idempotency key
```

Rules:

- The contention unit is a task, not the entire project.
- Different tasks may run in parallel when dependencies, write scopes, and policies allow it.
- A stale lease/version cannot write terminal task state.
- Overlapping write scopes should warn or block before execution rather than after corrupted parallel work.
- Lease transfer/release is explicit and auditable.
- PM only parallelizes work whose dependency graph and write boundaries permit it.

## P2.2 — Universal coding-engine contract

ND should expose one engine contract and keep vendor-specific details outside Company, Project, Task, Role, Skill, and Workflow objects.

Target capabilities:

```text
health()
capabilities()
startTask()
resumeTask()
cancelTask()
streamEvents()
requestApproval()
getUsage()
getChangedFiles()
getArtifacts()
getSessionState()
```

Priority adapters:

1. ND Harness
2. Codex direct app-server
3. Claude Code
4. Gemini CLI
5. goose / ACP-compatible workers
6. local/offline engine
7. remote/cloud worker

Engine switching must not require rebuilding company skills, memory, policy, or workflows.

Cross-runtime work should be normal:

```text
Claude implements
      |
      v
ND exact-diff evidence
      |
      v
Codex reviews
      |
      v
Harness runs project verification
      |
      v
ND decides PASS / REWORK
```

## P2.3 — ND Capability / Provider / Extension model

Separate the stable outcome contract from how it is implemented or installed.

```text
Capability
"what outcome is available?"

Provider
"what implementation performs it?"

Extension
"how is an optional provider installed, updated, disabled, or rolled back?"
```

Example:

```text
Capability: issue.read
  -> GitHub native provider
  -> GitHub MCP provider
  -> gh CLI provider
```

Suggested ND capabilities:

```text
code.implement
code.review
qa.verify
browser.inspect
browser.verify
design.inspect
design.modify
git.commit
git.publish
issue.read
issue.fix
deployment.preview
deployment.production
communication.send
```

Requirements:

- Company policy reasons about capabilities/actions, not vendor-specific tool names when possible.
- Providers declare readiness, required permissions, write boundaries, and supported evidence.
- Extension lifecycle is explicit and fail-closed; install/enable/update/rollback does not silently grant authority.
- Engine capabilities are observed execution support, not permission grants.
- Capability discovery should produce one inspectable resolved view per worker/run.

## P2.4 — Smart model and engine routing

Users should not need to constantly choose models manually.

Let users express intent such as:

```text
Quality: Maximum
Budget: $20
Priority: Fast
Privacy: Local-only where possible
```

ND selects routes using:

- task type
- repository history
- model/tool capability
- engine health
- latency
- rate limits
- token/cost budget
- first-pass review rate
- rework rate
- human-attention cost
- browser/vision needs
- policy constraints

Record every decision so routing can improve from actual outcomes.

Example learned metric:

```text
Backend refactor
Codex
first-review pass: 94%
average cost: $1.82
average rework: 0.3
human corrections: low
```

Routing should optimize verified outcomes and attention cost, not benchmark reputation alone.

## P2.5 — Company Brain and operating lessons

Upgrade flat durable memory into structured company knowledge.

Target knowledge domains:

```text
Company Brain
├── Product
│   ├── mission
│   ├── customers
│   ├── terminology
│   └── decisions
├── Architecture
│   ├── services
│   ├── dependencies
│   ├── APIs
│   ├── database
│   └── ADRs
├── Code
│   ├── symbols
│   ├── ownership
│   ├── tests
│   └── hotspots
├── Design
│   ├── tokens
│   ├── components
│   ├── screenshots
│   └── patterns
├── History
│   ├── bugs
│   ├── failed approaches
│   ├── releases
│   └── incidents
├── Feedback
│   ├── feature requests
│   ├── complaints
│   └── observations
└── Operating Lessons
    ├── architecture preferences
    ├── review expectations
    ├── product rules
    └── repeated failure avoidance
```

A durable knowledge record should prefer compact truth over raw transcripts:

```text
subject / decision
scope
source
provenance
confidence / authority
evidence refs
freshness / revision
supersedes
```

Requirements:

- company and project scope
- source provenance
- freshness/version information
- durable decisions and ADRs
- searchable code/design relationships
- memory invalidation when facts become stale
- reviewer-accessible history
- privacy/policy-aware retrieval
- user corrections can become explicit operating lessons
- raw private prompts/traces are not treated as canonical company truth

## P2.6 — Stronger AI PM / CTO behavior

The PM must become a continuous planner, not a one-time task generator.

Target loop:

```text
Objective
  -> repository/product understanding
  -> architecture/risk analysis
  -> milestone plan
  -> dependency graph
  -> worker assignment
  -> observe evidence/results
  -> re-plan when assumptions change
```

PM capabilities should include:

- detect oversized tasks and split them
- change dependency graph after discoveries
- reassign work when an engine fails
- balance cost, quality, and human attention
- detect blocked/stalled workers
- identify safe fallback work while one lane waits on a human gate
- request human product decisions only when truly ambiguous/high impact
- stop wasteful loops
- create follow-up technical-debt tasks when appropriate
- avoid turning every incoming signal into work

## P2.7 — Signal Inbox and Strategic Anchors

Feedback is input, not automatically a task.

Normalize signals from:

- user prompt
- customer/support feedback
- GitHub issue or PR event
- screenshot/design review
- failed QA scenario
- browser console/network error
- crash/error report
- benchmark or validation event
- AI discovery/recommendation

Each signal should carry:

```text
source
freshness
privacy boundary
impact/confidence
related project/goal
suggested effect
```

Then classify into an explicit effect:

```text
ignore
ask human
attach evidence
create todo
create bug
create objective
promote strategic anchor
schedule review
```

Strategic Anchors are the small number of proof paths or company outcomes that deserve active focus. They prevent an autonomous company from chasing every plausible signal.

## P2.8 — `Needs You`, Agent Lanes, and Review Feed

The Company Home should evolve from a task database into an attention-efficient management surface.

Primary regions:

```text
Needs You
Running
Watching
Ready to Review
Strategic Anchors
Projects
```

A useful `Needs You` item must show:

- the exact decision/action
- which task/action scope it blocks
- whether independent work continues
- evidence/context required for judgment
- safe choices and consequences where known

Agent Lane Board should show each employee's current task, lease, engine, workspace, evidence, blocker, and next stop condition.

Review Feed should let a human quickly classify agent output:

```text
useful
not useful
needs evidence
off-scope
too expensive
unsafe/private
promote
split into todo
archive
```

Those decisions should become typed feedback/reward events, not disappear into UI-only state.

## P2.9 — AI employee performance and reward model

Evaluate long-running worker value by more than task count.

```text
employee_value = f(
  quantity,
  verified_quality,
  token/cost,
  human_attention_cost
)
```

Per worker/engine/role, track:

- completed verified tasks
- first-pass review rate
- rework rate
- failed/blocked tasks
- average cost
- delivery latency
- human questions/approvals
- avoidable re-asks
- manual corrections
- strength of evidence
- policy/boundary violations

Example surface:

```text
Backend Engineer
48 verified tasks
91% first-pass review
4 reworks
$0.84 average cost/task
3 human interruptions
Trust trend: improving
Best engine: Codex
Weak area: visual/UI work
```

Human judgment should improve future routing and company operating lessons, but performance review must not silently mutate security or production policy.

## P2.10 — Design Mode as a source-aware system

Make visual editing understand the real application structure.

Desired relationship:

```text
Design element
     <-> browser DOM
     <-> React/component identity
     <-> source file + symbol
     <-> design token/variant
     <-> Git diff
```

Examples:

- Selecting a rendered button identifies the shared Button component and variant.
- "Make all buttons like this" updates the design system instead of one DOM instance.
- Design changes reuse existing components/tokens when possible.
- Source changes hot-reload into the same live project.
- Accessibility and responsive constraints are part of review evidence.

## P2.11 — Browser engineering and regression capture

Upgrade Browser/QA into a development verification surface:

- multiple known CDP targets/tabs
- console drawer
- network drawer
- device/viewport presets
- element inspect/highlight
- screenshot history
- browser action timeline
- visual before/after evidence
- per-origin privacy controls
- browser state tied to task/run receipts

Where practical, convert successful AI-driven QA sessions into replayable regression scenarios.

```text
AI verifies signup manually
        |
        v
record stable actions/assertions
        |
        v
save QA scenario
        |
        v
future CI/reviewer replays it
```

## P2.12 — Feedback-to-work automation

Signals promoted to real work should flow through one company pipeline:

```text
Signal
 -> understand/reproduce
 -> scope
 -> acceptance criteria
 -> tasks/dependencies
 -> assign worker
 -> evidence review
 -> rework
 -> completion
```

This preserves the simple user experience while keeping the control state explicit.

## Phase 2 metrics

| Metric | Phase 2 target |
| --- | ---: |
| Parallel task isolation failures | 0 critical |
| Stale/incorrect lease terminal writes | 0 |
| Merge/rebase conflicts incorrectly auto-resolved | 0 critical |
| Supported engine adapters | >= 4 production-usable |
| Engine failover success | >= 95% supported cases |
| Autonomous intervention rate | decreasing release over release |
| Human attention per verified feature | decreasing release over release |
| Evidence-backed UI completion | >= 98% supported UI tasks |
| PM re-plan success after task failure | >= 90% benchmark cases |
| Company memory factual stale-error rate | tracked and bounded |
| Signals automatically promoted to low-value work | measured and minimized |

## Exit criteria

Phase 2 is complete when:

1. Multiple AI workers can safely execute independent tasks in parallel with task-level leases/write scopes.
2. ND can use several top harnesses behind one company contract.
3. Capabilities, providers, engines, and extensions have explicit non-overlapping ownership boundaries.
4. Model/engine routing is measurable and informed by verified outcomes, cost, and human attention.
5. Company Brain materially improves continuity across sessions/projects and preserves operating lessons.
6. The PM can continue safe independent work while scoped gates block other lanes.
7. Signal Inbox, Needs You, Agent Lanes, and Review Feed make company supervision attention-efficient.
8. Design and browser surfaces are connected to real source/evidence.
9. Feedback can become verified implementation work with minimal manual setup without making every signal a task.

Then Phase 3 can focus on end-to-end autonomous company operation and shipping.
