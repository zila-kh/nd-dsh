# WIP 0019 — Browser Companion MVP

> Priority: P1  
> Owner: ND browser/runtime  
> Status: merged to main via PR #32 — implementation complete; local validation and real-Chrome smoke pending  
> Historical branch: `feat/browser-companion-mvp`  
> Merged via: PR #32 (`main@9e0fcc5`)  
> Validation mode: manual local only; GitHub Actions remains parked  
> Updated: 2026-09-23

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

Run from an up-to-date `main` checkout:

- [ ] `corepack pnpm install --frozen-lockfile`
- [ ] `corepack pnpm browser:host:test`
- [ ] `corepack pnpm verify`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm vitest run tests/browser-companion-leases.test.ts tests/browser-companion-store.test.ts`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `node scripts/verify-release.mjs --config-only`

Known repository caveat: task 0017 records an intermittent Windows worktree-test
`EBUSY` teardown race. Preserve the first failure before retrying.

## Manual Chrome smoke

- [ ] `corepack pnpm browser:host:build`.
- [ ] Load `extensions/browser-companion` unpacked in Chrome.
- [ ] Register the host with the real extension id.
- [ ] Start ND; Settings -> Browser shows the profile connected.
- [ ] Side panel requests and receives access only for a chosen test origin.
- [ ] `browser.connections` and `browser.tabs` return the connected profile/tabs.
- [ ] Snapshot returns semantic refs and page metadata.
- [ ] Attach a test tab and exercise click/fill/press/scroll/navigation.
- [ ] Screenshot succeeds for the active tab.
- [ ] Change DOM after a snapshot; old ref/revision is rejected.
- [ ] A second writer cannot acquire the same tab.
- [ ] Reload/disconnect the extension; leases are revoked; reconnect succeeds.
- [ ] Password fields do not reveal current values.
- [ ] Built-in embedded browser remains unaffected.

## Performance evidence

After correctness smoke passes, record p50/p95 for cold connect, warm reconnect,
tab list, snapshot, click acknowledgement and screenshot plus 1/2/4/8-tab
parallel operation. Record Electron-main and native-host memory separately.

No performance numbers belong in README until this evidence is reproducible.

## Exit criteria

The implementation is already merged to `main`, but it is **not release-evidence complete** until the local automated gates and real-Chrome smoke above are recorded. Company-level browser action normalization remains a post-MVP GA requirement and must not be misrepresented as completed by this task.
