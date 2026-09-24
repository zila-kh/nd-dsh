# TODO 0021 — BrowserTarget contract and router

> Priority: P1
> Owner: ND browser/control plane
> Status: merged to main via PR #41 — implementation complete; local validation pending
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

## Implementation evidence

- `src/shared/browser-platform.ts` defines the semantic target/tab/capability,
  lease, action, receipt, download, extension, credential and site-tool contracts.
- `src/main/browser-platform/browser-target.ts` defines the common target API.
- `src/main/browser-platform/browser-target-router.ts` routes one browser
  vocabulary across built-in and companion targets.
- explicit `target`, `tab` and `auto` selection are implemented.
- agent-facing APIs use ND target/tab ids rather than CDP/WebContents/native
  extension transport identifiers.

The router is now the engine-facing browser boundary.
