# TODO 0022 — Built-in browser tabs and persistent profile

> Priority: P1
> Owner: ND browser
> Status: todo
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
