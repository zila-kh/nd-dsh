# ND-DSH architecture

## Ownership

| Subsystem | Owner | Notes |
| --- | --- | --- |
| desktop lifecycle | ND-DSH / Electron | windows, IPC, native-view geometry, process shutdown |
| workbench | ND-DSH / React | sessions, chat, explorer, source preview, activity, status |
| DeepSeek UI surface | ND-DSH / WebContentsView | official harness UI on the loopback gateway origin |
| visible web runtime | Electron `WebContentsView` | one persistent partition and canonical target |
| browser automation | `agent-browser` | CDP, ARIA snapshots, actions, diagnostics, MCP |
| agent runtime | pinned DeepSeek Harness submodule | `web` profile + ND-DSH patch overlay; loop, tools, sessions, presets |
| gateway transport | ND-DSH / main process | HTTP RPC + WebSocket events to the runtime's `/api` |
| browser tool bridge | DSH MCP client | maps MCP schemas/results into native Harness tools |
| workspace policy | DSH sandbox providers | filesystem and shell capability boundary |

## Process graph

```text
Electron main process
  ├─ renderer process (React workbench, context-isolated preload)
  ├─ WebContentsView renderer (the inspected application — canonical browser)
  ├─ WebContentsView renderer (official DeepSeek UI surface, loopback origin)
  ├─ agent-browser session (attached over loopback CDP)
  └─ DeepSeek Harness child: dsh --profile web --patch configs/dsh/nd-dsh.patch.yml
       ├─ web server + /api gateway + official UI dist (127.0.0.1:<port>)
       ├─ gateway client in the main process (HTTP RPC + WebSocket events)
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

ND-DSH never imports harness code at build time and never patches the pinned
submodule. It launches the upstream `web` profile through the harness's own
CLI launcher and applies two ND-DSH-owned artifacts:

- `configs/dsh/nd-dsh.patch.yml` — a `--patch` overlay pinning the sandbox to
  the selected workspace, enabling durable full-text session search, making
  `nd-dsh` the default preset, and mounting the `browser-mcp` row
  (`@deepseek-ai/dsh-mcp-client` → `agent-browser mcp`).
- `configs/dsh/agent-presets/nd-dsh/` — the ND-DSH agent preset (standard
  toolset, ND-DSH persona, bundled `live-browser` skill), installed into the
  harness-home user preset root at launch. The shipped `standard`, `code`
  (PTC/code mode), and `cordis` (creator mode) presets remain available.

The desktop then drives the runtime over the loopback gateway
(`src/main/dsh/gateway-client.ts`): unary RPCs on `POST /api/<method>`,
answerable frames (approvals, questions) on `POST /api/respond`, and live
events over the `/api/events.mux` and `/api/events.host` WebSocket downlinks.
This keeps upstream updates reviewable as one explicit submodule/pin change.

## Surfaces

The default surface is the official DeepSeek UI: the harness serves it at the
gateway origin, and `src/main/dsh/dsh-surface.ts` hosts it in a sandboxed,
preload-free `WebContentsView` whose navigation is pinned to that origin. The
ND-DSH workbench surface shares the same runtime and session store: sessions
created in either surface appear in both, and the Explorer rail plus the
Browser tab stay available in both. The choice persists in `settings.json`
(`surface: dsh | workbench`).

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
permission grants. CDP is bound to loopback (auto-picked unless pinned). The
official DeepSeek UI view gets the same hardening plus an origin-locked
navigation guard; it is a product surface, never the agent browser. Browser
MCP remains privileged because page storage, cookies, console output,
screenshots, and network payloads may contain secrets.

### Approvals

The engine approval policy is the default `ask`. Approval frames stream over
the gateway event downlink; the official DeepSeek UI answers them directly,
and the ND-DSH workbench renders allow-once/reject cards answered through
`POST /api/respond`. Escalation requests never hang: with no answerer the
engine fails closed.

## Failure behavior

- Missing `agent-browser`: the native browser still loads and navigates; manual
  automation status becomes `unavailable`, and agent turns fail before launch.
- Missing or unbuilt Harness submodule: the workbench reports the exact missing
  CLI/runtime path; the browser remains usable.
- Missing API key: the workbench shows a setup warning; the upstream adapter
  reports the model error on use.
- Browser MCP startup failure: Harness startup fails loudly because the browser
  is a required capability; the visible browser remains manually usable.
- Initial localhost page unavailable: the pane records the load failure and the
  user can navigate later.
- App quit or window close: the harness child is terminated (graceful on
  POSIX, direct kill on Windows); durable sessions survive either way.

## Extension path

Monaco/LSP, a writable editor, terminal, Git, a trajectory event-ledger tab,
and packaging should be added as UI projections over Harness services or
narrow Electron IPC adapters. Engine-facing features belong in ND-DSH-owned
Harness plugins or patch-overlay rows. They must not introduce a second
browser, bypass workspace policy, or patch the Harness agent loop.
