---
id: "0010"
title: "ND Cloud Sync and Customer Portal"
status: deferred
created: 2026-09-27
---

# PRD 0010 — ND Cloud Sync and Customer Portal

## 1. Product outcome

After PRD 0009 is accepted, add optional hosted infrastructure around the complete free local ND product.

ND Cloud provides cross-device sync, remote access and hosted services for the local collaboration model defined by PRD 0009. It must not become required for normal local work.

## 1.1 Dependency gate\n\nImplementation is deferred until PRD 0009 local collaboration passes its durability/reliability gate. Cloud must transport the local model rather than inventing a second task/comment/approval system.\n\n## 2. Customer value

Potential paid capabilities:

- cross-device/company sync;
- remote Web access to connected ND hosts;
- cross-device synchronization of the local team workspace;\n- remote team access to the same comments/decisions/approvals model;
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


## 5. ND Desktop account and device identity

ND product identity is separate from coding-engine/provider accounts.

Desktop should own an `NdAccountService` in the trusted main process. Draft login flow:

```text
User -> Sign in to ND
Desktop main -> OAuth/OIDC + PKCE + state/nonce
ND Identity -> callback/deep-link/loopback completion
Desktop main -> authenticated ND account
```

Security rules:

- customer access/refresh tokens are never exposed to React;
- no auth tokens in URL query strings;
- no auth tokens in renderer localStorage;
- refresh credentials use OS secure storage when a secure backend is available;
- if secure persistence is unavailable, fail honestly or keep only bounded in-memory session state according to the final security review;
- coding-engine/provider credentials remain separate.

Signing in may enroll the installation as an ND device with metadata such as device ID, label, platform, ND version, public-key/device credential, last-seen state and enabled cloud capabilities.

## 6. Automatic customer-Web session handoff

After Desktop login, opening Company/Kanban/Needs You/Agents inside the protected ND customer Web surface should not require a second interactive login.

Preferred flow:

```text
Desktop main (already authenticated)
    │
    ├── request one-time short-lived Web bootstrap
    ▼
ND Cloud session broker
    │
    ▼
protected ND Cloud AppView
    │
    ├── exchange bootstrap
    └── receive Secure + HttpOnly customer session cookie
```

The bootstrap is single-use, narrowly scoped, short-lived and never logged. The Web page receives a normal customer session, not the Desktop refresh credential.

The embedded customer Web runs in a dedicated Electron session partition such as `persist:nd-cloud-app`. It must not share cookies/storage with the agent-controllable built-in browser profile.

The protected AppView is not registered as a normal browser automation target and is not available to agent-browser/CDP routing. Agents needing company/task data use typed ND APIs under their own scoped authority instead of inheriting the human user's Web cookie.

External links leave the protected AppView and open in the normal ND browser or system browser according to ND policy.

## 7. Local/offline behavior

Sign-in never becomes a prerequisite for local Kanban, company state, knowledge, agents, Git, browser, terminal or local Web Control.

The customer Web UI may eventually share components across:

```text
local transport -> localhost Control Gateway -> ND Host
cloud transport -> ND Cloud -> synced state / connected ND Host
```

Cloud outage or sign-out only degrades hosted features.

## 8. Tenant/company/device binding

A local company must not be implicitly attached to a cloud tenant merely because it is active in Desktop.

Persist an explicit sync binding between:

- local company/project identity;
- cloud tenant;
- cloud company/project identity;
- sync state/revision.

Tenant switching in customer Web must respect those bindings and never reinterpret a local active company as cloud authorization.

## 9. Logout and revocation

Desktop logout should:

1. revoke/expire the ND customer refresh session as supported;
2. revoke or disable the device session as appropriate;
3. erase the protected local refresh credential;
4. clear `persist:nd-cloud-app` customer cookies/site data as required;
5. close cloud sync/realtime channels;
6. leave all local companies/projects/tasks/knowledge/extensions/repositories untouched.

Remote device revocation should make future cloud commands/sync fail closed while preserving local-only operation.

## 10. Sync architecture

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

## 11. Realtime/remote control

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

## 12. Sync scope

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

## 13. Conflict model

Use entity versions/revisions and ordered sync cursors.

Transactions that conflict should surface a clear conflict state instead of silent last-write-wins.

Task/policy/approval state remains server-transactional. CRDT is not required for v1 sync.

## 14. Customer Web

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

## 15. Hosted data boundary

Customer data remains tenant-isolated.

ND staff do not receive default content access merely because ND operates the infrastructure.

Future support access to customer content must require:

- explicit support reason;
- customer authorization where appropriate;
- time-bounded grant;
- least privilege;
- audit receipt.

## 16. Infrastructure draft

Initial preference:

- PostgreSQL for relational cloud truth;
- S3-compatible storage for blobs;
- outbox/event stream for realtime;
- WebSocket/SSE service for client updates;
- add Redis only when measured fanout/cache needs justify it.

## 17. Monetization principle

Charge for hosted value/cost, not artificial local limitations.

Free local functionality must not be remotely disabled by subscription state.

## 18. Validation

Three layers:

1. contract/integration — tenant isolation, sync cursors, conflict rules, offline/reconnect, device auth;
2. E2E — two devices + customer Web + offline edits + reconnect + conflict paths;
3. human QA — real multi-device project operation for an extended session.

## 19. Open questions for deep review

- cloud repository/framework selection;
- account/auth provider and OAuth/OIDC redirect/deep-link strategy;
- secure Desktop token/session persistence policy by OS;
- Web session bootstrap TTL, audience and replay protection;
- protected AppView partition lifecycle/origin policy;
- exact pricing/retention;
- sync encryption design;
- object-storage limits;
- remote command channel protocol;
- device enrollment/revocation;
- backup restore authority;
- tenant/company membership semantics;
- regional hosting/data residency.
