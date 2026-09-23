# TODO 0023 — Chrome Companion BrowserTarget adapter

> Priority: P1
> Owner: ND browser/runtime
> Status: todo
> Depends on: PR #32, 0021

## Objective

Adapt the approved Browser Companion implementation behind BrowserTarget so agents
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
