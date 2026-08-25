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
| Plugins | Route the Counter Plugin Demo to different coding engines and inspect the selected adapter. |
| MCP | Treat `get`, `add`, and `reset` as the reference MCP tool contract. |
| Skills | Ask the Counter Skill Demo to reproduce or improve this accessible UI. |
| Commands | Run the prebuilt `/counter create --framework react --tests` example. |
| Hooks | Use the hook demo to check counter state before and after a task. |

Expected smoke path: `reset()` → `add(3)` → `add(4)` → `get()` returns `7` and the page shows `7`.
