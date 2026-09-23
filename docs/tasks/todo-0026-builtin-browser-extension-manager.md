# TODO 0026 — Built-in browser extension manager and compatibility matrix

> Priority: P1
> Owner: ND browser
> Status: todo
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
