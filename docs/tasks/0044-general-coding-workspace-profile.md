# Task 0044 — General / Coding workspace profile

> Owner: ND desktop + extensions  
> Status: implementation complete; local automated validation green on `b3d16a8` (2026-09-28); manual smoke scenarios pending operator  
> Priority: P1  
> PRD: [0007 — General and Coding Workspace Profiles](../prd/0007-general-and-coding-workspaces.md)

## Objective

Ship the first safe product slice that lets non-coding users enter ND through a General workspace while preserving the full Coding experience for developers.

## Scope

- Shared `WorkspaceProfile = 'general' | 'coding'` contract.
- Persist through the existing settings service with typed IPC/preload methods.
- Fresh profiles default to General; legacy settings with the old coding surface migrate to Coding.
- General / Coding title-bar toggle.
- Existing ND / DSH selector nested under Coding.
- General keeps Home / Company / Agent / Design / Settings and hides QA plus header Git controls.
- General cannot activate DSH through direct IPC.
- Stale QA route returns to Home.
- Extension/context/organization state remains untouched.

## Safety invariants

The profile setter must not pause/cancel organization work, stop agent sessions, disable schedules, revoke extension grants, or change permission mode.

## Evidence

- Unit coverage for the shared profile contract.
- Electron smoke starts fresh in General, verifies coding-only controls are hidden, then switches to Coding and verifies ND/DSH + QA.
- Reload regression coverage proves a persisted Coding profile keeps a direct `#/qa` route instead of being redirected by the renderer's initial loading state.
- General-mode smoke proves the main-process guard rejects a direct DSH activation request and switching back to Coding restores ND/workbench.
- Coding QA E2E explicitly selects Coding.
- Local `pnpm typecheck`, `pnpm test` and relevant Electron E2E are required before merge because GitHub Actions are parked.

## Follow-up

Add the first new native extension capability through the PRD 0006 broker/permission path in a separate task.
