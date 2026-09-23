# TODO 0024 — Built-in browser history, downloads and browser data

> Priority: P1
> Owner: ND browser
> Status: todo
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
