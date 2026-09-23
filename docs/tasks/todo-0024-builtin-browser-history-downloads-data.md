# TODO 0024 — Built-in browser history, downloads and browser data

> Priority: P1
> Owner: ND browser
> Status: merged to main via PR #41 — implementation complete; local persistence/file-policy validation pending
> Depends on: 0022

## Objective

Add normal browser lifecycle features to the built-in profile.

## Scope

- navigation history;
- downloads list/progress/cancel/open/reveal;
- explicit destination policy;
- per-site browser-data clearing;
- profile-wide clear controls;
- download provenance;
- file download action normalization.

## Security

Downloaded files and browser-data operations are governed actions.
Do not expose cookie values or authentication tokens in UI/API/logs.

## Acceptance

History and downloads survive normal use/restart as designed, destructive clear
operations are explicit, and download actions produce auditable results.

## Implementation evidence

- `src/main/browser/browser-history-store.ts` persists navigation metadata.
- `src/main/browser/browser-download-manager.ts` tracks progress, cancellation,
  completion and save paths, and arms agent-caused downloads for policy checks.
- browser-data clearing and history controls are exposed through
  `BrowserPlatformService` and Settings.
- completed downloads can be opened/revealed through trusted desktop controls.
- file-download actions are normalized through browser policy before agent-side
  side effects proceed.

Local validation still needs to exercise real downloads and restart persistence.
