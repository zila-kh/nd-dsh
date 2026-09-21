# Performance evidence baseline policy

Status: **decided** (task 0004, section 4). Updated: 2026-09-21
Related: [Performance benchmark suite](performance-benchmark-suite.md) · [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · `benchmarks/README.md`

## Decision

**The runtime evidence bundle keeps a committed, reviewed baseline per reference machine**, tracked at `benchmarks/baselines/<reference-machine>.json`. Raw sample bundles stay out of Git and are attached to the run that produced them (currently the `performance-evidence` CI artifact `prd-0002-performance-evidence`).

This extends the decision already recorded for the agent-task measurement in [performance-benchmark-suite.md §12.2](performance-benchmark-suite.md#122-baseline-policy--decided-and-a-baseline-is-committed), which left the runtime bundle open. Both artefacts live under `benchmarks/baselines/` and are refreshed deliberately, never by an ordinary run.

## Why this option

- **The alternative loses the "before".** `benchmark-results/` is gitignored, and CI artifacts expire (90 days by default). With artifact-only evidence, every historical claim depends on someone still having the old bundle on disk — the exact hole §12.1 of the plan records. A committed baseline makes "before → after" reviewable at the moment the "after" is proposed.
- **The baseline must be small, so it is the summary, not the samples.** The reviewed object is the *derived* evidence: identity, budget results, comparison rows, environment fingerprint. Raw samples (10 runs × 4 sources) are large, diff as noise, and are already preserved as CI artifacts. Committing them would make the repository grow on every release without adding a reviewable claim.
- **Absolute budgets are machine-class claims.** The idle-memory budget already branches on `os` (`budgets.mjs`): 40 MiB on win32, 30 MiB on linux. One baseline file per reference machine keeps that explicit instead of averaging incompatible machines.
- **Comparability is already gateable.** Commit, build profile, fixture revision, environment fingerprint and — since task 0004 — the nd-core executable hash are recorded in every result. A baseline that cannot satisfy those gates must not be recorded, and evidence that cannot match a baseline is refused rather than compared.

## What a baseline must contain

| Field | Why |
| --- | --- |
| `schemaVersion`, `kind`, `timestamp` | Bundle format and when it was reviewed. |
| `commit`, `buildProfile`, `fixtureRevision` | What was measured. |
| `environment` (os, osVersion, arch, cpuModel, logicalCpuCount, physicalMemoryBytes, nodeVersion) | The reference machine fingerprint every comparison must match. |
| `ndCore.sha256` (and its source) | The executable that ran, not just the repository that built it. |
| `budget.checks[]` with `kind` (`identity` or `budget`) | The gates, so an identity mismatch is never read as a budget violation. |
| `comparison.rows[]` | Legacy-vs-Rust deltas with their units. |
| `artifact` | Where the raw bundle that this summary was derived from is attached (CI run URL or artifact name) and its retention caveat. |

## Recording and refreshing

1. Produce the evidence with `pnpm bench:record` on the reference machine (CI: the `performance-evidence` job on `windows-latest`, `full_benchmark=true` or a ready-for-review PR).
2. Confirm the bundle is green including the identity gates: `pnpm bench:check <bundle>/summary.json`.
3. Copy the reviewed `summary.json` to `benchmarks/baselines/<reference-machine>.json`, and record the raw artifact location in `artifact`.
4. In the PR that changes the baseline, state what moved: the nd-core hash change, any environment change, and the budget deltas that changed. A baseline is never edited quietly — every update is a reviewed diff.
5. `pnpm bench:compare benchmarks/baselines/<machine>.json <new>/summary.json` answers "before → after" for the relative rows.

## Not covered

- The first runtime baseline does not exist yet, and cannot be created from a laptop: it requires the `performance-evidence` job to complete on the Windows reference runner, which needs release staging to produce a complete Harness closure (task 0004, section 2). Until that run exists, runtime comparisons use two reviewed bundles attached to the PR, as §12.2 already allows for the agent-task artefact.
- Baselines carry no fast-path or agent-cost claim; those belong to the `agent-task-metrics` baseline (task 0005).
