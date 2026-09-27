---
id: "0008"
title: "ND Cloud Sync and Customer Portal"
status: draft
created: 2026-09-27
---

# PRD 0008 — ND Cloud Sync and Customer Portal

## 1. Product outcome

Add optional paid hosted infrastructure around the complete free local ND product.

ND Cloud provides sync, remote access, collaboration and hosted services. It must not become required for normal local work.

## 2. Customer value

Potential paid capabilities:

- cross-device/company sync;
- remote Web access to connected ND hosts;
- multi-user/team collaboration;
- hosted backup/history;
- devices/host management;
- team membership and roles;
- private organization extension registry;
- cloud notifications;
- future hosted workers and managed runtime services.

## 3. Tenant hierarchy

Draft identity model:

```text
Account
└── Tenant / Organization
    ├── Users
    ├── Companies
    │   └── Projects
    ├── Devices
    ├── Subscription
    ├── Sync policy
    └── Extension policy
```

Cloud tenant and ND Company are separate concepts. One tenant may contain multiple ND companies.

## 4. Local-first rule

ND starts and operates from local state. If cloud is unavailable:

- local companies/projects continue;
- agents continue;
- Kanban continues;
- Git/browser/terminal continue;
- local Web Control continues.

Only cloud-backed capabilities degrade.

## 5. Sync architecture

```text
Local ND Store
    │
change/outbox events
    v
ND Sync Client
    │ secure outbound connection
    v
ND Cloud Sync
    │
    ├── PostgreSQL
    └── object storage
```

Do not open a local database over Dropbox/network shares for multiple writers.

## 6. Realtime/remote control

A connected ND host establishes an authenticated outbound channel to ND Cloud.

Customer Web sends typed commands through cloud to the intended connected host. The command must re-enter the same ND policy/control-plane path used locally.

No cloud command may bypass:

- policy;
- approvals;
- runtime capacity;
- leases;
- workspace isolation;
- evidence/review gates;
- credential boundaries.

## 7. Sync scope

Sync candidates:

- companies/projects;
- teams/roles/agents;
- goals/milestones/tasks;
- comments/activity;
- company/project knowledge;
- policies/budgets;
- strategic anchors;
- run/evidence summaries;
- audit receipts;
- selected artifacts.

Off/never by default:

- provider/API credentials;
- `.env` secrets;
- raw source repositories;
- local engine private storage;
- personal ND Home;
- personal chats/captures.

Personal content may be explicitly promoted into a company/project/task record.

## 8. Conflict model

Use entity versions/revisions and ordered sync cursors.

Transactions that conflict should surface a clear conflict state instead of silent last-write-wins.

Task/policy/approval state remains server-transactional. CRDT is not required for v1 sync.

## 9. Customer Web

Primary surfaces may include:

- Overview / Needs You;
- Companies;
- Projects;
- Kanban;
- Agents and Runs;
- Knowledge;
- Team;
- Devices;
- Sync;
- Backups;
- Extensions;
- Usage;
- Subscription;
- Account.

Remote source editing is not a v1 requirement. The Web portal controls ND work and reads approved synced state.

## 10. Hosted data boundary

Customer data remains tenant-isolated.

ND staff do not receive default content access merely because ND operates the infrastructure.

Future support access to customer content must require:

- explicit support reason;
- customer authorization where appropriate;
- time-bounded grant;
- least privilege;
- audit receipt.

## 11. Infrastructure draft

Initial preference:

- PostgreSQL for relational cloud truth;
- S3-compatible storage for blobs;
- outbox/event stream for realtime;
- WebSocket/SSE service for client updates;
- add Redis only when measured fanout/cache needs justify it.

## 12. Monetization principle

Charge for hosted value/cost, not artificial local limitations.

Free local functionality must not be remotely disabled by subscription state.

## 13. Validation

Three layers:

1. contract/integration — tenant isolation, sync cursors, conflict rules, offline/reconnect, device auth;
2. E2E — two devices + customer Web + offline edits + reconnect + conflict paths;
3. human QA — real multi-device project operation for an extended session.

## 14. Open questions for deep review

- cloud repository/framework selection;
- account/auth provider;
- exact pricing/retention;
- sync encryption design;
- object-storage limits;
- remote command channel protocol;
- device enrollment/revocation;
- backup restore authority;
- tenant/company membership semantics;
- regional hosting/data residency.
