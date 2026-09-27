---
id: "0007"
title: "Durable Local Control Plane and Web Control"
status: draft
created: 2026-09-27
---

# PRD 0007 — Durable Local Control Plane and Web Control

## 1. Product outcome

Make ND's local company state safe and scalable enough to support a first-class browser control surface without turning the browser into a second ND runtime.

Local ND remains complete and free without an ND Cloud account.

## 2. Goals

- one local authority shared by Desktop and Web;
- durable company/project/task/knowledge state suitable for larger real projects;
- local Web Control over the same policy/orchestration path as Electron;
- realtime state/events between Desktop and Web;
- storage boundaries ready for later optional cloud sync;
- preserve existing multi-company/project isolation and task/worktree correctness;
- retain export/recovery paths during migration.

## 3. Non-goals

- public internet exposure;
- multi-tenant cloud hosting;
- billing;
- remote team sync;
- marketplace;
- ND Admin;
- replacing business semantics with Rust;
- exposing unrestricted IPC/RPC over HTTP.

## 4. Architecture

```text
Electron UI ── Electron client ─┐
                               │
Browser UI ─── Web client ─────┼──> NdControlPlane
                               │       │
                               │       v
                               │   NdRepository
                               │       │
                               │       v
                               │   local store
                               │       │
                               └────> nd-core
```

Both transports call the same typed command/query layer.

## 5. Storage draft

Introduce a repository/storage abstraction before changing the physical format.

Candidate direction:

- new `crates/nd-store` for SQLite durability primitives;
- TypeScript keeps organization/business semantics;
- SQLite WAL mode for transactional local writes;
- schema migrations are explicit and reversible where practical;
- existing JSON is imported through a validated migration;
- old JSON remains untouched until migration commits successfully;
- export/import can continue using versioned JSON bundles.

Likely domains:

- companies;
- projects;
- teams/roles/agents;
- goals/milestones;
- tasks/dependencies/board rank;
- comments/activity;
- knowledge;
- policies;
- runs/checkpoints;
- budgets;
- leases;
- evidence;
- human actions/signals;
- strategic anchors/schedules;
- audit receipts;
- attachments metadata;
- change events.

## 6. Knowledge draft

Move toward one canonical knowledge model instead of letting multiple memory systems diverge.

Knowledge should support:

- company/project/task scope;
- kind: product, requirement, architecture, decision, lesson, design, incident, feedback;
- confidence;
- active/superseded/stale/archived state;
- source/provenance;
- tags;
- supersession links.

Agent context is a derived compilation from authoritative scoped records, repository facts, task requirements and current policy. Compiled prompts are not themselves the source of truth.

## 7. Kanban/task draft

Canonical task state belongs to the task/workflow model. Boards are views over that state.

Tasks need stable identity, status, priority, dependency edges, assignment/reviewer, rank/order, versions and timestamps.

Support multiple board views over the same task set rather than making one visual column layout authoritative.

## 8. Realtime model

Use snapshot + ordered change stream:

```text
GET current snapshot
remember seq
WS events after seq
```

Each change event should carry enough scope and version metadata for reconnect and conflict detection.

Do not introduce full event sourcing as the primary storage model in v1. Use relational state plus an append-only change/audit stream.

## 9. Concurrency

Use optimistic record versions for collaborative mutation. Stale updates should be rejected with a conflict rather than silently last-write-wins.

CRDT is deferred to document-style collaborative editing where it actually helps; policy, approval, task and budget state stays transactional.

## 10. Local Web security

Initial Web Control:

- loopback only;
- single-use/short-lived pairing/bootstrap;
- authenticated HttpOnly session;
- SameSite/CSRF protection;
- strict Host/Origin validation;
- no wildcard CORS;
- authenticated WebSocket;
- no secret readback;
- no raw generic privileged RPC;
- complete policy/audit path remains authoritative.

## 11. Migration safety

Before importing current company state, create an existing organization snapshot.

Migration transaction:

```text
validate JSON
→ create/open local DB
→ migrate all domains
→ validate counts/relationships
→ commit
→ write migration marker
```

Failure leaves the existing JSON authority untouched.

## 12. Validation

Three layers remain mandatory:

1. unit/contract — schemas, migration, conflicts, auth, isolation, policy path;
2. E2E — real ND + normal Chromium, Desktop/Web cross-update, reconnect/restart, parallel work;
3. human QA — operate a real project primarily from Web while Desktop is minimized.

## 13. Open questions for deep review

- exact `nd-store` Rust/TypeScript boundary;
- first schema shape and migration ownership;
- whether comments/activity need separate append-only storage;
- blob layout and backup retention;
- local Web URL/port lifecycle;
- how much renderer UI can be shared before an `NdClient` refactor becomes too broad;
- whether Web Control ships before or after SQLite migration;
- exact compatibility period for JSON authority.
