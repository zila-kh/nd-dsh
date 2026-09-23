# Unified browser platform plan

> Status: implementation complete — local validation/evidence pending
> Planning branch: `feat/unified-browser-platform-plan`
> Implementation branch: `feat/unified-browser-platform`
> Base: `main@9e0fcc5`
> Builds on: Browser Companion MVP merged via PR #32 (`main@9e0fcc5`)
> Updated: 2026-09-24

## Objective

Give every ND agent one browser capability that can control either:

1. ND's built-in browser and its own persistent browser profile; or
2. the user's existing Chrome profile through the Browser Companion.

The user and agent should not need to learn two unrelated browser APIs. ND owns
target selection, permissions, leases, company/project/task scope, approvals,
audit, and the common tool contract.

This branch is documentation only. No implementation starts until task 0020
records the built-in-browser runtime decision.

## Product reference

The public ChatGPT desktop product is a useful behavior reference, not an
implementation specification:

- its built-in browser uses its own persistent browser state, supports multiple
  tabs, sign-in, downloads, richer autofill/password management, extensions,
  and agent control of the page;
- its Chrome extension lets the desktop app work with the user's existing
  Chrome profile, open tabs, signed-in sessions and installed Chrome extensions;
- site tools in the built-in browser use WebMCP when a website exposes them.

ND should match the useful product behavior while preserving ND's own trust
boundaries, multi-company/task model and engine-neutral routing.

Official public references:

- https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app
- https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app
- https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg

## Built-in extension support is a required product outcome

The ND built-in browser **must support browser extensions as a first-class
product capability**. This is not optional and is not satisfied merely by the
external Chrome Companion.

The runtime decision in task 0020 decides **how** ND delivers that capability,
not whether the capability exists.

Minimum built-in extension baseline:

- install/load a supported extension into the ND-owned persistent browser profile;
- enable/disable/uninstall it from ND;
- persist extension identity and enabled state across desktop restarts;
- run extension content scripts in the intended ND browser tab;
- support the background/runtime messaging lifecycle needed by the approved
  compatibility set;
- expose requested extension permissions to the user before activation;
- isolate extension state with the intended ND browser profile;
- report incompatible APIs/extensions clearly rather than silently degrading;
- keep agent browser control attached to the exact visible ND tab even while
  extensions are active.

Electron already gives ND persistent sessions, cookies, storage, cache and
download hooks, and can load some unpacked extensions into persistent sessions.

Electron explicitly does not promise arbitrary Chrome Web Store compatibility.
Therefore ND must not claim "100% Chrome extensions" until task 0020 proves the
runtime can satisfy that stronger requirement.

If Electron cannot satisfy the required baseline for the representative extension
set, task 0020 must select a different Chromium-grade built-in runtime behind the
same BrowserTarget contract. Keeping Electron is not allowed to silently drop
the built-in-extension requirement.

Reference:

- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/extensions

## Target architecture

~~~text
                              ND agent / company runtime
                                       |
                               BrowserTargetRouter
                                       |
                    +------------------+------------------+
                    |                                     |
                    v                                     v
             BuiltinBrowserTarget                 CompanionBrowserTarget
                    |                                     |
            ND built-in browser                    Browser Companion
                    |                                     |
          ND persistent browser state              user's real Chrome
                    |                                     |
      +-------------+-------------+             existing profile/tabs/
      |             |             |             cookies/extensions
      v             v             v
  tabs/profile   site tools   extensions
      |
  downloads/history/autofill
~~~

Every target implements one common BrowserTarget contract. Engines and agents
must not branch on Electron/CDP versus Chrome-extension implementation details.

## BrowserTarget contract

The first common contract should cover:

- targets/list and target metadata;
- tabs/list/open/activate/close;
- snapshot with revision;
- click/fill/press/scroll;
- navigate/back/forward/reload;
- screenshot;
- waitFor;
- download status;
- site-tool discovery/invocation;
- explicit target/profile selection;
- writable tab lease acquisition/release;
- target capabilities so unsupported features fail honestly.

Capability flags should include at least:

- tabs
- semanticDom
- screenshots
- downloads
- uploads
- history
- credentials
- extensions
- siteTools
- backgroundControl

## Target selection

Explicit user intent wins:

- `@Browser` -> ND built-in browser
- `@Chrome` -> external Chrome companion
- `@Tab:<name>` -> exact selected tab
- `auto` -> router may choose only among already-approved targets

Automatic selection must not silently cross a browser-identity boundary when
that changes which account/profile is used. The UI must show the active target.

Initial routing policy:

1. explicit target;
2. tab mention/binding;
3. current visible target if it satisfies the task;
4. company/project browser default;
5. deterministic capability fit;
6. ask when identity/account ambiguity remains.

## Built-in browser product target

The built-in browser should become a first-class browser product rather than a
single preview surface:

- persistent ND browser profile;
- multiple tabs;
- navigation/history;
- cookies and site data;
- downloads with visible progress and save policy;
- sign-in in the browser, never by pasting secrets into chat;
- password save/fill with secrets kept outside agent-visible page snapshots;
- autofill;
- **built-in extension support as a required capability**, with an extension
  manager for the runtime's actually-supported extension surface;
- WebMCP/site-tool discovery;
- annotation/inspect;
- exact visible-tab agent control;
- browser-data clearing by site or profile.

The product requirement is "Chrome-class browser experience", not an unsupported
claim that Electron is Chrome.

## Existing-Chrome target

The Browser Companion MVP merged via PR #32 provides the external Chrome path:

- Chrome MV3 extension;
- Native Messaging;
- existing Chrome tabs/profile;
- optional site access;
- semantic refs;
- single-writer tab leases.

Task 0023 will adapt that implementation behind BrowserTarget without replacing
its transport/security boundary.

## Security model

### Browser identity is security-sensitive

The built-in profile and a user's Chrome profile are different identity
boundaries. A task must know which one it is operating.

### Credentials

Agents must never receive saved password values, secure tokens or raw browser
credential-store entries.

Password/autofill behavior is mediated by the browser/credential service. Agent
actions may focus or submit fields, but secret material is not added to
snapshots, prompts, logs, run receipts or MCP results.

### Page content

DOM text, accessibility text and WebMCP/site-tool output are untrusted
application data, never agent instructions.

### Website access

Browser technical permission and ND company policy are distinct:

- browser/site permission decides whether the browser can access/control a host;
- organization policy decides whether the requested action may execute.

### High-impact actions

Normalize browser actions before execution. Examples:

- deploy/publish -> `production.deploy` / `external.publish`
- purchase -> `money.spend`
- destructive deletion -> `data.destructive`
- upload/download -> `file.upload` / `file.download`
- history access -> sensitive browser-data access

ALLOW/ASK/DENY stays in the trusted main-process control plane.

## Multi-company and parallel work

Browser tabs are task resources just like worktrees.

A writable tab lease carries:

- targetId
- profileId
- tabId
- companyId
- projectId
- taskId
- runId
- engineSessionId

Rules:

- one writable owner per tab;
- multiple tasks may run in parallel on different tabs;
- task cancel/finish releases the lease;
- tab close revokes the lease;
- browser restart reconciles stale leases;
- company/profile sharing must be explicit and visible;
- a task cannot claim a different company's tab by supplying ids in an
  agent-facing request.

## Runtime decision gate

Task 0020 must answer the biggest architectural question before implementation:

Can the current Electron browser satisfy the built-in product target safely and
with acceptable compatibility?

Measure/verify:

- persistent profile behavior;
- multi-tab WebContentsView/session sharing;
- cookies/site-data clearing;
- downloads;
- credential/autofill feasibility;
- extension APIs required by representative real extensions;
- extension lifecycle/reload;
- WebMCP/site-tool feasibility;
- packaging/update footprint;
- crash/restart behavior;
- agent control latency;
- memory per 1/2/4/8 tabs.

Decision options:

A. Continue with Electron because it satisfies the required extension baseline
   and the rest of the built-in browser contract.
B. Continue with Electron with a documented compatibility ceiling only if the
   required representative extension set still passes.
C. Introduce a different Chromium-grade embedded runtime behind BrowserTarget
   when Electron cannot satisfy the required extension baseline or another
   must-have browser requirement.

Built-in extension support itself is not negotiable. What remains evidence-based
is the breadth of compatibility, including whether ND can ever claim broad
Chrome Web Store parity.

Do not fork or replace the browser engine without evidence from this gate, and
do not keep Electron merely to avoid a runtime change if it fails a required
capability.

## Work breakdown

| Task | Scope | Depends on |
| --- | --- | --- |
| 0020 | built-in browser runtime capability spike + decision | Browser Companion merged baseline reference |
| 0021 | BrowserTarget contract + target router | 0020 |
| 0022 | built-in multi-tab/profile target | 0021 |
| 0023 | Browser Companion adapter convergence | merged Browser Companion baseline, 0021 |
| 0024 | built-in history/download/browser-data manager | 0022 |
| 0025 | credential vault + password/autofill mediation | 0020, 0022 |
| 0026 | built-in extension manager + compatibility matrix | 0020, 0022 |
| 0027 | WebMCP/site tools | 0021, 0022 |
| 0028 | unified policy/permissions/audit + trusted leases | 0021, 0023 |
| 0029 | target picker + safe auto routing | 0021, 0022, 0023, 0028 |
| 0030 | validation, benchmarks and release evidence | all implementation tasks |

## Parallel execution after 0020/0021

~~~text
0020 runtime decision
        |
0021 BrowserTarget/router
        |
 +------+------+---------+---------+
 |             |         |         |
0022          0023      0027      0028
built-in      companion  WebMCP    policy/leases
 |
 +-----+-----+
 |           |
0024        0025/0026
data        credentials/extensions
 +-----------+-----------+---------+
                         |
                       0029
                    UX/auto-route
                         |
                       0030
                  validation/evidence
~~~

0024, 0025 and 0026 can run in parallel once 0022 freezes the built-in profile
and tab ownership contract.

## Evidence rules

Do not claim parity based on screenshots or public competitor behavior.

Before release claims, record:

- built-in cold start and tab-open latency;
- 1/2/4/8-tab memory;
- snapshot/click/navigation p50/p95;
- companion bridge p50/p95;
- download overhead;
- WebMCP discovery/invocation overhead;
- extension install/load/restart persistence for the representative set;
- extension startup cost for supported examples;
- extension content-script + background/runtime messaging correctness;
- restart/recovery;
- cross-company/task lease rejection;
- password/history privacy checks.

Keep browser process memory separate from Electron main, nd-core, native host and
external agent-engine memory.

## Exit condition for the planning phase

Planning is complete when:

- PRD 0005 is approved;
- task 0020-0030 scopes are accepted;
- the Browser Companion baseline already merged on `main` remains preserved as the external-browser foundation;
- no browser-platform implementation has been added to this documentation branch.

Then implementation starts with task 0020 only.


## Implementation result

The 0020-0030 implementation scope is complete on
`feat/unified-browser-platform`.

The chosen runtime decision is **B**: retain Electron for the built-in browser
with first-class extension support and an explicit compatibility ceiling. ND
does not claim arbitrary Chrome Web Store parity.

The implementation includes the common target router, real built-in tabs,
Chrome Companion convergence, history/downloads/browser data, encrypted
credential mediation, extension management, site tools, trusted leases/policy,
target UX, focused tests and benchmark harnesses.

The remaining gate is the local validation handoff: run the correctness suites,
runtime spike, unified browser benchmark, real Chrome/native-host smoke,
representative extension matrix, credential privacy checks and restart/recovery
checks before merge/release claims.
