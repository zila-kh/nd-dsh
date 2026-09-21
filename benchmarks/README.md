# ND performance benchmarks

These benchmarks are release evidence for PRD 0002. They use deterministic local fixtures and the real production paths; they do not call model providers.

- `pnpm bench:smoke` — short CI correctness/protocol/PTY/Git/scheduler/process-tree smoke.
- `node benchmarks/terminal-handshake-proof.mjs` — proves the benchmark client's Windows terminal handshake both ways: a client that stops answering fails loudly inside the grace window, and the same terminal finishes once it answers.
- `node benchmarks/verify-evidence-identity.mjs` — proves the evidence identity gates on synthetic bundles: a swapped legacy/rust pair, and a pair that ran two different nd-core executables, are refused by `bench:check` as `[identity]` failures instead of passing as budget deltas.
- `pnpm bench:record` — one-shot Windows reference run. It builds the current portable app, records release-core results, records the same built Electron app in legacy and Rust modes, records packaged startup, evaluates budgets, and writes `summary.json` plus generated `summary.md`.
- `pnpm bench:compare <legacy.json> <rust.json>` — compare two same-machine `electron-responsiveness.json` files. Provenance mismatch exits non-zero.
- `pnpm bench:check <bundle/summary.json>` — reload raw JSON and recompute all PRD budgets; missing or failed evidence exits non-zero.
- `pnpm bench:app` — packaged Electron startup only; requires `ND_DSH_BENCH_PACKAGED_APP`.
- `pnpm bench:runtime` — convenience Rust-only same-build Electron stress run for development.
- `pnpm bench:tasks` — agent-task measurement (see below): what one task costs, not how fast the runtime is.
- `pnpm bench:tasks:check` — offline check of the committed agent-task baseline; runs on ordinary PRs.
- `pnpm bench:contract` — runtime-contract measurements: revision-marker cost, the revision-keyed cache's effect on `git.status`/`git.log` and its invalidation under external mutation, bounded search latency and payload size, explicit truncation, cancel-to-stop latency, and core deadline expiry.

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
| `verified` (2 tasks) | 3 model steps, 4 tool calls, passing evidence | `completed`, verification `passed`, `completedTask: true` |
| `verification-failed` | 2 steps, failing evidence | `failed`, verification `failed`, `completedTask: false` |
| `engine-failed` | the engine reports an error | `failed`, verification `not-run` |
| `canceled` | 25 steps, canceled after the first round trip | `canceled`, `completedTask: false` |

Rules this measurement keeps:

- A task counts as completed only when its machine verification passed. Failed, canceled and interrupted tasks are reported as samples, never dropped, and `completionRate` guards against measuring "faster" by doing less.
- Counters do not depend on model latency, so an offline fixture may produce them — this is the default and the committed baseline — and a live-model fixture may too. Wall time may not: `wallTimeScope: excludes-model-latency` marks an offline record, whose wall times are product overhead rather than user-visible latency.
- `modelRoundTrips` counts what each engine can actually report: harness `assistant/message` events (one per model call) or a CLI's own wire step boundaries. `roundTripSource` records which, so a zero is never read as "free".
- The fixture declares its own workload and every recorded task is checked against it. A deviation fails the run: the measurement is wrong, not the task fast.
- On Windows an npm-style CLI resolves through a `.cmd` shim, and `cmd.exe` treats a newline inside an argument as a command separator, so a shimmed CLI receives only the first line of ND's multi-line prompt. `bytesToModel` counts the full prompt ND submitted; `fixture.shim` records which transport was used.

### Baseline policy

`benchmarks/baselines/agent-task-normal-loop.json` is the committed, reviewed baseline for the normal agent loop: one recorded bundle from the Windows x64 reference machine, refreshed deliberately by a documented PR (`pnpm bench:tasks:baseline`) rather than by every run. Local run directories under `benchmark-results/` stay ignored by Git.

That follows the discipline the runtime suite already states — local results are ignored, reviewed bundles are copied in intentionally — and it is what makes a `normal loop → fast path` comparison reviewable: same fixture revision, same pass definitions, same counter set, against a record anyone can re-check offline with `pnpm bench:tasks:check`.

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

Legacy and Rust relative claims are accepted only when commit, build profile, fixture revision, CPU/OS/architecture, logical CPU count, and physical memory match. The legacy switch is developer-only and exists only for migration/soak comparison; packaged production remains Rust-core only.

Identity is checked before the numbers are trusted, because a swapped legacy/rust pair — or a pair whose runs used two different nd-core executables — satisfies every relative budget in both directions:

- `backend-identity` requires each document's recorded `backend` to match the run that produced it (core/rust/packaged = `rust-core`, legacy = `legacy`).
- `core-binary-identity` requires one `ndCore.sha256` across the core suite, the Rust runtime and the packaged evidence, and requires those three to record one at all. Commit and build profile identify the repository, not the executable that ran; the recorder takes the packaged hash from the staged release manifest, so packaging a different core than the suite measured is refused rather than absorbed.
- `full-provenance` extends the same rule to commit, profile, fixture revision and the machine fingerprint.

Every check carries `kind: 'identity' | 'budget'`, and a failure line starts with `[identity]` or `[budget]`, so a mislabelled or mixed-executable bundle is never read as a numeric regression. `node benchmarks/verify-evidence-identity.mjs` demonstrates this on synthetic bundles, including a deliberately swapped pair.

Runtime baselines follow [the baseline policy](../docs/plan/performance-baseline-policy.md): one committed, reviewed summary per reference machine under `benchmarks/baselines/`, refreshed by a documented PR, with raw bundles attached to the run that produced them.

The full recorder uses at least 10 measured runs for startup and short-latency evidence and reports p50/p95. Memory records keep OS metric names (for example Windows private bytes or Linux PSS) rather than treating them as interchangeable.


## GitHub Actions checkpoint runs

Draft PR commits intentionally skip the heavy CI jobs. Use **Actions → ci → Run workflow** for checkpoints:

- leave `full_benchmark=false` for the normal Linux validation + Windows package/smoke gates;
- set `full_benchmark=true` for the Windows legacy-vs-Rust performance evidence run only.

The full benchmark job uploads `prd-0002-performance-evidence` containing the generated Markdown summary and raw JSON samples.
