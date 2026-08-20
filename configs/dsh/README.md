# DSH profile

`cordis.yml` is the complete runtime composition used by the Electron app's
official TypeScript SDK client. It intentionally stays outside the DeepSeek
Harness submodule so upstream updates remain a pinned-submodule review.

The `browser-mcp` row starts `agent-browser mcp` with the config and session
written by Electron. Electron first selects the `WebContentsView` CDP target and
then enables strict tab pinning, so MCP calls operate on the visible pane rather
than a second Chromium process.

Filesystem and shell providers use `workspace-write` by default. Set
`ND_DSH_PERMISSION_MODE=read-only` to disable model-driven mutations. The SDK
transport does not yet expose a human approval responder, so the profile uses
`policy: never`: workspace-contained actions can run, while escalation fails
closed. `danger-full-access` removes the sandbox boundary and must be an
explicit trusted-host choice.
