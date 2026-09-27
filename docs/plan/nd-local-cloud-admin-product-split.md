# ND Local + Cloud + Admin product split

Status: **draft for deep review**  
Branch: `feat/nd-cloud-platform-draft`  
Baseline: `main@a6f6816` (2026-09-27)

## Decision draft

ND should evolve as three clearly separated planes:

1. **ND Local** — the complete local product. Local companies, projects, agents, Kanban, knowledge, Git/worktrees, local Web Control, local extensions, BYOK/models, QA, browser, terminal, backups and core automation remain usable without an ND cloud account.
2. **ND Cloud / Customer Web** — optional hosted infrastructure for sync, remote access, multi-user collaboration, hosted backup, devices, team management, private registries and future hosted workers.
3. **ND Admin** — internal ND staff surface for plans/entitlements, extension moderation, release/feature rollout, operational health, support tooling and abuse/security handling.

The customer portal and the ND admin portal may share backend packages and a UI library, but they should be separate deployed applications and separate authorization surfaces.

## Product promise

**Local stays complete and free forever.**

ND should earn from infrastructure and coordination that actually cost ND to operate:

- cloud sync and storage;
- remote Web access;
- team collaboration;
- hosted backup/history;
- organization accounts and managed policies;
- private extension registries;
- managed extension delivery;
- enterprise administration;
- future hosted workers and managed runtime services.

Cloud must enhance ND, not become a prerequisite for core local work.

## Recommended repository boundary

```text
zila-kh/nd-dsh
  local/open product
  desktop + local host + local web control + local durable store

zila-kh/nd-cloud                 # future commercial repository
  apps/
    web/                         # customer portal
    admin/                       # ND internal admin portal
    api/                         # cloud API
    sync/                        # realtime/device sync
  packages/
    auth/
    database/
    sync-protocol/
    entitlements/
    extension-registry/
    billing/
    ui/
    contracts/
  infra/
```

The ND Cloud repository does not exist as part of this draft. This document only defines the intended boundary.

## Local architecture

```text
ND Desktop ──IPC────────┐
                       │
Local Web ──HTTP/WS────┼──> ND Control Plane
                       │          │
                       │          v
                       │      ND Repository
                       │          │
                       │          v
                       │      local durable store
                       │          │
                       └────────> nd-core
```

The browser surface is standalone UX, not a second ND runtime. The local host remains the one authority.

## Cloud architecture

```text
Customer Web ─┐
              ├──> ND Cloud API ──> Sync / Identity / Billing / Registry
ND Admin ─────┘                         │
                                      │ secure outbound device channel
                                      v
                                   ND Host
                                      │
                                   nd-core
```

A local ND host should connect outbound to ND Cloud. Cloud should not require users to expose inbound desktop ports.

## Customer Web and Admin must remain different

### Customer Web

Examples:

- companies/projects;
- Kanban/tasks;
- agents/runs/Needs You;
- team members;
- devices;
- sync controls;
- backups;
- extensions;
- subscription/usage;
- remote control of connected ND hosts.

### ND Admin

Examples:

- customer/tenant metadata;
- subscriptions and plan grants;
- entitlements;
- extension marketplace review/moderation;
- release channels;
- feature rollout;
- sync service health;
- storage/queue health;
- support access workflow;
- abuse/security controls.

Do not hide ND Admin behind a normal customer `/admin` route. Prefer a separate application, separate OAuth/client/session boundary, separate deployment and complete server-side authorization.

## Storage direction

Current local state remains split by domain:

- `organization.json` — core company/project/task/run state;
- `organization-control.json` — budgets, leases, evidence, signals, human actions;
- `organization-strategy.json` — strategic anchors, company knowledge, schedules, action audit;
- ND Home — personal notes/captures/chat metadata.

For real local team collaboration and Web Control, the draft direction is to preserve those domain boundaries while moving live mutable product state toward a transactional local database rather than a set of giant JSON snapshots.

Draft target:

- local: SQLite through a storage abstraction, preferably a future `nd-store` Rust crate;
- cloud: PostgreSQL;
- large artifacts: object/blob storage;
- realtime: append-only change/outbox events plus snapshots;
- search: relational truth + FTS, optional rebuildable vector index.

JSON remains useful for export/import/debug/recovery.

## Sync classification

Cloud sync should be selective.

Default sync candidates:

- companies/projects;
- goals/milestones/tasks;
- teams/roles/agents;
- company/project knowledge;
- comments/activity;
- policies/budgets;
- evidence metadata;
- run summaries;
- strategic anchors;
- audit receipts;
- selected attachments.

Never sync by default:

- provider API keys;
- OS credentials;
- `.env` secrets;
- raw source repositories (Git remains source transport);
- private engine storage;
- personal ND Home records;
- personal chats/captures.

Personal data should require explicit promotion to Company/Project/Task context.

## Extension ecosystem boundary

Local installation remains free:

- local folder;
- Git/private source;
- local activation;
- local development.

Cloud can later provide:

- public registry;
- official packages;
- company-private registry;
- signed publishing;
- moderation/security quarantine;
- managed updates;
- controlled rollout;
- organization allow/deny policy.

PRD 0006 intentionally deferred marketplace publishing/review/billing; this draft keeps that separation.

## Non-negotiable invariants

1. Local free functionality cannot be remotely disabled by cloud feature flags.
2. Cloud outage must not stop normal local coding/company operation.
3. ND Admin does not automatically gain access to customer source code, secrets, private screenshots or project knowledge.
4. Support access to customer content, if ever implemented, must be explicit, time-bounded, reasoned and audited.
5. The Web path cannot bypass ND policy, approvals, runtime permits, evidence gates or workspace isolation.
6. Customer and admin authorization models remain separate.
7. Sync is not a second source of truth: conflicts are resolved through defined version/revision rules.
8. Cloud features unlock additional hosted capabilities; they do not revoke the local core.


## Desktop identity and protected Cloud AppView

ND Desktop may offer an optional ND product sign-in for cloud-backed features. This identity is separate from coding-engine/provider accounts such as Codex, Antigravity, GitHub, or model-provider credentials.

Draft flow:

```text
ND Desktop
    │
    ▼
NdAccountService
    │ OAuth/OIDC + PKCE
    ▼
ND Cloud Identity
    │
    ├── access/session state kept out of React
    ├── refresh credential protected by OS secure storage when available
    └── device identity enrolled for sync/remote control
```

After Desktop sign-in, the customer Web experience may open inside ND without a second login prompt. Do not pass access/refresh tokens in URLs, localStorage, preload payloads, or renderer state. Electron main should request a short-lived, single-use Web session bootstrap from ND Cloud; the protected Web surface exchanges it for a normal secure HttpOnly customer session.

The embedded customer Web surface is **not** a normal ND browser tab. The current built-in browser is intentionally agent-controllable and uses the persistent `persist:nd-dsh-browser` profile. Customer Web should use a separate product surface and Electron session partition such as:

```text
BrowserController
  persist:nd-dsh-browser
  general browsing + agent control

NdCloudAppController
  persist:nd-cloud-app
  ND customer Web only
  no agent CDP/browser routing
```

The Cloud AppView should be restricted to approved ND customer origins. Links outside those origins open in the normal ND browser or system browser according to policy.

The same Company/Kanban/Needs You/Agents Web UX may later support two transports:

```text
Local mode
Web UI -> localhost ND Control Gateway -> ND Host

Cloud mode
Web UI -> ND Cloud API -> synced state / connected ND Host
```

Local Kanban and core company operation continue to work while signed out or offline.

Desktop sign-out revokes/clears the ND Cloud session, device session as appropriate, secure refresh credential, protected AppView cookies/storage and cloud realtime connections. It must not delete local companies, projects, knowledge, tasks, extensions, repositories, or other free-local product data.

Desktop customer identity never grants or bootstraps an ND Admin session. Admin remains a separate staff-only authentication boundary.

## Draft PRD split

- **PRD 0007 — Durable Local Control Plane and Web Control**
- **PRD 0008 — ND Cloud Sync and Customer Portal**
- **PRD 0009 — ND Admin, Entitlements and Extension Registry**

All three are drafts pending deep architecture/security/product review.
