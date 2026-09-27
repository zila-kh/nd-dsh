# TODO 0040 — Daily Essentials extension

> Priority: P1
> Owner: ND extensions
> Status: planned — implementation deferred
> Depends on: 0036, 0037, 0038, 0039
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Prove global ND extensions with useful personal notes, capture, web, and OS launch commands.

## Scope

- Ship an ND-maintained declarative package using allowlisted native host operations, not arbitrary renderer or shell code.
- Implement quick-note create/search/open against selected context; personal notes work without a company.
- Add area/full-display capture with display-under-pointer default, display selection, local preview, copy/export, and explicit attach/Ask ND.
- Separate capture from current immediate agent inspection; hide ND overlays from captured content and handle mixed DPI/negative monitor coordinates.
- Add Open Google, URL-encoded Google search, validated HTTP(S) navigation in the visible ND browser, and explicit system-browser opening.
- Add user-selected/approved app, file, and folder launching via narrow target-based APIs; no raw command strings or arbitrary argument execution.
- Apply remembered scoped grants and per-action agent screen/clipboard approval through the shared broker. Preserve existing browser config/session contracts.

## Acceptance

- With zero companies/projects, all daily commands work subject to their relevant grants/provider availability.
- Taking a screenshot alone creates no model request; cancellation creates no stored capture.
- An agent screenshot/clipboard request prompts each time; user capture buttons authorize the exact selection only.
- Multi-monitor/mixed-DPI captures show the selected region/display and exclude ND overlays.
- Invalid URLs, missing apps, denied targets, clipboard empty state, and OS capture failure show actionable errors.
- Opening a website uses the canonical visible browser by default; no hidden automation browser is started.
- Personal data remains personal even while an organization project is visible.

## Validation

Run native-operation/broker tests and Electron daily-action E2E; record real Windows capture/app-launch checks without claiming mocks prove OS behavior.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/main/capture/app-capture.ts`
- `src/main/ipc.ts`
- `src/renderer/src/App.tsx`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
