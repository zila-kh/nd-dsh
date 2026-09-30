# ND-DSH 0.0.1 release checklist

> Updated: 2026-09-29 · Tree: `main` @ `1608057` (PR #60 + #62 merged) plus the uncommitted release-prep fixes listed at the end.
> Machine: Windows 10.0.26200, Node 24.19.0, pnpm 11.7.0, Rust 1.98.1, Electron 43.4.0.
> Companion documents: [beta-release-gate.md](beta-release-gate.md) (per-area gate definitions), [beta-release-readiness.md](beta-release-readiness.md) (ordered plan), [blocked-0004](../tasks/blocked-0004-windows-release-validation.md) (runner evidence).
>
> **2026-09-30 update (RC freeze):** the recorded A10 failure is triaged, fixed, and live-verified — see [reliability-gate-2026-09-30](../qa/reliability-gate-2026-09-30.md). Freeze executed per Phase 0 of the readiness plan: branch `rc/0.1.1`, tag `rc-0.1.1-candidate-1` @ `d519791`, evidence skeleton `beta-three-layer-evidence-rc-0.1.1.json`. Only P0/P1 fixes and release-test changes until GO/NO-GO. Rows below reflect the 2026-09-29 record except where annotated.

## Status legend

| Status | Meaning |
| --- | --- |
| **Verified** | Ran green on this tree today. |
| **Stable** | Automated coverage exists and last passed; not re-run today. |
| **Verify** | Needs a human tester or an RC-artifact run before GO. |
| **Fail** | Ran today and failed; must be fixed. |
| **In progress** | Running or partially fixed now. |
| **Missing** | Not implemented or not configured. |
| **Decision** | Needs an owner decision before work can continue. |

## Verdict

**NO-GO for a public 0.0.1 today.** The live-model journey cannot complete its first chat turn (A10), which blocks any release until triaged. The other automated code gates are essentially green after today's fixes, but the release artifact is not yet rebuilt and verified, no human/RC evidence exists, and the public-distribution items (signing, installer, updates, CI) are missing.

## 1. Decisions needed first

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| D1 | Release label: Private Beta or Public 0.0.1 | Decision | Public release requires every row in section 5. Private Beta needs sections 2–4 only. |
| D2 | Version number | Decided | App version bumped `0.1.0` → `0.1.1` for this private build. Rust crates and the Browser Companion stay at `0.1.0` (protocol/component versions, not the desktop release). `0.0.1` would be a downgrade. |
| D3 | Artifact name | Decision | `electron-builder.yml` names the build `ND-DSH-${version}-private-beta-x64.exe`; `beta:automated` expects that name. Change both for a public name. |
| D4 | Bundled Harness version | Decision | `main` now bundles DeepSeek Harness `0.1.7-rc.2` (`21638c5`); the last fully attested build used `0.1.5-rc.2`. Confirm this runtime for the RC. |

## 2. Automated gate (`corepack pnpm beta:automated`)

| # | Stage | Script | First run today | After fixes | Notes |
| --- | --- | --- | --- | --- | --- |
| A1 | Repository verification | `verify` | Verified | Verified | |
| A2 | TypeScript typecheck | `typecheck` | Verified | Verified | |
| A3 | Unit/integration tests | `test` | Fail (2) | **Verified** — 1013 passed, 0 failed, 9 skipped | Symlink test now uses a Windows junction; live Antigravity loop is opt-in (`ND_DSH_LIVE_ANTIGRAVITY=1`). |
| A4 | Rust fmt + clippy + tests | `core:test` | Verified | — | |
| A5 | Browser native host tests | `browser:host:test` | Verified | — | |
| A6 | Browser platform tests | `browser:platform:test` | Verified | — | 26/26 |
| A7 | Production renderer build | `build` | Verified | — | |
| A8 | Full Playwright suite | `e2e` | Fail — 45 passed, 5 failed, 7 not run | **In progress** — 60 passed, 0 failed, 3 skipped | Specs updated for PR #60's Settings/Company redesign. Suite still exits 1 on the known Playwright worker-teardown timeout after the last test; fix or classify before GO. |
| A9 | 3 companies × 2 projects matrix | `e2e:beta:matrix` | Verified | — | |
| A10 | Live-model production journey | `e2e:prod` | Skipped (no `.env.e2e`) | **Triaged + fixed 2026-09-30** | Root cause: remote-face approval/question waterfalls were dropped by ND's gateway client, so escalated tool calls (e.g. `pwsh` `node --test`) blocked invisibly (see [reliability-gate-2026-09-30](../qa/reliability-gate-2026-09-30.md)). Fixed in `b999126`; on the fixed tree the full journey **passed 19/20 gates in 14.3 min** incl. two live approval round-trips and restart-during-active-work recovery (`e2e-results/real-user-prod-2026-09-30T07-21-12-497Z`). Remaining: re-run on the packaged RC artifact. |
| A11 | Built-in browser runtime proof | `bench:browser-runtime` | Fail — hung | **Verified** — pass, decision `B-candidate` | Top-level `await app.whenReady()` deadlocked on Electron 43; every probe step now has a timeout. |
| A12 | ND Core contract benchmark | `bench:contract` | Verified | — | |
| A13 | Agent-task baseline check | `bench:tasks:check` | Verified | — | |
| A14 | Windows portable build | `dist:win:portable` | Fail | **Verified** for `0.1.1` package | `dist-011/ND-DSH-0.1.1-private-beta-x64.exe` (2026-09-29). `dist/` stayed locked, so this build used a separate output folder. Packaged smokes below were run on the `0.1.0` artifact, not this file. |
| A15 | Forced nd-core crash cleanup | `release:smoke:core-crash` | Pass on old artifact | **Verified** on the 2026-09-29 artifact | Re-run after the `0.1.1` rebuild. |
| A16 | Packaged runtime/core/terminal/Git smoke | `release:smoke:packaged` | Pass on old artifact | **Verified** on the 2026-09-29 artifact | Re-run after the `0.1.1` rebuild. |

## 3. Beta gate by product area

Detail and evidence per row: [beta-release-gate.md](beta-release-gate.md).

| # | Area | Automated (Unit + E2E) | Human | Status | Open gap |
| --- | --- | --- | --- | --- | --- |
| 1 | Fresh install / upgrade | Partial | Pending | Verify | No config-schema migration tests; clean-machine install unproven. |
| 2 | Startup / sidecar lifecycle | Verified | Pending | Verify | Packaged mid-task nd-core interruption drill. |
| 3 | Core agent flow (company → project → task → result) | Fail | Pending | **Fixed on source 2026-09-30** | Live journey passed end-to-end after the waterfall fix (gates 9–13, 15–16); human/RC confirmation on the packaged artifact still required. |
| 4 | Workflow templates | Internal only | — | Stable | Not exposed as a user feature; do not advertise. |
| 5 | Multi-company / project isolation | Verified | Pending | Verify | Provider keys are desktop-global by design. |
| 6 | Parallel agents | Stable | — | Stable | |
| 7 | LLM providers / failure handling | Stable | Pending | Verify | Fresh RC evidence (A10). |
| 8 | Budget / entitlement | Stable | — | Stable | |
| 9 | Git safety + pre-push secret scan | Stable | Pending | Verify | Human inspection of Git/worktree state on RC. |
| 10 | Terminal + filesystem | Verified | — | Stable | |
| 11 | Browser tools | Verified | Pending | Verify | Real-Chrome Companion check; in-app popup `tabs.reload`/active-tab probes still fail (`B-candidate`). |
| 12 | MCP / skills errors | Verified | Pending | Verify | Interactive-session recovery after MCP child failure. |
| 13 | Persistence / recovery | Verified | — | Stable | |
| 14 | Security boundaries | Stable | Pending | Verify | Verify OS secure-storage backend on RC machine. |
| 15 | Failure drills (network, kill core, disk, merge conflict) | Partial | Pending | Verify | Human drills on the exact RC. |
| 16 | Performance | Stable | Pending | Verify | Long-session judgment. |
| 17 | 24-hour soak | Harness only | Pending | Verify | 24 h run on the RC machine (gate rejects < 1440 min). |
| 18 | Real-user matrix (3 × 2) | Verified | Pending | Verify | Human run on RC, ≥ 95 % pass rate. |
| 19 | Diagnostics export | Verified | — | Stable | |
| 20 | Rollback one version | Partial | — | Missing | Needs an update channel (section 5). |
| 21 | Quick Launcher / global popup | Verified | Pending | Verify | Global shortcut, focus, capture, clipboard checks. |
| 22 | ND Extensions + native host | Verified | Pending | Verify | Manual P0/P1 rows; agent-side native-host bridge is deferred and must not be claimed. |
| 23 | ND Home | Verified | Pending | Verify | Personal content never leaks into a workspace. |
| 24 | General / Coding profiles | Verified | Pending | Verify | Human judgment on the packaged RC. |
| 25 | Built-in browser extensions (PR #60) | Verified | Pending | Verify | New in this release; include in the RC evidence matrix. |

## 4. Private Beta release process

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| P1 | Freeze RC branch/tag from `main` | Missing | No tags exist. Only P0/P1 and release-test fixes after freeze. |
| P2 | Commit today's release-prep fixes | In progress | See the list below. |
| P3 | RC evidence file `docs/qa/beta-three-layer-evidence-<rc>.json` | Missing | Copy from `beta-three-layer-evidence.example.json`; add row 25. |
| P4 | `beta:automated` fully green on the RC | In progress | Section 2. |
| P5 | Clean-machine packaged install (no dev tools) | Verify | Decide whether Git/Node are bundled or prerequisites. |
| P6 | Installed-app E2E + negative cases | Verify | Cancel, kill core, missing engine, offline, corrupt state, rejected approval, missing credential, merge conflict. |
| P7 | Real-Chrome Browser Companion smoke | Verify | Previously green; re-run on RC. |
| P8 | Human failure drills | Verify | Row 15. |
| P9 | Real-world matrix ≥ 95 % | Verify | Row 18. |
| P10 | 24-hour soak | Verify | Row 17. |
| P11 | Rollback/recovery instructions for testers | Missing | |
| P12 | Known limitations + supported OS/providers/engines doc | Missing | Include the limitations below. |
| P13 | `beta:gate` on the evidence file + human GO | Missing | Human release owner records GO/NO-GO. |

## 5. Public release (additional)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| R1 | Restore CI (`.github-bk/` → `.github/`) + runner-attested Windows evidence | Missing | [blocked-0004](../tasks/blocked-0004-windows-release-validation.md) exit criteria. |
| R2 | Windows code signing | Missing | No signing config in `electron-builder.yml`. |
| R3 | Installer (e.g. NSIS) with uninstall behavior | Missing | Only a portable `.exe` target exists. |
| R4 | App icon, product metadata | Missing | No icon configured; Electron default is used. |
| R5 | Auto-update channel with signature verification | Missing | No updater in the app. |
| R6 | Previous-version rollback preserving user state | Missing | Depends on R5. |
| R7 | Third-party notices + licenses in artifact | Stable | Generated during `release:stage`; bundled with `LICENSE`. |
| R8 | Public docs: README status, install guide, limitations | Missing | README still says Developer Preview / Private Beta. |

## Known limitations to publish

- Provider API keys are desktop-global; one ND desktop is one trusted operator.
- Workflow-template authoring is not a user feature yet.
- Coding engines cannot call ND native-host methods yet.
- In-app extension popups: `tabs.reload` and active-tab matching do not pass the runtime probe.
- WebMCP is not available in the built-in browser runtime.

## Release-prep fixes made today (uncommitted)

| File | Change |
| --- | --- |
| `tests/nd-extension-lifecycle.test.ts` | Symlink-escape test uses a directory junction on Windows so it runs without admin rights. |
| `tests/real-world-agy-autonomous-loop.test.ts` | Live Antigravity loop is opt-in, matching the other live tests. |
| `e2e/agent-capabilities*.spec.ts` | Settings tab renamed to "Extensions & plugins". |
| `e2e/nd-home-extensions.spec.ts`, `e2e/zz-settings-visual.spec.ts` | Scoped ambiguous Install/Manage buttons. |
| `e2e/qa-functional.spec.ts` | Opens Overview after company creation (dashboard now opens on Work). |
| `benchmarks/browser-runtime-spike-electron.mjs` | No top-level `whenReady` await; every probe step has a timeout. |
| `vendor/deepseek-harness.json` | Records the submodule's actual commit (`21638c5`, Harness `0.1.7-rc.2`). |
| `src/renderer/src/components/ChatPanel.tsx`, `src/renderer/src/App.tsx` | Session-list refreshes are coalesced; background failures show an inline Retry notice instead of stacking toasts; identical toasts are deduplicated. |

Local environment cleanup (not in Git): removed 11 orphaned build-output folders in `vendor/deepseek-harness` from packages upstream deleted.
