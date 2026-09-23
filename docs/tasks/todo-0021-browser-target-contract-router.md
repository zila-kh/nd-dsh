# TODO 0021 — BrowserTarget contract and router

> Priority: P1
> Owner: ND browser/control plane
> Status: todo
> Depends on: 0020

## Objective

Define the single semantic browser API used by both the built-in browser and the
Chrome Companion.

## Scope

- BrowserTarget and BrowserTargetCapabilities;
- stable ND target/profile/tab identifiers;
- tabs/list/open/activate/close;
- snapshot/click/fill/press/scroll/wait/navigation/screenshot;
- optional downloads/uploads/site-tools capability flags;
- explicit `@Browser`, `@Chrome`, `@Tab`, and Auto routing inputs;
- fail-honestly behavior for unsupported features.

## Invariants

- no agent-facing CDP ids, WebContents ids, extension ports, or Native Messaging details;
- explicit target selection wins;
- auto-routing cannot silently switch browser identity/account;
- one router serves every supported engine.

## Acceptance

Both current embedded browser operations and PR #32 companion operations can be
adapted to the contract without vendor-specific browser APIs leaking upward.
