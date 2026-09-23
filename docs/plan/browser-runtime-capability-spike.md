# Built-in browser runtime capability spike

> PRD: 0005 Unified Browser Platform
> Task: 0020
> Branch: `feat/unified-browser-runtime-spike`
> Status: implementation complete; local evidence pending
> Updated: 2026-09-23

## Purpose

Decide whether ND can keep Electron as the built-in browser runtime while still
meeting PRD 0005's required browser-extension baseline and the broader
multi-tab/profile/download/credential/site-tool contract.

This document separates three kinds of evidence:

1. **repository facts** already true on the branch;
2. **runtime probe evidence** produced by `bench:browser-runtime`;
3. **manual compatibility evidence** that cannot be inferred from API presence.

No compatibility/performance result is recorded here until it has been measured.

## Existing repository baseline

ND already has:

- Electron 43.4.0;
- one persistent browser partition, `persist:nd-dsh-browser`;
- a sandboxed `WebContentsView`;
- exact visible-target CDP binding for agent-browser;
- navigation history through `webContents.navigationHistory`;
- Browser Companion as the separate existing-Chrome target;
- Electron `safeStorage` already used elsewhere in the product for protected
  credential material.

The existing browser implementation is intentionally single-view. Task 0022,
not this spike, owns the production multi-tab refactor.

## Electron compatibility boundary

Electron's extension API is intentionally smaller than Chrome's complete
extension platform. Its own documentation says Electron supports a subset of
Chrome Extensions APIs and that arbitrary Chrome Web Store compatibility is not
a goal.

Therefore PRD 0005 requires:

- first-class extensions in the built-in ND browser;
- a tested compatibility matrix;
- no claim of 100% Chrome Web Store compatibility without evidence;
- a runtime switch if Electron cannot satisfy the required representative set.

Official references:

- https://www.electronjs.org/docs/latest/api/extensions
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/safe-storage

## Automated probe

Run:

~~~bash
corepack pnpm bench:browser-runtime
~~~

The launcher starts a clean Electron process with an isolated temporary
`userData` directory and a persistent spike partition.

It uses only local loopback fixture pages and does not require model credentials,
external accounts, or internet access.

### Session/browser checks

The probe checks:

- set/read cookie;
- clear cookies through session storage clearing;
- multi-entry navigation history;
- controlled download through the target browser session;
- 1/2/4/8 simultaneous `WebContentsView` instances sharing one persistent
  session;
- Electron process-count and working-set observations.

### Extension checks

Two deliberately small fixture extensions are included.

`mv2-baseline` probes:

- extension loading;
- content-script execution;
- runtime messaging to a background page;
- extension-local storage;
- unload/removal.

`mv3-service-worker` probes the same flow with a Manifest V3 service worker.

These fixtures are not a claim that representative production extensions work.
They only answer whether the selected runtime exposes the minimum mechanisms.

### WebMCP presence check

The probe records whether the current renderer exposes
`navigator.modelContext`.

Absence is not treated as proof that WebMCP is impossible: the feature may be
experimental, flag-gated, origin-trial-gated, or require a different integration
surface. Task 0027 owns the final site-tool implementation.

### Credential primitive check

The probe records `safeStorage.isEncryptionAvailable()`.

That only establishes whether an OS-backed encryption primitive is available in
the current environment. It does not establish password-manager UX, autofill
correctness, synchronization, form heuristics, or enterprise credential policy.
Task 0025 owns those behaviors.

## Result schema

The generated JSON contains:

~~~text
status
decision
requirements
capabilities.runtime
capabilities.session
capabilities.extensions
capabilities.tabs
capabilities.webMcp
observations
failures
~~~

Candidate decisions:

- **A-candidate** — automated baseline is broad enough to continue with Electron,
  but representative real-extension/manual checks are still mandatory.
- **B-candidate** — Electron can remain only with a documented compatibility
  ceiling and the required representative extension set must still pass.
- **C-candidate** — Electron misses a required baseline; evaluate another
  Chromium-grade built-in runtime.

The script never upgrades a candidate into the final architectural decision.

## Representative extension matrix

Before closing task 0020, record at least:

| Class | Example under test | Install/load | Content script | Background/runtime | Storage/permissions | Restart restore | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| content-script-heavy | TBD locally | pending | pending | pending | pending | pending | pending |
| background/runtime-heavy | TBD locally | pending | pending | pending | pending | pending | pending |
| storage/permissions-heavy | TBD locally | pending | pending | pending | pending | pending | pending |

Use extensions that are legally/testably available in the local environment.
Do not copy credentials or private extension data into evidence artifacts.

## Performance matrix

The automated probe records raw 1/2/4/8-tab process/memory observations.

Task 0020's final note should add:

| Tabs | Total Electron process count | Renderer-like process count | Working set | Private bytes | Notes |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | pending | pending | pending | pending | |
| 2 | pending | pending | pending | pending | |
| 4 | pending | pending | pending | pending | |
| 8 | pending | pending | pending | pending | |

These are capability-spike measurements, not public performance claims.

## Decision gate

Task 0021 may start only after all of these are true:

- the probe artifact exists;
- the representative extension matrix is filled;
- credential/autofill feasibility is reviewed;
- WebMCP feasibility is classified;
- the final A/B/C decision is written into task 0020;
- any runtime change required by a C decision is reflected in PRD 0005 before
  implementation proceeds.
