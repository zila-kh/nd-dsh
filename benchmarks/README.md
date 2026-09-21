# ND performance benchmarks

These benchmarks are release evidence for PRD 0002. They use deterministic local fixtures and the real production paths; they do not call model providers.

- `pnpm bench:smoke` — short CI correctness/protocol/PTY/Git/scheduler/process-tree smoke.
- `pnpm bench:record` — one-shot Windows reference run. It builds the current portable app, records release-core results, records the same built Electron app in legacy and Rust modes, records packaged startup, evaluates budgets, and writes `summary.json` plus generated `summary.md`.
- `pnpm bench:compare <legacy.json> <rust.json>` — compare two same-machine `electron-responsiveness.json` files. Provenance mismatch exits non-zero.
- `pnpm bench:check <bundle/summary.json>` — reload raw JSON and recompute all PRD budgets; missing or failed evidence exits non-zero.
- `pnpm bench:app` — packaged Electron startup only; requires `ND_DSH_BENCH_PACKAGED_APP`.
- `pnpm bench:runtime` — convenience Rust-only same-build Electron stress run for development.

## Full MVP evidence

Run `pnpm bench:record` on the documented Windows x64 reference machine. The default command intentionally rebuilds the Windows portable artifact so packaged startup and same-build runtime measurements refer to the current commit.

For a reviewed prebuilt portable artifact, set both:

- `ND_DSH_BENCH_SKIP_PACKAGE_BUILD=1`
- `ND_DSH_BENCH_PACKAGED_APP=<absolute path to the current portable exe>`

The evidence bundle is written under `benchmark-results/<timestamp>-win32-x64/`. Local result directories are ignored by Git. Copy or attach a reviewed bundle intentionally when preserving release evidence.

Raw samples remain the source of truth. The generated Markdown summary contains no handwritten performance percentages; every delta and PASS/FAIL value is derived from JSON.

## Comparison discipline

Legacy and Rust relative claims are accepted only when commit, build profile, fixture revision, CPU/OS/architecture, logical CPU count, and physical memory match. The legacy switch is developer-only and exists only for migration/soak comparison; packaged production remains Rust-core only.

The full recorder uses at least 10 measured runs for startup and short-latency evidence and reports p50/p95. Memory records keep OS metric names (for example Windows private bytes or Linux PSS) rather than treating them as interchangeable.


## GitHub Actions checkpoint runs

Draft PR commits intentionally skip the heavy CI jobs. Use **Actions → ci → Run workflow** for checkpoints:

- leave `full_benchmark=false` for the normal Linux validation + Windows package/smoke gates;
- set `full_benchmark=true` for the Windows legacy-vs-Rust performance evidence run only.

The full benchmark job uploads `prd-0002-performance-evidence` containing the generated Markdown summary and raw JSON samples.
