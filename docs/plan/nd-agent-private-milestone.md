# ND Agent private milestone

Status: **paused at a private implementation milestone; unavailable for selection**. DeepSeek Harness (`nd-harness`) remains the default and retains existing chats. The stable Rust engine ID is `nd-native`. This branch is a checkpoint, not a release candidate.

## Implemented

- `nd-agent serve --stdio` runs a versioned bidirectional JSON-RPC protocol for sessions, history, turns, cancellation, model catalog, approvals, streamed events, and host tool requests. Session snapshots survive restart; an interrupted turn is marked failed and is never replayed.
- Streaming parsers and request builders cover OpenAI compatible Chat Completions, OpenAI Responses, Anthropic Messages, and the DeepSeek route. Provider credentials travel through the supervised pipe for the turn and are absent from command arguments and session snapshots.
- Electron supervises the sidecar through ND Core, binds native sessions to the existing engine router, routes organization approval responses to the issuing engine, and uses ND's configured provider/model route.
- The trusted tool broker checks the session's workspace or ND task worktree on every call. Its currently exposed tools use ND Core's bounded workspace read/list and ND's visible browser platform. Browser access tokens are injected by the broker, not persisted in model prompts. The broker journals intent before dispatch and marks interrupted effects uncertain on startup.
- The release stage, manifest, and Electron resources include the native binary. The existing Workbench chat can render native session events, and its model picker understands the native model catalog.

## Selection gate

`CodingEngineRegistry` reports `nd-native` as unavailable and `EngineSessionRouter` rejects new native sessions. Existing sessions identified by the stable ID still route to their owner. Do not lift this gate until all items below pass.

- [ ] Add workspace writes, shell, Git, and ND extension calls through verified workspace-scoped host policies. The current broker rejects these actions and the Rust model tool catalog does not advertise them.
- [ ] Make provider requests promptly cancelable even while a blocking network read is waiting. Approval and host response waits are cancelable now.
- [ ] Add long-context pruning and compaction controlled by Token Saver, with bounded durable history and recovery tests.
- [ ] Finish the ND-owned full coding screen using the Workbench chat and activity components, including sessions, approvals, presets, skills, browser work, and organization tasks. Keep the embedded Harness screen until this screen covers ND's exposed workflows and old Harness chats can be continued there.
- [ ] Run both engines through the same real project and visible-browser journeys, including old Harness chat continuation, crash/approval drills, and packaged Windows startup. Compare completion rate, errors, latency, token use, and tool calls with ND's task benchmark framework.
- [ ] Diagnose the separate Harness first-turn hang recorded in `release-0.0.1-checklist.md` before treating Harness as a baseline. The existing evidence shows a connected stream and a 10-minute running turn but does not establish a root cause.

## Resume tasks

1. Add a bounded, atomic workspace write primitive to ND Core using a directory capability. Reject absolute paths, parent traversal, oversized writes, and symlink escapes on Windows and Unix. Wire it through the trusted broker only after a session/worktree check and an effect-journal intent. Exercise crash and uncertain-outcome cases; never replay a write automatically.
2. Define narrow shell, Git, skill, and extension broker operations using existing ND policy and approval services. Keep tool names out of the Rust model catalog until their host paths and effect handling are verified. Treat process commands as potentially able to leave `cwd`; a working directory alone is not a sandbox.
3. Replace the blocking provider read path so cancellation interrupts a live HTTP stream. Add deterministic tests for provider disconnects, malformed tool calls, retries, and cancellation while receiving data.
4. Implement token budget management: bounded tool results and durable history, pruning, and Token Saver controlled compaction. Test restart and resumption without repeating side effects.
5. Build the ND-owned coding screen from Workbench components and route both `nd-harness` and `nd-native` sessions through it. Check sessions, messages, tool activity, approvals, model choices, presets, skills, browser work, and organization tasks before removing the vendor screen.
6. Verify old Harness chat continuation, both engines on one real project and ND's visible browser, benchmark measures, and packaged Windows startup. Run the required JS and Rust checks. Only then make `nd-native` selectable; keep `nd-harness` the default unless separately decided.

The workspace-write experiment started after this milestone was removed before this checkpoint because it had no broker wiring or verification.

## Checks run on this milestone

- `pnpm verify`, `pnpm typecheck`, `pnpm test` (1,020 passed, 9 skipped), and `pnpm build` passed at checkpoint.
- `pnpm core:test` passed at checkpoint, including Rust formatting, strict Clippy, ND Agent unit and stdio tests, and the existing ND Core suites.
- `node scripts/verify-release.mjs --config-only` and `git diff --check` passed. Full release staging and packaged end-to-end checks remain open.
