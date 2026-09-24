# TODO 0023 — Chrome Companion BrowserTarget adapter

> Priority: P1
> Owner: ND browser/runtime
> Status: merged to main via PR #41 — implementation complete; real-Chrome validation pending
> Depends on: Browser Companion merged in `main@9e0fcc5` via PR #32, 0021

## Objective

Adapt the merged Browser Companion implementation behind BrowserTarget so agents
use the same API for existing Chrome and the built-in browser.

## Scope

- target/profile/tab mapping;
- semantic snapshot/action adaptation;
- writable lease integration;
- connection/reconnect state;
- capability advertisement;
- background-control capability when actually supported;
- preserve Native Messaging and per-origin permission boundaries.

## Non-goals

Do not replace Native Messaging with localhost HTTP/WebSocket.
Do not weaken Chrome optional host permissions.

## Acceptance

An engine can switch between built-in and Chrome targets without changing tool
vocabulary, and unsupported companion features are reported rather than invented.

## Implementation evidence

- `src/main/browser-platform/companion-browser-target.ts` adapts the merged
  Browser Companion behind BrowserTarget.
- target/profile/tab ids, semantic snapshots/actions, history navigation,
  screenshots and capability advertisement are normalized.
- Native Messaging and per-origin Chrome permission boundaries remain intact.
- the unified router can switch between `builtin` and connected companion
  targets without changing tool vocabulary.

Real installed Chrome/native-host smoke remains a local validation gate.
