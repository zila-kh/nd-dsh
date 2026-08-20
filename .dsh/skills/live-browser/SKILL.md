---
name: live-browser
description: Drive and inspect the browser pane that is visible inside the ND-DSH desktop IDE.
---

# Live browser pane

Use the `mcp__browser__agent_browser_*` tools whenever the task involves the
web app shown in the IDE. These tools attach to the exact Electron browser pane
the operator is watching; do not launch a separate browser.

Start by calling `mcp__browser__agent_browser_snapshot` and use the returned
`@eN` accessibility references for click, fill, focus, and inspection. Take a
fresh snapshot after navigation or major DOM changes because references can
become stale.

Prefer semantic snapshot references over CSS selectors. Use console, errors,
network requests, cookies, and storage tools only when they materially help
diagnose the task. Treat cookies and storage as sensitive. Keep the visible
page and the user's current state intact unless the task requires changing it.
