# TODO 0020 — Built-in browser runtime capability spike

> Priority: P1
> Owner: ND browser/runtime
> Status: merged to main via PR #41 — Electron retained with an explicit compatibility ceiling; local evidence handoff pending
> Historical branch: `feat/unified-browser-runtime-spike`
> Depends on: PRD 0005
> Validation: local only; GitHub Actions remain parked

## Objective

Decide which built-in browser runtime can satisfy the product requirements before
any broad implementation starts.

**Built-in browser extension support is mandatory.** This task decides whether
Electron can deliver the required baseline or whether ND must use a different
Chromium-grade runtime behind BrowserTarget.

## Questions to answer

- Can the current persistent Electron session safely support multiple browser tabs?
- Can ND provide history, downloads, site-data clearing and restart recovery?
- What secure password/autofill model is feasible without exposing secrets to agents?
- Can the runtime install/load/enable/disable/uninstall supported extensions?
- Does extension identity/state survive restart in the ND persistent profile?
- Do content scripts target the intended visible ND tab?
- Does the required background/runtime messaging lifecycle work?
- Which representative Chrome extensions/APIs are compatible, limited, or unsupported?
- Can WebMCP/site-tool discovery be implemented in the current runtime?
- What are the memory and latency costs at 1/2/4/8 tabs?
- If must-have requirements fail, what replacement Chromium-grade runtime is viable
  behind the same BrowserTarget boundary?

## Deliverables

- runtime capability matrix;
- representative extension compatibility matrix;
- 1/2/4/8-tab performance evidence;
- credential/autofill feasibility note;
- WebMCP feasibility note;
- explicit decision:
  - A) Electron satisfies the required extension baseline and full browser contract;
  - B) Electron stays with a documented compatibility ceiling because the required
    representative extension set still passes;
  - C) alternative Chromium-grade runtime because Electron fails a required capability.

## Acceptance

No implementation task beyond 0020 may claim full built-in browser parity until
this decision is recorded and reviewed.

The decision may narrow **compatibility breadth**, but it may not remove built-in
extension support from PRD 0005.


Runtime protocol: [browser-runtime-capability-spike.md](../plan/browser-runtime-capability-spike.md).

## Implemented spike

The branch now includes a runnable Electron capability probe:

- `benchmarks/browser-runtime-spike.mjs`
- `benchmarks/browser-runtime-spike-electron.mjs`
- `tests/fixtures/browser-runtime-spike/extensions/mv2-baseline/`
- `tests/fixtures/browser-runtime-spike/extensions/mv3-service-worker/`

Run:

~~~bash
corepack pnpm install --frozen-lockfile
corepack pnpm bench:browser-runtime
~~~

The probe writes:

~~~text
benchmark-results/<timestamp>-browser-runtime-spike/
  browser-runtime-spike.json
~~~

It records:

- Electron/Chromium/runtime versions;
- `safeStorage` availability;
- cookie persistence + clearing behavior;
- navigation-history support;
- download interception/completion;
- MV2 extension load/content-script/runtime-messaging behavior;
- MV3 service-worker extension load/content-script/runtime-messaging behavior;
- extension unload cleanup;
- shared-session 1/2/4/8-tab process/memory observations;
- WebMCP-style `document.modelContext` presence.

The spike intentionally records unsupported features as evidence instead of
patching around them.

## Decision classification

The probe emits a candidate decision, not an automatic architectural approval:

- `A-candidate`: automated baseline passes, including the probed MV3/runtime and
  WebMCP surface. Representative real-extension/manual credential validation is
  still required.
- `B-candidate`: core browser requirements and at least one supported extension
  execution path pass, but compatibility breadth is limited or unproven.
- `C-candidate`: Electron misses a required baseline and a different
  Chromium-grade built-in runtime must be evaluated.

The final 0020 decision is not complete until the local artifact and manual
representative-extension results are attached to this task.

## Manual evidence still required

- [ ] run `corepack pnpm bench:browser-runtime`;
- [ ] attach the generated JSON artifact path;
- [ ] test at least three representative extensions:
  - content-script-heavy extension;
  - background/runtime-messaging extension;
  - storage/permissions-heavy extension;
- [ ] restart ND/Electron and confirm ND-managed extension enablement can be
  restored deterministically;
- [ ] validate secure credential-vault behavior on the target OS;
- [ ] validate WebMCP/site-tool feasibility in the chosen Chromium runtime;
- [ ] record the final A/B/C decision with evidence.

Do not start task 0021 implementation until this decision is recorded.

## Decision recorded

**Decision: B — keep Electron with a documented compatibility ceiling.**

The implementation branch now treats Electron as the built-in browser runtime,
while refusing to claim arbitrary Chrome Web Store compatibility. That decision
matches PRD 0005's product requirement: first-class extensions in the built-in
browser are required, but compatibility breadth is evidence-based.

Why B rather than A:

- ND now has real multi-tab `WebContentsView` support on one persistent profile;
- history, downloads, browser-data controls, secure credential storage, site
  permissions, extension loading, WebMCP-style site tools and agent control are
  implemented behind BrowserTarget;
- the extension manager explicitly reports compatibility as limited/error rather
  than implying full Chrome parity;
- the local runtime spike and representative real-extension matrix still need to
  be executed on the operator machine before release claims.

If local validation shows Electron cannot satisfy the required representative
extension set, reopen this decision and move to option C without changing the
BrowserTarget contract.

Implementation evidence:

- `benchmarks/browser-runtime-spike.mjs`
- `benchmarks/browser-runtime-spike-electron.mjs`
- `src/main/browser/browser-extension-manager.ts`
- `src/main/browser/browser-credential-vault.ts`
- `src/main/browser/browser-download-manager.ts`
- `src/main/browser/browser-history-store.ts`
- `src/main/browser/browser-controller.ts`

The remaining local checks are validation evidence, not missing implementation.
