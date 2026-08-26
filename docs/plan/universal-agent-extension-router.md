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

`auto` is deterministic from the coding-engine descriptor and the extension's executable runtime:

| Surface | ND Harness | Engines without the native surface |
| --- | --- | --- |
| MCP with executable runtime | stable ND MCP gateway | portable `nd-proxy` over shell |
| Skills | `native` | `skill-bridge` |
| Hooks | `cordis` | `hook-bridge` |
| Commands | `native` | `prompt-injection` |
| Memory | `prompt-injection` | `prompt-injection` |
| Subagents | native Harness delegation | ND orchestration proxy |
| Plugin with executable runtime | stable ND MCP gateway | portable `nd-proxy` over shell |
| Plugin without executable runtime | `prompt-injection` | `prompt-injection` |

A custom MCP extension is not considered usable until it has an executable MCP stdio runtime. An instruction-only custom Plugin is valid and routes as prompt/context only.

Sparse engine overrides mean `auto`. Empty provider scope means all enabled providers. Explicit adapter selections are validated against the target engine; ND shows impossible mappings as unsupported instead of claiming they work.

## Runtime architecture

```text
Company / Project / Agent
        |
        v
ND durable extension catalog
        |
        +-----------------------------+
        |                             |
        v                             v
Coding engine route              Model provider scope
        |                             |
        v                             v
ND Harness / Codex / ...         DeepSeek / OpenAI / ...
        |
        +------------------------------+
        |                              |
        | engine has MCP               | shell-capable engine
        v                              v
stable ND MCP gateway              portable ND proxy
mcp__nd-extensions__*              $ND_EXTENSION_PROXY
        |                              |
        +---------------+--------------+
                        v
            built-in tool runtime or
              custom MCP stdio child
```

The runtime implementation is split across:

- `src/shared/extensions.ts` — manifest, adapter vocabulary, executable runtime schema, deterministic resolver, trusted runtime context, IPC contracts, demo registry.
- `src/main/extensions/extension-store.ts` — atomic user-data persistence, built-in demo migration, executable runtime validation, and stable runtime environment references.
- `src/main/extensions/extension-router.ts` — engine/provider compatibility preview and runtime binding compilation.
- `src/main/extensions/extension-demo-service.ts` — deterministic executable Counter demos for all seven surfaces.
- `src/main/extensions/ipc.ts` — trusted renderer/main-process API.
- `src/main/engines/engine-session-router.ts` — applies extension resolution to interactive and organization runs before dispatching to the selected engine.
- `scripts/nd-extension-mcp.mjs` — fixed-shape MCP gateway mounted into ND Harness.
- `scripts/nd-extension-runtime.mjs` — portable list/call proxy, built-in Counter tool runtime, and custom MCP stdio bridge.
- `src/renderer/src/components/ExtensionSettings.tsx` — full management UI.

## Live MCP and Plugin routing

ND Harness gets one permanent MCP client row named `nd-extensions` through the sanctioned Harness patch overlay. The gateway intentionally exposes a stable two-tool catalog:

- `mcp__nd-extensions__nd_extension_list`
- `mcp__nd-extensions__nd_extension_call`

The first lists the raw tools for one enabled ND extension. The second calls one listed tool using `{ extensionId, toolName, arguments }`.

The gateway does **not** copy every extension tool into the Harness registry. That keeps the model-facing Harness tool catalog stable across enable/disable/configuration changes, so users do not need to restart Harness when they change Plugins or MCP Servers. Every list/call reads the durable extension catalog again and therefore enforces the current enabled state and route policy.

For engines without MCP but with shell access, ND injects stable environment references and tells the engine to use:

```text
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" list <extension-id>
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call <extension-id> <tool-name> '<json-arguments>'
```

This is the same underlying runtime used by the Harness gateway. Direct Codex therefore receives the same enabled tool extension even though Codex does not expose the Harness MCP registry.

## Custom executable MCP runtime

Custom MCP Servers and tool-bearing Plugins may define:

```ts
runtime: {
  kind: 'mcp-stdio',
  command: 'npx',
  args: ['-y', '@vendor/example-mcp'],
  env: {
    GITHUB_TOKEN: 'GITHUB_TOKEN'
  }
}
```

`env` is reference-only. The key is the child-process variable and the value is the name of a variable already present in the parent environment. ND persists `GITHUB_TOKEN=GITHUB_TOKEN`, never the token value.

On a tool call, the proxy starts the configured MCP process, performs MCP initialization, lists/calls the requested raw tool, forwards structured MCP output, and terminates the child. The extension must be enabled at call time.

**Enabling an executable MCP/Plugin extension authorizes its configured command to run with the ND desktop process's user/workspace permissions when an agent calls it.** Users should configure only MCP commands they trust.

## Persistence and ownership

Extension manifests are persisted by the trusted main process at `agent-extensions.json` under Electron user data. Renderer `localStorage` is not authoritative.

Built-in demo identity, descriptions, version, prompts, and runtime instructions are ND-owned. A user can enable/disable a demo and override its engine/provider routes. Custom extensions may be created, edited, enabled, routed, and deleted.

Writes are serialized and atomically renamed so a crash cannot leave a half-written JSON catalog. Loading merges the current ND demo definitions with saved routing choices, which means product updates can improve a demo without destroying user route preferences.

The store also publishes these non-secret runtime references into the execution environment before engines start:

- `ND_EXTENSION_NODE`
- `ND_EXTENSION_PROXY`
- `ND_EXTENSION_CATALOG`
- `ND_EXTENSION_STATE`
- `ND_DSH_EXTENSION_MCP_ENTRY`

## Real run behavior

`EngineSessionRouter` owns the execution boundary. Before dispatching a prompt it resolves all enabled extensions for the logical coding engine and active provider route. Supported bindings are appended in a trusted `<nd-extension-context>` block.

The original user prompt is preserved. Disabled, unsupported, or provider-denied extensions do not enter the runtime block. The block explicitly tells the agent not to claim a native tool exists unless the selected adapter actually exposes it. Tool-bearing extensions include exact native-MCP or portable-proxy invocation guidance.

Harness-backed delegated engines retain their logical engine id per session, so a task assigned to delegated Codex is routed as Codex even though the physical session is hosted by ND Harness. Direct Codex CLI sessions keep their own engine identity.

## UI behavior

Settings → **Agent capabilities** shows all seven surfaces. For each extension the user can:

- enable or disable it for real agent runs;
- create and delete custom extensions;
- edit custom name, version, description, and portable runtime instructions;
- configure an MCP stdio command, one argument per line, and environment-variable references for MCP/Plugin extensions;
- inspect every detected coding engine;
- leave an engine on `auto` or select an explicit adapter;
- see impossible explicit mappings as unsupported;
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
| Plugins | uses the same `counter_get`, `counter_add`, `counter_reset` tool runtime |
| MCP | `reset → add(3) → add(4) → get = 7` |
| Skills | validates the accessible counter sample contract and target value `7` |
| Commands | parses and translates `/counter create --framework react --tests` |
| Hooks | records pre-run state, adds `7`, validates post-run state |

The browser-facing reference app lives under `examples/extension-counter/`. It exposes `window.ndCounter.get()`, `add(n)`, and `reset()` and provides the same `reset → +3 → +4 → 7` smoke path.

The real portable proxy can also exercise the enabled MCP demo directly:

```bash
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" list demo-counter-mcp
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_reset '{}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_add '{"amount":3}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_add '{"amount":4}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_get '{}'
```

## Security rules

- Renderer code cannot choose filesystem paths for the extension catalog or extension state.
- Extension IPC accepts only the primary trusted renderer main frame.
- Manifest ids, surfaces, adapters, route ids, lengths, provider entries, MCP commands, arguments, and environment references are validated in the main process.
- Built-in demo identity cannot be replaced or deleted by renderer input.
- MCP environment configuration stores variable names only, never resolved secret values.
- Provider secrets remain owned by `ProviderStore` and never enter extension persistence.
- The proxy rechecks extension enablement before every list/call.
- Native Harness tool names stay stable while extension configuration changes.
- Executable custom transports are opt-in and visibly configured in Settings.
- Extension routing does not modify vendored DeepSeek Harness core; it uses the sanctioned patch overlay and existing MCP client package.

## Acceptance criteria

- Agent capabilities is directly routable in Settings.
- Memory, Subagents, Plugins, MCP Servers, Skills, Commands, and Hooks are all present.
- Every surface has an account-free built-in Counter demo.
- Built-in demos default disabled for real runs.
- A demo can be executed against a selected coding engine and optional model provider and reports the actual resolved adapter.
- Custom extensions can be created, edited, routed, enabled, persisted, and deleted.
- Custom MCP/Plugin extensions can store a validated MCP stdio runtime with environment-variable references.
- Built-in demo routing can be changed while ND-owned identity remains immutable.
- `auto` engine mapping is deterministic and uses engine capability descriptors plus executable-runtime availability.
- Impossible explicit adapter mappings fail closed.
- Engine adapter overrides persist across app restarts.
- Provider scope is independent from coding-engine mapping and persists across app restarts.
- Enabled extensions are compiled into real interactive and organization runs at the central engine dispatch boundary.
- ND Harness receives tool-bearing extensions through the permanent two-tool MCP gateway without a restart for extension changes.
- Direct Codex and other shell-capable engines receive the same tool extension through the portable proxy.
- Harness-backed delegated Codex sessions preserve Codex as their logical extension-routing target.
- Reset restores all demos without deleting custom extensions.
- Tests cover resolver behavior, trusted runtime context, persistence, secret-reference handling, executable proxy calls, stable MCP gateway discovery, demo immutability, provider scoping, compatibility preview, and all seven executable demos.
