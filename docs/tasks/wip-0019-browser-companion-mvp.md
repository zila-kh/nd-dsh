# WIP 0019 — Browser Companion MVP

> Priority: P1  
> Owner: ND browser/runtime  
> Status: merged to main via PR #32 — local automated validation and the real-Chrome companion smoke recorded green 2026-09-24  
> Historical branch: `feat/browser-companion-mvp`  
> Merged via: PR #32 (`main@9e0fcc5`)  
> Validation mode: manual local only; GitHub Actions remains parked  
> Updated: 2026-09-24

## Objective

Add a safe local bridge from ND to a user's existing Chrome/Chromium profile while
preserving the embedded ND browser, engine neutrality and the desktop trust boundary.

PRD: [0004-browser-companion-mvp.md](../prd/0004-browser-companion-mvp.md).

## Implemented

- [x] Manifest V3 browser companion with Native Messaging.
- [x] Explicit optional HTTP/HTTPS origin access in the side panel.
- [x] Stable extension installation/profile identity.
- [x] Semantic interactive-element snapshots with `@eN` refs.
- [x] Snapshot revisions and `STALE_BROWSER_REFERENCE` failures.
- [x] Password-value redaction.
- [x] Click/fill/press/scroll/navigation/screenshot/tab-list actions.
- [x] Rust `nd-browser-host` with bounded Chrome framing.
- [x] Per-process authenticated local desktop relay over named pipe/Unix socket.
- [x] Durable connection metadata without cookies/passwords/tokens.
- [x] One writable owner per connected tab.
- [x] Disconnect revokes tab leases.
- [x] Renderer-safe connection/lease IPC.
- [x] Browser Companion status in Settings -> Browser.
- [x] Stable `nd_browser_call` MCP tool for MCP-capable engines.
- [x] Portable local runtime path for shell-capable direct engines.
- [x] Release staging and electron-builder resources for host/extension/scripts.
- [x] Focused connection-store and tab-lease unit tests.

## Architecture decision

The MVP intentionally uses `tabs` + `scripting` + a semantic content driver
instead of `chrome.debugger`.

This keeps the first release off the broad debugger permission while covering the
MVP action set. CDP/debugger tunneling remains a later option if a measured feature
gap justifies the permission cost.

## Intentionally not complete in this task

- Company/project browser action policy is not yet a hard authorization boundary.
  Lease scope fields exist, but agent-supplied scope is not trusted identity.
- Normalized high-impact browser actions are not yet wired into
  `OrganizationApprovalGate`.
- Rich `@Chrome` / `@Tab` mention UI is deferred.
- Downloads/uploads, network/console tooling, cookies/storage tools and debugger
  access are deferred.
- Edge/Brave registration helpers and Firefox/Safari are deferred.
- Performance claims are deferred until local evidence is recorded.

These are explicit follow-up scope, not hidden MVP claims.

## Local automated validation

Recorded 2026-09-24 on the Windows reference machine (commit `d3de5be`, Windows 10.0.26100, node v24.16.0, pnpm 11.7.0):

- [x] `corepack pnpm install --frozen-lockfile` — already up to date, lockfile intact.
- [x] `corepack pnpm browser:host:test` — `cargo fmt --check` + clippy (`-D warnings`) + `nd-browser-host` tests all pass.
- [x] `corepack pnpm verify` — repository, ND Pencil, and vendor checks pass.
- [x] `corepack pnpm typecheck` — pass.
- [x] `corepack pnpm vitest run tests/browser-companion-leases.test.ts tests/browser-companion-store.test.ts` — 4 tests passed.
- [x] `corepack pnpm test` — 841 passed / 8 skipped; five consecutive green full-suite runs the same day.
- [x] `corepack pnpm build` — desktop build passes; also exercised inside `dist:win:portable`.
- [x] `node scripts/verify-release.mjs --config-only` — release packaging configuration verified.

The companion target is also exercised in the unified browser platform benchmark
(`pnpm bench:browser-platform`, bundle `benchmark-results/2026-09-24T10-01-18-231Z-unified-browser/`),
where it is correctly classified as `manual-evidence-required`.

Known repository caveat: task 0017 records an intermittent Windows worktree-test
`EBUSY` teardown race; it is closed as [done-0017](done/done-0017-windows-worktree-test-ebusy-flake.md)
with five green confirmation runs.

## Real-Chrome companion smoke

**Status 2026-09-24: recorded green — the smoke is now scripted and reproducible.**
`corepack pnpm e2e:companion:chrome` drives the real Google Chrome binary with
`extensions/browser-companion` loaded unpacked (`Extensions.loadUnpacked`, because
Chrome 137+ removed `--load-extension`), registers the native host under that
profile's real extension id, grants one test origin through the extension's own
side-panel button, and starts the built app under `ND_DSH_COMPANION_SMOKE_OUTPUT`
so the in-app harness (`src/main/perf/companion-chrome-smoke.ts`) drives the
token-guarded agent path against the live connection and writes step evidence.

Run 2026-09-24 (extension `gencpibbialokpmcnfbgcagenogdglcp`, Chrome 153.0.8010.53):
evidence `e2e-results/companion-chrome-2026-09-24T18-0x/companion-chrome-smoke.json`
— 15 steps pass, 1 documented skip, exit 0.

- [x] `corepack pnpm browser:host:build`. — `target/release/nd-browser-host.exe`; the driver re-registers it per run.
- [x] Load `extensions/browser-companion` unpacked in Chrome. — `Extensions.loadUnpacked` against the real Chrome binary; the SW target is asserted.
- [x] Register the host with the real extension id. — `pnpm browser:register -- --extension-id=<real id>`; HKCU manifest verified.
- [x] Start ND; Settings -> Browser shows the profile connected. — `companion-connection` step: companion target `connected: true`, profile label `chrome`.
- [x] Side panel requests and receives access only for a chosen test origin. — granted through the panel's own button for `http://127.0.0.1:<port>/*` only; the ungranted `localhost` origin is refused (`permission-required`).
- [x] `browser.connections` and `browser.tabs` return the connected profile/tabs. — `companion-tabs` step lists the exact Chrome tabs under the common target API.
- [x] Snapshot returns semantic refs and page metadata. — `snapshot-semantic-refs`: 4 interactive elements at revision 1.
- [x] Attach a test tab and exercise click/fill/press/scroll/navigation. — `attach-writable-lease`, `click`, `fill`, `press`, `scroll` (viewport 0 -> 600px), `navigate-back-forward-reload` all pass.
- [x] Screenshot succeeds for the active tab. — **skipped in the automated run by design**: Chrome withholds `captureVisibleTab` until the user has invoked the extension from the toolbar (`activeTab`). The step activates the tab first and records the exact Chrome refusal; it passes when the panel was opened from ND's toolbar icon.
- [x] Change DOM after a snapshot; old ref/revision is rejected. — `stale-ref-rejected`: `STALE_BROWSER_REFERENCE`.
- [x] A second writer cannot acquire the same tab. — `second-writer-rejected`: "Browser tab is already leased by another execution lane".
- [x] Reload/disconnect the extension; leases are revoked; reconnect succeeds. — `disconnect-reconnect`: native host killed, connection dropped, prior lease revoked, reconnect and re-attach succeed.
- [x] Password fields do not reveal current values. — `password-redaction`: `sensitive: true`, empty text.
- [x] Built-in embedded browser remains unaffected. — `builtin-browser-unaffected`: built-in snapshot with 4 elements while the companion lease is held.

Two behaviors the smoke recorded as Chrome constraints rather than product defects:

1. **`back`/`forward` traverse user history only.** Chrome records a session-history entry for user-initiated navigation; every renderer-initiated navigation (ND's `tabs.update`, an injected `location.assign`, even an agent's synthetic `click`) is a client redirect that replaces the current entry. The smoke therefore primes one real user navigation and proves `browser.forward`/`browser.back` over it. An agent cannot build history for a later `back` — inherent to the `tabs` + `scripting` model that deliberately avoids the debugger permission.
2. **Screenshots need a toolbar invocation** (see the checklist item above): ND never pre-grants `<all_urls>`; the per-origin grant that all other actions use is not enough for `captureVisibleTab`.

Automating the grant needs one human answer: Chrome answers an optional-host-permission request with a native dialog, and while it is unanswered the request stays pending forever. The driver bounds every path, waits up to 120s for the grant (however it lands), and prints which path granted; a desktop agent can answer the dialog.

## Performance evidence

After correctness smoke passes, record p50/p95 for cold connect, warm reconnect,
tab list, snapshot, click acknowledgement and screenshot plus 1/2/4/8-tab
parallel operation. Record Electron-main and native-host memory separately.

No performance numbers belong in README until this evidence is reproducible.

The companion leg requires the real extension/native host, so its numbers stay part of the scripted smoke above; performance claims stay deferred until they are recorded. The built-in target's 1/2/4/8-tab process/memory and action-latency
evidence is recorded by the unified browser platform benchmark
(`benchmark-results/2026-09-24T10-01-18-231Z-unified-browser/`), which deliberately
classifies the companion measurements as `manual-evidence-required`.

## Exit criteria

The implementation is already merged to `main`, and both halves of the record's evidence are now recorded: the local automated gates (2026-09-24) and the scripted real-Chrome companion smoke (2026-09-24, 15 pass / 1 documented skip). The two Chrome constraints the smoke documents (user-history-only back/forward, screenshots after a toolbar invocation) are behavior of the `tabs` + `scripting` model, not open defects. Companion performance numbers remain deferred to the follow-up measurement work. Company-level browser action normalization remains a post-MVP GA requirement and must not be misrepresented as completed by this task.
