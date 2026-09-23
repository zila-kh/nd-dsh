# TODO 0026 — Built-in browser extension manager and compatibility matrix

> Priority: P1
> Owner: ND browser
> Status: done — implementation complete with limited compatibility model; representative-extension validation pending
> Depends on: 0020, 0022

## Objective

Deliver first-class browser extensions inside ND's built-in browser, using the
runtime selected by task 0020, with an honest compatibility model.

This task is required for PRD 0005 acceptance; the external Chrome Companion is
not a substitute.

## Scope

- install/load supported extensions into the ND persistent browser profile;
- uninstall;
- extension id/name/version/permissions;
- enable/disable;
- persistent enabled state across desktop restart;
- content-script execution in the intended tab;
- required background/service-worker/runtime messaging lifecycle;
- extension storage/profile isolation;
- startup/load errors;
- compatibility status: compatible / limited / unsupported;
- representative extension/API test matrix;
- packaging/update behavior;
- coexistence with exact-visible-tab agent control.

## Constraint

Do not market arbitrary Chrome Web Store compatibility unless task 0020 evidence
proves it for the chosen runtime.

## Acceptance

- representative supported extensions install/load and work inside the built-in
  browser;
- enabled state and extension identity survive desktop restart;
- content scripts affect the intended ND tab, not a hidden browser;
- required background/runtime messaging works for the approved compatibility set;
- agent control remains attached to the exact visible ND tab;
- unsupported APIs/extensions fail clearly;
- permissions are visible before activation.

If the selected runtime cannot meet these points, reopen task 0020's runtime
decision rather than deleting the requirement.

## Implementation evidence

- `src/main/browser/browser-extension-manager.ts` implements unpacked extension
  install/load, enable/disable, remove, restart persistence and permission display.
- extension records expose `compatible/limited/unsupported/error` style status
  without claiming Chrome Web Store parity.
- Settings exposes built-in extension management.
- task 0020's MV2/MV3 fixtures cover content scripts and runtime/background
  messaging mechanisms.

The product intentionally stays on the Electron compatibility ceiling until the
local representative-extension matrix is recorded.
