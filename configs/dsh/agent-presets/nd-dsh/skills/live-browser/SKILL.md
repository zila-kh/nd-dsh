---
name: live-browser
description: Drive and inspect the browser pane that is visible inside the ND-DSH desktop IDE.
---

# Live browser pane

## Two browser channels — pick the right one

There are two separate MCP namespaces for browser work. Using the wrong one is
the most common failure mode.

| Namespace | `serverName` | When to use |
|---|---|---|
| `mcp__browser__agent_browser_*` | `browser` | The **visible embedded pane** inside ND-DSH. This is the canonical browser. Use it for every task that involves the page the operator is watching. |
| `mcp__external_app__external_app_*` | `external-app` | A **separate Electron app** launched with `--remote-debugging-port=9333`. Only use this when the operator explicitly asks to inspect an external app running on that port. |

Never use `external_app_*` tools to inspect the embedded pane — they talk to a
different debug port and will report "not reachable" if no external app is running.

## The pane is already open — do not call `agent_browser_open`

The embedded pane is launched and pinned by Electron. The agent-browser session
is already bound to it via CDP. Calling `agent_browser_open` on an
already-pinned CDP session blocks indefinitely because it tries to launch a
new browser that Electron already owns.

**Always start with `mcp__browser__agent_browser_snapshot`**, not `open`.
If you need to navigate, call `mcp__browser__agent_browser_navigate` instead.

```
✅  mcp__browser__agent_browser_snapshot          ← read the current state
✅  mcp__browser__agent_browser_navigate <url>    ← go somewhere
❌  mcp__browser__agent_browser_open <url>        ← hangs on a pinned session
```

## Workflow

1. Call `mcp__browser__agent_browser_snapshot` to read the current page.
2. Use the returned `@eN` accessibility references for click, fill, focus, and
   inspection. Do not construct CSS selectors when a snapshot ref is available.
3. Take a fresh snapshot after navigation or major DOM changes — refs from an
   earlier snapshot become stale after the page tree changes.
4. Use console, errors, network, cookies, and storage tools only when they
   materially help diagnose the task. Treat cookies and storage as sensitive.
5. Keep the visible page and the user's current browsing state intact unless
   the task explicitly requires changing it.
