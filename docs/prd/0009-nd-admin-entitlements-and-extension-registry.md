---
id: "0009"
title: "ND Admin, Entitlements and Extension Registry"
status: draft
created: 2026-09-27
---

# PRD 0009 — ND Admin, Entitlements and Extension Registry

## 1. Product outcome

Create a separate internal ND administration surface and cloud control services without mixing staff authority into the customer portal.

This PRD also defines the future managed extension registry and entitlement boundary.

## 2. Application separation

Recommended cloud applications:

```text
apps/web
  customer portal

apps/admin
  ND internal portal
```

They may share packages but should have separate:

- deployment;
- authentication client;
- session/cookie boundary;
- authorization scopes;
- CSP;
- audit stream;
- routing surface.

Do not ship the admin UI as a hidden route inside the normal customer application.

## 3. ND Admin capabilities

Potential internal surfaces:

- tenants/customers;
- subscriptions/plans;
- entitlement grants;
- extension review/moderation;
- release channels;
- feature rollout;
- service/sync health;
- storage/queue metrics;
- support cases;
- abuse/security;
- incident controls;
- future hosted-worker operations.

Admin authorization is always enforced server-side.

## 4. Entitlement model

The entitlement service should unlock hosted capabilities such as:

- cloud sync;
- remote control;
- team collaboration;
- hosted backups;
- private extension registry;
- enterprise managed policy;
- future hosted workers.

Local-core capabilities are intrinsic to the local product and are not remotely revocable.

Bad model:

```text
cloud flag says local Kanban=false
→ local Kanban disappears
```

Required model:

```text
local capability exists by product contract
cloud entitlement adds hosted capability
```

## 5. Extension registry

PRD 0006 keeps local installation free and defers marketplace/review/billing. This PRD owns that future hosted layer.

Registry records may include:

- publisher;
- package identity;
- version;
- manifest;
- package hash;
- signature;
- requested permissions;
- API compatibility;
- review state;
- visibility;
- security findings;
- publication time.

Visibility candidates:

- official;
- public;
- unlisted;
- private-tenant.

Local folder/Git installation remains available without cloud.

## 6. Extension moderation

Admin workflow should support:

- review;
- approve/reject;
- security quarantine;
- disable a compromised package/version;
- compatibility policy;
- signature/provenance checks;
- incident/audit history.

A registry disable action must affect registry delivery, not silently delete already-installed local user data.

## 7. Customer controls versus ND controls

Customer controls include:

- whether a project syncs;
- artifact/transcript sync choices;
- extension activation;
- update channel preferences;
- remote-control enablement;
- team invitations.

ND internal controls include:

- release rollout;
- plan limits;
- extension moderation;
- service maintenance;
- complimentary grants;
- abuse/security action.

These must remain separate permission domains.

## 8. Privacy/support boundary

Default Admin surfaces should favor metadata:

- tenant;
- plan;
- device status;
- storage usage;
- sync errors;
- billing status.

Do not make private project content casually browseable by ND staff.

Any future content-access support workflow should require narrow, time-bound, audited authorization.

## 9. Audit

Every sensitive admin action should record:

- staff actor;
- target tenant/resource;
- reason;
- action;
- before/after or result;
- time;
- request/support ticket reference where relevant.

Admin audit records should be append-only from the application point of view.

## 10. Feature rollout

Cloud feature rollout may support cohorts/percentages for hosted features, but it cannot remove functionality promised as free local core.

Feature rollout and subscription entitlement are related but distinct concepts.

## 11. Recommended cloud repository shape

```text
nd-cloud/
├── apps/
│   ├── web/
│   ├── admin/
│   ├── api/
│   └── sync/
├── packages/
│   ├── auth/
│   ├── database/
│   ├── sync-protocol/
│   ├── entitlements/
│   ├── extension-registry/
│   ├── billing/
│   ├── ui/
│   └── contracts/
└── infra/
```

This is a draft architecture recommendation, not an implementation commitment.

## 12. Validation

Three layers:

1. unit/contract — authorization, entitlement resolution, registry state machine, audit;
2. E2E — customer cannot access admin, admin role separation, extension moderation, plan grant/revoke, hosted feature gating;
3. human QA/security review — staff workflows, support access, incident disable/rollback drills.

## 13. Open questions for deep review

- staff identity/SSO/MFA;
- billing provider;
- marketplace payment/revenue share;
- package signing model;
- automated security scanning;
- extension appeals/review process;
- incident disable semantics;
- support impersonation policy;
- enterprise delegated admin;
- audit retention.
