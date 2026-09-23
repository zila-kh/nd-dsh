# ND performance benchmarks

These benchmarks are release evidence for PRD 0002. They use deterministic local fixtures and the real production paths; they do not call model providers.

- `pnpm bench:smoke` — short CI correctness/protocol/PTY/Git/scheduler/process-tree smoke.
- `node benchmarks/terminal-handshake-proof.mjs` — proves the benchmark client's Windows terminal handshake both ways: a client that stops answering fails loudly inside the grace window, and the same terminal finishes once it answers.
- `node benchmarks/verify-evidence-identity.mjs` — proves the production evidence identity gates on synthetic bundles: a mislabelled runtime or mismatched nd-core executable is refused by `bench:check` as an `[identity]` failure.
- `pnpm bench:record` — one-shot Windows reference run. It builds the current portable app, records release-core results, records the Rust Electron runtime and packaged startup, evaluates absolute/correctness budgets, and writes `summary.json` plus generated `summary.md`.
- `pnpm bench:compare <baseline.json> <candidate.json>` — compare two same-machine `electron-responsiveness.json` files. Provenance mismatch exits non-zero.
- `pnpm bench:check <bundle/summary.json>` — reload raw JSON and recompute all PRD budgets; missing or failed evidence exits non-zero.
- `pnpm bench:app` — packaged Electron startup only; requires `ND_DSH_BENCH_PACKAGED_APP`.
- `pnpm bench:runtime` — convenience Rust-only same-build Electron stress run for development.
- `pnpm bench:tasks` — agent-task measurement (see below): what one task costs, not how fast the runtime is.
- `pnpm bench:tasks:check` — offline check of the committed agent-task baseline; runs on ordinary PRs.
- `pnpm bench:contract` — runtime-contract measurements: revision-marker cost, the revision-keyed cache's effect on `git.status`/`git.log` and its invalidation under external mutation, bounded search latency and payload size, explicit truncation, cancel-to-stop latency, and core deadline expiry.

## Parallel-runtime v2 retention evidence

The release-core suite now includes the `rust-parallel-runtime-v2` scale contract at
`1/2/4/8/10/25/50/100` logical sessions/workers.

`session-journal-scaling.json` specifically exercises the native bounded event
journal added for high-concurrency chat/team workloads. It records retained
session/event/byte counts, the configured per-session byte ceiling, nd-core
memory and journal-tail RPC latency at every scale point. `bench:check` requires
all scale points and verifies that retained journal bytes never exceed the
configured aggregate bound.

Terminal metrics continue to report retained native terminal count/bytes. In v2,
active terminal scrollback is owned by nd-core; Electron materializes the tail
only for state delivery and durable desktop-restart snapshots instead of keeping
a second 512 KiB hot string per terminal.

Direct coding-engine transcript events are also mirrored into the native journal.
That owner is capped at 500 events / 2 MiB per session, while adapters keep only
a 32-event local safety tail used to bridge an nd-core restart. ChatGPT Web is
excluded from this native mirror and retains its existing durable transcript
because that engine already owns restart persistence and is not used as an
organization workspace worker.

## Agent-task measurement

The runtime benchmarks above measure nd-core and Electron. They cannot measure the agent, so `bench:tasks` records what one task costs:

~~~text
pnpm bench:tasks            # record a fresh bundle (builds core + desktop first)
pnpm bench:tasks:baseline   # the same run, additionally refreshing the committed baseline
pnpm bench:tasks:check      # offline: validate + recompute the committed baseline
~~~

Each task carries `totalWallMs`, `modelRoundTrips`, `toolCalls`, `ipcCrossings`, `bytesToModel`, `tokensToModel`, `escalations` and how the run ended. The result kind is `agent-task-metrics` (schema `benchmarks/schema/task-metrics.schema.json`); every raw sample is kept and the aggregate is derived from them.

Tasks run through the production path: organization records, the guarded `organization:run-task` dispatch with its runtime permit, isolated task worktrees, the real engine router, real machine verification and real cancellation. The engine is a deterministic offline CLI fixture (`benchmarks/fixtures/agent-task-cli.mjs`) selected through ND's documented `ND_DSH_OPENCODE_BINARY` developer override; no model provider is contacted. The counters come from `src/main/metrics/task-metrics.ts`, which is always on in production — the benchmark reads samples, it never switches the measurement on.

| Pass | Fixture workload | Expected record |
| --- | --- | --- |
| `normal-read` (2 tasks) | Read-only deterministic CLI task, 2 model steps / 3 tool calls | matched normal-loop side of the fast-path comparison |
| `fast-read` (2 tasks) | The same read/search/status task through the typed deterministic router | zero model round trips/tool calls/bytes-to-model; same verification gate |
| `verified` (2 tasks) | 3 model steps, 4 tool calls, passing evidence | `completed`, verification `passed`, `completedTask: true` |
| `verification-failed` | 2 steps, failing evidence | `failed`, verification `failed`, `completedTask: false` |
| `engine-failed` | the engine reports an error | `failed`, verification `not-run` |
| `canceled` | 25 steps, canceled after the first round trip | `canceled`, `completedTask: false` |

Rules this measurement keeps:

- A task counts as completed only when its machine verification passed. Failed, canceled and interrupted tasks are reported as samples, never dropped, and `completionRate` guards against measuring "faster" by doing less.
- Counters do not depend on model latency, so an offline fixture may produce them — this is the default and the committed baseline — and a live-model fixture may too. Wall time may not: `wallTimeScope: excludes-model-latency` marks an offline record, whose wall times are product overhead rather than user-visible latency.
- `modelRoundTrips` counts what each engine can actually report: harness `assistant/message` events (one per model call) or a CLI's own wire step boundaries. `roundTripSource` records which, so a zero is never read as "free".
- The fixture declares its own workload and every recorded task is checked against it. A deviation fails the run: the measurement is wrong, not the task fast.
- On Windows ND resolves npm-style `.cmd` shims to their Node entrypoint and spawns that script directly, preserving multi-line prompts. An unresolved shim is allowed only for simple arguments; multi-line or shell-sensitive arguments fail closed rather than being truncated or interpreted by `cmd.exe`.

### Baseline policy

`benchmarks/baselines/agent-task-normal-loop.json` is the committed, reviewed baseline for the normal agent loop: one recorded bundle from the Windows x64 reference machine, refreshed deliberately by a documented PR (`pnpm bench:tasks:baseline`) rather than by every run. Local run directories under `benchmark-results/` stay ignored by Git.

That follows the discipline the runtime suite already states — local results are ignored, reviewed bundles are copied in intentionally — and the same record carries the fast-path proof: `normal-read` and `fast-read` run the same read-only task inside one recording, and `fastPathComparison` must show fewer model round trips, tool calls and nd-core IPC crossings per verified completion, at no completion-rate cost and under the escalation budget. `pnpm bench:tasks:check` re-derives that comparison from the raw samples offline — no Electron, no provider — so a rotted or hand-edited baseline fails, and a run may only replace the baseline when it passes its own verdict.

The committed baseline was re-recorded on 2026-09-23 ([task 0016](../docs/tasks/done/done-0016-agent-task-baseline-fast-path-budgets.md)), and its measured delta per verified completion is model round trips 2 → 0, model-visible tool calls 3 → 0, nd-core IPC crossings 12.5 → 9, completion rate unchanged at 1.0, escalations 0. Its `artifact` field records that the raw bundle is a local recording (`ciRun: null`) because no runner produced it.

## Full MVP evidence

Run `pnpm bench:record` on the documented Windows x64 reference machine. The default command intentionally rebuilds the Windows portable artifact so packaged startup and same-build runtime measurements refer to the current commit.

For a reviewed prebuilt portable artifact, set both:

- `ND_DSH_BENCH_SKIP_PACKAGE_BUILD=1`
- `ND_DSH_BENCH_PACKAGED_APP=<absolute path to the current portable exe>`

The evidence bundle is written under `benchmark-results/<timestamp>-win32-x64/`. Local result directories are ignored by Git. Copy or attach a reviewed bundle intentionally when preserving release evidence.

Raw samples remain the source of truth. The generated Markdown summary contains no handwritten performance percentages; every delta and PASS/FAIL value is derived from JSON.

## Terminal byte accounting on Windows

A PTY is not a byte pipe, and the terminal benchmark must not confuse the console host's rendering with a byte nd-core lost.

Windows ConPTY asks the terminal for its cursor position (`ESC[6n`) before it releases the child's output, and waits for the answer. The benchmark client is a headless byte collector, so it answers with `ESC[1;1R` exactly as the product's xterm.js pane does; without that answer a terminal delivers those four bytes and then nothing at all. `attachTerminalHandshake` in `benchmarks/lib/core-rpc.mjs` owns that behaviour and `benchmarks/terminal-handshake-proof.mjs` proves both directions.

ConPTY also re-renders the stream it forwards: it translates LF to CRLF, and once a line reaches the right margin it emits its own wrap sequence and re-emits the margin character. A 64 KiB blob of `A` therefore comes back as 66 332 payload bytes with 796 injected sequences. That is the console host, not the core.

The fixture (`benchmarks/fixtures/terminal-flood.mjs`) emits payload as self-identifying 64-byte records separated by LF, which stays inside the terminal width and is therefore delivered verbatim. `terminal-throughput.json` separates the two:

- `payloadBytesObserved` / `payloadBytesTarget` and `payloadVerified` — the fixture's payload, compared byte for byte against `expectedPayload()`; length, content and order in one assertion.
- `capturedBytesObserved` / `controlBytesObserved` / `escapeSequencesObserved` — everything the core framed around it, reported rather than subtracted silently.
- `conptyHandshake.queriesAnswered` — cursor-position queries the client answered (0 on Linux, 1 per terminal on Windows).
- `reordered` — terminal event sequence gaps, unchanged.

`pnpm bench:check` requires `payloadVerified`, exact payload counts, four terminals and `reordered=0`.

## Comparison discipline

Release evidence now measures the single production runtime: `rust-core`. The legacy backend switch and node-pty fallback were retired after migration convergence, so `bench:record` no longer boots a second runtime merely to preserve a migration-era relative comparison.

Production evidence still fails closed on identity:
- `backend-identity` requires core/runtime/packaged documents to identify `rust-core`.
- `core-binary-identity` requires one nd-core SHA-256 across core, Electron runtime and packaged evidence.
- `full-provenance` requires one commit, profile, fixture revision and machine fingerprint.

Historical same-machine legacy-vs-Rust `electron-responsiveness.json` files remain comparable with `pnpm bench:compare`. They are historical migration evidence, not a prerequisite for current release recording.

Runtime baselines follow [the baseline policy](../docs/plan/performance-baseline-policy.md): the reviewed summary is committed per reference machine (`benchmarks/baselines/win11-x64.json`, recorded 2026-09-23 by [task 0015](../docs/tasks/done/done-0015-runtime-evidence-baseline.md)), the raw bundle stays gitignored, and the baseline's `artifact` field says where that bundle lives. The full recorder uses at least 10 measured runs for startup and short-latency evidence and reports p50/p95.

## Validation while GitHub Actions is parked

GitHub Actions is intentionally parked while runtime v2 is being stabilized.
Do not treat a missing runner result as waived evidence: run the local handoff in
[task 0018](../docs/tasks/done/done-0018-rust-parallel-runtime-v2.md), including
`pnpm bench:smoke` for development and `pnpm bench:record` +
`pnpm bench:check` on the Windows reference machine when recording reviewed
performance evidence.

The existing workflow definitions remain parked for later restoration; runtime-v2
work does not require enabling them.
