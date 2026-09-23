# ND Performance Benchmark Suite

Status: **implemented at runtime level, and extended here.** Sections 1-10 describe the suite that merged with PRD 0002 (`benchmarks/`, scripts `bench:smoke|record|compare|check|app|runtime`, CI wiring in `.github/workflows/ci.yml` and `benchmark-proof.yml`). Section 12 records the gaps that remain before this suite can measure agent-task cost and fast-path gains.
Updated: 2026-09-22
Related: [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · [Parallel work distribution](parallel-work-distribution.md) · [Roadmap](../roadmap.md)


## 0. 2026-09-22 convergence decision

The migration-era dual-backend release gate is retired. Desktop production now has one runtime path: bundled `nd-core`; node-pty and `ND_DSH_CORE_BACKEND=legacy` are no longer runtime/packaging dependencies. Current `bench:record` therefore records absolute/correctness evidence for Rust core + Rust Electron runtime + the packaged app. `bench:compare` remains available for historical legacy-vs-Rust bundles.

Agent-task measurement now includes matched `normal-read` and `fast-read` passes. The fast pass exercises the production organization router and a bounded composite `workspace.snapshot` operation, and it must reduce model round trips, model-visible tool calls and nd-core IPC crossings without reducing completion rate. Offline fixture wall time is not presented as model-latency evidence.

## 1. Why this exists

The Rust shared-core migration is not successful merely because code moved from TypeScript to Rust.

The MVP must prove, with repeatable measurements, that ND is:

- cheaper to scale across multiple agents,
- more responsive under terminal/Git/process load,
- safer to cancel and clean up,
- bounded in memory and queues,
- faster or at least no-regression on hot paths,
- measurable again after future changes.

jcode is a useful reference because it keeps startup, memory, terminal, and budget-check tooling in its repository instead of treating performance as a one-time blog claim. ND should adopt the same discipline while measuring the things that matter for an Electron multi-agent product.

This plan intentionally does **not** copy jcode's TUI targets. ND has Chromium/React and must measure the full desktop process graph separately from the native core.

## 2. Principles

1. **Benchmarks live in the repo.** A result that cannot be reproduced from committed scripts is not release evidence.
2. **Raw samples are preserved.** Never report only the fastest run.
3. **Same-machine comparisons.** Legacy-vs-Rust percentage claims use the same machine, fixtures, run count, and product mode.
4. **Separate layers.** Report nd-core, Electron, and external engine children separately.
5. **No live-model dependency.** Core speed gates use deterministic local fixtures/synthetic workers.
6. **Packaged matters.** Startup evidence includes the actual packaged Windows artifact.
7. **Correctness before speed.** A benchmark fails if bytes are dropped, processes leak, caps are bypassed, or results are malformed.
8. **Budgets fail builds.** The benchmark checker exits non-zero when a required budget is violated.
9. **No benchmark-only fast path.** Production code paths must be exercised; benchmark-specific bypasses invalidate the result.
10. **Environment is evidence.** Every result records machine/runtime/toolchain provenance.

## 3. Proposed repository layout

~~~text
benchmarks/
  README.md

  schema/
    result.schema.json

  fixtures/
    generate-large-git-fixture.mjs
    synthetic-engine.mjs
    terminal-flood.mjs

  lib/
    benchmark-env.mjs
    process-metrics.mjs
    statistics.mjs
    result-writer.mjs
    packaged-app.mjs

  core-startup.mjs
  app-startup.mjs
  memory-scaling.mjs
  terminal-throughput.mjs
  git-workload.mjs
  scheduler-multi-agent.mjs
  cancellation-latency.mjs
  electron-responsiveness.mjs

  compare.mjs
  check-budgets.mjs

  baselines/
    README.md
~~~

Rust microbenchmarks may also live under:

~~~text
crates/nd-core/benches/
  protocol.rs
  git_parse.rs
  scheduler.rs
~~~

Microbenchmarks are diagnostic only. Product acceptance is based primarily on end-to-end benchmark scripts that cross the real Electron <-> nd-core boundary.

## 4. Package commands

The MVP should expose:

~~~text
pnpm bench:smoke
pnpm bench:record
pnpm bench:compare
pnpm bench:check
pnpm bench:tasks
pnpm bench:contract
~~~

### bench:smoke

Short enough for normal PR CI.

Must prove:
- benchmark harness boots,
- result schema validates,
- core handshake works,
- one terminal test completes without dropped/reordered bytes,
- one Git fixture workload completes,
- scheduler caps are respected,
- cancel leaves no orphan process,
- one-core-many-sessions invariant holds.

Do not use tight absolute timing thresholds on shared GitHub-hosted runners.

### bench:record

Runs the full suite and writes one machine-readable result bundle.

Example output:

~~~text
benchmark-results/
  2026-09-21T143200Z-win32-x64/
    environment.json
    core-startup.json
    app-startup.json
    memory-scaling.json
    terminal-throughput.json
    git-workload.json
    scheduler-multi-agent.json
    cancellation-latency.json
    electron-responsiveness.json
    summary.json
    summary.md
~~~

Local result directories should normally be ignored by Git. Selected release/reference baselines may be copied into a reviewed location when intentionally retained.

### bench:compare

Compares two recorded bundles or runs both backend modes on the same machine:

~~~text
legacy
vs
rust-core
~~~

Output includes:
- absolute values,
- percent delta,
- PASS/FAIL against relative budgets,
- machine/provenance mismatch warnings.

### bench:check

Reads a benchmark result and exits:
- 0 when required budgets pass,
- non-zero when required budgets fail,
- non-zero when required metrics are missing,
- non-zero when provenance/schema is invalid.

It must never silently convert missing measurements to zero or PASS.

## 5. Result schema

Every suite result must contain:

~~~text
schemaVersion
benchmark
commit
backend
timestamp
os
osVersion
arch
cpuModel
logicalCpuCount
physicalMemoryBytes
nodeVersion
electronVersion
rustcVersion
buildProfile
fixtureRevision
warmupRuns
measuredRuns
samples[]
summary:
  min
  max
  mean
  p50
  p95
  p99?
budget:
  status
  failures[]
notes[]
~~~

Per-benchmark fields may add:
- process memory metric name,
- bytes processed,
- process count,
- workspace/session count,
- worktree disk bytes,
- dropped bytes,
- reordered bytes,
- event-loop lag,
- queue depth,
- resource ids/counts.

## 6. Benchmarks

## 6.1 Core startup

Measure:
1. Electron/process requests nd-core launch.
2. OS process spawn observed.
3. protocol handshake complete.
4. first health RPC complete.

Report:
- spawn -> handshake p50/p95,
- ready health RPC p50/p95,
- core private/PSS memory after ready.

Final evidence: at least 10 measured runs after warm-up.

## 6.2 Packaged Electron startup

Measure the real packaged Windows app:

~~~text
process launch
 -> Electron main ready
 -> preload bridge ready
 -> renderer ready
 -> first usable workspace shell
~~~

Do not substitute Vite dev startup for packaged startup.

The benchmark may use internal test-only timestamps/events, but they must instrument the normal production path rather than skip product initialization.

## 6.3 Memory scaling

Run logical-session counts:

~~~text
1
2
4
8
10
~~~

Variants:
- all sessions sharing one workspace,
- sessions split across multiple workspaces where practical.

Report separately:
- Electron main,
- renderer process group where measurable,
- nd-core,
- external synthetic engine children,
- total ND process tree.

Key proof:
- one nd-core process,
- shared workspace resource counts do not scale 1:1 with sessions,
- incremental core memory/session remains within PRD budget.

## 6.4 Terminal throughput and latency

Use a real PTY and deterministic flood producer.

Scenarios:
- one terminal sustained output,
- four terminals sustained output,
- input while output is saturated,
- cancel/close while output is saturated.

Measure:
- bytes/sec,
- Rust event -> Electron handler latency,
- input request -> PTY write latency,
- queue depth,
- retained buffer bytes,
- CPU,
- dropped bytes,
- reordered bytes.

A faster result with missing/reordered terminal bytes is a FAIL.

## 6.5 Git workload

Generate a deterministic large repository rather than committing a giant fixture.

Suggested fixture:
- thousands of files,
- deterministic nested directories,
- hundreds of modified files,
- staged and unstaged changes,
- deterministic history,
- multiple worktrees.

Measure:
- repository discovery,
- status,
- log,
- diff,
- stage,
- unstage,
- worktree create,
- task baseline,
- reset,
- integration preparation.

Separate:
- Git subprocess time,
- Rust parse time,
- RPC/IPC delivery time,
- total caller-visible time.

## 6.6 Parallel-agent scheduler

Use deterministic synthetic workers; do not call real model APIs.

Worker counts:

~~~text
1
2
4
8
10
~~~

Measure:
- permit acquisition latency,
- release latency,
- scheduler queue/wait time,
- same-role assignment spread,
- project cap behavior,
- role/team cap behavior,
- separate review-pool behavior,
- process count,
- core memory,
- total child memory,
- worktree disk growth,
- shared workspace resource counts.

Required correctness:
- cap is never exceeded,
- Autopilot-equivalent path cannot bypass the permit service,
- no partial multi-pool acquisition,
- same-workspace shared resources do not duplicate per worker.

## 6.7 Cancellation and cleanup

Start several synthetic long-running workers.

Cancel exactly one.

Measure:
- user/control request -> nd-core cancel receive,
- cancel receive -> child/process-tree exit,
- process exit -> permit release.

Assert:
- canceled worker is gone,
- descendants are gone,
- unrelated workers remain alive,
- capacity becomes available again,
- no orphan remains after benchmark cleanup.

Run normal-exit and forced-kill variants.

## 6.8 Electron responsiveness under combined load

Combine:
- terminal output,
- Git refresh,
- several synthetic organization workers.

Measure:
- Electron main event-loop lag,
- main-process CPU,
- renderer responsiveness where testable,
- nd-core queue depth,
- IPC latency.

This benchmark is especially important because moving code to Rust only matters if Electron becomes more responsive in the real product.

## 7. Legacy vs Rust proof

The migration PR must produce a same-machine comparison.

Use the temporary legacy switch during the soak period:

~~~text
ND_DSH_CORE_BACKEND=legacy
ND_DSH_CORE_BACKEND=rust
~~~

The benchmark runner should invoke both modes with:
- same ND commit where practical,
- same fixture generation seed/version,
- same build mode,
- same run count,
- same machine,
- same background-process guidance.

Required comparison table:

| Metric | Legacy | Rust core | Delta | Budget |
| --- | ---: | ---: | ---: | --- |
| Core/backend startup p50 | | | | |
| Packaged usable startup p50 | | | | |
| Idle backend memory | | | | |
| 10-session backend memory | | | | |
| Terminal throughput | | | | |
| Terminal event latency p95 | | | | |
| Git workload total p50 | | | | |
| Main-process CPU under load | | | | |
| Event-loop lag p95 | | | | |
| Cancel-to-exit p95 | | | | |
| 10-worker permit latency p95 | | | | |
| Worktree disk growth | | | | |

## 8. MVP budgets

Absolute budgets come from PRD 0002. Relative migration gates include:

- Electron main high-volume workload CPU target: at least 25% reduction for at least one defined terminal/Git stress scenario.
- Electron + nd-core idle backend memory: no more than 20% worse than comparable legacy idle backend without explicit review approval.
- 1 -> 10 session backend memory growth: lower in Rust shared-core mode than legacy.
- cancel -> process-tree exit p95: no more than 10% regression and inside the absolute cleanup budget.
- no hot-path p50 regression greater than 10% without an explicitly documented tradeoff.
- all correctness invariants must pass regardless of timing.

A result may be architecturally cleaner but still fail the MVP if these measurements show that the migration made the product materially slower or more memory-hungry without a reviewed reason.

## 9. CI policy

### Normal PR CI

Run:

~~~text
pnpm bench:smoke
~~~

Gate deterministic invariants, schema validity, cleanup, and benchmark harness health.

Do not enforce narrow timing budgets on shared hosted runners.

### Full MVP/release evidence

Run:

~~~text
pnpm bench:record
pnpm bench:compare
pnpm bench:check
~~~

on the documented Windows reference machine.

The result bundle is attached to the PR/release evidence.

### Future stable performance runner

If ND later adds a stable self-hosted benchmark runner, the same result schema and bench:check become an automated required status. Do not create a second benchmark format.

## 10. Anti-cheating rules

A benchmark is invalid if it:

- disables normal production work solely to improve the score,
- bypasses Electron/CoreClient for an end-to-end metric,
- uses a benchmark-specific protocol path not used by product code,
- omits child processes from a metric labeled total,
- reports RSS/PSS/private bytes as though they were interchangeable,
- compares different machines without clearly labeling the comparison non-relative,
- compares dev legacy against release Rust or vice versa,
- hides failed/outlier runs instead of reporting them,
- changes fixture size between candidates,
- measures live model latency as a core-runtime performance claim,
- counts a canceled process as cleaned up while descendants are still alive.

## 11. Human review evidence

The implementation PR should include a generated summary such as:

~~~text
Benchmark result: PASS
Reference: Windows 11 x64 / <CPU> / <RAM>
Runs: 10 startup, 5 steady-state workloads

Key changes:
- Electron main CPU under terminal stress: -XX%
- Event-loop p95: XX ms -> XX ms
- 10-session backend memory: XX MB -> XX MB
- Cancel p95: XX ms -> XX ms
- Git workload p50: XX ms -> XX ms

Failures: none
Raw result bundle: <artifact/path>
~~~

Numbers are generated from JSON. They are never handwritten into the PR without the matching raw result.

## 12. Gap closures — agent-task metrics, baselines, and fast-path proof

Sections 1-11 describe a suite that measures the **runtime**: startup, memory, terminal, Git, event-loop lag, cancellation, packaging. That is the right layer for proving the Rust migration. It cannot measure the agent, and it cannot prove a fast-agent-path gain, because the fast path's claims are about **how many times we call the model and how many times we cross the boundary**, not how fast Rust is.

Four gaps were identified, in dependency order; all four are addressed as of 2026-09-23, with the closure recorded in place. 12.5 and 12.6 record two further findings about coverage and the headless client.

### 12.1 Agent-task-level metrics — implemented (task 0005)

Before task 0005, nothing in `benchmarks/` recorded per-task agent cost. The nearest neighbours are product-side bookkeeping that no benchmark reads: `src/main/usage/usage-ledger.ts` accumulates per-model token totals, and `src/main/engines/agent-cli/structured-cli-engine.ts` tracks turn/tool-call transcript state. `pendingRpcCount`/`queuedEventCount` in the core suite are instantaneous queue snapshots, not per-task call counts. Those neighbours are still not repurposed: the task record counts the same engine events itself rather than reading a UI-facing summary back.

A task-level result kind sits alongside the existing runtime kinds. Required per task:

| Metric | Why |
| --- | --- |
| `totalWallMs` | The number the user feels; task start to terminal state. |
| `modelRoundTrips` | The primary fast-path claim. |
| `toolCalls` | Distinguishes "fewer model calls" from "fewer tools per call". |
| `ipcCrossings` | The Phase 4 claim; basis for any composite core operation. |
| `bytesToModel` / `tokensToModel` | Cost, and the Token Saver interaction. |
| `escalations` | How often the cheap tier could not decide. |
| `completionRate` | Guards against measuring "faster" by doing less. |

Two rules carry over unchanged from §2: the fixture must be deterministic and offline (no live-model dependency for the core gate — but see 12.2 on where one live-model measurement is legitimate), and a task is only counted as completing if its machine verification passed.

**Implemented (task 0005).** The result kind `agent-task-metrics` exists (`benchmarks/task-metrics.mjs`, schema `benchmarks/schema/task-metrics.schema.json`) with `pnpm bench:tasks` to record it, `pnpm bench:tasks:check` to re-check it offline, and `benchmarks/baselines/agent-task-normal-loop.json` as the normal-loop baseline. The counters come from `src/main/metrics/task-metrics.ts`, which is always on in production: the benchmark reads samples instead of switching a measurement on, and no call site branches on being benchmarked. `modelRoundTrips` is counted from what each engine can actually report — harness `assistant/message` events (one per model call) or a CLI's own wire step boundaries (`step_finish`), with the source recorded per sample so a zero is never read as "free". Raw samples are preserved and the aggregate is recomputed from them, and every recorded task is checked against the workload the fixture declared, so a deviation fails the run instead of becoming a number.

### 12.2 Baseline policy — decided, and a baseline is committed

`benchmark-results/` is gitignored (`.gitignore`) and no baseline JSON is tracked in `benchmarks/`. `bench:compare` takes two raw result files as positional arguments, and the budget checker recomputes relative deltas pairwise at check time. The consequence: no result set is retained in the repository, and a "before → after" claim is only reproducible if both hand-collected bundles still exist on someone's disk.

This repository already knows the discipline it wants — `benchmarks/README.md` says local run directories are ignored and reviewed bundles are copied in intentionally — but no reviewed bundle has ever been committed.

Decide one of:

- **committed reviewed baseline** — a small, reviewed JSON bundle per reference machine under a tracked path (for example `benchmarks/baselines/win11-x64.json`), refreshed deliberately by a documented PR rather than by every run; or
- **artifact-only** — keep results out of Git, but require the PR to attach both bundles and record their provenance hashes in the summary.

Either is defensible. Leaving it undecided is not: it is why the roadmap cannot currently show a `TS path → Rust path` or `normal loop → fast path` progression.

**Decided: committed reviewed baseline** (task 0005), for the agent-task measurement. `benchmarks/baselines/agent-task-normal-loop.json` is tracked, refreshed only by `pnpm bench:tasks:baseline` in a documented PR, and verified on ordinary PRs by `pnpm bench:tasks:check` — which needs neither Electron nor a provider, recomputes the summary from the raw samples instead of trusting the stored one, and re-checks each task against the fixture's declared workload. Local run directories under `benchmark-results/` remain ignored. The runtime evidence bundle (§9) takes the same option under a separate decision and a separate file — see [performance-baseline-policy.md](performance-baseline-policy.md); the two artefacts answer different questions and are refreshed on different cadences. **Both are now committed:** `benchmarks/baselines/win11-x64.json` joined the agent-task baseline on 2026-09-23 ([task 0015](../tasks/done/done-0015-runtime-evidence-baseline.md)), recorded locally because Actions is parked, so the paragraphs above describe the state before either decision landed.

### 12.3 Evidence does not assert which backend produced it — implemented (task 0004)

`benchmarks/lib/budgets.mjs` validates same-machine and full-provenance equality across the four evidence files, but it never asserts that `legacyRuntime.backend === 'legacy'` or `rustRuntime.backend === 'rust-core'`. The `backend` field is written into every result envelope and echoed by the comparator, so the data is present — it is simply never checked.

The only thing preventing a TS/Rust mix-up today is the hardcoded argument order in `benchmarks/record.mjs`. A swapped or mislabelled pair would satisfy every existing gate and could pass the relative budgets.

Add: a backend-identity assertion per evidence file, and — because `commit`/`buildProfile` identify the repository, not the binary — a hash of the actual `nd-core` executable in the Rust evidence. Release staging already records an nd-core sha256 in the release manifest; benchmark evidence should do the same.

**Implemented (task 0004).** `benchmarks/lib/budgets.mjs` now refuses to trust numbers before identity: `EXPECTED_BACKENDS` asserts each evidence document's `backend` label (a mismatch is reported with `kind: 'identity'`, never as a budget violation), and `core-binary-identity` requires every document to name the same `nd-core` sha256 — a missing hash fails the check, so a mix-up between two nd-core builds cannot pass either. `benchmarks/verify-evidence-identity.mjs` proves both gates fail closed by feeding them a deliberately swapped and mislabelled bundle, and it runs as its own CI step. Release evidence is Rust-only since task 0007 removed the legacy switch, so the historical `legacyRuntime.backend === 'legacy'` label is no longer a release prerequisite; legacy-vs-Rust bundles remain usable through `bench:compare`.

### 12.4 Agent-level fast-path budgets — implemented (task 0008 / wired 2026-09-23)

A normal-loop baseline now exists (12.2), so the missing half was the fast path itself: nothing distinguishes a normal agent loop run from a fast-path run while the fast path does not exist (see [agent-fast-path.md](agent-fast-path.md)). Now that it does, §8-style relative budgets apply to the agent metrics as well, measured as counters per *verified completion* so that doing less cannot read as doing better:

- model round trips per completed task: must decrease, on the same fixture set;
- IPC crossings per completed task: must decrease, or the composite-operation work is unjustified;
- completion rate: must not decrease — a fast path that quietly does less is a regression, not an optimization;
- escalation rate: must stay under a budget, or the cheap tier is not paying for itself and the fast path should be reconsidered rather than tuned (see [agent-fast-path.md](agent-fast-path.md) §7).

One legitimate exception to §2's "no live-model dependency": a *task-cost* measurement that counts round trips, tool calls, and bytes may include a live-model fixture, because those counters do not depend on model latency. Wall-time claims still may not: the committed baseline is recorded with the offline fixture and is stamped `wallTimeScope: excludes-model-latency`, so its wall times are product overhead and not a user-facing latency claim.

**Status (2026-09-23): the budgets are wired.** [Task 0008](../tasks/done/done-0008-agent-fast-path.md) shipped the typed action space, the deterministic-first router with fail-closed escalation, and the matched `normal-read` / `fast-read` arms; enforcement landed with them in `compareFastPath()` (`benchmarks/task-metrics.mjs`) and is a required part of a recorded result since this reconciliation. A run fails its own verdict when the fast arm's means per *verified completion* do not reduce model round trips, model-visible tool calls or nd-core IPC crossings, when its completion rate drops, or when its escalations per task exceed the 0.1 budget. Both arms are recorded inside one run, so the difference is attributable to the router rather than to drift between recording days; the committed baseline keeps its role as the reviewed record of the normal loop. `pnpm bench:tasks:check` re-derives the comparison from the stored raw samples offline, so a rotted or hand-edited baseline fails without starting Electron, `--baseline` refuses to write when the run's own verdict fails, and the schema requires the comparison so a result recorded before it cannot pass as a baseline.

### 12.5 CI does not enforce budgets on ordinary PRs

Worth stating explicitly since it bounds how much the suite protects the repository day to day:

- `pnpm bench:smoke` runs on normal `validate` CI, and gates schema validity plus deterministic invariants — no timing budgets.
- `pnpm bench:tasks:check` runs on normal `validate` CI too. It is offline and cheap, so it catches a rotted or hand-edited agent-task baseline without starting Electron.
- Full `bench:record` + `bench:check` runs only on a `workflow_dispatch` with `full_benchmark=true`, or when a PR moves to `ready_for_review`; draft PRs skip it entirely.
- The Windows packaging job runs crash cleanup and the packaged runtime smoke, which are acceptance checks rather than timing budgets.

So a timing or memory regression introduced by an ordinary push is caught only when someone later runs the full evidence path. Any new agent-task budget inherits that same coverage unless CI policy changes with it.

### 12.6 `bench:smoke` is red on Windows, and the client is the reason

Found during reconciliation on 2026-09-21. `pnpm bench:smoke` fails on Windows at the third benchmark and the suite exits 1:

~~~text
Error: timed out waiting for nd-core event terminal.exit
    at benchmarks/lib/core-rpc.mjs:86
~~~

Only `core-startup.json` and `memory-scheduler-scaling.json` are written; `terminal-throughput` never lands, and neither do the later benchmarks.

**Root cause is the benchmark client, not the PTY or the product.** Windows ConPTY emits an initial Device Status Report (`ESC[6n`) and withholds the child's output until the client answers it. A real terminal answers automatically — xterm.js does, which is why the product's terminal pane is unaffected — but `benchmarks/lib/core-rpc.mjs` is a headless byte collector that never replies.

Reproduced three ways against a directly launched nd-core: `node -e 'console.log("hi")'`, `cmd.exe /c echo MARKER`, and the `terminal-flood.mjs` fixture all return a pid from `terminal.create`, deliver exactly `ESC[6n` and nothing else, and never emit `terminal.exit` within 30 s. Answering the query with a cursor-position report (`ESC[1;1R` via `terminal.write`) makes the same command complete normally:

~~~text
saw DSR, replying with cursor report #1
EXIT EVENT code=0
total output received: "\x1b[6n\x1b[?9001h\x1b[?1004h\x1b[m\x1b]0;C:\WINDOWS\system32\cmd.exe\u0007\x1b[?25hMARKER-99999\r\n"
~~~

Why this matters beyond a red gate:

- `bench:smoke` is the **only** benchmark gate that runs on ordinary PRs, and CI runs it on `ubuntu-latest`, where portable-pty uses a plain PTY and no such handshake exists. The Windows release platform therefore has **no benchmark coverage at all** for terminal behaviour, and the failure is invisible to CI by construction.
- Every terminal metric in §3 and §6 — throughput, event latency, sequencing, byte integrity — is unmeasured on Windows until this is fixed. A Windows terminal claim cannot currently be backed by a Windows artifact.

Fix direction: give the benchmark client a minimal terminal responder (answer DSR, and any other query the fixture encounters) rather than teaching the PTY to work around a client that does not behave like a terminal. Then add `bench:smoke` to a Windows CI job — the fix alone does not help if the platform that needs it still never runs it.

This is also a caution for §12.1: agent-task metrics must be collected through a client that behaves like a real consumer, or the numbers describe the harness instead of the product. The agent-task measurement takes that caution literally by not going through `benchmarks/lib/core-rpc.mjs` at all: it drives the real desktop app, whose terminal pane, engines, organization records and task worktrees are the production ones. The headless core client stays where it belongs — protocol and throughput measurements — so a client-side handshake gap can never quietly become a task-cost number.

**Implemented (task 0004).** The narrow fix was right and is in: `benchmarks/lib/core-rpc.mjs` answers the ConPTY handshake through `attachTerminalHandshake`. The stronger guarantee is `benchmarks/terminal-handshake-proof.mjs`, which proves both directions against a real nd-core — with the responder the fixture completes, and with `respond: false` the client fails loudly inside the grace window naming the query and the reply counts instead of hanging for the fixture's 30 s — so the silent-timeout shape this section describes cannot return unnoticed. `Benchmark smoke on Windows` and `Prove the terminal handshake fails loudly` now run in the Windows packaging job, which is what makes a Windows terminal claim backable by a Windows artifact.

### 12.7 Runtime-contract measurements (task 0006) — implemented

`pnpm bench:contract` (`benchmarks/nd-core-contract.mjs`) measures the claims the
runtime-contract work rests on, rather than asserting them: revision-marker read cost,
the revision-keyed cache's effect on `git.status` and `git.log` (cold vs served, plus
invalidation under an external mutation and an external commit), bounded search latency
and payload size, explicit truncation reporting, cancel-to-stop latency, and core deadline
expiry. Its results are written through the same envelope and provenance path as the rest
of the suite, and it exits non-zero when a claim does not hold on the machine it ran on.

### 12.8 Post-PR #21 CI status and orchestration comparison backlog

PR #21 merged to `main` as `101a855b`. The first push CI run (`35640378484`) did not reach the newly added ordinary benchmark/evidence gates because `pnpm core:test` failed first on Ubuntu: the protocol contract `workspace_primitives_are_bounded_reject_escapes_and_are_the_only_ones_exposed` received `workspace path is unavailable: No such file or directory (os error 2)`. The unit suite itself passed 38/38 and the protocol contract reached 15/16 before that failure. The Windows job was canceled during dependency installation, and the full `performance-evidence` job was skipped. Therefore local Windows/package results remain evidence, but CI proof is still open.

Agent/company-scale comparisons are broader than the Rust-runtime suite in this document. Keep the maintained external reference set and candidate metrics in [agent-orchestration-reference-matrix.md](agent-orchestration-reference-matrix.md). That matrix currently retains QM, AWS sample-codex-agent-team, Orca, Paperclip, Gajae Code, LazyCodex, and jcode with observed revisions. Comparative claims must use equivalent verified-completion definitions and preserve exact upstream revision/configuration; this suite's internal Rust-vs-legacy evidence remains a separate benchmark class.
