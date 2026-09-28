# In-app browser extension runtime — local validation handoff

> Branch: `feat/builtin-browser-extension-manager`
> PR: #60
> Task: 0046
> Runtime: Electron 43.x / ND built-in persistent Chromium session
> Goal: prove Method 2 works inside ND without external Chrome

## 1. Automated gates

From the repository root:

~~~bash
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm browser:platform:test
node scripts/verify-release.mjs --config-only
corepack pnpm bench:browser-runtime
~~~

Record the command, exit code, and timestamp for every gate.

The browser runtime result must show:

- `requirements.coreBrowserPass === true`
- `requirements.extensionBaselinePass === true`
- `requirements.extensionActionPopupPass === true`
- `capabilities.extensions.mv3ActionPopup.loaded === true`
- `capabilities.extensions.mv3ActionPopup.popupLoaded === true`
- `capabilities.extensions.mv3ActionPopup.runtimeAvailable === true`
- `capabilities.extensions.mv3ActionPopup.storageAvailable === true`
- `capabilities.extensions.mv3ActionPopup.tabsQueryAvailable === true`
- `capabilities.extensions.mv3ActionPopup.activeTabMatchesHost === true`
- `capabilities.extensions.mv3ActionPopup.removed === true`

If `activeTabMatchesHost` is false, do **not** paper over it. That means Electron's active-tab semantics are insufficient for Chrome-style popup parity and task 0046 must open a deeper Chromium compatibility item.

## 2. Manual ND popup smoke

Launch the desktop app:

~~~bash
corepack pnpm dev
~~~

Start with the **bundled Method 2 extension**, not an external Chrome package:

1. Open **Settings → General → Browser**.
2. Confirm the Browser control toggle is visible.
3. Open **Extensions → Manage**.
4. Find **ND Browser Tools · ND** under the built-in catalog.
5. Confirm it is available even with Developer mode off.
6. Click **Install**.
7. Before activation, verify the native ND confirmation shows:
   - ND Browser Tools name/version;
   - MV version;
   - requested `storage` and `tabs` permissions;
   - compatibility status/notes;
   - bundled source directory.
8. Cancel once and confirm the extension is **not** installed.
9. Repeat and approve **Load into ND browser**.
10. Open the ND built-in browser on an ordinary HTTP/HTTPS page.
11. Confirm the **puzzle/Extensions** button is in the ND browser toolbar.
12. Open the extension menu and press **Open** for ND Browser Tools.
13. Confirm its popup renders inside the ND desktop window over the built-in browser surface.
14. Confirm the popup shows the underlying website tab title/URL, not a `chrome-extension://` popup URL.
15. Press **Reload active tab** and confirm the underlying ND website tab reloads and the popup closes.
16. Re-open the popup, then click the website/browser chrome and confirm it closes.
17. Switch tabs and confirm the popup closes.
18. Re-open the popup, navigate the website, and confirm it closes.
19. Disable the extension and confirm it can no longer open.
20. Re-enable it and confirm it works again.
21. Restart ND and confirm enabled state and extension identity persist.
22. Remove it and confirm it disappears after restart.

Then exercise the **Developer mode** path separately:

1. Enable Developer mode.
2. Click **Load unpacked**.
3. Select `tests/fixtures/browser-runtime-spike/extensions/mv3-action-popup`.
4. Verify the same pre-activation permission/compatibility confirmation.
5. Approve the load and confirm its action popup also opens inside ND.

## 3. No-external-browser proof

During the entire Method 2 smoke:

- do not select `@Chrome`;
- do not run Browser Companion setup;
- do not import a Chrome profile;
- do not launch `chrome.exe`, Edge, Brave, or another standalone browser for the extension;
- normal Electron/Chromium child processes belonging to ND are expected.

The extension popup URL must be an ND-owned `chrome-extension://<id>/...` page rendered by a `WebContentsView` using `persist:nd-dsh-browser`.

## 4. Compatibility status smoke

Load one small test extension that requests an API outside Electron's documented subset (for example a local fixture using `identity`, `notifications`, or `side_panel`).

Expected result:

- ND still allows an explicit developer load if Electron accepts the package;
- Settings marks it **limited** rather than compatible;
- the native pre-load confirmation names the compatibility reason;
- ND does not claim Chrome Web Store parity.

An action manifest with `default_popup` should say that ND hosts the popup.

An action manifest without `default_popup` should be marked limited because `chrome.action.onClicked` is not hosted yet.

## 5. Catalog identity smoke

**ND Browser Tools** is the Method 2 first-party package and must come only from the bundled ND resources. Its catalog entry must never accept an arbitrary replacement folder.

The **ChatGPT** entry is a compatibility reference to the official standalone-Chrome extension, not the Method 2 implementation. Unless an authorized unpacked package is available, it remains metadata/reference only.

For a verified third-party catalog install:

- ND must verify the manifest public key maps to the expected extension id;
- a mismatched/unverifiable package must be rejected as that vendor catalog item;
- the same folder may still be tested through generic **Load unpacked**, where it is not labeled as vendor-verified;
- ND must never copy a user's Chrome profile to make the catalog install work.

## 6. Evidence to attach to PR #60

Attach:

- automated gate output or concise pass/fail transcript;
- generated browser-runtime JSON;
- one screenshot of Settings → Browser → Extensions;
- one screenshot of the puzzle menu;
- one screenshot of an action popup visibly inside ND;
- process evidence showing no standalone Chrome was required;
- any unsupported API encountered with the exact extension name/version and manifest permission/key;
- confirmation that the packaged/release configuration includes `browser-extensions/nd-browser-tools`.

Only after these gates are green should PR #60 be changed from draft to ready.
