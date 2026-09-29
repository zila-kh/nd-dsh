# Local-First Team Workspace + Always-On Automation Handoff

Status: **implementation complete for local MVP; local machine verification required**
Branch: `feat/local-first-team-workspace`
PR: #64

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
- chat/reactions do not imply approval;
- stale checkpoint approval is rejected;
- request-changes returns a task to ready/rework state;
- rejection blocks the task with a visible reason;
- Needs You combines collaboration attention with control-plane attention, reviews, blockers and automation/heartbeat signals.

The existing Agent `ChatPanel` remains the execution transcript. Team collaboration is durable project truth in Company, so tools/subagent traces do not become noisy team chat.

### Automation v2

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
10. automation does not become a second authority.

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
corepack pnpm vitest run tests/organization-collaboration.test.ts tests/local-automation-v2.test.ts tests/local-runtime-service.test.ts tests/schedule-runner.test.ts
corepack pnpm test
corepack pnpm build
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
   - changing checkpoint makes an old approval fail stale;
   - Request Changes returns work to ready;
   - Reject blocks it.
6. Strategy:
   - create interval schedule;
   - create one-shot schedule;
   - create cron schedule using local timezone;
   - create an agent routine with a selected agent + skill;
   - create heartbeat;
   - create event trigger.
7. Set company autonomy >= 3 and verify an automation executes its own generated task.
8. Enable Always-On:
   - close ND window;
   - verify process remains alive;
   - wait for scheduler/heartbeat tick;
   - reopen through global launcher / app launch;
   - confirm liveness timestamps advanced.
9. In packaged Windows/macOS build:
   - enable Start at login;
   - sign out/reboot/login;
   - verify ND launches hidden;
   - verify due automation is processed.
10. Disable Always-On and confirm normal close exits cleanly.

## Acceptance gate

Do not merge as “fully verified” until:

- typecheck passes;
- targeted tests pass;
- full test suite passes;
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
