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
- Savings text explains that the visible counter is ND-local; Harness history/tool-result compaction is controlled by the same switch but is not folded into that estimate yet.

## 2. Built-in demo

Click **Run demo**.

Expected:

- No account or network/provider setup is required.
- The button completes with `Demo passed`.
- The demo reports a positive reduction percentage.
- Savings counters increase.
- The demo internally verifies the original synthetic payload can be recovered from its local recovery reference.

## 3. ND-only disable/enable and Harness policy refresh

Turn **Save tokens in ND** off, send one normal ND Harness prompt, then turn it on and send another prompt.

Expected:

- Off selects Mode = Off.
- External apps remains unchanged/off.
- The next Harness prompt/session transparently refreshes the runtime so Harness automatic history compaction + tool-result pruning follow the Off state.
- Turning it back on selects Automatic unless Advanced was previously selected.
- The next Harness prompt/session refreshes the runtime again with the reducers enabled.
- Durable chat history remains available across those runtime refreshes.
- ND continues to run normal chats in either state.

## 4. Advanced quality protection

Select **Advanced**.

Expected:

- Quality protection switch appears.
- It is on by default.
- Returning to Automatic hides the advanced switch without enabling external apps.

## 5. Real Harness long-output smoke

With **Save tokens in ND** on, use an ND Harness session to perform work that produces substantial tool output (for example a noisy test/build command), then continue the conversation long enough to create context pressure.

Expected:

- The Harness remains stable and can continue the task.
- Its pinned replay-safe tool-result pruner/history compactor may reduce old model-visible context under pressure while retaining original events in the durable Harness log.
- The Settings savings number does **not** jump by a guessed Harness amount; only ND-local measured reductions are displayed there.

## 6. External Codex one-click setup

Precondition: network access is available.

Turn **Enable for external apps** on, then enable **Codex**.

Expected:

- ND shows `Setting up…` while working.
- ND downloads the pinned helper itself; no terminal opens.
- The release archive is SHA-256 verified before execution.
- The extracted helper reports the pinned version and ND records its binary SHA-256 for future reuse verification.
- Codex becomes managed/enabled without changing the user's Codex login.
- The built-in ND saver remains usable throughout setup.

## 7. External helper reuse integrity

After external Codex has been enabled once, disable and re-enable it normally.

Expected:

- ND reuses the helper only when its install manifest, pinned release digest, and current binary hash still match.
- A missing/corrupt install manifest or modified helper causes ND to discard that install and obtain a fresh pinned verified copy rather than executing the unverifiable binary.

This integrity path is primarily covered by code/CI review; deliberately tampering with app user-data files is optional advanced QA, not required for normal beta testing.

## 8. External Codex restore

With external Codex enabled, disable the Codex app switch or turn the External apps master switch off.

Expected:

- ND removes/restores the exact Codex integration surface it recorded before enablement.
- Previous Codex `AGENTS.md` / `RTK.md` state is restored where the current files are still ND-managed.
- If the tester deliberately edits one of those managed files after enablement, ND preserves the user-edited file rather than overwriting it on disable.
- Codex authentication remains connected.
- ND built-in Token Saver remains on.

## 9. External setup failure isolation

Block GitHub/release downloads temporarily, then try enabling external Codex on a machine where the helper is not already installed.

Expected:

- ND surfaces an error in the app.
- The external setting rolls back rather than remaining half-enabled.
- **Save tokens in ND** remains on and chats continue to work.

## 10. Codex account

In Accounts, click **Connect** for Codex if it is not already connected.

Expected:

- The official Codex sign-in flow is launched by ND.
- After success, Refresh shows Codex as Connected.
- ND does not ask for an API key.
- Disconnect uses Codex's native logout and does not affect Antigravity.

## 11. Antigravity OAuth

Click **Connect** for Antigravity.

Expected:

- The system browser opens Google authorization.
- After approval, the browser shows `Antigravity connected to ND` and can be closed.
- ND shows Antigravity Connected and displays the Google account email when userinfo is available.
- Restart ND: on macOS/Windows and Linux with secure keyring storage, the account remains connected. On Linux `basic_text` storage, the credential intentionally does not persist.
- Treat this as **account connection only** in this beta; Antigravity project/model bootstrap is not exposed as a routing capability yet.

## 12. Scope/privacy regression

Review the External apps and Accounts sections after testing.

Expected:

- Antigravity external optimization is labeled **Account only** in this beta.
- No Claude/Gemini/other OAuth connect buttons appear.
- No root-certificate or system-proxy permission is requested.
- Savings counters contain only numbers, not prompt/log content.
- Reset clears savings counters without disconnecting accounts or changing app scope.
