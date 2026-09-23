# TODO 0020 — Built-in browser runtime capability spike

> Priority: P1
> Owner: ND browser/runtime
> Status: todo
> Branch target: `feat/unified-browser-platform`
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
