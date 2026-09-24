# Blocked Task 0004 — Windows release validation

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: release validation  
> Updated: 2026-09-23  

## Why this is blocked instead of WIP

All known implementation work owned by the former task 0004 has landed or been superseded: the ConPTY handshake proof, release staging closure checks, evidence identity checks, desktop teardown fix, and Linux validation path are implemented. Main workflow run `35719173634` completed **validate** successfully, including ND Core verification, benchmark smoke, agent-task baseline validation, evidence-identity proof, repository verification, typecheck, unit tests, desktop build, renderer isolation, and desktop smoke.

The same run failed **windows-package → Verify ND Core** before Windows benchmark smoke, packaging, forced-sidecar cleanup, and packaged smoke could execute. `performance-evidence` was skipped. The current convergence branch is intentionally written with `[skip ci]` at the operator's request, so a passing Windows run cannot be manufactured or inferred here.

**Update (2026-09-23):** a fresh run exists and it moved the blocker rather than clearing it. Run `35762360604` — the first run on `main` after PR #29 merged — fails `Verify ND Core` in **both** jobs (`validate` in 59 s, `windows-package` in 1m43s), so every Windows step below was skipped and no Windows evidence was produced. The cause is not Windows-specific: `crates/nd-core` was merged with unformatted, lint-failing source, which aborts `pnpm core:test` on any platform. That is a deterministic source defect, so it is claimed as [done-0012](done/done-0012-nd-core-format-lint-gate.md), exactly as the "Current implementation state" section below directs. This record stays blocked until a run gets past that gate.

**Update 2 (2026-09-23):** the gate is repaired and the Windows job now reaches the steps this record has been waiting on. On run [35773266896](https://github.com/zila-kh/nd-dsh/actions/runs/35773266896) `validate` is fully green (5m19s) and `windows-package` passes `Verify ND Core`'s fmt and clippy stages before failing on a timing flake in `protocol_contract.rs`, filed as [done-0013](done/done-0013-windows-timing-flakes.md). Note that the Windows steps below did execute once, on run [35768282861](https://github.com/zila-kh/nd-dsh/actions/runs/35768282861): `Verify ND Core`, `Benchmark smoke on Windows`, and `Prove the terminal handshake fails loudly` all passed, and the job was then **canceled** by a concurrency collision — a second dispatch on the same ref — not by a failure. The portable build, forced-cleanup proof, and packaged smoke therefore still have no completed run.

**Update 3 (2026-09-23):** the optional `performance-evidence` criterion has now been attempted for the first time, on run [35771982331](https://github.com/zila-kh/nd-dsh/actions/runs/35771982331). It failed at 37m24s inside `pnpm bench:record`, because the app-runtime benchmark waits for a terminal marker that its own `exit` makes unreadable. That is filed and fixed as [done-0014](done/done-0014-app-runtime-terminal-marker.md), with a local before/after reproduction. No budget could be checked because no combined `summary.json` was produced, so the committed runtime baseline described in [performance-baseline-policy.md](../plan/performance-baseline-policy.md) is still unrecorded.

**Update 4 (2026-09-23): CI parked at the operator's direction.** GitHub Actions is no longer in use — the operator renamed `.github/` to `.github-bk/` (`2ff4a3c`, merged as `8fd7c16`) to conserve compute until the product is stable enough to justify it — so this record's exit criteria are deferred rather than pursued. Nothing is waived, and renaming the folder back restores the workflows unchanged. Where the implementation stands, all of it verified locally:

| Criterion | State |
| --- | --- |
| Windows run completes `Verify ND Core` | **Passed on a runner** — run [35776684225](https://github.com/zila-kh/nd-dsh/actions/runs/35776684225) `windows-package`, after [done-0012](done/done-0012-nd-core-format-lint-gate.md) and [done-0013](done/done-0013-windows-timing-flakes.md) |
| Windows benchmark smoke + terminal handshake proof | **Passed on a runner** — same job |
| Portable build + forced-sidecar cleanup proof | Not completed — the job was canceled when Actions was parked mid-build; `pnpm dist:win:portable` and the cleanup receipt were verified locally on 2026-09-21 |
| Packaged core / terminal / Git smoke | Not completed — needs the same job to reach it |
| Optional performance-evidence bundle | **Recorded locally, runner output still open** — the first attempt (run `35771982331`) failed on [done-0014](done/done-0014-app-runtime-terminal-marker.md), that defect was fixed, and the recording then completed on the reference machine as [done-0015](done/done-0015-runtime-evidence-baseline.md) with the committed baseline `benchmarks/baselines/win11-x64.json`. What is still missing is the *runner-produced* bundle and its `artifact` URL |

The last three need a Windows runner and cannot be satisfied on a dev machine, so they are the checklist for the first run after the workflows are restored.

**Update 5 (2026-09-23): the evidence half of this record is now produced locally, and doing it exposed five more defects that no run had reached.** With Actions parked, the committed runtime baseline could not wait for a runner, so it was recorded on the reference machine end to end: bundle `benchmark-results/2026-09-23T05-48-13-222Z-win32-x64/`, `pnpm bench:check` green (21/21 checks), reviewed summary committed as [`benchmarks/baselines/win11-x64.json`](../../benchmarks/baselines/win11-x64.json). Getting there required fixing the VS2019/MSVC toolchain (Skia prebuilts are VS2022-built and would not link), a packaged-startup watchdog that was timing the portable self-extraction, an event-loop budget that Windows timer quantization made unattainable by construction, a cold-start artifact in the first nd-core spawn, and a recorder that hashed the debug sidecar while measuring the release one — all recorded in [done-0015](done/done-0015-runtime-evidence-baseline.md). What this does **not** substitute for is the criterion itself: the baseline's `artifact.ciRun` is `null` because no runner produced it, and `benchmark-results/` is gitignored, so the raw bundle exists only on the reference machine.

**Update 6 (2026-09-24): the locally-recordable half of this record's exit criteria was re-recorded on the current tree, and it is all green.** `pnpm dist:win:portable` staged and built `dist/ND-DSH-0.1.0-private-beta-x64.exe` from a clean `.release` (release inputs verified: ND Core 0.1.0 / protocol 1, Browser Companion 0.1.0 / protocol 1, Harness 0.1.5-rc.2, ND Pencil 0.8.4). The forced-core-crash cleanup proof passed — managed and descendant pids both gone after a forced core kill (`benchmark-results/packaged-smoke/core-crash-cleanup.json`). The packaged runtime smoke passed against that artifact: terminal marker observed, Git resolved, bundled core protocol v1, runtime handshake 196 ms, startup usable mark 1 270 ms (`benchmark-results/packaged-smoke/packaged-runtime-smoke.json`). The same session recorded `pnpm bench:contract` (9/9 contract documents, including effect-journal and decision-kernel) and `pnpm bench:runtime` with every shared budget class inside the committed baseline's bounds — on this host, and with the caveat that the baseline was recorded on a different machine, so that is a budget-class check, not a speed claim. **Nothing here substitutes for the three unchecked exit criteria below**: they need the Windows runner, Actions remains parked as `.github-bk/` at the operator's direction, and this update refreshes the same local evidence Updates 4–5 described rather than manufacturing runner output.

## Exit criteria

- [ ] A Windows run completes `Verify ND Core`.
- [ ] Windows benchmark smoke + terminal handshake proof complete.
- [ ] Windows portable build and forced-sidecar cleanup proof complete.
- [ ] Packaged Rust core / terminal / Git smoke completes.
- [ ] The optional full performance-evidence workflow is recorded when release evidence is requested. — A complete bundle and committed baseline exist from a **local** recording ([done-0015](done/done-0015-runtime-evidence-baseline.md)); the workflow-produced bundle is what remains.

## Current implementation state

The implementation side of this record is complete, and the evidence side is now complete locally too. The three defects that the failed runs exposed are closed: [done-0012](done/done-0012-nd-core-format-lint-gate.md) restored `Verify ND Core` (a formatting/lint repair only — `cargo test -p nd-core` already passed 55 tests), [done-0013](done/done-0013-windows-timing-flakes.md) removed the Windows timing assumptions the repaired gate then revealed, and [done-0014](done/done-0014-app-runtime-terminal-marker.md) fixed the app-runtime terminal marker that failed the first `performance-evidence` attempt. All three merged with PR #30 (`8fd7c16`) and are verified locally. [done-0015](done/done-0015-runtime-evidence-baseline.md) then recorded the runtime evidence bundle and the committed baseline on the reference machine, fixing the five defects that local recording exposed. What remains is exactly the runner: this record's exit criteria are testable only on a Windows runner, and Actions is parked, so they wait for the workflows to be restored rather than for more code. A further Windows-only failure at that point would be a new defect and should be filed as its own task.

## Historical detail

The former WIP record is retained below for audit context.

---

# Task 0004 — Restore green CI on Windows and make performance evidence trustworthy

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ZCode  
> Branch: — (working tree on `main`; a concurrent session is editing `crates/nd-core` and `src/main/**`)  
> Updated: 2026-09-22  

## Objective

CI has never been green on the merged MVP, and the benchmark gate that produces performance claims cannot be trusted or cannot run. Four problems, one outcome: **the gates must actually execute and their output must be real.**

Run `35592399694` failed all three jobs. `windows-package` and `performance-evidence` died during release staging, so the packaged Windows smoke and the performance-evidence bundle have never run at all. `validate` passed every step including Benchmark smoke, then failed on the last one. Separately, `pnpm bench:smoke` fails on Windows with a root cause that CI cannot see because it runs that step on Linux only.

## Post-merge CI update (2026-09-22)

PR #21 merged to `main` as `101a855ba332cd1861c1467c36ccd2d35c294115`. The first push CI run on that merge was [35640378484](https://github.com/zila-kh/nd-dsh/actions/runs/35640378484) and is **not green**:

- `validate` reached `Verify ND Core` and failed in `crates/nd-core/tests/protocol_contract.rs`: `workspace_primitives_are_bounded_reject_escapes_and_are_the_only_ones_exposed` returned `CoreError { code: "method_failed", message: "workspace path is unavailable: No such file or directory (os error 2)" }`. The unit portion had 38/38 passing and the protocol contract had 15/16 passing before this failure.
- Because `Verify ND Core` failed, the later Linux migration/unit/benchmark/identity/desktop gates did not execute in that run. This is a new CI-environment/path failure relative to the local `pnpm core:test` evidence recorded in PR #21 and must be reproduced/fixed rather than treated as green.
- `windows-package` was canceled during dependency installation, before `Verify ND Core`, Windows `bench:smoke`, handshake proof, packaging, cleanup, or packaged smoke ran.
- `performance-evidence` was skipped, so the 120-minute evidence bundle remains open.

This supersedes any wording below that says only the old desktop teardown blocks `validate`: task 0004 now also owns this post-merge Linux workspace-path contract failure until it is explained and a non-draft CI run passes.

## Status (2026-09-21)

| Section | State |
| --- | --- |
| 1 — Benchmark terminal handshake | **Done and verified on Windows.** `pnpm bench:smoke` exits 0 and writes `terminal-throughput.json`; `benchmarks/terminal-handshake-proof.mjs` proves both directions; CI now runs both on `windows-latest`. |
| 2 — Release staging | **Fixed and verified locally.** `pnpm release:stage` succeeded from a removed `.release` and the new closure check passed (84 dependencies, 53 client faces). The packaged build, packaged smoke and `performance-evidence` still need a Windows CI run. |
| 3 — `validate` / Desktop smoke | **Failure named and classified: no spec failed.** Both non-draft runs ended in Playwright's worker teardown watchdog after 36 passed / 1 skipped. The Windows-only product defect found while reproducing it is fixed here; the teardown itself is [todo-0010](todo-0010-desktop-smoke-teardown.md). |
| 4 — Evidence integrity | **Done.** Backend identity and nd-core binary identity gates, a deliberate-swap proof, and a recorded baseline policy. |

Two findings beyond the ticket that changed what had to be fixed:

1. **The merged tree renamed the workspace RPC**, so `bench:smoke` was red on every platform, not just Windows: `benchmarks/run-suite.mjs` called `workspace.stat`, which the merged core no longer routes (it exposes `workspace.list|read|revision|search`). The benchmark now uses `workspace.list` and asserts the shared fixture is visible in the listing. Nothing in `crates/` was touched.
2. **The same ConPTY defect exists in the product**, not only in the benchmark client: the main-process terminal bridge answered no cursor-position query, so any terminal with no rendered xterm.js pane (the packaged runtime smoke, an e2e spec driving the preload bridge, a session whose pane is not mounted) received exactly `ESC[6n` and then nothing, on Windows only. Fixed in `src/main/terminal/terminal-manager.ts` (see section 3).

## 1. Benchmark terminal handshake — `bench:smoke` fails on Windows

Root cause is the benchmark client, not the PTY and not the product. Windows ConPTY emits an initial Device Status Report (`ESC[6n`) and withholds the child's output until the client answers it. A real terminal answers automatically — xterm.js does, which is why the product's terminal pane is unaffected — but `benchmarks/lib/core-rpc.mjs` is a headless byte collector that never replies. The output never arrives, no `terminal.exit` is emitted, and the fixture's 30-second wait times out.

Reproduced three ways against a directly launched nd-core (`node -e 'console.log("hi")'`, `cmd.exe /c echo MARKER`, and `benchmarks/fixtures/terminal-flood.mjs`): all return a pid from `terminal.create`, deliver exactly `ESC[6n` and nothing else, and never emit `terminal.exit`. Replying with `ESC[1;1R` via `terminal.write` makes the same command finish with exit code 0 and full output.

- [x] The benchmark client answers the cursor-position query, with the ConPTY behaviour documented so it is not mistaken for benchmark-specific cheating. — `attachTerminalHandshake` in `benchmarks/lib/core-rpc.mjs`; the doc comment states that xterm.js answers the same query in the product, and that POSIX PTYs never send it.
- [x] Byte accounting and the reordering assertion are unchanged by the responder. — The reply travels to the terminal's input, not into the measured stream. The accounting got *stronger*: the fixture writes self-identifying 64-byte records (`benchmarks/lib/terminal-payload.mjs`), and the payload must equal `expectedPayload()` byte for byte — length, content and order in one assertion — with `capturedBytesObserved`/`controlBytesObserved`/`escapeSequencesObserved` reporting the console host's own bytes instead of hiding them. `reordered` and the event-sequence assertion are unchanged.
- [x] `pnpm bench:smoke` exits 0 on Windows, writing `terminal-throughput.json` and the benchmarks that follow it. — `benchmark-results/2026-09-21T17-08-15-949Z-win32-x64/`: `status: pass`, `failures: []`; terminal evidence `payloadVerified: true`, `payloadBytesObserved 65536 / payloadBytesTarget 65536`, `capturedBytesObserved 67807`, `controlBytesObserved 2271`, `queriesAnswered: 1`, `reordered: 0`, exit code 0.
- [x] A CI job runs `bench:smoke` on `windows-latest` and fails on a non-zero exit; `ubuntu-latest` still passes. — `Benchmark smoke on Windows` in the `windows-package` job; `validate` keeps running the same suite on `ubuntu-latest`.
- [x] A client that stops answering the query fails loudly instead of hanging for 30 seconds. — `TerminalHandshake.progress()` fails inside an 8-second grace window naming the handshake, the query, and the per-terminal reply counts. `benchmarks/terminal-handshake-proof.mjs` proves it on both a stub client and a real nd-core: with `respond: false` the terminal streams 4 bytes and no exit, and `progress()` throws after 3.0 s (`queries=1 replies=0 outputBytes=4 outputBytesAfterQuery=0`); with the responder the same terminal finishes (marker observed, `progress()` in 26 ms). Run on `windows-latest` by the `Prove the terminal handshake fails loudly` step.

## 2. Release staging drops the Harness client face

```text
Error: Release runtime file is missing:
  .release/harness/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/index.js
```

Both Windows jobs fail here, before their real work. This is a genuine packaging defect, not an over-strict check: a packaged app that cannot load client plugins cannot boot the `web` profile.

- [x] `pnpm release:stage && pnpm release:verify` succeeds from a clean checkout with no pre-existing `.release`. — **Verified locally from a removed `.release`:** staging exited 0 and wrote the release manifest (`Web profile closure resolves 84 dependencies, including 53 client face(s)`), and `node scripts/verify-release.mjs` then reported `Release runtime inputs verified.`
- [x] Staging fails with an actionable message when the client face is missing, rather than only at `release:verify`. — Two layers. The deploy itself: `pnpm deploy --legacy` copies the selected project's own `node_modules` surface and stops, so `@deepseek-ai/dsh-web-app` shipped with empty dependencies and none of the 80 packages the web profile loads; staging now deploys with `--config.inject-workspace-packages=true --config.node-linker=hoisted`, which resolves the closure a published install would and leaves no symlinks for electron-builder to mis-copy. The check: `verifyWebProfileClosure()` resolves every dependency of `@deepseek-ai/dsh-web-app` the way the runtime does (walking `node_modules` upward from the declaring package, bounded to the staged tree) and requires every `dsh.client` face to carry the entry its manifest declares, naming the packages and the fix when it does not. Against the old closure the same check reports 40+ unresolvable dependencies.
- [x] `windows-package` completes: portable build, packaged runtime smoke, and the forced-kill cleanup receipt. — **All three components verified locally.** `pnpm dist:win:portable` exited 0 and produced `dist/ND-DSH-0.1.0-private-beta-x64.exe`; `node benchmarks/windows-core-crash-cleanup.mjs` reported `status: pass` (managed and descendant pids both gone after a forced core kill); `node scripts/packaged-runtime-smoke.mjs` against that artifact reported `status: pass`, `markerObserved: true`, bundled core protocol v1, Git resolved, 249 ms. What remains unverified is the job itself running on a CI runner.
- [x] The packaged smoke observes its terminal marker (`scripts/packaged-runtime-smoke.mjs:70`) or fails naming a real product defect. — **Two product defects were found and fixed; the packed artifact now observes the marker.** (a) The headless terminal path stalled in ConPTY's handshake (section 3): the terminal delivered exactly `ESC[6n` and no marker. (b) With that fixed, the smoke still failed, and now for its own reason: its command printed the marker and ran `exit` on the same input line, and the output still in flight when the console closes is never read. Measured through the preload bridge with the same shell and command — `echo <marker>` + `exit` written at 0/50/100/150/200 ms after create: marker observed in none of them, status `exited`, buffer ending at the echoed command line; the same command without `exit`: marker observed at 0/100/200 ms, status `running`. `terminalCommand()` now prints the marker and leaves the shell running (the smoke closes the terminal after reading it), and the failure receipt records the terminal's shell, status, output sequence and a buffer excerpt so a future failure names what the PTY produced.
- [ ] `performance-evidence` completes and uploads a `benchmark-results/**` artifact. — Not executed: it is a 120-minute Windows job (`pnpm bench:record`) that requires the portable artifact; its staging blocker is gone, so the next non-draft run is the first real attempt.

A third packaging defect, seen while running the packaged app by hand (not part of the smoke's checks): the packaged app logs `agent-browser MCP entry is missing from this ND install at <resources>/app.asar/node_modules/agent-browser/bin/agent-browser.js` and fails that `dsh:rpc` call. Staging requires `node_modules/agent-browser/bin/agent-browser.js` from the *repository*, but electron-builder does not ship that package inside `app.asar`, so the browser capability is broken in a packaged build while staging reports it present. Same defect family as the client face above, different layer.

## 3. `validate` fails at Desktop smoke tests

Every earlier step passes — including Benchmark smoke, Migration unit tests, Unit tests, Typecheck, Build desktop, and Verify production renderer isolation — then:

```yaml
- name: Desktop smoke tests
  run: xvfb-run --auto-servernum corepack pnpm e2e
```

- [x] The failing spec is named with its assertion and error output. — **No spec failed.** Both non-draft runs ([35586601675](https://github.com/zila-kh/nd-dsh/actions/runs/35586601675), [35592399694](https://github.com/zila-kh/nd-dsh/actions/runs/35592399694)) end with `Worker teardown timeout of 120000ms exceeded` / `1 skipped` / `36 passed (2.8m | 3.1m)` plus `1 error was not a part of any test`. The one skipped spec is `e2e/qa-functional.spec.ts:26:1 › QA: full work loop` (needs `OPENCODE_API_KEY`). The error is Playwright's worker-teardown watchdog firing 120 s after the last spec passed, so the assertion to name is the teardown, not a test.
- [x] The cause is classified as environmental, product defect, or flake, with evidence rather than assumption. — **Two-part classification.** (a) The CI failure is a test-runner teardown hang, not a product assertion: identical symptom in two runs (so not a flake), all 36 specs green, and the app is closed by each spec's bounded `afterAll(closeApp)`. The mechanism is still unproven — CI captures no process tree and no app stderr on that path — so it is filed as [todo-0010](todo-0010-desktop-smoke-teardown.md) rather than guessed at. (b) Running the same suite locally on Windows exposed a **product defect** the Linux CI cannot see: `Terminal Dock: dedicated terminal session runs a command` and `dedicated terminal runs a real PTY command through the sandboxed bridge` both fail with `Error: Timed out waiting for PTY output` (15.1 s each) because the terminal bridge stalled in ConPTY's handshake. Fixed in `src/main/terminal/terminal-manager.ts`: the PTY owner now answers the startup cursor-position query when the shell has produced no payload yet — the window in which the console host withholds output and the cursor really is at home — and leaves later queries to the emulator, which knows where the cursor is. `tests/terminal-manager.test.ts` covers the reply, the control-sequences-only case, and the post-output case; a probe of the built app via the preload bridge shows the marker arriving in 118 ms where it never arrived before.
- [ ] `validate` completes green on a non-draft pull request, with this step passing or replaced by an equivalent gate that genuinely runs. — Requires a CI run. Local Windows evidence: after the fix the terminal specs pass (see the run recorded in [todo-0010](todo-0010-desktop-smoke-teardown.md)).
- [x] Do not use `continue-on-error`: a skipped assertion is not a passing assertion. — No step gained `continue-on-error`.
- [x] If the cause is a product defect, file it as its own task. — The ConPTY terminal defect was found and fixed in this task (it is what section 2's packaged smoke would have hit). The unproven teardown mechanism is [todo-0010](todo-0010-desktop-smoke-teardown.md).

## 4. Evidence integrity — baselines, backend identity, binary hash

Three holes weaken results the suite already produces. All are described in [performance-benchmark-suite.md §12](../plan/performance-benchmark-suite.md#12-gap-closures--agent-task-metrics-baselines-and-fast-path-proof).

1. **No committed baseline.** `benchmark-results/` is gitignored and no baseline JSON is tracked, so "before → after" has nowhere to live and historical claims depend on someone still having the old bundle on disk. — **Decided and now recorded:** one committed, reviewed summary per reference machine under `benchmarks/baselines/`, raw bundles attached to the run that produced them; reasoning, contents and refresh protocol in [performance-baseline-policy.md](../plan/performance-baseline-policy.md). `benchmarks/baselines/win11-x64.json` was recorded locally on 2026-09-23 ([done-0015](done/done-0015-runtime-evidence-baseline.md)); the runner-produced bundle that fills in its `artifact` URL still requires the `performance-evidence` job.
2. **Evidence never asserts which backend produced it.** `benchmarks/lib/budgets.mjs` checks same-machine and full-provenance equality but never asserts `backend === 'legacy'` versus `'rust-core'`. A swapped or mislabelled pair would satisfy every existing gate and could pass the relative budgets. — **Closed:** the `backend-identity` gate requires each document's recorded backend to match the run that produced it.
3. **The Rust binary is not identified.** Evidence compares `commit` and `buildProfile`, which identify the repository, not the executable that ran. — **Closed:** `results.mjs` records `ndCore.sha256` (hashed from the binary the run measures, or taken from the staged release manifest for the packaged step), and the `core-binary-identity` gate requires one executable across the core suite, the Rust runtime and the packaged evidence.

- [x] A baseline policy is recorded (tracked reviewed bundle per reference machine, or artifact-only with required attached provenance), with reasoning. — `docs/plan/performance-baseline-policy.md`.
- [x] `bench:check` fails when a legacy/rust evidence pair is swapped, demonstrated by a test that deliberately swaps them. — `benchmarks/verify-evidence-identity.mjs` (run in `validate`): swapping the two documents fails `backend-identity`, the failure is reported as `[identity]`, and the real `bench:check` CLI exits 1 with that message on a swapped bundle.
- [x] Rust evidence records the nd-core executable hash; the checker fails when two candidate runs used different binaries. — Same script: two different `ndCore.sha256` values fail `core-binary-identity` as an `[identity]` failure while the backend labels stay green.
- [x] Failure messages distinguish identity/hash mismatch from budget violation. — Every check carries `kind: 'identity' | 'budget'` and every failure line starts with `[identity] ` or `[budget] `.
- [x] Existing budget thresholds are unchanged. — No numeric budget moved. The one gate whose *fields* changed is `terminal-integrity`, which now asserts byte-exact payload content instead of a byte count (strictly stronger).

## Notes

- Section 2 gates sections 1 and 4 end to end: the evidence bundle those sections rely on cannot be produced until staging works.
- Section 1 already gates trustworthy agent-task measurement (task 0005).
- Nothing here is a Rust change. Do not touch nd-core to satisfy a benchmark.
- Environment note: this checkout's `vendor/deepseek-harness` submodule was missing 74 tracked `vendor/*` files (the framework packages `link:` dependencies resolve to). Restoring them (`git -C vendor/deepseek-harness checkout -- .`) was required before staging could deploy an injected closure; CI checks out submodules recursively and was never affected.
