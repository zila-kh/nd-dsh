# Task 0046 — First-class in-app browser extension runtime

> Owner: ND browser
> Status: implementation in progress on `feat/builtin-browser-extension-manager`; local validation pending
> Priority: P0
> PRD: [0005 — Unified Browser Platform](../prd/0005-unified-browser-platform.md)
> Depends on: 0020, 0022, 0026

## Objective

Make extension support a first-class capability of the **ND built-in browser**, not a delegation to external Chrome.

Method 1 / Browser Companion remains available for users who explicitly want their existing Chrome/Chromium profile. This task prioritizes Method 2: extensions loaded into the ND-owned persistent Chromium session and surfaced through ND browser chrome.

## Product contract

- The canonical runtime remains the visible ND `WebContentsView` browser.
- Extension packages load into `persist:nd-dsh-browser`.
- No `chrome.exe`, Edge, Brave, or external browser process is launched to run a built-in extension.
- No external Chrome profile is imported silently.
- The browser toolbar exposes an Extensions button.
- MV3/MV2 action metadata is read from `action`, `browser_action`, or `page_action`.
- `action.default_popup` opens in a sandboxed `WebContentsView` inside the ND window and uses the same ND browser session.
- Popup navigation is constrained to the extension origin; HTTP/HTTPS popup windows are redirected to a normal ND browser tab.
- Popup teardown occurs on blur, browser navigation, tab switches, browser hiding, extension disable/remove/reload, and shutdown.
- Settings provides Browser enable/disable, Developer mode, Load unpacked, reload/update, catalog, enable/disable, remove, permissions/status, and compatibility messaging.
- Before first activation, ND parses the manifest and shows a native confirmation with extension identity, requested permissions, compatibility status/notes, and source path; cancel leaves the extension unloaded.
- Unsupported Chrome APIs remain an explicit compatibility limitation; ND does not claim full Chrome Web Store parity.

## Built-in catalog

Method 2 has a real first-party bundled reference extension:

- **ND Browser Tools** — source under `resources/browser-extensions/nd-browser-tools/`, packaged as an Electron `extraResource`, and run only in `persist:nd-dsh-browser`.
- It exercises the ND-hosted action popup, `chrome.storage.local`, active-tab lookup, and tab reload without Native Messaging or an external browser.

The catalog may also contain third-party compatibility references such as the official ChatGPT Chrome extension id. Those references are **not** the implementation of Method 2 and ND must not redistribute proprietary Web Store packages without authorization.

Catalog package policies are explicit:

- `bundled` — first-party/trusted package must ship with the ND build and cannot be replaced by an arbitrary user folder;
- `reference-only` — third-party/store metadata can be shown for compatibility research, but ND does not install or authenticate an arbitrary unpacked folder as that publisher.

Third-party folders can still be loaded through Developer mode as generic unpacked extensions, but ND does not label them as the vendor catalog item. Matching a public manifest key/extension id alone is not treated as publisher authentication. Neither path launches Chrome or imports a Chrome profile. A third-party catalog listing opens in a normal **ND built-in browser tab**, not the system browser.

## Validation

Automated runtime evidence now includes an MV3 action-popup fixture that verifies:

- extension load;
- `chrome-extension://` popup page load in an ND-owned `WebContentsView`;
- `chrome.runtime` availability;
- `chrome.storage.local` availability;
- partial `chrome.tabs.query({ active: true })` availability from the popup;
- `chrome.tabs.reload` availability for the active ND tab;
- the popup's active-tab query resolves to the underlying ND website tab rather than the popup surface itself;
- clean extension unload.

Required before merge:

- `pnpm verify`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm bench:browser-runtime`
- manual Windows smoke with one representative unpacked MV3 extension containing `action.default_popup`

## Follow-up ceiling

If representative extensions require Chrome APIs Electron does not expose, record the missing API surface explicitly. Do not fall back to external Chrome for Method 2. Instead, open a runtime-compatibility task for a deeper Chromium integration or maintained Chromium fork behind the same ND `BrowserTarget` contract.


## Handoff

- Local validation: [In-app browser extension runtime](../plan/in-app-browser-extension-local-validation.md)
- Keep PR #60 draft until the handoff evidence is recorded.
