# Extension Counter Demo

Static zero-dependency sample used by the Agent capabilities demo pack.

Open `index.html` in a browser or serve this directory with any static server. The page exposes:

```js
window.ndCounter.get()
window.ndCounter.add(3)
window.ndCounter.reset()
```

Use the same app for every extension surface so manual QA can verify routing rather than app complexity:

| Surface | Manual demo |
| --- | --- |
| Memory | Set the counter to 7, save that fact, then ask for it in a later task. |
| Subagents | Delegate implementation/review of an additional `+5` button. |
| Plugins | Enable Counter Plugin Demo, switch coding engines, and verify ND selects MCP or the portable proxy. |
| MCP | Enable Counter MCP Demo and execute `counter_reset`, `counter_add`, and `counter_get`. |
| Skills | Ask the Counter Skill Demo to reproduce or improve this accessible UI. |
| Commands | Run the prebuilt `/counter create --framework react --tests` example. |
| Hooks | Use the hook demo to check counter state before and after a task. |

Expected browser smoke path: `reset()` → `add(3)` → `add(4)` → `get()` returns `7` and the page shows `7`.

## Test the real universal tool transport

In ND, open **Settings → Agent capabilities → MCP Servers**, enable **Counter MCP Demo**, and leave the engine route on `auto`.

ND Harness receives the extension through the permanent `nd-extensions` MCP gateway. The agent first calls `mcp__nd-extensions__nd_extension_list` for `demo-counter-mcp`, then calls `mcp__nd-extensions__nd_extension_call` with one of the returned raw tool names.

Direct Codex and other shell-capable engines receive the same extension through the portable proxy. From a child process launched by ND the equivalent smoke path is:

```bash
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" list demo-counter-mcp
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_reset '{}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_add '{"amount":3}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_add '{"amount":4}'
"$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call demo-counter-mcp counter_get '{}'
```

The last call returns MCP content containing `7`. Disabling the extension causes later proxy calls to fail instead of using stale configuration.

## Custom MCP smoke example

Create a custom **MCP Server** or tool-bearing **Plugin** and fill in its MCP stdio transport:

```text
Command: npx
Arguments, one per line:
-y
@vendor/example-mcp

Environment references:
API_TOKEN=EXAMPLE_API_TOKEN
```

ND persists the variable names only. It resolves `EXAMPLE_API_TOKEN` from the parent environment when the MCP child actually runs; the secret value is not written to `agent-extensions.json`.
