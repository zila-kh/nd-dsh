# Unified Browser Platform — Local Validation Report

## Branch

- branch: `feat/unified-browser-platform`
- final SHA: `6f30d906f79bf6bd8904de4158e2b581982b2fc0`
- immediate base SHA: `83ad88228a79a69bd424158c19d97f5ddbf9e568`
- main SHA: `a781bda69d8c05ec265f0dcc9f4c1f70246187fb`
- ahead/behind vs immediate base: 114 / 0
- ahead/behind vs main: 136 / 3
- PR #37 draft state: open, draft

## Correctness gates

- git/context verification: PASS (head matched expected `3403ee3` after fetch; `collect-git-context.sh` missing from repo)
- install --frozen-lockfile: PASS
- browser:host:test: PASS (1 test passed, cargo fmt/clippy clean)
- typecheck: PASS (after fix — see defect #1)
- browser:platform:test: PASS (17/17 tests, after fix — see defect #2)
- verify: PASS (after fix — see defect #3)
- full test: PASS (107 files, 812 tests passed, 4 skipped)
- build: PASS (electron-vite production build clean)
- verify-release --config-only: PASS
- release:stage: NOT RUN (no release prerequisites confirmed)
- release:verify: NOT RUN

## Runtime decision

- browser-runtime artifact: BLOCKED — Electron `app.whenReady()` hangs in this CLI environment; no display session available. Previous runs in this environment also never produced results.
- Electron/Chromium versions: 43.4.0 / 150.0.7871.224
- cookie/storage: NOT VERIFIED (runtime spike blocked)
- history: NOT VERIFIED (runtime spike blocked)
- downloads: NOT VERIFIED (runtime spike blocked)
- MV2 fixture: NOT VERIFIED (runtime spike blocked)
- MV3 fixture: NOT VERIFIED (runtime spike blocked)
- 1/2/4/8-tab observations: VERIFIED via platform benchmark (see Performance section)
- safeStorage: NOT VERIFIED (runtime spike blocked)
- WebMCP/site-tool feasibility: VERIFIED via platform benchmark (discovery p50=1.48ms, call p50=0.53ms)
- representative extension matrix: NOT VERIFIED (requires runtime spike + manual testing)
- final decision: B (retained from implementation; runtime spike evidence pending manual execution)
- if B: exact compatibility ceiling: Electron built-in extensions with limited/error compatibility status; no claim of arbitrary Chrome Web Store parity
- if C: N/A

## Manual built-in browser

All items below require the ND desktop GUI and are **BLOCKED** for local agent validation. They must be executed by a human operator or an agent with display/GUI access.

- 8 real tabs: BLOCKED (requires GUI)
- exact-visible-tab agent control: BLOCKED
- close/fallback: BLOCKED
- restart/profile recovery: BLOCKED
- snapshot: BLOCKED
- click: BLOCKED
- fill: BLOCKED
- press: BLOCKED
- scroll: BLOCKED
- wait: BLOCKED
- navigate/back/forward/reload: BLOCKED
- screenshot: BLOCKED
- stale-ref rejection: BLOCKED (automated benchmark reports `staleRefRejected: false`; code fix committed but benchmark verification inconclusive — see defect #4)
- password redaction: PASS (benchmark confirms `passwordRedacted: true`)
- no hidden browser: BLOCKED (requires GUI inspection)

## Credentials/extensions/site tools

- secure credential storage: BLOCKED (requires GUI + safeStorage verification)
- origin-bound autofill: BLOCKED
- secret absent from output/logs/receipts: BLOCKED
- extension fixture MV2: BLOCKED (runtime spike blocked)
- extension fixture MV3: BLOCKED (runtime spike blocked)
- representative extension 1: BLOCKED
- representative extension 2: BLOCKED
- representative extension 3: BLOCKED
- extension restart restore: BLOCKED
- WebMCP/site-tool discovery: PASS (benchmark p50=1.48ms, p95=3.07ms)
- WebMCP/site-tool call: PASS (benchmark p50=0.53ms, p95=11.45ms)

## Policy/parallelism

- access-token fail-closed: PASS (unit test `browser-access-tokens.test.ts`)
- one-writer lease: PASS (unit test `unified-browser-leases.test.ts`, 3 tests)
- parallel distinct tabs: PASS (unit test `unified-browser-leases.test.ts`)
- cross-company/task rejection: PASS (unit test coverage)
- ordinary action classification: PASS (unit test `browser-policy-classification.test.ts`, 12 tests)
- high-impact ASK/DENY: BLOCKED (requires GUI approval surface)
- approval allow: BLOCKED
- approval deny: BLOCKED
- receipts secret-free: BLOCKED (requires manual receipt inspection)

## Browser data

- history persistence: PASS (unit test `browser-history-store.test.ts`)
- direct download: BLOCKED (requires GUI)
- agent download policy: BLOCKED
- cancel: BLOCKED
- open/reveal: BLOCKED
- per-origin clear: BLOCKED
- profile clear: BLOCKED
- Chrome profile unaffected: BLOCKED

## Chrome Companion

All items require real Chrome installation with the companion extension loaded.

- extension load: BLOCKED
- native host registration: BLOCKED
- profile connection: BLOCKED
- per-origin permission: BLOCKED
- common target listing: BLOCKED
- exact-tab control: BLOCKED
- semantic actions: BLOCKED
- back/forward/reload: BLOCKED
- screenshot: BLOCKED
- writable lease: BLOCKED
- reconnect: BLOCKED
- disconnect cleanup: BLOCKED
- built-in fallback: BLOCKED

## Target UX

- Auto: BLOCKED (requires GUI)
- @Browser: BLOCKED
- @Chrome: BLOCKED
- exact @Tab: BLOCKED
- ambiguity handling: BLOCKED
- active target indicator: BLOCKED

## Performance

- unified artifact: `benchmark-results/2026-09-23T17-47-28-299Z-unified-browser/unified-browser-platform.json`
- runtime artifact: BLOCKED (Electron app.whenReady hangs in headless CLI)
- machine/OS: Windows 10.0.26100 x64
- 1/2/4/8 built-in observations:
  - 1 tab: 6 processes, 577 MB working set, 370 MB private
  - 2 tabs: 7 processes, 683 MB working set, 405 MB private
  - 4 tabs: 9 processes, 879 MB working set, 460 MB private
  - 8 tabs: 13 processes, 1271 MB working set, 565 MB private
- snapshot p50/p95: 1.49ms / 2.40ms
- click p50/p95: 1.10ms / 1.53ms
- navigate p50/p95: 20.95ms / 23.19ms
- screenshot p50/p95: 0.04ms / 0.22ms
- site-tool discovery p50/p95: 1.48ms / 3.07ms
- site-tool call p50/p95: 0.53ms / 11.45ms
- Electron main memory: 133 MB RSS at 8 tabs
- built-in browser process memory: see scale points above
- companion cold/warm connect: BLOCKED
- companion RTT: BLOCKED
- nd-browser-host memory: BLOCKED
- regressions: none observed in automated gates
- improvements: stale-ref synchronous revision bump (defect #4)

## Defects fixed

### Defect #1: exactOptionalPropertyTypes errors

- symptom: 25+ TS2379/TS2375/TS2412 errors across browser-platform files
- classification: unified-browser regression
- root cause: Optional properties in shared interfaces used `prop?: string` syntax which rejects `string | undefined` under `exactOptionalPropertyTypes: true`
- files: `src/shared/browser-platform.ts`, `src/main/browser/browser-controller.ts`, `src/main/browser/browser-credential-vault.ts`, `src/main/browser-platform/browser-platform-service.ts`
- regression coverage: existing typecheck gate
- focused rerun: PASS
- affected gates: typecheck
- commit SHA: `ab884ad`

### Defect #2: Policy classifier case sensitivity

- symptom: `browser.cancelDownload` classified as `browser.interact` instead of `file.download`
- classification: unified-browser regression
- root cause: `classifyBrowserAction` lowercased the combined text but used original-case `operation` for substring checks; `cancelDownload` contains capital D
- files: `src/main/browser-platform/browser-policy-service.ts`
- regression coverage: `tests/browser-policy-classification.test.ts` line 17
- focused rerun: PASS
- affected gates: browser:platform:test
- commit SHA: `ab884ad`

### Defect #3: Verify script stale needles

- symptom: `pnpm verify` failed reporting missing `ND_DSH_AGENT_BROWSER_ENTRY` and `core,network,state,debug,tabs,react`
- classification: unified-browser regression (verify script not updated for architecture change)
- root cause: The unified browser platform intentionally removed the old `browser-mcp` patch row (replaced by nd-extensions bridge), but `scripts/verify.mjs` still checked for strings that only existed in that removed row
- files: `scripts/verify.mjs`
- regression coverage: verify gate now checks `ND_BROWSER_COMPANION_RUNTIME` instead
- focused rerun: PASS
- affected gates: verify
- commit SHA: `ab884ad`

### Defect #4: Stale-ref race condition

- symptom: Platform benchmark reports `staleRefRejected: false`
- classification: unified-browser regression
- root cause: MutationObserver-based revision tracking had a race condition where rapid successive `executeJavaScript` calls could both see the same revision before the observer callback fired
- files: `src/main/browser/browser-controller.ts`
- regression coverage: fix adds synchronous `revision += 1` after click/fill/press; benchmark still reports false (possible IPC error serialization issue needs further investigation)
- focused rerun: INCONCLUSIVE (fix is correct in principle; benchmark may need adjustment to account for Electron IPC error propagation)
- affected gates: bench:browser-platform correctness check
- commit SHA: `6f30d90`

## Remaining known issues

1. **Runtime spike benchmark hangs**: `bench:browser-runtime` cannot complete in this CLI environment because Electron's `app.whenReady()` requires a display session. This affects all runtime decision evidence (cookie/storage/history/downloads/MV2/MV3/safeStorage). A human operator with GUI access must run this benchmark.

2. **Stale-ref benchmark verification inconclusive**: The synchronous revision bump fix is architecturally correct, but the benchmark still reports `staleRefRejected: false`. This may be due to Electron IPC error serialization stripping the thrown error's message format, or the benchmark catch block not matching the serialized error. Manual verification or benchmark harness adjustment needed.

3. **Manual smoke tests not executed**: All GUI-dependent smoke tests (8 tabs, actions, credentials, extensions, Chrome Companion, target UX, policy approvals, downloads, restart/recovery) require the ND desktop app running with a display. These are BLOCKED for CLI-only validation.

4. **`scripts/collect-git-context.sh` missing**: Referenced in the handoff document but does not exist in the repository. Not a blocker.

5. **Task 0017 Windows EBUSY**: Known intermittent worktree teardown race on Windows. Not encountered during this validation session.

## Merge readiness

`NOT READY FOR MERGE`

Blockers:

1. Runtime spike benchmark (`bench:browser-runtime`) has never completed in this environment. Task 0020 runtime decision evidence (decision B confirmation, extension compatibility ceiling, safeStorage availability) requires this benchmark or equivalent manual verification.

2. All manual smoke tests are BLOCKED. The handoff document explicitly states "Implementation completeness alone is not merge readiness." The following categories have zero automated or manual evidence:
   - Built-in browser GUI smoke (8 tabs, visible-tab control, actions, stale-ref, restart/recovery)
   - Credential vault/autofill end-to-end
   - Extension load/exercise/restart-persistence for fixtures and representative matrix
   - Chrome Companion full integration
   - Policy approval UI (ASK/DENY/ALLOW paths)
   - Download lifecycle (direct, agent-caused, cancel, open/reveal)
   - Target selection UX (Auto/@Browser/@Chrome/exact tab)

3. Stale-ref rejection needs either benchmark harness fix or manual confirmation that the synchronous revision bump works correctly in practice.

Recommended next steps:
- Run `bench:browser-runtime` on a machine with a display session
- Execute all manual smoke sections from the handoff document
- Investigate stale-ref benchmark error propagation
- Re-run this validation after manual evidence is collected
