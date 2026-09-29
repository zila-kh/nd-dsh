# ND Local + Cloud + Admin product split

Status: **draft; local-first execution order selected**
Branch: `feat/nd-cloud-platform-draft`
Baseline: `main@da6d836` (2026-09-29)

## Current decision

ND still has three architectural planes, but implementation order is now explicit:

1. **ND Local** — build and validate the complete team-workspace model first.
2. **ND Cloud / Customer Web** — deferred until the local collaboration model is durable and proven.
3. **ND Admin** — deferred until there is a real hosted product to operate.

The next milestone is **local only**. It does not require an ND server, Google Drive, Firebase, Supabase, hosted auth, LAN exposure, P2P, or any other cloud dependency.

## Product promise

**Local stays complete and free forever.**

The local product owns the core work model:

- companies and projects;
- humans, AI agents, teams and roles;
- Kanban/tasks;
- project chat and task discussion;
- comments/threads;
- mentions;
- decisions;
- review requests;
- explicit approvals/change requests;
- activity/audit history;
- Needs You / inbox projection;
- knowledge;
- Git/worktrees;
- browser/terminal;
- extensions;
- BYOK/models;
- local Web Control;
- backups/export.

Future cloud infrastructure may add cross-device synchronization, remote access, hosted backup, organization identity, hosted notifications, registries and managed services. It must not redefine the local collaboration model.

## Competitive position

PRD 0009 is tracked against a maintained external reference set: [ND Team Workspace Competitive Reference](./team-workspace-competitive-reference.md).

The implementation rule is **reference, do not clone**. ND should match the essential human-agent collaboration quality already established by Asana, Linear, GitHub Agent HQ, Codex and Microsoft Copilot, while differentiating on local-first ownership, General + Coding, engine-neutral execution, isolated task/worktree transactions, explicit checkpoint-bound approvals and extensible local desktop capabilities.

Cloud breadth is not the current competition target. The local milestone wins by proving a complete, safe workflow without a server.

## Stability-first competitive rule

The competitive reference set is **future inspiration, not current scope pressure**.

Current priority:

```text
stable local core
-> durable collaboration
-> reliable agent/task execution
-> explicit review/approval
-> offline/restart proof
-> local milestone accepted
```

Only after that gate should ND selectively combine proven ideas from Asana, Linear, GitHub Agent HQ, Codex, Microsoft Copilot or newer references.

Every borrowed idea must be adapted to ND's own invariants: local-first operation, General + Coding over one project model, engine-neutral execution, task/worktree isolation, explicit governance and one authoritative control plane.

## Immediate milestone: local team workspace

PRD 0009 is the next product contract.

The first milestone proves the full collaboration semantics on one ND host:

```text
ND Desktop / Local Web
        |
        v
   NdControlPlane
        |
        +-- Company / Project
        +-- Human members
        +-- AI agents
        +-- Tasks / Kanban
        +-- Chat / Threads / Comments
        +-- Decisions
        +-- Review / Approvals
        +-- Inbox / Needs You
        +-- Activity / Audit
        |
        v
   local durable store
```

This is deliberately **not multi-machine collaboration yet**.

Multiple named human members can exist in the local workspace so workflows, attribution, review and approval semantics can be exercised. Until a real identity/sync layer exists, selecting a local member profile is workflow attribution, not a strong authentication boundary.

## Collaboration primitives

ND should not collapse every kind of communication into chat.

### Chat

Fast conversation scoped to a company/project. Chat can contain mentions, links and attachments, but prose does not mutate protected workflow state.

### Task discussion/comments

Durable discussion anchored to a task or artifact. This is the primary place for implementation questions, review notes and follow-up.

### Decision

A first-class durable record with rationale and supersession links. A decision is more authoritative than an arbitrary message.

### Approval

A transactional workflow object. Approval requires an explicit action and binds to a specific task/action/checkpoint/version.

A message such as "looks good", an emoji reaction, or an AI interpretation must never silently become approval.

### Activity/audit

Append-only product history for meaningful actions. It supports attribution, recovery, debugging and later sync, but it is not the sole source of mutable state.

## Human + agent model

Humans and agents participate in the same workspace, but they are different actor kinds.

```text
Workspace actor
  |-- human member
  |-- organization agent
  `-- system
```

Existing `OrganizationAgent`, task execution, reviewer, worktree and coordination semantics stay intact.

PRD 0003's structured agent-team coordination remains the machine-oriented execution/handoff channel. Human-grade chat/comments/decisions/approvals are an additional collaboration layer; they do not replace task isolation or engine-neutral execution.

## Local persistence direction

Current organization truth is primarily in atomic JSON snapshots. Team-workspace data will grow faster than today's organization metadata, so the target remains:

- repository/storage abstraction first;
- SQLite for durable local relational state;
- WAL mode for safe local transactions;
- explicit migrations;
- version/revision columns for conflict detection;
- FTS for chat/comments/decisions when needed;
- append-only activity/change stream beside canonical relational state;
- versioned JSON export/import for recovery and portability.

The first UI slice does not need to wait for every legacy domain to move to SQLite, but the local-team milestone is not considered scalable/durable until collaboration state is on the transactional store.

## Local autonomy runtime — OpenClaw/Hermes inspiration

Local-first does not mean foreground-only. ND should be able to keep a company operating safely while the visible desktop window is closed.

Reference patterns are adapted, not embedded:

- OpenClaw-style persistent local runtime, scheduling, heartbeat and event automation;
- Hermes-style persistent agent routines, skill use, memory and learned-skill candidates;
- ND remains the authority for tasks, leases, isolated workspaces, checkpoints, review, approval, policy and audit.

The local autonomy model is:

```text
ND Desktop
   |
   v
Always-On Local Runtime
   |
   +-- Scheduler: once / interval / cron / agent routine
   +-- Heartbeat: cheap deterministic attention scan
   +-- Event triggers: organization activity -> governed task/signal
   +-- Skill candidates: propose -> evidence -> explicit promotion/rejection
   |
   v
ND Control Plane
   |
   v
Task -> Lease -> Workspace -> Agent -> Checkpoint -> Verify -> Review -> Approval
```

The first implementation may keep Electron as the background host to preserve the current trusted IPC/runtime boundary. A later `nd-agentd` extraction may make the runtime crash-independent, but it must not create a second task or policy authority.

24/7 autonomy never means unlimited permission. Scheduled, heartbeat-triggered and event-triggered work must still obey the same budgets, runtime permits, task isolation, review and approval policy as manually started work.

## Local Web boundary

Desktop and Local Web are two clients of the same local authority:

```text
Electron UI -- IPC -------+
                          |
Local Web ---- HTTP/WS ---+--> NdControlPlane --> repository/store --> nd-core
```

Initial Local Web remains loopback-only. No LAN or public internet exposure is part of this milestone.

## Security rules

1. Chat text never grants permission.
2. Reactions never grant permission.
3. Agents cannot approve their own protected work when policy requires independent approval.
4. Approval binds to an exact target revision/checkpoint so stale approval cannot authorize changed work.
5. Existing ND policy, runtime permits, review gates, task leases and workspace isolation remain authoritative.
6. Secrets are not auto-copied into chat, comments, knowledge or attachments.
7. Local member profiles are not presented as enterprise authentication.
8. No new generic privileged RPC is exposed to Local Web.

## Local milestone acceptance

The plan is ready for implementation when all of these are represented in the contract and task breakdown:

- create/manage local human members;
- humans and agents have stable actor attribution;
- project chat works locally;
- task comments and threaded replies survive restart;
- @mentions feed a local Needs You/inbox projection;
- decisions can be created and superseded;
- a task can request review;
- reviewer can explicitly approve, request changes or reject;
- policy can require a human approval for selected actions;
- an agent cannot self-approve where policy forbids it;
- "looks good" in chat does not change approval state;
- activity/audit records meaningful transitions;
- Desktop and Local Web observe the same authoritative state;
- export/import preserves collaboration records;
- no external network or cloud account is required.

## Deferred after local proof

Not part of the current milestone:

- Google Drive sync;
- ND Cloud;
- multi-device synchronization;
- remote team access;
- public/LAN hosting;
- cloud identity/SSO;
- invitations by email;
- push notifications;
- hosted backup;
- billing/entitlements;
- marketplace administration;
- cross-device presence/typing indicators;
- CRDT document editing;
- end-to-end encrypted remote collaboration.

## Future cloud boundary

After local collaboration is proven, PRD 0010 may transport the same stable records across devices:

```text
Local DB
  |
change/outbox events
  |
SyncProvider / ND Cloud
  |
other authorized device
```

Cloud is transport, identity and hosted coordination infrastructure. It is not a second task/comment/approval model.

## Recommended repository boundary

```text
zila-kh/nd-dsh
  complete local product
  desktop + local host + Local Web + local durable store
  collaboration primitives and policy authority

zila-kh/nd-cloud                 # future/deferred
  apps/
    web/
    admin/
    api/
    sync/
  packages/
    auth/
    database/
    sync-protocol/
    entitlements/
    extension-registry/
    billing/
    ui/
    contracts/
```

## PRD order after latest main

Latest `main` already owns:

- PRD 0007 — General and Coding Workspace Profiles
- PRD 0008 — Command Registry / Native Extensions

This branch therefore uses:

- **PRD 0009 — Local-First Team Workspace and Durable Control Plane**
- **PRD 0010 — ND Cloud Sync and Customer Portal** — deferred
- **PRD 0011 — ND Admin, Entitlements and Extension Registry** — deferred

## Execution order

```text
M0  collaboration domain contract
    actors + messages + comments + decisions + approvals + activity

M1  local task/project UX
    project chat + task discussion + review/approval + Needs You

M2  durability
    repository abstraction + SQLite collaboration schema + migration/export

M3  Local Web parity
    same collaboration views/commands over loopback transport

M4  Always-On local runtime
    background host + optional start-at-login + runtime liveness

M5  automation v2
    once + interval + cron + timezone + agent routines

M6  heartbeat + event triggers
    cheap attention scan + governed task/signal automation

M7  gated skill learning
    candidate + evidence + explicit promote/reject

M8  reliability proof
    window-closed operation + restart/recovery/conflict/stale-approval/policy/E2E/manual QA

---- local milestone gate ----

M9   optional crash-independent nd-agentd extraction
M10  optional sync protocol design
M11  optional ND Cloud/customer Web
M12  optional ND Admin/hosted registry
```

Do not start M9-M12 as implementation work until the local milestone gate is accepted.
