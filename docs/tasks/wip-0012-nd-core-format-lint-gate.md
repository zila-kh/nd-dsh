# Task 0012 — Restore the `Verify ND Core` gate on `main`

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ZCode  
> Branch: fix/nd-core-format-lint-gate  
> Updated: 2026-09-23  

## Objective

`pnpm core:test` fails on `main`, so the first step of both CI jobs aborts before any real gate runs. Restore it so the release validation in [blocked-0004](blocked-0004-windows-release-validation.md) can produce evidence again.

## What is known

Main workflow run [35762360604](https://github.com/zila-kh/nd-dsh/actions/runs/35762360604) — the first run on `main` after PR #29 merged — failed `Verify ND Core` in **both** jobs. `validate` died after 59 s and `windows-package` after 1m43s; every downstream step (Windows benchmark smoke, terminal handshake proof, portable build, forced-cleanup proof, packaged smoke, `performance-evidence`) was skipped, so the run produced no Windows evidence at all.

`Verify ND Core` is `pnpm core:test`, which is:

```bash
cargo fmt --check && cargo clippy -p nd-core --all-targets -- -D warnings && cargo test -p nd-core
```

Reproduced on a clean checkout of `c5c22b2` with no local modifications:

| Check | Result |
| --- | --- |
| `cargo fmt --check` | **fails** — `crates/nd-core/src/snapshot.rs` (1 diff), `crates/nd-core/tests/protocol_contract.rs` (3 diffs) |
| `cargo clippy -p nd-core --all-targets -- -D warnings` | **fails** — `clippy::possible_missing_else` at `snapshot.rs:13` |
| `cargo test -p nd-core` | passes — 38 + 17 tests, 0 failures |

The behavior is correct; only formatting and lint fail. That is enough to block everything, because `cargo fmt --check` is the first command in the chain.

## Root cause

`crates/nd-core/src/snapshot.rs` is committed **minified** — 13 lines, 3160 bytes, whole functions on single lines with no spaces after commas or colons. It is the only minified file in the crate; every other file under `crates/nd-core/src/` is normally formatted at 200–860 lines. Minified source is what produces both failures: rustfmt rewrites it, and clippy reads `...)))}if p.searches...` as an `if` with a missing `else`.

The commits that introduced it, `ca6ab34` and `bbcf17b` ("feat: add governed fast-path contract"), carry `[skip ci]` and added exactly two files — `snapshot.rs` and the new `protocol_contract.rs` cases. Because the convergence branch was written with `[skip ci]` at the operator's request, no gate ever evaluated them before PR #29 merged. `validate` was last green in run [35719173634](https://github.com/zila-kh/nd-dsh/actions/runs/35719173634), before those commits existed.

This is a platform-independent source defect, not a Windows problem: the Windows job fails at the same step for the same reason.

## Acceptance criteria

- [x] `pnpm core:test` exits 0 on a clean checkout, with no test weakened, skipped, or newly allowed. — `corepack pnpm core:test` exits 0: `cargo fmt --check` clean, clippy clean under `-D warnings`, and `cargo test -p nd-core` passes 38 + 17 tests with 0 failures. No test, budget, or assertion was changed.
- [x] `snapshot.rs` is restored to normally formatted source rather than left minified. — Expanded from 13 minified lines to 140 normally formatted lines; `git diff` touches only `snapshot.rs` and `protocol_contract.rs`, and both diffs are line-wrapping only. The `clippy::possible_missing_else` error was a symptom of the minification, not a separate defect: rustfmt's output puts the second `if` on its own line, which is the remedy the lint itself names.
- [ ] Both CI jobs get past `Verify ND Core` on a non-draft pull request, so the Windows steps in blocked-0004 execute for the first time since the regression.
- [x] No `continue-on-error` is added anywhere, and no lint is `allow`-ed to satisfy the gate. — No workflow, lint, or crate configuration changed; the only edits are the two source files and the task board.

## Verification run locally (2026-09-23, Windows)

| Command | Result |
| --- | --- |
| `corepack pnpm core:test` | exit 0 |
| `corepack pnpm verify` | exit 0 — 227 source files, 102 test files; Harness submodule at `c291e7961a51`, ND Pencil boundary verified |
| `corepack pnpm typecheck` | exit 0 |
| `corepack pnpm test` | exit 0 — 777 passed, 8 skipped |
| `corepack pnpm build` | exit 0 |
