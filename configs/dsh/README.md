# DSH composition

ND-DSH boots the official DeepSeek Harness `web` profile — the base and web-app
bundle layers, the official browser UI, and the HTTP API gateway — and applies
`nd-dsh.patch.yml` as a `--patch` overlay on top. Everything here intentionally
stays outside the DeepSeek Harness submodule so upstream updates remain a
pinned-submodule review.

The desktop launch is:

```
node <harness>/apps/cli/lib/bin.js --profile web --patch configs/dsh/nd-dsh.patch.yml --no-open --port <port>
```

- **`nd-dsh.patch.yml`** pins the sandbox to the workspace the desktop selected,
  enables full-text session search, makes `nd-dsh` the default agent preset, and
  mounts the `browser-mcp` row: `agent-browser mcp` runs with the config and
  session written by Electron. Electron first selects the `WebContentsView` CDP
  target and then enables strict tab pinning, so MCP calls operate on the
  visible pane rather than a second Chromium process.
- **`agent-presets/nd-dsh/`** is the ND-DSH agent preset (the standard coding
  toolset plus the ND-DSH persona and the bundled `live-browser` skill). The
  desktop installs it into the harness-home user preset root at launch; the
  shipped `standard`, `code` (PTC/code mode), and `cordis` (creator mode)
  presets remain available from the launcher's system root.

Filesystem and shell providers use `workspace-write` by default. Set
`ND_DSH_PERMISSION_MODE=read-only` to disable model-driven mutations. Human
approvals follow the engine default (`ask`): the official DeepSeek UI answers
them directly, and the ND-DSH workbench answers through the gateway `respond`
endpoint. `danger-full-access` removes the sandbox boundary and must be an
explicit choice.
