## Verification record (2026-09-22)

Verified by `ZCode` before archiving. Basis: the working tree at commit `588f3ed` **plus its
uncommitted changes** — the work was never committed, so this record is only as durable as the
eventual commit.

| Gate | Command | Result |
| --- | --- | --- |
| Rust format | `cargo fmt --check` | clean (no diff) |
| Rust lint | `cargo clippy -p nd-core --all-targets -- -D warnings` | clean |
| Rust tests | `cargo test -p nd-core` | 16 passed, 0 failed (was 9 before this work) |
| Repo invariants | `pnpm verify` | passed |
| Types | `pnpm typecheck` | passed |
| Unit tests | `pnpm test` | 748 passed, 8 skipped (was 719) |

Substantive criteria were checked against the tree, not against the checkboxes. What that covers is
listed per ticket below; the remaining boxes were accepted on the strength of the gates above rather
than audited individually.

**Limit of this verification:** no review of the client-side call sites beyond compile and test
coverage, and no packaged-app or Linux-CI run. Work is uncommitted.
# Task 0006 — Finish the nd-core runtime contract

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ZCode (Sila Rim)  
> Branch: feat/nd-core-runtime-contract  
> Updated: 2026-09-21  

## Status

**Implemented.** Sections 1, 2, 3, 4, and 5 are closed with tests and measurements. The
decision record that must not be re-litigated lives in
[PRD 0002 §5.0.3](../prd/0002-rust-sidecar-mvp-migration.md#503-decision-record--nd-core-runtime-contract-task-0006-2026-09-21);
this file carries the per-section work and its evidence.

Three things are deliberately **not** done here, and are recorded as follow-ups rather
than left implied:

1. `workspace.search` and `workspace.revision` are exercised by tests and the contract
   benchmark, but no product or engine path calls them yet. Search is the one new
   capability in this task, and the §1 lesson applies to it too: its consumer is the
   agent/engine tool bridge, which is not this task. **Do not advertise search as a
   product feature until a real caller exists** — the RPC is a foundation, not a shipped
   capability.
2. A user-facing "cancel this operation" affordance is not wired. `core.cancel` has a
   real automated consumer (the client's own timeout backstop, below) and full test
   coverage, but no UI or workflow asks for a cancel by request id yet.
3. Durable state is still out of scope: the cache and revision markers are
   process-lifetime, exactly as the PRD scopes them.

## Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Rust format | `cargo fmt --check` | no diff |
| Rust lint | `cargo clippy -p nd-core --all-targets -- -D warnings` | clean |
| Rust unit tests | `cargo test -p nd-core` | 38 passed, 0 failed |
| Rust protocol tests | `cargo test -p nd-core --test protocol_contract` | 16 passed, 0 failed |
| TypeScript contract tests | `vitest run tests/nd-core-contract.test.ts` | 10 passed |
| Static verification | `pnpm verify` | passed (225 source files, 97 test files) |
| Typecheck | `pnpm typecheck` | passed |
| Unit suite | `pnpm test` | 745 passed, 8 skipped, 0 failed |
| Build | `pnpm build` | passed |
| Benchmark smoke | `pnpm bench:smoke` | passed, `status: pass`, `failures: []` (see note) |
| Contract measurements | `pnpm bench:contract` | see §4 and §5 below |

Note on `bench:smoke`: it was red on Windows before this work (ConPTY Device Status Report;
owned by task 0004). On this branch it passes on Windows with the new protocol in place, so
the protocol changes here — the optional `deadlineMs` frame field, the `workspace.list`
result shape, and the new methods — did not break the runtime suite. The smoke gate is
Windows-local evidence; CI coverage for it is still task 0004's.

## 1. The `workspace.*` RPCs have no product caller — decided

**Decision.** `workspace.list` and `workspace.read` are the product's workspace
filesystem layer and are now called from `src/`. `workspace.realpath`, `workspace.stat`,
and `workspace.atomicWrite` were **removed from the protocol**.

Why that split, rather than keeping all five and finding users for them:

- The only real consumer of per-file workspace work is the workspace browser
  (`WorkspaceService.list` / `.read`, reached from the renderer through `IPC.workspaceList`
  and `IPC.workspaceRead`). It needs exactly list and read.
- A bare resolve (`realpath`) or stat is never the operation a caller wants; it is a step
  inside one, and both kept methods already resolve and contain internally. Keeping them
  would have been protocol surface with a caller invented to justify it — which this task
  explicitly forbids.
- The renderer workspace API is read-only, and the product's durable writes are
  organization/registry state owned by TypeScript stores that already do their own atomic
  temp-and-rename. A general workspace **write** RPC has no consumer today.

What changed in the Rust side to make the migrated call sites honest:

- `list` returns a bounded result object with `truncated` and `maxEntries` instead of
  silently returning the first N entries. The product requests the full bounded window
  (4096) and then applies its own skip/limit filter, so a directory full of skipped heavy
  folders cannot consume the window and hide real files.
- `read` returns `truncated` and `byteSize` instead of failing when the file is larger
  than the requested bound, and the hard bound is now derived from the protocol frame
  bound (`MAX_FRAME_BYTES / 2`). Before this a caller could legally ask for 16 MiB and get
  a read that could never be framed, so the failure landed after the read as an unrelated
  protocol error.

- [x] Every `workspace.*` RPC is either called from `src/` with a test covering the call
      site, or removed from the protocol.
      — `tests/nd-core-contract.test.ts` ("workspace primitives call site") asserts the
      call site passes the workspace root and the core bound through, maps truncation,
      applies the product filter, propagates core rejections instead of falling back, and
      that the in-process path still serves the legacy backend.
- [x] No workspace RPC remains reachable only from benchmarks.
      — `benchmarks/run-suite.mjs` uses `workspace.list`, the same method the product
      uses. The five-method benchmark-only surface is gone.
- [x] Migrated call sites reject paths outside the active workspace root, with a test
      proving the rejection.
      — `protocol_contract.rs::workspace_primitives_are_bounded_reject_escapes_and_are_the_only_ones_exposed`
      (parent escape, absolute path, Windows drive prefix), plus the workspace unit tests.
- [x] Symlink/realpath escape coverage exists for each migrated primitive that resolves
      paths.
      — `workspace.rs::rejects_symlink_escape_on_read_and_list`. The fixture is created at
      run time and the test reports itself as skipped when the platform refuses to create
      a symlink, rather than passing on a false premise.
- [x] The bounded-read and payload-size guarantees the Rust side enforces are preserved
      at the call site.
      — `bounded_read_reports_truncation_instead_of_failing` asserts the clamp; the TS call
      site passes its own 1 MiB cap and maps `truncated` straight through.
- [x] The decision is recorded so it is not re-litigated.
      — PRD §5.0.3, the PRD method list, `docs/plan/agent-fast-path.md` §4.1, and this
      section.

## 2. Core-side deadlines and per-request cancellation

**Decision.** The deadline lives on the request frame (`deadlineMs`), not on individual
methods, so every method is boundable without a second convention. Values are validated
against core-side bounds (50 ms … 30 min) *before* a request is queued. The client derives
its deadline as `timeoutMs - 250 ms`, which is what makes the core lose the race: the
caller now receives a typed deadline error instead of an untagged client timeout while the
work continues in Rust.

Stopping work is per request id. A request's interrupt is registered when the request is
accepted, so a request that expires while queued fails immediately instead of running late,
and it is released by a drop guard, so a request that fails cannot leak its slot.

The kill is done by the thread that owns the child handle, which is why there is no
watchdog thread: no other thread ever holds a pid it could reuse after the child is reaped.
On Windows the child is also assigned to a kill-on-close Job Object, so closing the handle
ends the tree; on unix it is spawned as its own process group.

- [x] `git.exec` (and one other long-running method) accept a deadline; expiry stops the
      work and reports a distinguishable error code.
      — `git.exec`, `git.status`, and `git.log` accept the frame deadline and answer
      `deadline_exceeded`. Covered by
      `deadline_expiry_stops_git_work_reports_its_code_and_leaves_no_orphan` and by
      `benchmarks/nd-core-contract.mjs` (`contract-deadline-expiry`: an 800 ms deadline
      stopped a 60 s command in 1091 ms).
- [x] After expiry, no orphaned child process remains and the request's permit is released.
      — The same test proves the child was alive (heartbeat file non-empty) and then frozen
      after the stop, and asserts `inFlightRequestCount` / `dispatcher.active` are back to
      the observer's own single slot.
- [x] Cancelling one request leaves unrelated in-flight requests and their permits intact.
      — `cancelling_one_request_leaves_its_peer_running_and_releases_only_its_own_slot`:
      the cancelled request answers in 259 ms, its peer completes with exit code 0, and the
      dispatcher returns to baseline. Measured cancel-to-stop in the benchmark: 299 ms.
- [x] Deadline values are bounded and validated; an absurd deadline is rejected rather than
      accepted.
      — `absurd_deadlines_are_rejected_before_any_work_starts` covers 0, 10, 86 400 000 and
      `u64::MAX`, asserts the `invalid_params` code, and asserts the fake Git executable was
      never started.
- [x] The client maps core deadline errors to a typed error a caller can branch on, not a
      generic failure string.
      — `NdCoreError` (with `code`) plus `isNdCoreDeadlineError` / `isNdCoreCanceledError`
      in `src/main/core/core-protocol.ts`, tested in `tests/nd-core-contract.test.ts`.
      `GitCli.execCore` branches on it and reports `GitErrorCodes.DeadlineExceeded`, so the
      Git surface can distinguish a timeout from a failure.
- [x] Tests cover expiry, cancellation, and the no-orphan assertion.
      — The four integration tests above, plus the unit-level interrupt tests in
      `deadline.rs`.

One more hole was closed while implementing this: the client's own timer used to reject and
leave the work running — the original defect, moved to the other side. It now tells the core
to cancel that request id before rejecting, which also gives `core.cancel` a real automated
consumer.

## 3. Protocol completeness and the event model

**Decision: methods.** `terminal.restart` and `terminal.state` exist. `process.kill` and
`scheduler.configure` were removed from the PRD's method list:

- `process.kill` is `process.cancel`; a second name for the same call would be surface with
  no distinct behaviour (and `process.cancel` now has protocol-level tests).
- `scheduler.configure` would make the sidecar a second, unsynchronized source of truth for
  capacity limits that arrive with each `scheduler.acquire` claim and are owned by the
  organization layer. Role/team/review caps and `maxParallelWorkers` are decided there
  (task 0007 owns the remaining dispatch heuristic).

**Decision: events.** The existing uniform envelope stays; there is no
subscribe/acknowledge protocol. The client is a single trusted local process whose
subscriptions are fixed at startup, and the bounded priority output queues already provide
backpressure — a second flow-control mechanism would have no consumer. What was genuinely
missing was recovering from *missed* events, and that is answered per resource: a terminal
keeps a bounded output tail and a monotonic sequence, and `terminal.state` reports both, so
a client that missed events reaches the same view as one that received them all.

- [x] Each listed method either exists with tests, or is removed from the PRD with a
      recorded reason.
      — `terminal_restart_preserves_identity_and_never_reports_the_previous_shell_running`,
      `terminal_state_carries_the_sequence_a_client_needs_to_recover_from_missed_events`,
      `process_cancel_stops_a_managed_process_and_reports_nothing_afterward`, and
      `every_declared_capability_is_reachable_and_unknown_methods_are_refused` (which
      asserts `process.kill` is refused). Reasons recorded in the PRD method list.
- [x] `terminal.restart` preserves terminal identity and never reports a previous shell as
      still running.
      — Identity: the same `terminalId` keeps its registry entry, its sequence numbers
      continue, and its output tail survives (the tail belongs to the terminal, not to one
      shell). Truthfulness: each shell is a *generation*; the state read describes the
      current generation's pid and marks a running shell as running. A superseded
      generation's exit is recorded but never published as the terminal's exit, which is
      what stops a client from concluding the live terminal ended. Tested in Rust and in
      `tests/nd-core-contract.test.ts`; `TerminalManager.restart` uses it when the runtime
      supports it, so `PtyProcessLike.restart` keeps the terminal in place instead of
      spawning a new one.
- [x] `terminal.state` lets a client that missed events reach the same view as one that
      received them all.
      — `seq`, `firstRetainedSeq`, `droppedThroughSeq`, `retainedBytes`, `tailTruncated`,
      plus the retained bytes themselves. Output that has aged out of the bounded tail is
      reported as dropped rather than silently absent. The desktop side reads it in
      `readCoreShellState`, which `TerminalManager.reconcileShells()` uses to mark terminals
      whose shell died with a previous sidecar generation as exited instead of leaving them
      showing as running.
- [x] An explicit event-model decision is recorded.
      — PRD §5.0.3, "Event model" row.
- [x] Any new event stream is bounded with the same backpressure guarantee as the existing
      priority queues.
      — `terminal.restart` publishes through the same `ProtocolWriter` priority queues as
      every other event, and the new state that could grow without limit (the retained tail)
      is bounded at 256 KiB per terminal, with the bound and the dropped sequence reported.
      `metrics.snapshot` finally reports `retainedTerminalBufferBytes` from the real tails
      instead of a hardcoded 0, and adds `retainedTerminalCount` and `inFlightRequestCount`.

## 4. State and cache primitives with a revision marker

**Decision.** Two markers, because two reads depend on different state:

- `RevisionScope::GitRefs` fingerprints `HEAD`, `packed-refs`, the in-progress-operation
  files, `config`, and `refs/**` (recursively, content-hashed). History cannot change
  without one of them changing, so `git.log` is cached against this cheap marker
  (p50 3.0 ms).
- `RevisionScope::Worktree` adds the index and a walk of the working tree in Git's own
  ignore terms, recording path, kind, size, and mtime per entry. `git.status` reports on the
  worktree and the index, so it needs this (p50 12.5 ms over 127 entries).

A marker that could not be computed faithfully — the walk hit its bound, or an entry could
not be read — is reported `truncated` / `skippedEntries > 0` and the cache is **bypassed**,
rather than serving a hit that cannot be trusted. Every cached response carries `cached` and
`revision`, so a served reply and a computed one are always distinguishable, from Rust and
from the Git command log in the main process.

Measured (`pnpm bench:contract`, `contract-git-status-cache` / `contract-git-log-cache`):

| Read | Cold (spawn + parse) | Cached (revision + served) | Ratio |
| --- | --- | --- | --- |
| `git.status` | 69 ms | p50 12.5 ms / p95 21.9 ms | 5.5× |
| `git.log -n8` | 74 ms | p50 4.2 ms | 17.8× |

Both were served on 9 of 9 repeats with an unchanged revision, invalidated by an external
file creation (`git.status`) and by an external commit (`git.log`). The cache reported
21 hits, 4 misses, 2 invalidations and 2 live entries at 1446 bytes.

- [x] A revision marker exists, is cheap to read, and changes when the described state
      changes, with tests for both directions.
      — `revision.rs` unit tests (stable when nothing changes, moves on edit/add/remove,
      refs-scope unaffected by worktree edits) and
      `protocol_contract.rs::a_revision_marker_changes_with_the_described_state_and_holds_when_it_does_not`.
- [x] At least one real derived read (Git status is the candidate) is cached against the
      revision and demonstrably avoids redundant work.
      — `git.status` and `git.log` through the product's own `GitService.refresh()`
      (`statusEntries` / `logEntries`, i.e. every workspace event, every Git action, and
      every engine turn). Numbers above.
- [x] Invalidation is correct under external mutation: a file changed outside nd-core must
      not serve a stale cached result.
      — `git_status_and_log_are_cached_against_a_revision_and_never_serve_stale_state`
      mutates the repository from outside nd-core and asserts the next read is
      `cached: false`, carries a new revision, and lists the externally created file.
- [x] Entry count and memory are bounded by an eviction policy, with a test proving the
      bound under sustained load.
      — LRU by entry count and by bytes.
      `cache.rs::entry_count_and_bytes_stay_bounded_under_sustained_load` performs 500
      inserts against a 16-entry / 4 KiB cache and asserts both bounds after every insert.
- [x] `metrics.snapshot` reports cache size and hit/miss counts so the benchmark suite can
      measure the effect.
      — `metrics.snapshot.cache`: entries, bytes, maxEntries, maxBytes, hits, misses,
      invalidations, evictions, inserts.
- [x] Staleness is never silent.
      — `cached` and `revision` on every response; a non-authoritative marker bypasses the
      cache entirely; the Git command log line is labelled `cached` when a response was
      served.

## 5. Search and indexing (new capability, not a migration)

**Decision: scan, not index.** `workspace.search` walks the workspace with Git-compatible
ignore rules and matches line by line, with hard bounds on results, files, per-file matches,
and file size. Measured on a 123-file fixture returning 122 matches: p50 30.5 ms, mean
62.6 ms, max 319.6 ms — the same order as the stat-only revision read that guards a cache,
so an index would add a second source of truth and a background process to keep in step for
a latency that is not the bottleneck yet. Revisit when a measured search on a real workspace
is the dominant cost of a task.

The scan runs on the requesting dispatcher thread and never spawns a worker, which makes
"no orphaned scanner left running" a structural property rather than a cleanup obligation —
a deadline or a cancel can only stop the walk, never leave it behind. That is also why the
walker uses `ignore`'s single-threaded builder rather than its parallel one.

- [x] A bounded content search exists over the active workspace root, returning file, line,
      and preview.
      — `workspace.search`; previews are capped per line so one pathological line cannot
      dominate an otherwise bounded response.
- [x] Ignore rules are honored and search cannot escape the workspace root.
      — `.gitignore`, global and per-repo excludes via the `ignore` walker (Git's own
      semantics, not an approximation), with `require_git(false)` so the rules also apply in
      a folder that is not a repository; escape rejection tested in Rust and over the
      protocol.
- [x] Results report truncation explicitly; a caller can tell a complete result from a
      capped one.
      — `truncated`, `stopReason` (`resultLimit` | `fileLimit` | `deadlineExceeded` |
      `canceled`), `cappedFiles`, plus the effective limits and skip counters.
- [x] Binary and oversized files are skipped without failing the request.
      — `skippedBinaryFiles` / `skippedOversizedFiles` are reported; a skipped file is not
      reported as truncation.
- [x] Deadlines and cancellation apply (section 2), with no orphaned scanner left running.
      — A stopped scan returns its partial result with `stopReason` instead of an error,
      because a search has partial value; `git.exec` reports an error instead, because a
      half-finished Git command has no partial result. The asymmetry is recorded in §5.0.3.
- [x] Latency and result-size bounds are measured, not asserted.
      — `contract-search`: p50/mean/max latency, match count, scanned files, payload bytes
      (15 555 bytes for 122 matches), and the capped case returning exactly the requested 5
      with `stopReason: resultLimit`.
- [x] The index-versus-scan decision is recorded with the measurement that justified it.
      — PRD §5.0.3, "Search: scan or index" row.

## Files changed

Rust (`crates/nd-core/`): `errors.rs`, `deadline.rs`, `cache.rs`, `revision.rs`,
`search.rs` (new); `workspace.rs`, `git.rs`, `terminal.rs`, `protocol.rs`, `main.rs`,
`dispatcher.rs`, `Cargo.toml`; `tests/protocol_contract.rs` (new).

TypeScript (`src/main/`): `core/core-protocol.ts`, `core/core-client.ts`,
`core/core-workspace.ts` (new), `core/core-pty.ts`, `workspace/workspace-service.ts`,
`terminal/terminal-manager.ts`, `git/git-cli.ts`, `index.ts`.

Tests and evidence: `tests/nd-core-contract.test.ts` (new),
`benchmarks/nd-core-contract.mjs` (new), `benchmarks/lib/core-rpc.mjs` (optional request id
and `deadlineMs`), `package.json` (`bench:contract`).

## Follow-ups

| Follow-up | Why it is not in this task | Where it belongs |
| --- | --- | --- |
| Give `workspace.search` a product/engine caller | Its consumer is the engine tool bridge; the §1 lesson is not to ship capability without one | Task 0008 (fast path) or the engine adapter work |
| Wire a user-facing cancel to `core.cancel` | Needs a request handle exposed to callers and a UI affordance | Task 0007 or the editor/terminal UX work |
| Retire the in-process workspace filesystem | Kept only as the documented legacy rollback path | Task 0007 (legacy backend removal trigger) |
| Cache `workspace.revision` itself | The marker is recomputed per read; its cost is measured and acceptable | Only if the benchmark shows it as a cost |
| Durable state | Explicitly out of sidecar scope in PRD 0002 | Organization/runtime persistence work |
