# Universal Agent Extension Router

Status: implemented on `feat/universal-extension-router`.

## Goal

ND should let a user configure an agent capability once and route it across every coding engine and model provider the company uses. Switching from ND Harness to Codex CLI, Claude Code, OpenCode, Gemini CLI, or a future engine must not require rebuilding the company's MCP, skills, commands, hooks, memory, or plugin configuration.

The product separates two independent routing dimensions:

1. **Coding engine route** — where execution happens and which extension transport ND uses.
2. **Model provider scope** — whether prompt/context delivery may reach a model route such as DeepSeek, OpenAI, Anthropic, Gemini, or local providers.

Model vendors are not treated as coding engines. A DeepSeek model can run through ND Harness, while an OpenAI-compatible route can also run through ND Harness. Engine compatibility is therefore the primary extension routing decision.

## Agent capability surfaces

The universal router models these first-class surfaces:

- Memory
- Subagents
- Plugins
- MCP Servers
- Skills
- Commands
- Hooks

The existing `CapabilityKind = engine | memory | context` registry remains provider routing and is intentionally not overloaded with extension transport semantics.

## Routing adapters

Each extension can leave a coding engine on `auto` or explicitly select one adapter:

- `native`
- `cordis`
- `mcp`
- `hook-bridge`
- `skill-bridge`
- `prompt-injection`
- `nd-proxy`
- `disabled`

`auto` resolves from the engine descriptor. Examples:

| Surface | Engine has native support | Engine lacks native support |
| --- | --- | --- |
| MCP | `mcp` | `nd-proxy` |
| Skills | `native` | `skill-bridge` |
| Hooks | Harness: `cordis` | `hook-bridge` |
| Commands | Harness: `native` | `prompt-injection` |
| Memory | `prompt-injection` | `prompt-injection` |
| Subagents | `native` engine delegation | `native` engine delegation |
| Plugins | `mcp` when available | `nd-proxy` |

Explicit per-engine overrides always win over auto resolution.

## UI

Settings now includes **Agent capabilities**. The left navigation mirrors the target product model:

- Memory
- Subagents
- Plugins
- MCP Servers
- Skills
- Commands
- Hooks

For an extension, the detail pane shows:

- enabled/disabled state;
- a pre-built demo prompt;
- every detected coding engine;
- the resolved route and explanation;
- an adapter override control per engine;
- every configured model provider;
- provider allow/deny scope independently of the engine route.

The renderer persists the user's extension routing snapshot locally so manual QA can change routes and relaunch without losing the configuration.

## Pre-built demo requirement

Every surface ships with a ready-to-use Counter demo. This is deliberate: all seven demos use the same tiny domain so QA can focus on transport/routing behavior rather than learning different examples.

| Surface | Demo |
| --- | --- |
| Memory | remember/read counter value |
| Subagents | delegate counter implementation/review |
| Plugins | route a portable counter plugin bundle |
| MCP | `counter_get`, `counter_add`, `counter_reset` behavior |
| Skills | generate an accessible counter app |
| Commands | portable `/counter create` sample |
| Hooks | pre-run/post-run lifecycle sample |

The demo registry is defined in `src/shared/extensions.ts`; UI users can restore it with **Reset demo pack**.

## Data model

`AgentExtensionManifest` owns:

- id/name/version/description;
- surface;
- enabled state;
- optional built-in demo prompt;
- sparse per-engine route overrides;
- sparse model-provider scope.

Empty engine route entries mean `auto`. Empty provider scope means all enabled model providers.

The resolver returns a `ResolvedExtensionRoute` containing the selected adapter, support status, engine/provider identity, and a user-facing reason. This keeps UI, future runtime compilation, and tests on one deterministic routing function.

## Runtime boundary

The router is designed as an ND control-plane abstraction. Runtime adapters consume the resolved route rather than reading vendor configuration directly. That keeps these boundaries clear:

```text
Company / Project / Agent
        |
        v
ND Agent Extension Manifest
        |
        +----------------------+
        |                      |
        v                      v
Coding-engine route       Model-provider scope
        |                      |
        v                      v
ND Harness / Codex / ...  DeepSeek / OpenAI / ...
        |
        v
native | MCP | bridge | ND proxy
```

Future engine adapters only need to advertise their capabilities in `CodingEngineDescriptor`; existing extensions can remain on `auto` and gain a deterministic route automatically.

## Acceptance criteria

- Agent capabilities appears in Settings and is directly routable with `#/settings?tab=extensions` (plus `plugin`, `plugins`, and `extension` aliases).
- All seven capability surfaces are visible.
- All seven surfaces contain a built-in Counter demo with a runnable sample prompt.
- Detected coding engines are shown for the selected extension.
- `auto` resolves per engine capability and displays its reason.
- A user can override the adapter for each engine.
- Model providers are scoped independently from coding engines.
- Route choices persist across renderer reloads.
- Reset restores the complete demo pack.
- Unit tests cover every demo surface plus native/proxy/bridge, explicit overrides, and provider scoping.

## Follow-on runtime adapters

The current implementation establishes the universal contract, resolver, settings experience, persistence, provider scope, and complete demo matrix. Concrete third-party adapters plug into this contract without changing the UX: Cordis rows for Harness, MCP config projection for MCP-capable engines, Claude/Codex hook bridges, skill/prompt translation, and ND proxy transports for engines with no native surface.
