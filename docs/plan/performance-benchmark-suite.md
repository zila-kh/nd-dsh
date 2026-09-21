# ND Performance Benchmark Suite

Status: **draft — folded into PRD 0002 for human review.** No benchmark implementation started.
Updated: 2026-09-21
Related: [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · [Parallel work distribution](parallel-work-distribution.md) · [Roadmap](../roadmap.md)

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
