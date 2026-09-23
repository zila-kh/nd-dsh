---
id: "0005"
title: "Unified Browser Platform — Built-in Browser + Chrome Companion"
status: proposed
last-audit: 2026-09-23
---

# PRD 0005 — Unified Browser Platform

## 1. Problem

ND currently has two browser directions:

1. the existing ND built-in Electron browser, optimized around the visible
   application/browser pane and agent-browser binding; and
2. the Browser Companion in PR #32, which targets the user's existing Chrome
   profile through an extension and Native Messaging.

Without a unifying product contract, engines and users would need to understand
two browser implementations, policy could diverge, and future features such as
tabs, downloads, credentials, extensions and site tools could be duplicated.

## 2. Product outcome

ND presents one browser capability with multiple explicit targets.

Users can keep work in ND's built-in browser or intentionally use their existing
Chrome profile. Agents use the same high-level tools regardless of the target.

~~~text
                   ND Browser Capability
                          |
                  BrowserTargetRouter
                   /              \
                  /                \
        ND built-in browser      Chrome Companion
        own browser state        existing Chrome state
~~~

## 3. Goals

- one BrowserTarget contract for built-in and Chrome;
- built-in persistent browser profile and multi-tab UX;
- direct control of the exact visible built-in tab;
- explicit access to existing Chrome tabs through Browser Companion;
- safe automatic target selection where identity is unambiguous;
- built-in navigation/history/download lifecycle;
- secure password/autofill mediation without agent-visible secrets;
- **first-class extension support in the built-in browser** with an honest,
  evidence-based compatibility model;
- WebMCP/site-tool support where websites expose structured tools;
- unified site permissions, organization policy, tab leases and audit;
- engine-neutral delivery through ND's existing routing architecture;
- measurable performance and restart/recovery evidence.

## 4. Non-goals

- no claim of 100% Chrome extension compatibility without evidence;
- no raw cookie/password/token export to agents;
- no silent profile/account switching;
- no browser implementation logic inside company/task domain objects;
- no vendor-engine-specific browser APIs;
- no replacement of PR #32 Native Messaging with a localhost network listener;
- no Chromium fork unless the runtime decision spike proves it necessary;
- no Firefox/Safari requirement in this wave.

## 5. Dependency

PR #32 / PRD 0004 is the external-browser transport foundation and remains
independently reviewable.

This PRD does not require PR #32 to be merged before planning, but implementation
of CompanionBrowserTarget depends on its final approved contract.

Task number 0019 is reserved by PR #32. This PRD starts its task set at 0020.

## 6. Competitive behavior reference

Public OpenAI documentation demonstrates a useful product model:

- a built-in desktop browser with its own browser state, multiple tabs,
  sign-in, downloads, autofill/password management and extensions;
- a Chrome extension for controlling the user's existing Chrome profile/tabs;
- WebMCP-backed site tools inside the built-in browser.

ND uses this as a behavior reference only. No undocumented OpenAI transport,
browser-engine or security implementation is assumed.

## 7. Runtime feasibility requirement

Built-in extension support is a hard product requirement. The implementation
spike determines which browser runtime can deliver it safely.

Electron supports persistent sessions and some unpacked extension APIs, but its
documentation explicitly says arbitrary Chrome extensions are not guaranteed.

Therefore implementation begins with a runtime capability spike.

The spike must produce a written decision covering:

- current Electron path;
- the required built-in extension baseline;
- representative extension compatibility;
- password/autofill feasibility;
- history/download support;
- WebMCP feasibility;
- multi-tab memory/performance;
- packaging/update footprint;
- alternative runtime cost if a must-have fails.

The minimum extension baseline is:

- install/load supported extensions in the ND-owned persistent profile;
- enable/disable/uninstall;
- persist extension state across restart;
- run content scripts in the intended tab;
- support the approved background/runtime messaging lifecycle;
- show extension permissions before activation;
- keep agent control bound to the exact visible ND tab while extensions run;
- clearly mark unsupported APIs/extensions.

If Electron cannot meet that baseline for the representative extension set, the
runtime decision must select a different Chromium-grade implementation behind
BrowserTarget. The requirement is extensions in the built-in browser; the
evidence-sensitive question is how broad compatibility can be.

No implementation phase may advertise "100% Chrome-compatible built-in browser"
before evidence proves it.

## 8. BrowserTarget model

~~~ts
interface BrowserTarget {
  descriptor(): BrowserTargetDescriptor
  capabilities(): BrowserTargetCapabilities

  listTabs(): Promise<BrowserTab[]>
  openTab(input?: OpenTabInput): Promise<BrowserTab>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>

  snapshot(tabId: string): Promise<BrowserSnapshot>
  navigate(tabId: string, url: string): Promise<BrowserTab>
  click(input: BrowserElementAction): Promise<BrowserActionResult>
  fill(input: BrowserFillAction): Promise<BrowserActionResult>
  press(input: BrowserKeyAction): Promise<BrowserActionResult>
  scroll(input: BrowserScrollAction): Promise<BrowserActionResult>
  waitFor(input: BrowserWaitInput): Promise<BrowserActionResult>
  screenshot(tabId: string): Promise<BrowserScreenshot>

  discoverSiteTools?(tabId: string): Promise<SiteToolDescriptor[]>
  callSiteTool?(input: SiteToolCall): Promise<SiteToolResult>
}
~~~

The contract is semantic. It must not expose CDP ids, extension ports or
Electron WebContents as agent-facing primitives.

## 9. Target descriptors

Every target identifies:

- target id;
- kind: `builtin` or `companion`;
- profile id/label;
- connection state;
- visible/focused state;
- capability flags;
- company/project binding policy;
- whether background control is supported.

Every tab identifies:

- stable ND tab id;
- underlying target id;
- title/url/origin;
- active/visible state;
- writable lease status;
- task/run owner when leased.

## 10. Built-in browser requirements

### Profile

Use a persistent ND-owned browser profile.

Support:

- cookies/session persistence;
- site data;
- history;
- per-site permission state;
- browser-data clearing;
- multiple tabs sharing the intended profile.

### Tabs

The shell must make tab identity explicit rather than assuming one
WebContentsView forever.

The agent always acts against an ND tab id whose visible/hidden state is known.

### Downloads

Downloads have:

- visible filename/origin/status;
- explicit destination policy;
- cancellation;
- completion/failure evidence;
- organization action normalization.

### Credentials and autofill

Users may save/fill credentials in the built-in browser.

Secrets must be protected by an OS-backed or equivalently reviewed secure store.

Agent-visible snapshots, logs, prompts and audit receipts never contain the
saved secret value.

The browser may complete an autofill action after user/policy authorization
without returning the secret to the model.

### Extensions

Extension support is required in the built-in ND browser, not delegated to the
external Chrome Companion.

ND provides an extension manager for the actually supported runtime.

It must display:

- extension name/version/id;
- requested permissions;
- compatible/limited/unsupported status;
- enabled state;
- startup/load errors.

Electron's documented compatibility limitation must remain visible in product
and developer docs until evidence proves broader compatibility. If Electron
cannot meet the required baseline, ND changes the built-in runtime rather than
dropping extension support.

### WebMCP/site tools

When the current website exposes supported WebMCP/site tools:

- discover them for the exact current tab/origin;
- show the tool surface to the user;
- route calls through the same organization policy boundary;
- treat returned site data as untrusted;
- prefer structured site tools over brittle DOM actions when both satisfy the
  task and policy.

## 11. Chrome Companion requirements

The companion remains the path for:

- existing Chrome profile;
- existing Chrome cookies/sessions;
- existing open tabs;
- existing Chrome extensions;
- background-capable work where the approved companion supports it.

Its Native Messaging boundary, per-origin site access and connection identity
stay intact.

The unified router adapts the companion; it does not bypass its controls.

## 12. Target selection

User-visible target controls:

- `@Browser`
- `@Chrome`
- `@Tab:<tab>`
- `Auto`

Explicit user target always wins.

Auto may select a target when capability and identity requirements are
unambiguous. Auto must not silently move from the built-in profile to a personal
Chrome account just because that profile is already signed in.

If account identity matters and ND cannot determine the intended profile safely,
the operation asks the user.

## 13. Site access and organization policy

There are two independent checks.

### Browser access

Can this browser target technically access/control the origin?

Examples:

- built-in allowed/blocked site;
- Chrome extension optional host permission.

### ND action policy

May this company/project/task perform the requested action?

Examples:

- reading a page;
- external publish;
- production deploy;
- spending;
- destructive changes;
- uploads/downloads;
- history access;
- credential/autofill usage.

Browser access can never override a DENY organization policy.

## 14. Tab leases and parallelism

One writable tab has one execution owner at a time.

A trusted lease binds:

- company;
- project;
- task;
- run;
- engine session;
- browser target;
- profile;
- tab.

The binding is created by ND's trusted control plane, not accepted from
agent-supplied ids.

Parallel teams can work simultaneously when they have separate writable tabs.

Read-only sharing may be introduced later but is not required for this wave.

## 15. Audit and provenance

Browser receipts record:

- target kind/profile id;
- tab id/origin;
- normalized action;
- policy decision;
- task/run/session;
- result;
- download/upload artifact metadata where applicable.

Do not record:

- raw passwords;
- cookie values;
- auth tokens;
- complete sensitive form contents unless explicitly required and approved.

## 16. UX

### Browser shell

The built-in browser gains:

- tab strip;
- active target/profile indicator;
- downloads surface;
- history/browser-data controls;
- extension manager;
- site-tool indicator;
- site permission state;
- agent-control indicator.

### Chat/work

The composer/context picker gains:

- `@Browser`
- `@Chrome`
- `@Tab`
- target indicator on active runs.

Automatic routing decisions must be inspectable after the fact.

## 17. Failure behavior

- built-in browser unavailable -> companion may be offered if approved;
- companion unavailable -> built-in browser remains usable;
- unsupported extension -> report unsupported, do not claim it loaded;
- stale semantic ref -> require a fresh snapshot;
- tab closed -> revoke lease;
- browser/profile restart -> reconcile stale leases;
- credential store unavailable -> do not persist secrets insecurely;
- WebMCP unavailable -> fall back to ordinary browser actions;
- policy classifier uncertain -> ASK, never implicit ALLOW.

## 18. Performance contract

Record at 1/2/4/8 tabs:

- browser target creation;
- tab open/activate;
- snapshot;
- click;
- navigation;
- screenshot;
- WebMCP discovery/call where available;
- Electron main RSS/heap;
- browser process RSS;
- companion native-host RSS;
- extension startup overhead.

Compare like-for-like operations between built-in and companion targets.

Performance claims require reproducible evidence bundles.

## 19. Acceptance

A representative end-to-end flow:

1. user opens an ND built-in browser tab and signs into a test account;
2. another task selects a connected Chrome profile;
3. both targets appear through the same BrowserTarget API;
4. two agents work in separate tabs in parallel;
5. each task can snapshot/click/fill/navigate its own tab;
6. site tools are used when exposed in the built-in browser;
7. a download is visible and governed;
8. saved-password/autofill secrets never appear in model-visible output;
9. a supported extension runs inside the built-in profile, survives restart,
   and affects the intended visible ND tab;
10. an unsupported extension/API is reported explicitly rather than pretending
    to work;
11. a high-impact browser action reaches the organization approval gate;
12. cross-task/cross-company tab takeover is rejected;
13. restarting either browser path reconciles connection/tab leases;
14. evidence shows the performance/memory cost of both paths.

## 20. Delivery order

1. task 0020 — runtime capability spike and decision;
2. task 0021 — BrowserTarget contract/router;
3. tasks 0022/0023 — built-in and companion adapters;
4. tasks 0024-0028 — browser product capabilities and policy;
5. task 0029 — target UX/auto routing;
6. task 0030 — full validation/evidence.

Implementation may parallelize after 0020/0021, but those two gates are
sequential and mandatory.
