# TODO 0027 — WebMCP and site tools

> Priority: P1
> Owner: ND browser/tools
> Status: merged to main via PR #41 — implementation complete; runtime/site fixture validation pending
> Depends on: 0021, 0022

## Objective

Discover and invoke structured website tools from the exact active browser tab
when a site exposes a supported WebMCP/site-tool surface.

## Scope

- discovery for current tab/origin;
- tool descriptors and schemas;
- tool invocation;
- result normalization;
- origin/tab binding;
- policy classification;
- audit;
- fallback to normal DOM actions when unavailable.

## Security

Site-tool output is untrusted application data, never instructions.
A site tool cannot grant itself additional ND capabilities or bypass policy.

## Acceptance

A fixture site exposing structured tools can be discovered and called from the
built-in browser through the common BrowserTarget/tool route.

## Implementation evidence

- BrowserTarget exposes `discoverSiteTools` and `callSiteTool`.
- built-in target discovers the current tab's model-context/site-tool surface.
- calls remain tab/origin-bound and flow through unified browser policy.
- site-tool results remain untrusted application data.
- the unified browser benchmark includes fixture discovery/invocation timing.

Local validation still needs the chosen runtime/site fixture evidence.
