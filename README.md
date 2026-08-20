# ND-DSH

A Cursor-style Electron IDE shell that gives DeepSeek Harness a live, embedded
browser without reimplementing browser automation.

The operator and the agent share **the same Chromium target**:

```text
React workbench
  ├─ Agent chat ── TypeScript DSH SDK ── DeepSeek Harness subprocess
  │                                      └─ DSH MCP client
  │                                           └─ agent-browser MCP
  └─ Browser pane ── Electron WebContentsView ◄── exact CDP target pin
```

## Implemented vertical slice

- secure Electron desktop shell with a React workbench
- native `WebContentsView` browser pane inside the IDE
- exact CDP target discovery, selection, and strict reattachment
- `agent-browser` accessibility snapshots, interactions, console, network,
  cookies, storage, tabs, screenshots, and React diagnostics through MCP
- DeepSeek Harness as a **pinned Git submodule**, driven through its official
  TypeScript SDK and stdio JSON-RPC runtime
- workspace-scoped filesystem and shell providers
- DSH skills, persistence, checkpointing, compaction, jobs, and in-process
  subagents
- Explorer, read-only source preview, agent activity, browser toolbar, and
  manual snapshot output
- persistent browser profile and DSH sessions under Electron application data

DeepSeek Harness is intentionally not forked. Its source lives at
`vendor/deepseek-harness`, currently pinned to commit
`141eb6fef83422698aef7a981029e843e8161534` (`0.1.0-rc.8`). The machine-readable
pin is `vendor/deepseek-harness.json`; the Git index stores the same commit as a
submodule gitlink.

## Requirements

- Node.js 24+
- Corepack and pnpm 11
- Git
- a DeepSeek API key for real model turns
- macOS, Linux, or Windows

`agent-browser` attaches to Electron Chromium over CDP, so ND-DSH does **not**
start a second hidden browser for agent tasks.

## First run

From a Git clone:

```bash
git clone --recursive <your-private-repo-url> nd-dsh
cd nd-dsh
corepack enable
cp .env.example .env
# Add DEEPSEEK_API_KEY to .env
corepack pnpm bootstrap
corepack pnpm dev
```

From the downloadable source archive, extract it and run the same setup
commands. `bootstrap` detects the absence of repository metadata and clones the
exact Harness commit recorded in `vendor/deepseek-harness.json`.

Bootstrap performs four operations:

1. initializes and verifies the Harness pin;
2. installs ND-DSH desktop dependencies;
3. installs and builds the independent Harness workspace;
4. runs repository verification.

Later starts only need:

```bash
corepack pnpm dev
```

Start the web app you want to inspect at `http://localhost:5173`, or set
`ND_DSH_BROWSER_URL` in `.env`. If that server is not running yet, the desktop
still opens and the address bar remains usable.

## Runtime flow

1. Electron starts with a loopback-only remote-debugging port.
2. A persistent `WebContentsView` loads the configured app URL.
3. Electron asks CDP for that view's exact target id.
4. The desktop selects that target once without strict pinning, then enables
   strict `agent-browser` tab pinning for all later CLI and MCP calls.
5. When the user sends a prompt, the official TypeScript DSH SDK lazily starts
   the pinned Harness JSON-RPC runtime.
6. DSH's MCP client launches `agent-browser mcp` with the same config and
   session, so every model browser action appears in the visible pane.

The MCP tools are exposed to the model as
`mcp__browser__agent_browser_<action>`. The project skill at
`.dsh/skills/live-browser/SKILL.md` teaches snapshot-first interaction using
semantic accessibility references.

## Configuration

Copy `.env.example` to `.env` and edit as needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | required for model turns |
| `ND_DSH_PROVIDER` | `deepseek-official` | Harness provider route |
| `ND_DSH_MODEL` | `deepseek-v4-flash` | Harness model |
| `ND_DSH_MAX_TOKENS` | `49152` | maximum output tokens per model request |
| `ND_DSH_BROWSER_URL` | `http://localhost:5173` | initial visible page |
| `ND_DSH_CDP_PORT` | `9222` | loopback CDP port |
| `ND_DSH_WORKSPACE` | process cwd | initial workspace |
| `ND_DSH_PERMISSION_MODE` | `workspace-write` | `read-only`, `workspace-write`, or `danger-full-access` |
| `ND_DSH_HARNESS_ROOT` | `vendor/deepseek-harness` | optional upstream checkout override |
| `ND_DSH_NODE_BIN` | `node` | Node 24 executable used for the Harness child |

The complete Harness composition is `configs/dsh/cordis.yml`. ND-DSH owns that
composition while all Harness implementation remains in the submodule.

## Security model

- CDP listens on `127.0.0.1`, not the LAN.
- browser permission prompts are denied by default.
- renderer Node integration is disabled; context isolation and sandboxing are
  enabled.
- renderer IPC is limited to the main workbench frame and validated inputs.
- workspace reads reject traversal and symbolic-link escapes.
- filesystem mutations and shell commands default to the DSH
  `workspace-write` sandbox policy.
- interactive Harness approvals are not bridged in this MVP. The approval
  policy is therefore `never`: workspace-contained operations can run, while
  requests for sandbox escalation fail closed.
- cookies, storage, console output, screenshots, and network bodies can contain
  secrets; browser MCP tools are privileged local capabilities.
- the MCP stdio command is trusted executable code started outside the model's
  sandbox. Keep both upstream pins reviewed.

Use `ND_DSH_PERMISSION_MODE=read-only` when inspecting an untrusted workspace.
Use `danger-full-access` only for an explicitly trusted project and host.

## Development checks

```bash
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

`pnpm verify` can run before dependency installation. It checks pins, submodule
metadata, Cordis composition, security invariants, relative imports, Node script
syntax, CSS brace balance, and TypeScript transpile syntax when a TypeScript
installation is available. The remaining commands require a completed
bootstrap.

## Updating DeepSeek Harness

Never update the submodule by implicitly following `master`. Supply a reviewed
tag or full commit explicitly:

```bash
corepack pnpm run dsh:update -- <tag-or-commit>
corepack pnpm bootstrap
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The update command checks out the fetched ref detached and records the resulting
full SHA and release in the pin metadata. Review upstream breaking changes and
ND-DSH adapters before committing the updated gitlink.

## MVP boundaries

This scaffold intentionally does not reimplement Chromium, CDP, accessibility
snapshots, click targeting, console capture, or network capture. It also does
not yet include Monaco, a writable editor surface, a PTY terminal, LSP UI, Git
panels, approval dialogs, extension packaging, or signed installers. Future IDE
surfaces should project Harness services through narrow IPC contracts without
introducing a second browser or patching the Harness agent loop.

See [`docs/architecture.md`](docs/architecture.md) for subsystem ownership and
failure boundaries, and [`docs/roadmap.md`](docs/roadmap.md) for the next
milestones.
