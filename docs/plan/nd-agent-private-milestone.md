# ND Agent private milestone

Status: **private implementation pass complete; validation opt-in available, public promotion still gated**. DeepSeek Harness (`nd-harness`) remains the default and retains existing chats. The stable Rust engine ID is `nd-native`. Set `ND_DSH_NATIVE_PRIVATE_SELECTION=1` only on a validation machine to make the native engine selectable; normal/package defaults remain fail-closed.

## Implemented

- `nd-agent serve --stdio` runs a versioned bidirectional JSON-RPC protocol for sessions, history, turns, cancellation, model catalog, approvals, streamed events, and host tool requests. Session snapshots survive restart; an interrupted turn is marked failed and is never replayed.
- Streaming parsers and request builders cover OpenAI compatible Chat Completions, OpenAI Responses, Anthropic Messages, and the DeepSeek route. Provider credentials travel through the supervised pipe for the turn and are absent from command arguments and session snapshots.
- Electron supervises the sidecar through ND Core, binds native sessions to the existing engine router, routes organization approval responses to the issuing engine, and uses ND's configured provider/model route.
- The trusted tool broker checks the session's workspace or ND task worktree on every call. It exposes bounded read/list, atomic workspace writes, allowlisted Git status/log/diff/add, ND's visible browser, and governed native-host ND extension command/view contributions. Executable extension MCP tools remain on their dedicated deferred bridge and are not misrouted through native hosts. Browser access tokens and extension run credentials are injected trusted-side and are never persisted in model prompts. The broker journals intent before dispatch and marks interrupted effects uncertain on startup. Generic shell remains deliberately unavailable because `cwd` is not an OS sandbox; the engine descriptor truthfully reports `shell: false`.
- The release stage, manifest, and Electron resources include the native binary. The existing Workbench chat can render native session events, and its model picker understands the native model catalog.

## Selection gate

The gate now has two levels:

- **Private validation:** `ND_DSH_NATIVE_PRIVATE_SELECTION=1` plus a present `nd-agent` binary makes `nd-native` selectable. The router independently checks the same private flag before creating a new native session.
- **Normal/package/public:** fail-closed by default. This branch does **not** convert private validation into a release claim; promotion still requires exact-artifact evidence.

Implementation checklist:

- [x] Workspace writes are bounded/atomic and reject absolute paths, traversal, oversized writes, missing parent capabilities, and symlink escapes. Git is restricted to broker-built status/log/diff/add operations. ND native-host command/view extensions use the existing InvocationBroker policy/grant/audit path; executable MCP tool contributions remain unavailable until their dedicated agent bridge exists. Generic shell stays intentionally unavailable and unadvertised because a working directory is not a sandbox.
- [x] Provider connect/stream waits are cancel-aware; cancellation drops the in-flight HTTP future instead of waiting for the 180-second provider timeout.
- [x] Token Saver controls native long-context compaction. Durable events retain a bounded tail and snapshots persist the compacted context without replaying side effects.
- [x] ND-owned Workbench chat is the common renderer for direct-engine sessions, including native sessions, with the existing shared session/event/model/approval/skill/browser/organization surfaces. The embedded Harness surface remains available for vendor-specific runtime work; old Harness sessions keep their original engine ownership.
- [x] Private selection is an explicit operator gate instead of a source-code edit, so the same branch can run the cross-engine matrix without making native the default.
- [ ] **External evidence gate:** run both engines on the same real project/browser journey, old Harness continuation, crash/approval drills, benchmark comparison, and packaged Windows startup on the exact artifact.
- [ ] **Baseline gate:** resolve or deliberately pin around the separate Harness `0.1.7-rc.2` first-turn hang before using Harness results as the comparison baseline. Do not infer a cause from the existing 10-minute hang evidence.

## Remaining validation tasks

1. Run the focused JS/Rust suites plus `verify`, `typecheck`, `build`, and release config checks on the branch.
2. With `ND_DSH_NATIVE_PRIVATE_SELECTION=1`, run the real same-project journey on Harness and ND Agent using the visible ND browser. Record completion, errors, latency, model/token usage, and tool-call counts.
3. Continue an old Harness chat in Workbench, then create/continue a native chat; verify engine ownership never changes on an existing session.
4. Exercise cancel during provider streaming, extension approval-required/retry, nd-core interruption after write intent, and restart recovery. Unreceipted effects must become `uncertain` and must never replay automatically.
5. Build the Windows portable artifact and repeat startup + journey checks against that exact file.
6. Resolve the Harness baseline hang separately. Until then, native validation can proceed, but comparative Harness numbers are not a valid release baseline.

## Validation evidence status

The green commands below belong to checkpoint `ab8ef9e`; they are **not** evidence for the later native milestone implementation/fix commits and must be re-run on the final branch head.

- At `ab8ef9e`: `pnpm verify`, `pnpm typecheck`, `pnpm test` (1,020 passed, 9 skipped), and `pnpm build` passed.
- At `ab8ef9e`: `pnpm core:test` passed, including Rust formatting, strict Clippy, ND Agent unit and stdio tests, and the existing ND Core suites.
- At `ab8ef9e`: `node scripts/verify-release.mjs --config-only` and `git diff --check` passed.
- Current branch head still requires the code gates in `docs/qa/nd-native-private-validation.md`, followed by packaged Windows and real-engine evidence.
