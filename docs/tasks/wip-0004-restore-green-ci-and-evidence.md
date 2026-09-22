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

Three holes weaken results the suite already produces. All are described in [performance-benchmark-suite.md §12](../plan/performance-benchmark-suite.md#12-remaining-gaps--agent-task-metrics-baselines-and-fast-path-proof).

1. **No committed baseline.** `benchmark-results/` is gitignored and no baseline JSON is tracked, so "before → after" has nowhere to live and historical claims depend on someone still having the old bundle on disk. — **Decided:** one committed, reviewed summary per reference machine under `benchmarks/baselines/`, raw bundles attached to the run that produced them; reasoning, contents and refresh protocol in [performance-baseline-policy.md](../plan/performance-baseline-policy.md). The first runtime baseline can only be recorded once the `performance-evidence` job completes.
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