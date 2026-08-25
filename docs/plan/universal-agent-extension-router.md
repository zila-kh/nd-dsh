# Universal Agent Extension Router

Status: implemented on `feat/universal-extension-router`.

## Product goal

ND lets a user define an agent capability once and route it across every coding engine and model route used by a company. Changing the coding engine does not require rebuilding the company's memory, subagents, plugins, MCP, skills, commands, or hooks configuration.

The product separates two routing dimensions:

1. **Coding engine route** — ND Harness, delegated Codex, direct Codex CLI, or another registered engine; this decides the delivery adapter.
2. **Model provider scope** — DeepSeek, OpenAI-compatible, Anthropic, Gemini, local, or another configured model provider; this decides whether portable prompt/context delivery may reach that model route.

Model vendors are not coding engines. A DeepSeek or OpenAI-compatible model can both run through ND Harness, while Codex CLI remains a distinct execution engine with its own native model/authentication behavior.

## First-class agent capability surfaces

The Agent capabilities settings section owns seven surfaces:

- Memory
- Subagents
- Plugins
- MCP Servers
- Skills
- Commands
- Hooks

`CapabilityKind = engine | memory | context` remains the provider-assignment registry for organization subjects. Agent extensions are a separate compatibility layer because transport mapping is different from provider selection.

## Delivery adapters

Each extension may leave an engine route on `auto` or override it with:

- `native`
- `cordis`
- `mcp`
- `hook-bridge`
- `skill-bridge`
- `prompt-injection`
- `nd-proxy`
- `disabled`

`auto` is deterministic from the coding-engine descriptor:

| Surface | ND Harness | Engines without the native surface |
| --- | --- | --- |
| MCP | `mcp` | `nd-proxy` |
| Skills | `native` | `skill-bridge` |
| Hooks | `cordis` | `hook-bridge` |
| Commands | `native` | `prompt-injection` |
| Memory | `prompt-injection` | `prompt-injection` |
| Subagents | engine delegation route | ND compatibility route |
| Plugins | `mcp` when available | `nd-proxy` |

Sparse engine overrides mean `auto`. Empty provider scope means all enabled providers.

## Runtime architecture

```text
Company / Project / Agent
        |
        v
ND extension catalog
        |
        +-----------------------------+
        |                             |
        v                             v
Coding engine route              Model provider scope
        |                             |
        v                             v
ND Harness / Codex / ...         DeepSeek / OpenAI / ...
        |
        v
native | Cordis | MCP | bridge | prompt | ND proxy
        |
        v
EngineSessionRouter
        |
        v
resolved trusted extension context + selected engine
```

The runtime implementation is split across:

- `src/shared/extensions.ts` — manifest, adapter vocabulary, deterministic resolver, runtime context format, IPC contracts, demo registry.
- `src/main/extensions/extension-store.ts` — atomic user-data persistence and built-in demo migration.
- `src/main/extensions/extension-router.ts` — engine/provider compatibility preview and runtime binding compilation.
- `src/main/extensions/extension-demo-service.ts` — deterministic executable Counter demos for all seven surfaces.
- `src/main/extensions/ipc.ts` — trusted renderer/main-process API.
- `src/main/engines/engine-session-router.ts` — applies extension resolution to interactive and organization runs before dispatching to the selected engine.
- `src/renderer/src/components/ExtensionSettings.tsx` — full management UI.

## Persistence and ownership

Extension manifests are persisted by the trusted main process at `agent-extensions.json` under Electron user data. Renderer `localStorage` is not authoritative.

Built-in demo identity, descriptions, version, prompts, and runtime instructions are ND-owned. A user can enable/disable a demo and override its engine/provider routes. Custom extensions may be created, edited, enabled, routed, and deleted.

Writes are serialized and atomically renamed so a crash cannot leave a half-written JSON catalog. Loading merges the current ND demo definitions with saved routing choices, which means product updates can improve a demo without destroying user route preferences.

## Real run behavior

`EngineSessionRouter` owns the execution boundary. Before dispatching a prompt it resolves all enabled extensions for the logical coding engine and active provider route. Supported bindings are appended in a trusted `<nd-extension-context>` block.

The original user prompt is preserved. Disabled, unsupported, or provider-denied extensions do not enter the runtime block. The block explicitly tells the agent not to claim a native tool exists unless the selected adapter actually exposes it.

Harness-backed delegated engines retain their logical engine id per session, so a task assigned to delegated Codex is routed as Codex even though the physical session is hosted by ND Harness. Direct Codex CLI sessions keep their own engine identity.

## UI behavior

Settings → **Agent capabilities** shows all seven surfaces. For each extension the user can:

- enable or disable it for real agent runs;
- create and delete custom extensions;
- edit custom name, version, description, and portable runtime instructions;
- inspect every detected coding engine;
- leave an engine on `auto` or select an explicit adapter;
- allow all model providers or maintain provider-specific allow/deny scope;
- run the built-in deterministic demo on a selected engine/provider route;
- reset all built-in demos without deleting custom extensions.

Direct routing aliases include `#/settings?tab=extensions`, `plugin`, `plugins`, and `extension`.

## Pre-built Counter demos

All seven surfaces ship disabled-by-default Counter demos so normal prompts stay clean. **Run demo** enables a temporary copy only for the demo execution; it does not silently change real-run settings.

| Surface | Executable demo behavior |
| --- | --- |
| Memory | writes counter `7`, then reads `7` back |
| Subagents | models separate worker/reviewer contributions that resolve to `7` |
| Plugins | executes the reference plugin `add/get` contract |
| MCP | `reset → add(3) → add(4) → get = 7` |
| Skills | validates the accessible counter sample contract and target value `7` |
| Commands | parses and translates `/counter create --framework react --tests` |
| Hooks | records pre-run state, adds `7`, validates post-run state |

The browser-facing reference app lives under `examples/extension-counter/`. It exposes `window.ndCounter.get()`, `add(n)`, and `reset()` and provides the same `reset → +3 → +4 → 7` smoke path.

## Security rules

- Renderer code cannot choose filesystem paths for the extension catalog.
- IPC accepts only the primary trusted renderer main frame.
- Manifest ids, surfaces, adapters, route ids, lengths, and provider entries are validated in the main process.
- Built-in demo identity cannot be replaced or deleted by renderer input.
- Extension configuration contains no model credentials.
- Provider secrets remain owned by `ProviderStore` and never enter extension persistence.
- Extension routing does not patch vendored DeepSeek Harness core.

## Acceptance criteria

- Agent capabilities is directly routable in Settings.
- Memory, Subagents, Plugins, MCP Servers, Skills, Commands, and Hooks are all present.
- Every surface has an account-free built-in Counter demo.
- Built-in demos default disabled for real runs.
- A demo can be executed against a selected coding engine and optional model provider and reports the actual resolved adapter.
- Custom extensions can be created, edited, routed, enabled, persisted, and deleted.
- Built-in demo routing can be changed while ND-owned identity remains immutable.
- `auto` engine mapping is deterministic and uses engine capability descriptors.
- Engine adapter overrides persist across app restarts.
- Provider scope is independent from coding-engine mapping and persists across app restarts.
- Enabled extensions are compiled into real interactive and organization runs at the central engine dispatch boundary.
- Harness-backed delegated Codex sessions preserve Codex as their logical extension-routing target.
- Reset restores all demos without deleting custom extensions.
- Tests cover the resolver, trusted runtime context, persistence, demo immutability, provider scoping, compatibility preview, and all seven executable demos.
