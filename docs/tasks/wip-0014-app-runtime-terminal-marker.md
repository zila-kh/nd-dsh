# Task 0014 — The app-runtime benchmark never reads its terminal marker

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ZCode  
> Branch: fix/nd-core-format-lint-gate  
> Updated: 2026-09-23  

## Objective

`performance-evidence` cannot produce the release evidence bundle in [blocked-0004](blocked-0004-windows-release-validation.md), because the app-runtime benchmark it runs fails waiting for a terminal marker that never becomes readable.

## What is known

Run [35771982331](https://github.com/zila-kh/nd-dsh/actions/runs/35771982331) — the first execution of `pnpm bench:record` on Windows, since earlier runs skipped the job — failed after 37m24s:

```text
Runtime benchmark failed: Error: Runtime benchmark terminal did not finish within the timeout.
    at waitForTerminalMarker (out/main/index.js:25407:8)
    at async runRuntimeBenchmark (out/main/index.js:25309:3)
Error: node benchmarks/app-runtime.mjs rust-core exited with code 1
```

Because the recording step failed, the budget step had no combined `summary.json` to check and the uploaded artifact was empty.

## Root cause

`terminalCommand()` in `src/main/perf/runtime-benchmark.ts` ended its command with `exit` on the same input line:

```ts
return `$env:ELECTRON_RUN_AS_NODE='1'; & ${psQuote(process.execPath)} ${psQuote(fixture)} ${bytes}; exit\r\n`
```

A shell that exits on the same input line closes the console host before it has flushed the output still in flight, so the marker `ND_RUNTIME_STRESS_DONE` the benchmark waits for is never readable and `waitForTerminalMarker` times out at 20 s.

This is not a new discovery. The same defect was found, measured and fixed for the packaged smoke, and the finding is recorded in `src/main/perf/packaged-runtime-smoke.ts`: `echo <marker>` plus `exit` written as one input left the buffer holding the echoed command and the banner with neither the marker nor any output after it, while the same command without `exit` was read in full at every write delay from 0 to 200 ms. That file dropped its `exit`; this harness kept its own.

Reproduced and fixed locally, with the timeout left at 20 s so the change under test is the only variable:

| Tree | `ND_DSH_BENCH_RUNS=2 node benchmarks/app-runtime.mjs rust-core` |
| --- | --- |
| pre-fix | fails — `Runtime benchmark terminal did not finish within the timeout.` |
| post-fix | exit 0, full result payload written |

## Acceptance criteria

- [x] The marker is readable, proven by a local before/after run rather than by argument. — See the table above; the failure reproduces deterministically on a dev machine, so it is not a cold-runner flake.
- [x] The shell does not have to end on its own for the benchmark to finish. — The benchmark already closes the terminal itself in its `finally` block (`options.terminal.close(sessionId, terminalId)`), so leaving the shell running is the shape the packaged smoke already uses.
- [x] The timeout is unchanged, so the fix is not a threshold relaxation. — Still 20 s.
- [ ] `performance-evidence` completes on a non-draft pull request and uploads a `benchmark-results/**` artifact whose budgets pass `bench:check`. — **Deferred, not dropped:** CI usage was suspended on 2026-09-23 at the operator's direction to conserve compute. The fix is reproduced before/after locally; this criterion needs a Windows runner.

## Notes

- This is a harness defect in shipped code (`src/main/perf/` is bundled into the app), not a test-only change.
- It is independent of [wip-0013](wip-0013-windows-timing-flakes.md): those are `cargo test` timing assumptions, this is a terminal-command defect in the benchmark harness. It is also independent of the ConPTY handshake work in blocked-0004, which is already fixed.
- `performance-evidence` is the optional criterion in blocked-0004, so this does not hold up the required Windows gates; it does hold up the performance evidence bundle and the committed runtime baseline that depends on it.
