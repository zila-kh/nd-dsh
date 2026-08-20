# Roadmap

## Milestone 1 — vertical slice (this repository)

- Secure Electron/React shell.
- One visible `WebContentsView`.
- Exact CDP target binding.
- agent-browser MCP on the shared target.
- Pinned DeepSeek Harness submodule and SDK adapter.
- Workspace explorer, source preview, agent chat, persistence, and subagents.

## Milestone 2 — real coding workspace

1. Replace the source preview with Monaco.
2. Add controlled read/write/edit IPC with optimistic conflict checks.
3. Start one language-server supervisor per workspace and map diagnostics, symbols, definitions, references, rename, and code actions into Monaco.
4. Add a PTY terminal surface with process-group cleanup and explicit shell permissions.
5. Add Problems, Output, and Git panels.

Success criterion: the user can implement and validate a normal web change without leaving the application.

## Milestone 3 — browser product surface

1. Render a desktop tab strip backed by agent-browser target ids.
2. Add console and network drawers fed by the same controller.
3. Add viewport presets, device emulation, screenshot history, and element highlight overlays.
4. Add a visible action timeline that links each Harness tool call to browser state before and after execution.
5. Add per-origin permission controls and ephemeral/private browser profiles.

Success criterion: every browser action is observable, attributable, and recoverable by the user.

## Milestone 4 — permissions and sessions

1. Bridge Harness approval and question requests into renderer dialogs.
2. Resume/list/fork sessions when the SDK protocol exposes the necessary methods.
3. Surface subagent trees, goals, plans, and background jobs.
4. Add secrets storage through the operating-system credential vault.
5. Add workspace trust and policy presets.

Success criterion: long-running work is safe to interrupt, inspect, approve, and resume.

## Milestone 5 — distribution

1. Add electron-builder or Electron Forge packaging.
2. Sign and notarize macOS builds; sign Windows builds.
3. Bundle or acquire a compatible Harness runtime and agent-browser binary per platform.
4. Add SBOM, third-party notices, update signatures, crash reporting, and release provenance.
5. Add automated smoke tests that launch Electron, bind the visible target, and drive a deterministic local fixture through MCP.

Success criterion: a clean machine can install, launch, update, and verify ND DSH without a developer toolchain.
