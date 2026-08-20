# ND-DSH

A Cursor-style Electron IDE that shells the complete DeepSeek Harness product —
its official web UI, agent presets (Creator mode, Code mode), approvals,
sessions, and the HTTP API gateway — and adds the differentiators the harness
does not ship: a live embedded browser pane, a file explorer, and a workbench
layout, all on **one engine**.

The operator and the agent share **the same Chromium target**:

```text
One DeepSeek Harness runtime (dsh --profile web + ND-DSH patch overlay)
  ├─ official DeepSeek UI  ── WebContentsView ── http://127.0.0.1:<gateway>
  ├─ ND-DSH workbench ── React ── narrow IPC ── gateway client (HTTP + WebSocket)
  │                                             └─ /api sessions, approvals, presets, models
  └─ browser MCP ── agent-browser ── visible WebContentsView ◄── exact CDP target pin
```

A Settings toggle picks the active surface (default: the official DeepSeek UI);
the workbench chrome — Explorer and the Browser tab — stays available in both.

## Implemented

- secure Electron desktop shell with two surfaces: the official DeepSeek
  Harness UI (served by the runtime on loopback) and the ND-DSH workbench
- native `WebContentsView` browser pane inside the IDE
- exact CDP target discovery, selection, and strict reattachment
- `agent-browser` accessibility snapshots, interactions, console, network,
  cookies, storage, tabs, screenshots, and React diagnostics through MCP
- DeepSeek Harness as a **pinned Git submodule**, booted through its own
  `web` profile plus ND-DSH's `--patch` overlay — no fork, no patch
- real sessions sidebar (list/create/resume/history), streamed assistant
  chunks, tool cards, todos, approval cards, and user-question cards in the
  workbench
- agent presets: ND-DSH default, shipped standard, code (PTC), and cordis
  (Creator mode), with a Presets settings tab
- per-session model selection and reasoning effort, process-level permission
  modes, real changed-files banner from fs tool events
- workspace-scoped filesystem and shell providers, skills, persistence,
  checkpointing, compaction, jobs, and in-process subagents
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

1. Electron starts with a loopback-only remote-debugging port (auto-picked
   unless `ND_DSH_CDP_PORT` pins one).
2. A persistent `WebContentsView` loads the configured app URL.
3. Electron asks CDP for that view's exact target id.
4. The desktop selects that target once without strict pinning, then enables
   strict `agent-browser` tab pinning for all later CLI and MCP calls.
5. On first use (eagerly when the DeepSeek surface is active), the desktop
   spawns the pinned harness CLI: `dsh --profile web --patch
   configs/dsh/nd-dsh.patch.yml --no-open --port <free port>`. The runtime
   serves the official UI and the `/api` gateway on loopback.
6. The official UI surface renders that origin in a sandboxed
   `WebContentsView`; the workbench drives the same gateway over HTTP and
   receives live events over the `/api/events.*` WebSocket downlinks.
7. DSH's MCP client launches `agent-browser mcp` with the same config and
   session, so every model browser action appears in the visible pane.

The MCP tools are exposed to the model as
`mcp__browser__agent_browser_<action>`. The `live-browser` skill (bundled in
the ND-DSH preset and in `.dsh/skills/`) teaches snapshot-first interaction
using semantic accessibility references.

## Configuration

Copy `.env.example` to `.env` and edit as needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | required for model turns |
| `ND_DSH_PROVIDER` | `deepseek-official` | Harness provider route |
| `ND_DSH_MODEL` | `deepseek-v4-flash` | Harness model |
| `ND_DSH_MAX_TOKENS` | `49152` | maximum output tokens per model request |
| `ND_DSH_BROWSER_URL` | `http://localhost:5173` | initial visible page |
| `ND_DSH_CDP_PORT` | auto-picked | loopback CDP port |
| `ND_DSH_WORKSPACE` | process cwd | initial workspace |
| `ND_DSH_PERMISSION_MODE` | `workspace-write` | `read-only`, `workspace-write`, or `danger-full-access` |
| `ND_DSH_HARNESS_ROOT` | `vendor/deepseek-harness` | optional upstream checkout override |
| `ND_DSH_PATCH` | `configs/dsh/nd-dsh.patch.yml` | optional overlay override |
| `ND_DSH_NODE_BIN` | `node` | Node 24 executable used for the Harness child |

ND-DSH owns the composition — the patch overlay at
`configs/dsh/nd-dsh.patch.yml` and the preset at
`configs/dsh/agent-presets/nd-dsh/` — while all Harness implementation remains
in the submodule.

## Security model

- the harness gateway binds `127.0.0.1` only; the desktop never passes
  `--host`.
- CDP listens on `127.0.0.1`, not the LAN.
- browser permission prompts are denied by default.
- renderer Node integration is disabled; context isolation and sandboxing are
  enabled; the DeepSeek UI view gets the same hardening.
- renderer IPC is limited to the main workbench frame and validated inputs;
  gateway RPCs pass a method-name allowlist.
- workspace reads reject traversal and symbolic-link escapes.
- filesystem mutations and shell commands default to the DSH
  `workspace-write` sandbox policy.
- interactive Harness approvals follow the engine default (`ask`): the
  official UI answers them directly, and the workbench answers through the
  gateway `respond` endpoint.
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
metadata, the patch overlay and preset composition, security invariants,
relative imports, Node script syntax, CSS brace balance, and TypeScript
transpile syntax when a TypeScript installation is available. The remaining
commands require a completed bootstrap.

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

## Remaining boundaries

ND-DSH intentionally does not reimplement Chromium, CDP, accessibility
snapshots, click targeting, console capture, or network capture. Still to come:
a writable editor surface with a real diff view, a PTY terminal, LSP UI, Git
panels, a trajectory (event ledger) tab, extension packaging, and signed
installers. Future IDE surfaces should project Harness services through narrow
IPC contracts without introducing a second browser or patching the Harness
agent loop.

See [`docs/architecture.md`](docs/architecture.md) for subsystem ownership and
failure boundaries, and [`docs/roadmap.md`](docs/roadmap.md) for the next
milestones.
