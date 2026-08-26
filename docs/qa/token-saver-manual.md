# Token Saver — manual beta QA

Branch: `feat/token-saver`

The feature is designed for non-technical users. All setup below is performed from ND Desktop; a tester should not need Terminal, environment variables, or config-file edits.

## 1. Fresh-start defaults

Open **Settings → Coding engines**.

Expected:

- Token Saver appears above Coding engines.
- **Save tokens in ND** is on.
- Mode is **Automatic**.
- **Enable for external apps** is off.
- Accounts shows exactly **Codex** and **Antigravity**.

## 2. Built-in demo

Click **Run demo**.

Expected:

- No account or network/provider setup is required.
- The button completes with `Demo passed`.
- The demo reports a positive reduction percentage.
- Savings counters increase.
- The demo internally verifies the original synthetic payload can be recovered from its local recovery reference.

## 3. ND-only disable/enable

Turn **Save tokens in ND** off, then on again.

Expected:

- Off selects Mode = Off.
- External apps remains unchanged/off.
- Turning it back on selects Automatic unless Advanced was previously selected.
- ND continues to run normal chats in either state.

## 4. Advanced quality protection

Select **Advanced**.

Expected:

- Quality protection switch appears.
- It is on by default.
- Returning to Automatic hides the advanced switch without enabling external apps.

## 5. External Codex one-click setup

Precondition: network access is available.

Turn **Enable for external apps** on, then enable **Codex**.

Expected:

- ND shows `Setting up…` while working.
- ND downloads the pinned helper itself; no terminal opens.
- The helper is checksum-verified before execution.
- Codex becomes managed/enabled without changing the user's Codex login.
- The built-in ND saver remains usable throughout setup.

## 6. External Codex restore

With external Codex enabled, disable the Codex app switch or turn the External apps master switch off.

Expected:

- ND runs the managed uninstall path.
- ND removes its managed Codex Token Saver integration.
- Previous Codex `AGENTS.md` / `RTK.md` state is restored where safe.
- Codex authentication remains connected.
- ND built-in Token Saver remains on.

## 7. External setup failure isolation

Block GitHub/release downloads temporarily, then try enabling external Codex on a machine where the helper is not already installed.

Expected:

- ND surfaces an error in the app.
- The external setting rolls back rather than remaining half-enabled.
- **Save tokens in ND** remains on and chats continue to work.

## 8. Codex account

In Accounts, click **Connect** for Codex if it is not already connected.

Expected:

- The official Codex sign-in flow is launched by ND.
- After success, Refresh shows Codex as Connected.
- ND does not ask for an API key.
- Disconnect uses Codex's native logout and does not affect Antigravity.

## 9. Antigravity OAuth

Click **Connect** for Antigravity.

Expected:

- The system browser opens Google authorization.
- After approval, the browser shows `Antigravity connected to ND` and can be closed.
- ND shows Antigravity Connected and displays the Google account email when userinfo is available.
- Restart ND: on macOS/Windows and Linux with secure keyring storage, the account remains connected. On Linux `basic_text` storage, the credential intentionally does not persist.

## 10. Scope/privacy regression

Review the External apps and Accounts sections after testing.

Expected:

- Antigravity external optimization is labeled **Account only** in this beta.
- No Claude/Gemini/other OAuth connect buttons appear.
- No root-certificate or system-proxy permission is requested.
- Savings counters contain only numbers, not prompt/log content.
- Reset clears savings counters without disconnecting accounts or changing app scope.
