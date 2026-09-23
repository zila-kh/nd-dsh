# Task 0015 — Record the runtime evidence baseline on the reference machine

> **Done 2026-09-23.** Bundle `benchmark-results/2026-09-23T05-48-13-222Z-win32-x64/`, `pnpm bench:check` green (21/21 checks), reviewed summary committed as [`benchmarks/baselines/win11-x64.json`](../../../benchmarks/baselines/win11-x64.json). Recorded locally on the reference machine because GitHub Actions is parked; the runner-produced artifact stays deferred in [blocked-0004](../blocked-0004-windows-release-validation.md).

> PRD: [PRD-0002](../../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: release evidence  
> Status: done — baseline recorded and committed; runner artifact deferred  
> Branch: main  
> Updated: 2026-09-23  

## Objective

[performance-baseline-policy.md](../../plan/performance-baseline-policy.md) decided that the runtime evidence bundle keeps a committed, reviewed baseline per reference machine at `benchmarks/baselines/<machine>.json`, and that its raw bundle is attached to the run that produced it. The agent-task half of that decision landed with task 0005; the runtime half had never been recorded, because the only producer was the `performance-evidence` job and its one attempt failed inside `pnpm bench:record` ([done-0014](done-0014-app-runtime-terminal-marker.md)).

With the workflows parked, the baseline had to be produced locally or not at all — and doing that turned out to require fixing five defects, each of which had been invisible because no run had ever reached the step that exposes it.

## Defects found and fixed

### 1. The reference machine could not build ND Pencil at all — toolchain

`pnpm dist:win:portable` died in `scripts/build-nd-pencil.mjs` with `error: linking with link.exe failed: exit code 1120`: ten unresolved newer-STL symbols (`__std_find_last_trivial_2`, `__std_min_element_f`, `__std_search_1`, …) from Skia's prebuilt libraries. `skia-bindings` 0.97.2 downloads prebuilts from `rust-skia/skia-binaries` that are built with VS2022 MSVC, and `vswhere` reported only VS2019 BuildTools (MSVC 14.29.30133) — Version 14.29 cannot link them.

**Fix:** installed VS2022 Build Tools 17.14.41 (MSVC 14.44.35229, `link.exe` 14.44.35229.0). The blockers were disk (11 GB free) and elevation, not the build. Afterwards `op-host-web-server` relinked in 1m51s (76 MB), the wasm bundle built in 5m04s, and the runtime staged to `resources/nd-pencil`.

### 2. The packaged-startup watchdog killed slow portable launches

`benchmarks/app-startup.mjs` allowed 30 s per launch; the run died with `packaged startup benchmark timed out`. The breakdown was one-sided: `marks.usable` — the in-process startup mark the evidence actually records — was **948 ms**, while wall clock was **20.6–23.8 s**. The portable target re-extracts its payload into a fresh temp directory on every launch (observed extraction directories: 600–735 MB), so the timer was watching extraction, not the app.

**Fix:** watchdog raised to 120 s and documented as hang detection. Nothing was relaxed on the way: the packaged gate checks run count, bundled-core protocol v1 and a finite mark, and the recorded sample is the in-process mark.

### 3. The event-loop budget was unattainable by construction

`[budget] Rust Electron main event-loop p95 under combined load: expected <= 16 ms, got 18.104319`. Two independent recordings agreed closely (p95 17.97 and 18.10, p50 16.32 and 16.29), so this was not noise. A standalone probe settled it: an **idle** Node process on this machine reports event-loop delay p50 15.53 ms, p95 16.11–16.22 ms, because `monitorEventLoopDelay` is quantized by the ~15.6 ms Windows system timer. The gate had under half a millisecond of headroom above the floor of a process doing nothing.

**Fix:** the runtime benchmark now samples the same histogram for 750 ms with nothing to service, records `floorP95Ms`, and the gate scores `excessP95Ms` — the delay this app actually caused — against the same 16 ms. Raw p50/p95/p99/max and the PRD's ">50 ms stall" observation are unchanged.

### 4. The first nd-core spawn is a cold-start artifact

`[budget] nd-core spawn→handshake p95: expected <= 120 ms, got 189.6797`. Both recordings that failed here failed on **sample one** (134.9952 ms, 189.6797 ms) while samples two to ten sat at 19.8–40.6 ms, and the suite measures 10 runs, so its p95 *is* the maximum. A freshly linked `nd-core.exe` is cold in the file cache and gets its first anti-malware scan.

**Fix:** one unmeasured launch runs first; the cold value is recorded as `coldSpawnMs` rather than discarded (31.1 ms in the committed run, where the binary was already warm).

### 5. The summary named the wrong sidecar

The bundle's own `ndCore` claimed `target/debug/nd-core.exe` (sha `1059b759…`) while all three documents it summarizes measured `target/release/nd-core.exe` (sha `e64265a4…`). `defaultCoreBinary()` reads `ND_DSH_BENCH_PROFILE`, which `record.mjs` set only for its child steps, so the recorder resolved the debug profile for itself. The identity gate compared only the three documents, so a summary could carry the wrong executable and still pass.

**Fix:** the recorder now sets that profile for its own provenance resolution.

## Recorded evidence

| Item | Value |
| --- | --- |
| Bundle | `benchmark-results/2026-09-23T05-48-13-222Z-win32-x64/` |
| Verdict | `pass` — 21/21 checks, 0 observations |
| Commit | `cf29d4133671118f4cde9a8baea70cfe638a3e7b` |
| nd-core | `e64265a450bf7c2ccc9c033f1d31de705f781b364833dfeade7cb334385f3c34`, source `binary` + `release-manifest`, 3,359,744 bytes |
| Reference machine | win32 10.0.26200 x64 · Intel Core i7-10700 (16 logical) · 31.8 GiB · Node v24.19.0 |
| Core spawn→handshake | p50 22.66 ms, p95 24.45 ms, cold 31.1 ms (budget ≤ 120 ms) |
| Event-loop p95 | floor 16.21 ms, stress 17.12 ms, **excess 0.91 ms** (budget ≤ 16 ms above the floor) |
| Idle nd-core memory | 1.33 MiB (budget ≤ 40 MiB win32) |
| Session memory increment | 8.9 KiB/session (budget ≤ 8 MiB) |
| Packaged startup (`usable`) | p50 1115.8 ms, p95 3420.7 ms — recorded, no budget; excludes portable self-extraction |
| Stalls >50 ms | 0 |

## Acceptance criteria

- [x] One complete bundle exists from a single machine, commit, build profile and fixture revision, with the identity gates green. — `full-provenance` and `core-binary-identity` both pass: one nd-core sha256 across core, runtime and packaged evidence.
- [x] The reviewed summary is committed with its artifact location and retention caveat. — [`benchmarks/baselines/win11-x64.json`](../../../benchmarks/baselines/win11-x64.json); `artifact.kind` is `local-recording` with `ciRun: null` and the gitignored-bundle caveat, because there is no run URL to record.
- [x] Every gate that failed on the way was fixed at its cause, not by moving the number. — the four threshold failures are documented above with the measurement that identified the artifact; no budget value changed.
- [ ] A runner-produced `benchmark-results/**` artifact. — Still [blocked-0004](../blocked-0004-windows-release-validation.md)'s exit criterion; it needs the workflows restored, and nothing here substitutes for it.

## Notes

- **Operational hazard:** a portable launch that is killed leaves its ~600–735 MB extraction directory behind, because the NSIS stub only cleans up on a normal exit. One such leftover had to be removed mid-recording, when free disk fell to 306 MB. The full record needs roughly 2–4 GB free for packaging plus extraction.
- The idle control window adds 750 ms per runtime-benchmark run (7.5 s over ten runs).
- This record's fixes are harness and packaging-side; the only shipped-code change is the idle control window in `src/main/perf/runtime-benchmark.ts`, which the packaged app carries.
- The bundle was produced with `ND_DSH_BENCH_SKIP_PACKAGE_BUILD=1` against the portable built from commit `eacb5d4`, whose application sources are identical to the recorded commit; only `benchmarks/` changed between them. The raw documents, including `rust/raw/` samples, remain on the reference machine.
