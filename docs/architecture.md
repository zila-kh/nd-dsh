# ND-DSH architecture

## Ownership

| Subsystem | Owner | Notes |
| --- | --- | --- |
| desktop lifecycle | ND-DSH / Electron | windows, IPC, native-view geometry, process shutdown |
| workbench | ND-DSH / React | Explorer, chat, source preview, activity, status |
| visible web runtime | Electron `WebContentsView` | one persistent partition and canonical target |
| browser automation | `agent-browser` | CDP, ARIA snapshots, actions, diagnostics, MCP |
| agent runtime | pinned DeepSeek Harness submodule | loop, model route, tools, sessions, skills, subagents |
| browser tool bridge | DSH MCP client | maps MCP schemas/results into native Harness tools |
| workspace policy | DSH sandbox providers | filesystem and shell capability boundary |

## Process graph

```text
Electron main process
  ├─ renderer process (React, context-isolated preload)
  ├─ WebContentsView renderer (the inspected application)
  ├─ agent-browser daemon/session (attached over loopback CDP)
  └─ DeepSeek Harness JSON-RPC child
       └─ agent-browser MCP child
            └─ same agent-browser session and exact CDP target
```

The direct Electron-to-agent-browser path exists only to bind the visible
target and provide manual snapshots in the UI. Model tool calls travel through
Harness MCP. Both routes use the same generated config and session name.

## Same-browser invariant

A CDP port identifies Electron's browser process, not one tab. ND-DSH therefore
asks the embedded view's `webContents.debugger` for `Target.getTargetInfo`, then
selects that exact `targetId` in `agent-browser`.

A new strict pinned session can create a fresh target before it has a binding.
ND-DSH avoids that by selecting the view once with `--no-pin-tab`, then issuing
a command with `--pin-tab`. The resulting session persists the exact target;
later CLI and MCP commands cannot silently adopt another renderer.

## Harness boundary

ND-DSH imports only the built TypeScript SDK client from the pinned submodule.
The SDK owns a JSON-RPC subprocess that boots the upstream runtime with the
external `configs/dsh/cordis.yml`. No Harness core source is patched.

The project composition adds:

- DeepSeek adapter and model route
- JSONL persistence, checkpoints, token metering, and compaction
- workspace-scoped filesystem and cross-platform shell providers
- local skills, workspace instructions, jobs, and todo tools
- in-process spawn/fork subagents
- `@deepseek-ai/dsh-mcp-client` configured for `agent-browser mcp`

This keeps upstream updates reviewable as one explicit submodule/pin change.

## Trust boundaries

### Renderer

The React process has no Node integration. The preload exposes only typed,
capability-specific methods. Main-process IPC rejects calls from any sender
other than the workbench's main frame and validates strings, paths, and native
view bounds.

### Workspace

The Explorer is read-only in the MVP. Paths are resolved beneath the selected
root, then checked again after `realpath`; symbolic links are not exposed.
Model-facing write/edit and shell capabilities come from Harness sandbox
providers, not renderer IPC.

### Browser

The embedded page has its own persistent partition, no Node integration, and no
permission grants. CDP is bound to loopback. Browser MCP remains privileged
because page storage, cookies, console output, screenshots, and network payloads
may contain secrets.

### Approvals

The SDK automation protocol currently has no desktop human-approval responder.
The Harness approval policy is therefore `never`. Workspace-contained actions
run according to the selected sandbox mode; escalation requests are rejected
without hanging. A renderer approval channel is a later milestone.

## Failure behavior

- Missing `agent-browser`: the native browser still loads and navigates; manual
  automation status becomes `unavailable`, and agent turns fail before launch.
- Missing or unbuilt Harness submodule: chat reports the exact missing SDK or
  runtime path; the browser remains usable.
- Missing API key: the workbench shows a setup warning; the upstream adapter
  reports the model error on use.
- Browser MCP startup failure: Harness startup fails loudly because the browser
  is a required capability; the visible browser remains manually usable.
- Initial localhost page unavailable: the pane records the load failure and the
  user can navigate later.
- App quit or window close: the SDK performs protocol shutdown and subprocess
  escalation; Electron waits for every active close operation before exit.

## Extension path

Monaco/LSP, terminal, Git, Problems, approval dialogs, and session history should
be added as UI projections over Harness services or narrow Electron IPC
adapters. They must not introduce a second browser, bypass workspace policy, or
patch the Harness agent loop.
