# WIP 0018 — Rust parallel runtime v2

> Priority: P1  
> Owner: ND runtime  
> Status: WIP — process-ownership convergence implemented; retention migration follows measured evidence  
> Branch: `feat/rust-parallel-runtime-v2`  
> Base synced: `main@5bc853d2` on 2026-09-23  
> Validation mode: manual local only; GitHub Actions remains parked  
> Updated: 2026-09-23

## Objective

Reduce Electron-main RAM, process handles, event churn, and duplicated state as ND scales from a few workers to many companies/projects/teams with 10/25/50/100 concurrent logical workers.

The rule is **benchmark-directed migration**, not “rewrite TypeScript in Rust”:

- TypeScript keeps company semantics, planning, policy, prompts, engine protocol interpretation, and UI.
- `nd-core` owns machine-wide scheduling and system-heavy/shared runtime work.
- A migration must preserve the external ND contract and prove a resource or latency win before deeper business logic moves.

## Current baseline

The 100-worker scale contract is already merged to `main`:

- logical/runtime scale points: `1/2/4/8/10/25/50/100`;
- scheduler/process/worktree benchmark records core, managed-worker, external-worker, queue and disk measurements;
- Electron runtime benchmark records RSS plus JS heap/external/array-buffer memory and core retained-resource counters.

This task continues from that merged baseline rather than duplicating it.

## Phase A — project process ownership convergence

### Why

Direct coding-engine children already spawn through `createCoreSpawn`, but `ProjectRuntimeService` still launched dev servers directly from Electron with `node:child_process.spawn({ shell: true })` and maintained its own platform-specific tree teardown.

That leaves a long-lived process class outside the shared Rust supervisor.

### Implemented on this branch

- [x] Resolve project start commands through an explicit platform shell:
  - Windows: `COMSPEC /d /s /c <command>`
  - POSIX: `/bin/sh -c <command>`
- [x] Use a dedicated `createCoreSpawn(core)` for project dev servers.
- [x] Do **not** attach project dev servers to the current worker/task permit.
- [x] Add `stopCoreManagedChildProcess`; its `kill()` maps to Rust `process.cancel` whole-tree teardown.
- [x] Keep `ProjectRuntimeService` injectable so unit tests and non-core fallback tests remain possible.
- [x] Add focused regression tests for shell argv and injected process-owner teardown.
- [x] Route task machine-verification commands through the same unscoped Rust process supervisor.
- [x] Make verification process ownership injectable so direct unit coverage can keep using the local Node fallback.
- [x] Await process-owner teardown before verification cleanup restores a task worktree after timeout.

## Phase B — session/event retention

Next candidate after Phase A validation:

- measure Electron retention for session journals and direct-engine transcripts at 10/25/50/100 sessions;
- move bounded normalized event retention toward a shared native store only if JS heap/GC evidence justifies it;
- preserve engine-specific parsing/routing in TypeScript;
- prefer batched append/tail RPCs so moving storage does not increase IPC crossings.

Important current hotspots:

- `SessionEventHub`: bounded journal up to 10,000 envelopes per session;
- direct engines: up to 500 transcript envelopes per session;
- renderer copies can multiply the live-object cost.

## Phase C — terminal retention convergence

The Rust PTY already retains a bounded live tail, but Electron also keeps/persists terminal scrollback.

Do not remove the JS/persisted buffer until Rust has a durable replacement: current desktop restart behavior restores scrollback, while the in-memory Rust tail dies with `nd-core`.

Target:

- durable native terminal tail/session metadata;
- one authoritative retained byte budget;
- Electron keeps only the active renderer-facing tail;
- no loss of restart/restore semantics.

## Phase D — organization persistence only if measured

`OrganizationStore` still clones and serializes whole snapshots. Consider incremental native persistence (for example append log/SQLite + snapshots) only after the 100-worker measurements show it is material.

Business rules remain TypeScript-owned.

## Manual local validation handoff

Do **not** enable or run GitHub Actions for this task.

Run these locally from an up-to-date checkout of `feat/rust-parallel-runtime-v2`:

- [ ] `corepack pnpm core:test`
- [ ] `corepack pnpm verify`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm vitest run tests/project-runtime.test.ts tests/beta-reliability.test.ts`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm bench:smoke`

Known local-suite caveat: [todo-0017](todo-0017-windows-worktree-test-ebusy-flake.md) records an intermittent Windows `EBUSY` teardown race in `tests/task-worktree.test.ts`. If the only full-suite failure is that exact known teardown symptom, preserve the log and run the focused worktree test instead of treating it as proof this runtime change failed.

### Manual project-runtime smoke

On Windows (highest priority for this slice):

- [ ] Configure a project start command such as `pnpm dev`.
- [ ] Start it from ND; target becomes ready and logs stream normally.
- [ ] Verify `nd-core` process metrics include the managed dev-server process.
- [ ] Stop the project; the whole dev-server descendant tree exits and the port is released.
- [ ] Restart repeatedly; only one live tree owns the port.
- [ ] Switch to another workspace; the previous project's dev server exits.
- [ ] Close ND while the server is running; no child process remains.
- [ ] Try a shell command containing quoting and `&&` to confirm the explicit `cmd.exe /c` path preserves normal start-command semantics.

On macOS/Linux:

- [ ] Repeat start/stop/restart with a command that uses a pipe or `&&`; `/bin/sh -c` must preserve it.

## Acceptance for Phase A

- [ ] All manual local validation above is recorded.
- [ ] Project start/stop behavior is unchanged from the UI's perspective.
- [ ] Project dev servers and task machine-verification commands appear under the single Rust process supervisor.
- [ ] No project dev server is killed merely because a task execution permit is released.
- [ ] Closing/stopping ND leaves zero project-runtime process descendants.
- [ ] No regression in shell command quoting on supported platforms.

## Merge rule

Do not merge Phase B/C/D merely because they increase Rust coverage. Each later migration needs a before/after measurement from the committed 100-worker contract and must preserve the existing ND external contract.
