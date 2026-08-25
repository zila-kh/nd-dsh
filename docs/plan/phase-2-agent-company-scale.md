# Phase 2 — Agent Company Scale and Differentiation

Status: execution plan  
Updated: 2026-08-25  
Goal: move ND-DSH from a reliable autonomous developer into a true multi-worker AI software company that is better than using any individual harness alone.

## Product thesis

Phase 2 is where ND stops competing as another coding agent.

> Claude Code, Codex, Gemini CLI, goose, ND Harness, and future systems are workers. ND owns the company, project, task graph, policy, memory, verification, routing, and durable state around them.

## P2.1 — Parallel AI teams

Replace the one-active-run ceiling with safe parallel project execution.

Target model:

```text
Project
├── Task A -> worktree A -> Worker 1
├── Task B -> worktree B -> Worker 2
├── Task C -> worktree C -> Worker 3
└── Task D -> worktree D -> Worker 4
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
- task lease/ownership
- resource/cost budget
- cancellation and cleanup
- conflict detection before merge
- deterministic merge/rebase/rework state

The PM should only parallelize tasks whose dependency graph allows it.

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

## P2.3 — Smart model and engine routing

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
```

## P2.4 — Company Brain

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
└── Feedback
    ├── feature requests
    ├── complaints
    └── observations
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

## P2.5 — Stronger AI PM / CTO behavior

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
- balance cost and quality
- detect blocked workers
- request human product decisions only when truly ambiguous/high impact
- stop wasteful loops
- create follow-up technical-debt tasks when appropriate

## P2.6 — Design Mode as a source-aware system

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

## P2.7 — Browser engineering and regression capture

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

Example:

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

## P2.8 — Feedback-to-work automation

Normalize incoming work from:

- user prompt
- GitHub issue
- support/customer feedback
- screenshot
- failed QA scenario
- browser console/network error
- design review
- crash report/log

All should flow into the same company system:

```text
Input
 -> understand/reproduce
 -> scope
 -> acceptance criteria
 -> tasks/dependencies
 -> assign worker
 -> evidence review
 -> rework
 -> completion
```

## Phase 2 metrics

| Metric | Phase 2 target |
| --- | ---: |
| Parallel task isolation failures | 0 critical |
| Merge/rebase conflicts incorrectly auto-resolved | 0 critical |
| Supported engine adapters | >= 4 production-usable |
| Engine failover success | >= 95% supported cases |
| Autonomous intervention rate | decreasing release over release |
| Evidence-backed UI completion | >= 98% supported UI tasks |
| PM re-plan success after task failure | >= 90% benchmark cases |
| Company memory factual stale-error rate | tracked and bounded |

## Exit criteria

Phase 2 is complete when:

1. Multiple AI workers can safely execute independent tasks in parallel.
2. ND can use several top harnesses behind one company contract.
3. Model/engine routing is measurable and policy-aware.
4. Company Brain materially improves continuity across sessions/projects.
5. Design and browser surfaces are connected to real source/evidence.
6. Feedback can become verified implementation work with minimal manual setup.

Then Phase 3 can focus on end-to-end autonomous company operation and shipping.
