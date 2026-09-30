# Local-First Team Workspace + Always-On Automation Handoff

Status: **implementation complete for local MVP; local machine verification required**
Branch: `feat/local-first-team-workspace`
PR: #64

## Local verification log (2026-09-30, Windows 11 x64, Node 24.19 / pnpm 11.7 / Rust 1.98)

Programmatic gates, executed on this branch with the fixes listed below:

- `corepack pnpm install` — up to date.
- `corepack pnpm typecheck` — **passes** (after fixes; previously 15 errors: unchecked cron tuple access, `readSnapshot` widening `DurableOrganizationSnapshot`, a statically dead `previousOutcome !== 'success'` comparison, `nextRunAt` missing from the `schedule.add` mutation type, and `exactOptionalPropertyTypes` violations in `tests/local-automation-v2.test.ts`).
- Targeted vitest suite (collaboration / strategy / control / automation v2 / runtime service / schedule runner) — **45/45 pass**.
- `corepack pnpm test` — **1066 pass, 9 skipped (live-engine), 0 fail**.
- `corepack pnpm build` — **passes**.
- `corepack pnpm beta:unit` — **passes end-to-end** (verify + typecheck + full test + `core:test` + `browser:host:test`). Required fixing one pre-existing clippy `collapsible_if` in `crates/nd-agent/src/lib.rs` under Rust 1.98 plus `cargo fmt`.
- `corepack pnpm dist:win:dir` — **packages successfully** (`dist/win-unpacked/ND-DSH.exe`, signtool-signed).
- `corepack pnpm release:smoke:packaged` — **fails, but not from this branch**: a freshly staged harness now resolves upstream `node-addon-require-builtin@0.1.6`, whose native Electron fingerprint allowlist (43.0.0, 44.0.0, 45.0.0-alpha.6) rejects this app's Electron 43.4.0 (`Node 24.18.1, V8 15.0.245.28-electron.0`), so the harness cannot boot inside Electron at all. The branch touches no `vendor/`, `package.json`, or lockfile files; rebuilding `main` today fails identically. The older Sep 29 portable artifact on this machine predates the vendored dependency drift and still boots. Upstream has no newer loader release (0.1.6 is latest). Remedy belongs to a harness sync or an Electron pin decision on main, not this branch.

Fixes applied on the working tree (uncommitted): `src/main/organization/cron.ts`, `src/main/organization/store.ts`, `src/main/organization/strategy-plane.ts`, `src/shared/organization-strategy.ts`, `tests/local-automation-v2.test.ts`, `crates/nd-agent/src/lib.rs`.

Still outstanding from the acceptance gate: manual collaboration smoke, manual Always-On background smoke, start-at-login smoke on the release OS, and the overnight automation observation.

## Goal

Make ND a stronger local-first Human + AI Team Workspace before cloud work, while adapting the best local-agent patterns from OpenClaw/Hermes without turning ND into a wrapper around either project.

The local product now owns the collaboration and automation semantics. Cloud/sync remains optional and deferred.

## Implemented

### Human + AI collaboration

- local human member profiles for attribution;
- human and existing `OrganizationAgent` identities remain distinct;
- project chat and task-scoped discussion;
- @mentions;
- durable decisions with supersession;
- checkpoint-bound explicit approval requests;
- approve / request changes / reject verdicts;
- integration approvals fail closed once merge-back already happened, so verdicts never pretend to undo merged code;
- chat/reactions do not imply approval;
- stale checkpoint approval is rejected;
- request-changes returns a task to ready/rework state;
- rejection blocks the task with a visible reason;
- Needs You combines collaboration attention with control-plane attention, reviews, blockers and automation/heartbeat signals.

The existing Agent `ChatPanel` remains the execution transcript. Team collaboration is durable project truth in Company, so tools/subagent traces do not become noisy team chat.

### Automation v2

Automation/strategy state is written atomically to both a primary file and `.bak` recovery snapshot. If the primary JSON is unreadable after an interrupted write or disk corruption, ND recovers the last durable automation state from backup and rewrites the primary.

ND schedules now support:

- interval;
- one-time;
- timezone-aware 5-field cron;
- agent routine.

Agent routines can bind:

- a specific `OrganizationAgent`;
- a prompt;
- explicit skill IDs.

Routine skills are validated against company/project scope and flow into the generated task's effective task context.

Scheduled work creates/reuses one durable task and, when autonomy/policy allows, dispatches **that exact task** rather than an arbitrary ready task.

### Heartbeat

Heartbeat is deliberately separate from scheduled model work.

The local heartbeat checks structured state without spending a model turn:

- blocked tasks;
- failed runs;
- pending explicit approvals;
- open human actions.

Healthy heartbeats remain quiet. Attention creates a governed ND signal.

### Event triggers

Organization activity can trigger:

- a governed signal; or
- a task assigned to an optional agent.

Task triggers carry durable `sourceTriggerId + sourceActivityId` provenance for crash/retry idempotency.

When autonomy >= 3, the control plane evaluates and dispatches the exact generated trigger task. Otherwise it remains visible for human action.

### Gated skill learning

ND now has skill candidates:

- human/agent source attribution;
- description;
- reusable instructions;
- evidence;
- proposed / approved / rejected state.

Promotion is explicit and creates a normal ND skill. A candidate cannot silently activate itself, rewrite policy, or grant permissions.

### Always-On local runtime MVP

Local runtime settings include:

- Always-On;
- Start at login;
- background/foreground state;
- scheduler / heartbeat / event liveness timestamps.

When Always-On is enabled, closing the main ND window hides it rather than destroying the Electron runtime. The same local:

- control plane;
- scheduler;
- agents/engines;
- automation;
- heartbeat;
- event triggers

continue running while the user is logged in.

Packaged Windows builds use the `--background` login-item argument. On macOS, where Electron login-item arguments are Windows-only, ND detects `wasOpenedAtLogin` and hides the window itself. macOS login-item behavior should be validated on a packaged, signed/notarized build.

Linux currently reports start-at-login as unsupported instead of claiming integration that does not exist.

## Important architecture boundary

This milestone implements a **background Electron local-runtime MVP**.

It is not yet an independent `nd-agentd` OS daemon/service.

Therefore:

- closing/hiding the window with Always-On enabled keeps work running;
- start-at-login can launch the packaged app hidden;
- schedules survive ordinary UI hiding and app restarts through durable state;
- but an Electron main-process crash still stops automation until ND restarts;
- Windows Service / macOS LaunchAgent / Linux systemd-user watchdog is a separate runtime-split milestone.

Do not market this branch as crash-independent daemon operation.

## Durable local state

The organization store, strategy/automation plane, and control plane now all use atomic primary writes plus recovery snapshots for their critical JSON state. The strategy/control authorities serialize first-load races and recover a valid backup if the primary file is unreadable.

## Safety invariants

The implementation preserves:

1. task/worktree isolation;
2. runtime permits and control-plane gates;
3. engine-neutral task ownership;
4. exact checkpoint provenance;
5. independent machine-review evidence;
6. explicit human approval;
7. stale-approval rejection;
8. local secrets remain outside collaboration data by default;
9. scheduled/event work re-enters the same control plane as manual work;
10. automation does not become a second authority;
11. integration approval is currently a pre-integration collaboration gate/record; mandatory orchestrator pause-and-resume enforcement remains a separate bridge and is not falsely claimed by this milestone.

## OpenClaw / Hermes mapping

| Reference pattern | ND implementation |
| --- | --- |
| OpenClaw persistent gateway | Always-On local runtime MVP |
| OpenClaw cron/automation | Automation v2 |
| OpenClaw heartbeat | ND structured heartbeat |
| OpenClaw event/webhook model | ND organization event triggers |
| Hermes persistent bot | existing `OrganizationAgent` |
| Hermes routine | agent-bound ND schedule |
| Hermes skills | existing ND skill system |
| Hermes learning | gated skill candidate -> explicit promotion |
| Hermes messaging | future extension/channel layer, not core in this PR |

## Key files

### Collaboration

- `src/shared/organization.ts`
- `src/main/organization/store.ts`
- `src/renderer/src/components/OrganizationCollaborationCenter.tsx`
- `src/renderer/src/components/OrganizationDashboard.tsx`

### Automation / long-running local operation

- `src/shared/organization-strategy.ts`
- `src/main/organization/strategy-plane.ts`
- `src/main/organization/schedule-runner.ts`
- `src/main/organization/cron.ts`
- `src/main/organization/heartbeat-runner.ts`
- `src/main/organization/event-trigger-runner.ts`
- `src/renderer/src/components/OrganizationStrategyCenter.tsx`

### Always-On runtime

- `src/shared/local-runtime.ts`
- `src/main/local-runtime/local-runtime-service.ts`
- `src/main/local-runtime/ipc.ts`
- `src/preload/local-runtime.ts`
- `src/main/index.ts`

## Tests added/extended

- `tests/organization-collaboration.test.ts`
- `tests/local-automation-v2.test.ts`
- `tests/local-runtime-service.test.ts`
- `tests/schedule-runner.test.ts`

Coverage includes:

- collaboration persistence;
- decision supersession;
- chat != approval;
- stale checkpoint approval rejection;
- approval request-changes/reject semantics;
- cron/timezone calculation;
- one-shot/routine schedules;
- lightweight heartbeat;
- event-trigger idempotency;
- skill candidate promotion;
- Always-On setting persistence/liveness;
- exact scheduled-task dispatch.

## Local verification required

This ChatGPT environment could not clone/install the repo because outbound container DNS to GitHub was unavailable, and PR #64 currently exposes no GitHub Actions run/status.

Run locally from the repo:

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm vitest run \
  tests/organization-collaboration.test.ts \
  tests/organization-strategy-plane.test.ts \
  tests/organization-control-plane.test.ts \
  tests/local-automation-v2.test.ts \
  tests/local-runtime-service.test.ts \
  tests/schedule-runner.test.ts
corepack pnpm test
corepack pnpm build
corepack pnpm beta:unit
```

If dependencies are already installed, skip `pnpm install`.

### Manual local smoke

1. Create/open a company and project.
2. Company -> Team Collaboration:
   - add a second local member;
   - post project chat + @mention;
   - post task discussion;
   - create a decision.
3. Run/checkpoint a coding task.
4. Request explicit integration approval.
5. Confirm:
   - typing “looks good” does not approve;
   - changing checkpoint automatically cancels the old approval;
   - a forged/stale checkpoint cannot be requested;
   - an already-integrated task cannot receive or resolve an integration approval;
   - Request Changes returns pre-integration work to ready;
   - Reject blocks it.
6. Strategy:
   - create interval schedule;
   - create one-shot schedule;
   - create cron schedule using local timezone;
   - create an agent routine with a selected agent + skill;
   - create heartbeat;
   - create event trigger.
7. Set company autonomy >= 3 and verify an automation executes its own generated task.
   - verify blocked/in-progress/review scheduled tasks are not auto-restarted;
   - simulate one transient trigger failure and confirm it retries after the backoff without creating a duplicate task.
8. Remove a test project that owns a schedule, heartbeat, trigger, signal/gate and evidence; restart ND and confirm no orphaned background/control records return.
9. Enable Always-On:
   - close ND window;
   - verify process remains alive;
   - wait for scheduler/heartbeat tick;
   - reopen through global launcher / app launch;
   - confirm liveness timestamps advanced.
10. In an unpackaged dev build, confirm Start at login is shown unsupported while Always-On itself still works.
11. In a packaged Windows build:
   - enable Start at login;
   - sign out/reboot/login;
   - verify ND launches hidden via the background login argument;
   - verify due automation is processed.
12. On packaged macOS, validate the same flow on the signed/notarized app; ND detects the login launch through Electron's login-item state instead of Windows-only arguments.
13. Disable Always-On and confirm normal close exits cleanly.

## Acceptance gate

Do not merge as “fully verified” until:

- typecheck passes;
- targeted collaboration + strategy + control + automation/runtime tests pass;
- full test suite passes;
- `beta:unit` passes;
- packaged build passes;
- manual collaboration smoke passes;
- manual Always-On background smoke passes;
- start-at-login smoke passes on the release OS;
- at least one overnight local automation run is observed without duplicate tasks.

## Deferred intentionally

- independent OS daemon/service/watchdog;
- remote team sync;
- Google Drive / ND Cloud;
- external Telegram/Slack/Discord/email channels;
- hosted identity/SSO;
- billing/admin.

The next local reliability milestone should split the persistent runtime from Electron only if crash-independent/background-service operation is required for Beta/RC.
