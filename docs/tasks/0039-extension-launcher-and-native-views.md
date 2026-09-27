# TODO 0039 — Extension launcher, ND-rendered views, and management UI

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 — automated layers green; operator manual gate pending (docs/qa/nd-extensions-home-manual.md)
> Depends on: 0037, 0038
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Make installed commands discoverable globally and render extension interactions consistently within ND.

## Scope

- Reuse global shortcut/popup and existing command launcher; OS entry defaults to Personal each time, in-app entry uses current context.
- Add a visible context selector and filter contributions by context, activation, and policy; explain project-only availability.
- Implement typed list/detail/form/action rendering without extension JavaScript or DOM injection.
- Register commands targeting declared operations, views, or agent tasks; handle loading, empty, denied, cancelled, and failed states.
- Keep simple actions in the popup; hand off browser/longer chat work with bound context so current main-window selection cannot redirect it.
- Expose Extensions management for packages, versions/source, settings, context activation, grants, updates, rollback, and errors; preserve settings route aliases.
- Keep browser extensions clearly separate and retain sandbox/context-isolation boundaries.

## Acceptance

- Global popup opens Personal while a project is active; in-app launcher shows its current context explicitly.
- One installed package exposes commands/views only in supported authorized contexts.
- Untrusted result text cannot invoke actions or inject active markup; actions resolve declared contribution IDs through the broker.
- Context survives popup-to-main handoff; simple commands need no agent/model call.
- Keyboard navigation, cancellation, context switching, and error recovery work in Electron E2E.

## Validation

Run launcher/contribution/view tests plus Electron launcher and Extensions manager scenarios; run pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/main/launcher-popup.ts`
- `src/renderer/src/components/QuickLauncher.tsx`
- `src/renderer/src/components/ExtensionSettings.tsx`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
