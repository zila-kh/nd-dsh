---
id: "0004"
title: "Unified Browser Companion and Real-Chrome Agent Control"
status: implementation
last-audit: 2026-09-23
---

# Product Requirement Document (PRD): Unified Browser Companion and Real-Chrome Agent Control

## 1. Context

ND already owns a canonical visible embedded Electron browser and binds agent-browser
to its exact CDP target. That remains the default same-browser path.

Some tasks need the user's existing Chromium profile instead: signed-in accounts,
open tabs, cookies, browser extensions, and other profile-local state. Launching a
second automation browser does not preserve that context, and attaching a generic
remote-debugging port to a normal Chrome profile is not a production contract.

ND Browser Companion adds an explicit second browser target class without turning
the extension into another agent runtime.

## 2. Goals

1. Preserve the existing embedded browser and same-browser invariant.
2. Let ND use an explicitly connected existing Chrome/Chromium profile and tab.
3. Keep ND desktop as the trusted control plane for routing, leases, policy and audit.
4. Use Chrome Native Messaging rather than an open localhost HTTP/WebSocket server.
5. Keep extension privileges minimal: scripting + optional per-origin access for MVP.
6. Reuse the universal extension router so Harness and supported direct engines share
   one browser capability rather than receiving vendor-specific browser integrations.
7. Use semantic element references with snapshot revisions and fail on stale refs.
8. Prevent two execution lanes from mutating the same connected tab concurrently.
9. Never expose password values or browser cookies to an agent.
10. Package the native host, extension and runtime bridge with ND release inputs.

## 3. Non-goals for MVP

- Do not replace the embedded ND browser.
- Do not add `browser` to the persisted `CapabilityKind` schema yet.
- Do not use `chrome.debugger` in the initial implementation.
- Do not expose cookies, local storage secrets, saved passwords or arbitrary browser
  profile files.
- Do not claim Firefox/Safari support.
- Do not claim company-level browser policy normalization is complete until the
  organization action envelope and approval gate are wired to browser mutations.
- Do not claim hard company/profile isolation when users intentionally share one
  Chromium profile.

## 4. Architecture

~~~text
Chrome / Chromium profile
        |
ND Browser Companion (Manifest V3)
  service worker
  optional per-origin access
  semantic content driver
  side panel
        |
Chrome Native Messaging
        |
nd-browser-host (Rust)
  framing only
  discovery/auth relay
        |
named pipe / Unix socket
        |
BrowserCompanionService (Electron main)
  connection registry
  request routing
  writable tab leases
  renderer state IPC
        |
universal extension router
   + stable nd-extensions MCP
        |
Harness / direct coding engines
~~~

The native host contains no company semantics, model credentials or agent logic.
Browser business state stays in the Electron main process.

## 5. Browser driver contract

MVP methods:

- `browser.connections`
- `browser.tabs`
- `browser.attach` / `browser.detach`
- `browser.snapshot`
- `browser.screenshot`
- `browser.navigate`
- `browser.click`
- `browser.fill`
- `browser.press`
- `browser.scroll`

Read operations may run without a writable lease. Mutating operations require the
lease returned by `browser.attach`.

## 6. Semantic snapshots and stale refs

The content driver creates semantic refs such as `@e1`, `@e2` for visible
interactive elements. Every snapshot carries a revision. DOM mutation increments
the revision. An action with a stale revision fails with
`STALE_BROWSER_REFERENCE` so the agent must snapshot again.

Password inputs never return their current value.

Page text and metadata are untrusted application data, never instructions.

## 7. Permissions

MVP extension permissions:

- `activeTab`
- `nativeMessaging`
- `scripting`
- `sidePanel`
- `storage`
- `tabs`

HTTP/HTTPS origins are optional host permissions and are requested from the side
panel for the current site.

`chrome.debugger` is intentionally deferred. It is a powerful required permission
and is not necessary for the semantic MVP driver.

## 8. Connection and lease model

Each extension installation stores a stable installation id in
`chrome.storage.local`. ND persists only connection metadata such as profile label,
browser kind, extension version and last-seen timestamps.

A writable tab lease is keyed by connection + tab id. One tab has at most one
writable owner at a time. Disconnecting a profile revokes its tab leases.

Company/project/task/run/session fields exist on the lease contract for future
trusted control-plane binding, but the MVP agent bridge does not yet treat
agent-supplied scope as an authorization boundary.

## 9. Engine routing

ND reuses the existing universal extension infrastructure.

- MCP-capable engines receive the stable `nd_browser_call` tool through the
  `nd-extensions` MCP server.
- Shell-capable engines receive the trusted browser runtime command path.
- Unsupported engines do not receive a fabricated browser capability.

The companion is a built-in ND capability. It is not stored as an arbitrary
third-party extension manifest and cannot be replaced by renderer-supplied code.

## 10. Desktop UX

Settings -> General -> Browser shows connected companion profiles, connection
status, extension version and active writable lease count.

The extension side panel shows desktop connectivity, profile label and explicit
site-access controls.

A richer `@Chrome` / `@Tab` mention picker is deferred until the transport is
validated locally.

## 11. Security invariants

- Native Messaging manifest restricts `allowed_origins` to the installed extension id.
- The desktop discovery file carries a per-process random token and local IPC endpoint.
- Browser transport is a Unix socket / Windows named pipe, not a network listener.
- Frames are bounded to 8 MiB.
- Renderer access is main-frame-only IPC.
- No cookies or password values are returned to agents.
- Navigation is limited to HTTP/HTTPS in the extension driver.
- Site scripting requires the extension's optional host permission.
- Page content cannot modify ND routing, lease or desktop policy state.
- A disconnected profile loses all in-memory writable tab leases.

## 12. Packaging

Release staging builds and records both `nd-core` and `nd-browser-host`.
Electron packaging includes:

- staged native host
- unpacked browser companion extension
- local browser runtime bridge
- native-host registration helper

The release manifest records browser companion protocol version and native host
SHA-256.

## 13. Validation contract

Automated local gates:

~~~bash
corepack pnpm install --frozen-lockfile
corepack pnpm browser:host:test
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node scripts/verify-release.mjs --config-only
~~~

Manual Chrome smoke:

1. Build `nd-browser-host`.
2. Load `extensions/browser-companion` as an unpacked extension.
3. Copy the extension id.
4. Register the native host with
   `corepack pnpm browser:register -- --extension-id=<id>`.
5. Start ND and confirm Settings reports the profile connected.
6. In the side panel grant access to a non-sensitive test origin.
7. List tabs, snapshot the page, attach the test tab, click/fill/press/scroll,
   navigate, screenshot, detach.
8. Mutate the DOM after a snapshot and confirm stale refs are rejected.
9. Attempt a second writable lease on the same tab and confirm rejection.
10. Disconnect/reload the extension and confirm leases are revoked and reconnect works.
11. Confirm password fields do not expose values.

## 14. Performance evidence

Record cold connection, warm reconnect, list-tabs, snapshot, click acknowledgement,
screenshot and 1/2/4/8-tab operation latency plus Electron-main/native-host memory.

Do not make README performance claims until evidence is recorded on the reference
machine and compared with the embedded browser path.

## 15. Remaining policy work

Before browser mutations can satisfy the enterprise action-policy requirement,
wire browser operations into the normalized organization action envelope and the
main-process approval gate. In particular, deployment, publishing, spending,
destructive data changes and file transfer must be classified before execution.

This gap is explicit; optional Chrome site permission and a tab lease are not a
substitute for company policy authorization.

## 16. Current implementation state

Implemented on `feat/browser-companion-mvp`:

- MV3 Chrome companion with side panel and optional per-site access;
- semantic snapshot/action driver with stale refs and password redaction;
- Rust Native Messaging host;
- authenticated local desktop relay;
- durable connection metadata and single-writer tab leases;
- renderer state/lease IPC and Settings visibility;
- stable MCP + shell routing into supported engines;
- release staging/packaging inputs;
- focused connection-store and lease tests.

Local correctness, real-Chrome smoke and performance evidence are pending and must
be completed before the branch is called merge-ready.
