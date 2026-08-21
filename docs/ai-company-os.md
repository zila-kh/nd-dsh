# AI Company OS

ND-DSH is evolving from a coding workbench into a desktop operating system for AI-run companies. The user operates at the level of companies, projects, goals, policies, and approvals; DeepSeek Harness remains the execution engine for sessions, tools, subagents, browser automation, filesystem/shell work, and approvals.

## Product hierarchy

```text
User
├─ Company A
│  ├─ mission, autonomy, policies, memory
│  ├─ reusable teams, roles, agents, skills, workflows
│  ├─ Project A1
│  │  ├─ objective, workspace/repos
│  │  ├─ goals → milestones → dependency-aware tasks
│  │  └─ runs, review results, project memory
│  └─ Project A2
├─ Company B
└─ Company C
```

A company is the primary isolation boundary. Company-scoped roles, teams, agents, memory, policies, and project resources must never be silently reused across another company. Projects bind business outcomes to one or more technical workspaces/resources; a project is not the same thing as a filesystem workspace.

## Default company

Creating a company seeds a usable AI workforce instead of an empty configuration:

- Product team with an AI Product Manager.
- Engineering team with a software implementation worker.
- Quality & Research team with an independent reviewer and researcher.
- Built-in capability catalog for strategy, planning, task breakdown, implementation, review, QA, web research, browser operation, releases, and organizational memory.
- A default `Plan → Execute → Review` workflow.
- Safe policy defaults: internal planning/execution/review are allowed, public publishing/deployments/spending ask, destructive production data operations are denied.

Users can add company- or project-scoped skills and can add roles, agents, teams, workflows, tasks, memory, and policies through the organization API.

## PM execution loop

The first autonomous vertical slice is deliberately simple and inspectable:

```text
Project objective
      ↓
AI PM session
      ↓
structured goal + milestones + tasks
      ↓
next dependency-ready task
      ↓
fresh worker session
      ↓
workspace changes + validation
      ↓
fresh independent review session
      ↓
pass ────────────────┐
 │                    │
 └→ complete + memory ├→ next ready task
fail → blocked ───────┘
```

PM and reviewer outputs use tagged JSON envelopes (`<nd-dsh-plan>` and `<nd-dsh-review>`) so orchestration state is derived from explicit machine-readable results while normal reasoning stays visible in the underlying Harness session.

Each worker/reviewer gets a fresh Harness session. The session prompt contains only the selected company/project scope, relevant role/agent instructions, inherited skills, allowed company/project memory, task requirements, and policies. This keeps the Harness general while ND-DSH owns organization composition.

## Autonomy levels

| Level | Meaning |
| --- | --- |
| 0 | Ask before work; use ND-DSH as an organizational console. |
| 1 | AI may plan; humans drive execution. |
| 2 | Safe internal work is available on explicit user commands. |
| 3 | Workflow autopilot: after an explicit start, ready tasks execute and review can continue automatically. |
| 4 | Company autopilot foundation; currently follows the level-3 execution loop while leaving room for scheduled/cross-project management. |

Autonomy never overrides company policy. `deny` blocks both manual and automatic execution. `ask` blocks automatic continuation and is intended to hand control to approval UX; explicit user actions can proceed. Harness tool approvals remain an additional lower-level safety boundary.

## Persistence and event ledger

Organization state is persisted at:

```text
<electron userData>/organization.json
```

Writes use a temp file + rename so the on-disk snapshot is replaced atomically. The snapshot contains companies, projects, roles, teams, agents, skills, workflows, goals, milestones, tasks, memory, policies, activity, and run receipts. Harness sessions remain in the existing durable Harness session store.

The organization run ledger links PM/worker/reviewer runs to Harness session IDs. The Company dashboard can therefore show business-level progress while the DeepSeek workbench remains the place to inspect the full agent trajectory and approvals.

## Runtime ownership

```text
ND-DSH / Electron
├─ Company dashboard and organization IPC
├─ OrganizationStore (scoped durable state)
├─ OrganizationOrchestrator (PM → worker → reviewer loop)
├─ Workspace switching / project binding
└─ existing gateway + browser + workbench surfaces
        ↓
DeepSeek Harness
├─ models and agent loop
├─ sessions and events
├─ tools / skills / MCP
├─ filesystem + shell sandbox
├─ jobs / subagents
└─ approvals
```

ND-DSH does not fork or patch the Harness agent loop. Organization features compose existing Harness capabilities through the same gateway/runtime boundary used by the workbench.

## Current UI

The default center surface is now **Company**. It provides:

- multi-company switcher and company creation;
- multi-project switcher, project creation, and workspace binding;
- autonomy selector and `Run next` command;
- company/project progress, goals, live run ledger, queue, and activity;
- PM planning and task run/review controls;
- team/agent overview and built-in/scoped skill catalog;
- organizational memory and editable `ALLOW / ASK / DENY` policies;
- direct navigation back to the DeepSeek workbench, Browser, and existing editor/workspace surfaces.

## Extension path

The next company-level work should build on the same domain instead of replacing it:

1. scheduled/conditional workflows and background job projection;
2. explicit approval queue for organization `ask` policies;
3. connectors/integrations and scoped secrets;
4. richer team/role/agent editors and templates;
5. cross-project company objectives and resource allocation;
6. cost/token budgets and run accounting;
7. artifact/document deliverables and external publishing workflows;
8. stronger resumability, retries, review rubrics, and failure recovery;
9. signed distribution and remote/sync storage options.
