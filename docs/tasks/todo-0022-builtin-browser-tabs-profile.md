# TODO 0022 — Built-in browser tabs and persistent profile

> Priority: P1
> Owner: ND browser
> Status: done — implementation complete; local 8-tab/restart validation pending
> Depends on: 0021

## Objective

Turn the current single visible browser surface into a first-class multi-tab
built-in browser target with a persistent ND-owned profile.

## Scope

- tab strip and tab lifecycle;
- stable ND tab ids;
- active/visible tab tracking;
- persistent profile/session ownership;
- cookies/site-data persistence;
- per-site permission state;
- browser-data clearing;
- exact visible-tab agent control;
- restart/crash reconciliation.

## Acceptance

At least 8 tabs can be created/activated/closed deterministically, agent actions
target the intended ND tab, and restart restores profile state without creating
hidden duplicate automation browsers.

## Implementation evidence

- `src/main/browser/browser-controller.ts` now owns real per-tab
  `WebContentsView` instances on the persistent `persist:nd-dsh-browser`
  session.
- stable ND tab ids, create/activate/close, active visibility and exact-target
  agent binding are implemented.
- `src/renderer/src/components/BrowserPane.tsx` renders the real built-in tab
  strip instead of URL-only simulated tabs.
- site permissions and browser-data clearing are integrated through the platform
  services.

Local validation still needs to record 1/2/4/8-tab behavior and restart recovery.
