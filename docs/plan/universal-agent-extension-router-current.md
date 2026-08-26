# Universal Agent Extension Router — Current Implementation

This document is the implementation-accurate companion to `universal-agent-extension-router.md` for branch `feat/universal-extension-router`.

## Product contract

ND owns one persistent Agent Capabilities catalog and maps each capability onto the selected coding engine. Coding-engine routing is independent from model-provider scope:

- **Coding engines:** ND Harness, delegated Codex, direct Codex CLI, and future registered engines.
- **Model providers:** DeepSeek, OpenAI-compatible, Anthropic, Gemini, local providers, and future model routes.

A user should be able to change the coding engine without recreating company-level capability configuration.

## First-class surfaces

ND exposes seven Agent Capabilities surfaces:

| Surface | Current delivery |
| --- | --- |
| Memory | trusted prompt/context injection |
| Subagents | native Harness delegation policy; portable trusted policy on other engines |
| Plugins | executable MCP transport when configured; otherwise portable prompt/context |
| MCP Servers | executable MCP stdio transport |
| Skills | portable `skill-bridge` through trusted engine context |
| Commands | portable command translation through trusted engine context |
| Hooks | portable `hook-bridge` lifecycle policy through trusted engine context |

The existing organization provider registry (`engine | memory | context`) stays separate. Provider assignment answers *which provider should this subject use?*; Agent Capabilities routing answers *how is this extension delivered to this coding engine?*

## Supported adapters

The manifest vocabulary is:

- `auto`
- `native`
- `cordis`
- `mcp`
- `hook-bridge`
- `skill-bridge`
- `prompt-injection`
- `nd-proxy`
- `disabled`

Not every adapter is available for every surface. ND fails closed when a user selects a mapping that the runtime cannot actually deliver. In particular, generic dynamic `cordis` projection is reserved but is not advertised as working until a real projector exists.

### Auto routing

| Surface | ND Harness | Engine without Harness MCP |
| --- | --- | --- |
| MCP + executable runtime | `mcp` via stable ND gateway | `nd-proxy` when shell is available |
| Plugin + executable runtime | `mcp` via stable ND gateway | `nd-proxy` when shell is available |
| Plugin without executable runtime | `prompt-injection` | `prompt-injection` |
| Memory | `prompt-injection` | `prompt-injection` |
| Skill | `skill-bridge` | `skill-bridge` |
| Command | `prompt-injection` | `prompt-injection` |
| Hook | `hook-bridge` | `hook-bridge` |
| Subagent | `native` Harness delegation policy | `prompt-injection` delegation policy |

A custom MCP Server is unavailable until it has a valid executable MCP stdio runtime.

## Stable Harness MCP gateway

ND mounts one permanent MCP client row through `configs/dsh/nd-dsh.patch.yml` using the existing Harness MCP client package. The server name is `nd-extensions` and its model-facing catalog is intentionally fixed:

- `mcp__nd-extensions__nd_extension_list`
- `mcp__nd-extensions__nd_extension_call`

The gateway does not copy every external tool into the Harness tool registry. This keeps the Harness request/tool shape stable while users enable, disable, add, delete, or reroute extensions.

Every `list` or `call` delegates to the portable proxy and re-reads the durable catalog. The gateway binds its calls to the `nd-harness` engine route so an extension disabled for Harness cannot be reached through this MCP path.

## Portable shell proxy

Shell-capable engines such as direct Codex receive the same executable extension through:

```text
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" list <extension-id> <engine-id>
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call <extension-id> <tool-name> '<json-arguments>' <engine-id>
```

The target engine id is required on every proxy invocation. The proxy checks current enablement and the current per-engine route before it lists or calls a tool. This prevents a stale prompt or manual shell invocation from bypassing an engine-specific disabled route.

## Custom MCP stdio runtime

Plugins and MCP Servers can optionally carry an executable runtime:

```json
{
  "kind": "mcp-stdio",
  "command": "npx",
  "args": ["-y", "@vendor/example-mcp"],
  "env": {
    "API_TOKEN": "EXAMPLE_API_TOKEN"
  }
}
```

`env` is reference-only. ND stores the child variable name and the name of the parent variable, not its secret value.

When the tool is invoked, ND starts the configured child, performs MCP initialization, lists or calls the raw tool, forwards the MCP result, and terminates the child. The child gets a small OS/runtime environment plus only explicitly referenced secret variables; it does not inherit the full ND desktop environment.

Enabling such an extension authorizes the configured executable to run with the desktop user's permissions when an agent calls it. Only trusted MCP commands should be configured.

## Persistence

The trusted main process owns `agent-extensions.json` under Electron user data. Writes are serialized and atomically renamed.

Built-in demo identity/content is ND-owned. Users may enable/disable demos and change route/provider policy. Custom extensions may be created, edited, routed, enabled, persisted, and deleted.

Runtime references exported before engine startup:

- `ND_EXTENSION_NODE`
- `ND_EXTENSION_PROXY`
- `ND_EXTENSION_CATALOG`
- `ND_EXTENSION_STATE`
- `ND_DSH_EXTENSION_MCP_ENTRY`

No provider credential is stored in the extension catalog.

## Real execution boundary

`EngineSessionRouter` resolves enabled extensions before dispatching either interactive or organization work. Supported bindings are appended in a trusted `<nd-extension-context>` block while the original user prompt is preserved.

Harness-backed delegated sessions retain their logical engine id, so a delegated Codex assignment is evaluated against the Codex route even when its physical execution session lives inside ND Harness. Direct Codex CLI keeps its own engine identity.

Tool-bearing bindings include exact invocation guidance for either the stable Harness MCP gateway or the per-engine shell proxy. Unsupported, disabled, or provider-denied bindings are omitted.

## UI

Settings → **Plugins** is the user-facing catalog for Agent Capabilities. It intentionally uses the familiar plugin-manager pattern while preserving the more precise internal capability model.

The catalog provides:

- top-level capability tabs for Plugins, MCP, Skills, Commands, Hooks, Subagents, and Memory, each with a live count;
- search scoped to the selected capability surface;
- refresh and **+ New** controls;
- a separate **Installed** area for user-created capability packages;
- a separate **Built-in** area for ND-owned capabilities and account-free demos;
- compact enable/disable switches directly in each catalog row;
- an empty-state **Browse built-ins** path when nothing has been installed yet;
- detailed configuration for the selected item below the catalog;
- custom extension create/edit/delete;
- engine route matrix with `auto` and explicit adapters;
- model-provider allow/deny scope independent from engine routing;
- custom MCP stdio command, arguments, and environment-variable references;
- deterministic **Run demo** action per built-in demo;
- reset demo pack without deleting custom extensions.

User-facing terminology is intentionally layered:

- **Plugin** is the approachable installable/bundle concept and the Settings entry point.
- **Capability** is what the agent can do.
- **Extension** is the persistent internal manifest/routing unit.
- MCP, Skills, Commands, Hooks, Subagents, and Memory remain explicit advanced surfaces rather than being erased into one generic plugin type.

Aliases route directly to this settings surface: `extensions`, `extension`, `plugin`, and `plugins`.

## Prebuilt Counter demos

Every surface has an account-free Counter demo and all demos default disabled for real work:

| Surface | Demo |
| --- | --- |
| Memory | save/read counter value 7 |
| Subagents | worker/reviewer policy resulting in 7 |
| Plugin | routed counter tool transport |
| MCP | reset → +3 → +4 → get = 7 |
| Skill | accessible counter implementation contract |
| Command | `/counter create --framework react --tests` translation |
| Hook | pre/post counter lifecycle validation |

The browser sample is under `examples/extension-counter/`. A zero-dependency MCP stdio server and example extension manifest are included there as well.

## Test coverage committed

The branch contains coverage for:

- deterministic resolver behavior;
- unsupported explicit mappings;
- provider scope;
- trusted prompt context;
- persistent extension catalog;
- built-in immutability and reset behavior;
- secret-reference persistence rules;
- custom MCP runtime validation;
- portable proxy Counter calls;
- per-engine route enforcement;
- custom MCP child environment isolation;
- stable Harness MCP gateway discovery/call behavior;
- all seven built-in demos;
- Settings route aliases;
- Plugins catalog search, Installed/Built-in sections, toggles, and creation controls;
- Electron E2E navigation and demo execution;
- the real zero-dependency Counter MCP example.

Automated repository CI exercises verification, TypeScript, unit tests, desktop build, and Electron smoke coverage. Manual product QA remains available in `docs/qa/agent-capabilities-manual.md` for the user's later hands-on pass.
