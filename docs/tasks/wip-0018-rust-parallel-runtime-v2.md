# WIP 0018 — Rust parallel runtime v2

> Priority: P1  
> Owner: ND runtime  
> Status: done — merged to main after local validation and performance evidence  
> Branch: `feat/rust-parallel-runtime-v2`  
> Base: `main@5bc853d2`  
> Validation mode: manual local only; GitHub Actions remains parked  
> Updated: 2026-09-23
>
> Validation result: merged by `d1aed436` after the reference bundle `benchmark-results/2026-09-23T10-27-15-202Z-win32-x64` passed 24/24 checks at feature commit `ae801def`.

## Objective

Make ND's multi-company / multi-project / multi-team runtime scale cheaply toward
10/25/50/100 concurrent logical workers without turning the product into a
TypeScript-to-Rust rewrite.

The ownership rule for this wave is:

- TypeScript keeps company semantics, planning, policy, prompts, engine-specific
  protocol interpretation, workflow decisions, approvals, and UI.
- `nd-core` owns machine-wide scheduling, native process lifecycle, PTYs,
  bounded high-volume retention, and other shared system-heavy resources.
- Migration stops where measurement does not justify it.

## Scale contract already on main

The benchmark contract records `1/2/4/8/10/25/50/100` sessions/workers and
separates Electron-main memory, nd-core memory, managed worker memory, external
engine memory, event queues, worktree cost, and control latencies.

Runtime v2 extends that contract with native session-journal retention evidence.

## Phase A — process ownership convergence — implemented

- [x] Project dev servers use an unscoped `createCoreSpawn(core)`; they are
  project-owned resources and never inherit a task permit accidentally.
- [x] Project start commands keep shell semantics explicitly:
  - Windows: `COMSPEC /d /s /c <command>`
  - POSIX: `/bin/sh -c <command>`
- [x] `stopCoreManagedChildProcess` maps teardown to Rust `process.cancel`
  whole-tree ownership.
- [x] Task machine-verification commands use the same unscoped Rust supervisor.
- [x] Verification waits for process-owner teardown before restoring a task
  worktree after timeout.
- [x] Node fallback paths remain injectable and retain whole-tree cleanup.
- [x] nd-core waits one bounded 250 ms drain window for stdout/stderr readers
  before publishing process exit, so verification/dev-server final output is
  not normally truncated while inherited descendant pipes can never hang exit.
- [x] Focused project-runtime regression coverage is committed.

## Phase B — session/event/transcript retention — implemented

### Harness sessions

- [x] Added bounded `SessionJournalStore` to nd-core.
- [x] Default bound is 10,000 events **and** 8 MiB per session.
- [x] Added append/tail/drop/reset/clear RPCs and native retained-byte/event
  metrics.
- [x] Electron batches journal appends over a small bounded window instead of
  crossing core once per event; append replies contain retention metadata only,
  never the retained tail itself.
- [x] `SessionEventHub` no longer owns a 10,000-object JavaScript journal per
  session; it keeps only live stream/baseline/write coordination state.
- [x] Existing history wire shape and live `DshEventFrame` vocabulary are
  unchanged.
- [x] Snapshot/reconnect sequence dedupe remains in TypeScript.
- [x] Surface operations are retained by the native journal.
- [x] If nd-core restarts while the Harness runtime survives, active follow
  streams reopen and repopulate the volatile native journal from fresh runtime
  snapshots instead of losing desktop history.

### Direct coding engines

- [x] Normalized direct-engine transcript events are mirrored once at the common
  `EngineSessionRouter` boundary; vendor adapters remain Rust-agnostic.
- [x] Codex, Claude, Cursor, Pi, Antigravity and ZCode keep only a 32-event JS
  safety tail instead of 500 live event objects.
- [x] Structured CLI engines (OpenCode, Goose, JCode, Hermes) retain their
  historical `assistant/chunk` transcript behavior in native replay.
- [x] Previously-unbounded Structured CLI and MiniMax local transcript arrays are
  now bounded to 32 events.
- [x] Direct-engine native retention is capped independently at 500 events /
  2 MiB per session instead of inheriting the Harness 10,000-event / 8 MiB
  ceiling.
- [x] Renderer transcript reads merge/dedupe the native replay with the
  engine-local safety tail, preserving immediate pre-restart context when
  nd-core has restarted.
- [x] ChatGPT Web intentionally keeps its existing durable 500-event transcript:
  it already owns restart persistence and is not an organization workspace
  worker. Moving it would expand persistence scope rather than solve the
  parallel-worker hotspot.

### Evidence

- [x] Added `session-journal-scaling` benchmark at
  `1/2/4/8/10/25/50/100`.
- [x] It records retained sessions/events/bytes, native memory, tail latency and
  queue metrics.
- [x] Budget checks require the full scale grid and enforce the configured
  aggregate byte bound.
- [x] Added focused batched-journal ownership/replay tests.

## Phase C — terminal retention convergence — implemented

The production PTY was already Rust-owned, but Electron also retained a second
hot 512 KiB scrollback string and repeatedly concatenated it on every output
chunk.

- [x] nd-core terminal tail now matches the desktop 512 KiB bound.
- [x] Active scrollback has one hot owner: nd-core.
- [x] Electron no longer concatenates the live terminal buffer when the PTY
  exposes the native tail contract.
- [x] State delivery and `terminals.json` persistence materialize the Rust tail
  only when needed.
- [x] Persisted scrollback and output sequence seed the native tail after desktop
  restart, preserving existing restore behavior.
- [x] Restart/restore notices can be appended directly to native history without
  inventing shell output events.
- [x] Exited shells remain in nd-core just long enough for Electron to capture
  the final tail, then the native resource is explicitly closed.
- [x] Core-restart reconciliation falls back to the last durable terminal
  snapshot if the previous native tail is no longer available.
- [x] Failed in-place shell restart materializes the native tail before teardown,
  so restart failure cannot erase newer scrollback.
- [x] nd-core gives the PTY reader one bounded 250 ms drain window before
  `terminal.exit`, so final shell output normally lands in replay history
  before Electron captures the exited terminal.
- [x] Focused native-tail/live-state and desktop-restart regression tests are
  committed.

## Phase D — organization persistence — closed by evidence rule, not migrated

`OrganizationStore` remains TypeScript-owned in this wave.

That is deliberate:

- company/task/workflow truth is business state, not a native runtime primitive;
- the existing 100-worker measurements now expose Electron heap/RSS and native
  retention separately;
- no recorded v2 evidence yet demonstrates that whole-snapshot organization
  persistence is the dominant high-concurrency cost;
- introducing SQLite/append-log semantics without that evidence would enlarge
  the migration and persistence failure surface for speculative benefit.

If the local 100-worker evidence later shows organization serialization/GC is a
material bottleneck, open a new measured task for an incremental persistence
backend. Do not reopen this runtime-v2 branch merely to increase Rust coverage.

## Intentionally not migrated in v2

These remain TypeScript by design unless later profiling says otherwise:

- company/team/role/project/task semantics;
- prompts, routing policy and model/provider selection;
- engine-specific protocol parsing;
- approvals and workflow decisions;
- React/renderer state;
- user-triggered QA tooling and one-per-app helper processes where worker count
  does not multiply the cost;
- ChatGPT Web's durable transcript store.

## Manual local validation handoff

**Do not enable or run GitHub Actions for this task.**

From an up-to-date checkout of `feat/rust-parallel-runtime-v2` run:

- [ ] `corepack pnpm core:test`
- [ ] `corepack pnpm verify`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm vitest run tests/project-runtime.test.ts tests/beta-reliability.test.ts tests/session-event-hub.test.ts tests/core-session-journal.test.ts tests/terminal-manager.test.ts tests/nd-core-contract.test.ts tests/engine-session-router.test.ts tests/extra-coding-engines.test.ts tests/agent-cli-engines.test.ts`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm bench:smoke`

Known caveat: [todo-0017](todo-0017-windows-worktree-test-ebusy-flake.md)
records an intermittent Windows `EBUSY` teardown race in
`tests/task-worktree.test.ts`. If that exact teardown symptom is the only
full-suite failure, preserve the log and run the focused worktree spec; do not
silently rerun until green.

### Manual project/runtime smoke

On Windows:

- [ ] Configure a project start command such as `pnpm dev`; start it from ND.
- [ ] Confirm the target becomes ready and logs stream.
- [ ] Confirm nd-core process metrics include the managed dev-server/verification
  processes.
- [ ] Stop/restart/switch workspaces and confirm descendant trees and ports are
  released.
- [ ] Close ND with a server active and confirm no project child remains.
- [ ] Exercise quoting plus `&&` through the explicit `cmd.exe /c` path.
- [ ] Trigger a task verification timeout/cancel and confirm no verifier
  descendants remain.
- [ ] Run a verification command that writes a final stdout/stderr line directly
  before exit and confirm that line is present in the recorded evidence.

On macOS/Linux, repeat start/stop/restart with a shell command containing a pipe
or `&&`.

### Manual chat/transcript smoke

- [ ] Run a Harness session long enough to produce history, reload its thread and
  confirm history/live events are not duplicated.
- [ ] Run a direct coding-engine session with more than 32 normalized events;
  transcript/history must still show older entries from the native journal.
- [ ] Exercise OpenCode/Goose/JCode/Hermes streaming and confirm
  `assistant/chunk` history is preserved.
- [ ] Restart nd-core during a direct session and confirm the merged local
  safety tail + new native events preserve immediate pre-restart context.
- [ ] Restart nd-core during an active Harness session and confirm its thread
  history is rebuilt from the runtime snapshot without duplicates.

### Manual terminal smoke

- [ ] Generate substantial terminal output; live rendering remains continuous.
- [ ] Re-read terminal state and confirm scrollback is present.
- [ ] Restart the shell and confirm the ND restart marker plus prior scrollback.
- [ ] Restart the desktop and confirm persisted scrollback seeds the new native
  terminal.
- [ ] Restart nd-core unexpectedly and confirm reconciliation marks the old shell
  exited without replacing the last durable scrollback with an empty buffer.
- [ ] Run a shell command that prints immediately before exit and confirm the
  final text is present in terminal scrollback after the exit event.
- [ ] Close terminals and confirm `retainedTerminalCount` does not leak upward.

## Full performance evidence handoff

On the Windows reference machine, after the correctness checklist is clean:

- [ ] `corepack pnpm bench:record`
- [ ] `corepack pnpm bench:check <generated bundle/summary.json>`
- [ ] Compare Electron-main RSS/heap and nd-core RSS at 10/25/50/100 against the
  pre-v2 reference bundle.
- [ ] Inspect `session-journal-scaling.json` for the native retained-byte bound
  and tail latency.
- [ ] Confirm external engine memory is reported separately so vendor-process
  RSS does not hide an ND regression.

## Exit / merge result

The operator completed the local correctness and reference-machine evidence pass.
The resulting feature head `ae801def` was merged to `main` by `d1aed436`.
The recorded bundle `benchmark-results/2026-09-23T10-27-15-202Z-win32-x64`
passed 24/24 checks.

GitHub Actions remained intentionally parked; the merge relied on the documented
local validation path rather than silently waiving the acceptance criteria.
