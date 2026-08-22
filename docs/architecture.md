# ND-DSH architecture

ND-DSH is the product and control plane. Model vendors and coding runtimes are replaceable execution dependencies.

## Ownership

| Subsystem | Product owner | Runtime implementation |
| --- | --- | --- |
| companies, projects, goals, tasks | ND-DSH | `OrganizationStore` + orchestrator |
| teams, roles, AI employees | ND-DSH | organization domain |
| skills and memory | ND-DSH | compiled into runtime context/tools |
| company policy | ND-DSH | orchestrator + main-process approval gate |
| model-provider routes | ND-DSH | provider compiler → Harness LLM adapters |
| coding-engine routes | ND-DSH | engine registry + per-employee assignments |
| primary coding runtime | ND-DSH adapter | pinned DeepSeek Harness |
| delegated Codex execution | ND-DSH adapter | pinned Harness Codex provider → official Codex app-server |
| visible browser | ND-DSH / Electron | one `WebContentsView` + exact CDP target |
| browser automation | ND-DSH integration | agent-browser + Harness MCP client |
| desktop lifecycle / IPC | ND-DSH | Electron main + context-isolated preload |
| product UI | ND-DSH | React renderer |

The source may contain upstream package names where they are technically required, but product-domain state and user-facing identity must not depend on one model vendor or coding engine.

## Process graph

```text
ND-DSH React product UI
        |
        v
context-isolated preload / narrow IPC
        |
        v
Electron main process
  |-- organization state + PM/worker/reviewer orchestrator
  |-- provider control plane + encrypted credentials
  |-- coding-engine registry + employee assignments
  |-- company approval policy gate
  |-- workspace service
  |-- visible browser controller
  |
  `-- ND Harness adapter
        |
        `-- pinned Harness child: dsh --profile web --patch ...
              |-- provider-neutral LLM runtime
              |-- workspace filesystem / shell / jobs
              |-- ND skills / workflow tools
              |-- browser MCP -> exact visible Electron target
              `-- optional Codex provider
                    `-- package-local official codex app-server --stdio
```

The hidden Harness web surface remains compatibility/debug infrastructure. ND-DSH forces the normal product surface to the ND workbench and does not present the upstream UI as product identity.

## Control-plane state

ND keeps durable product state outside runtime-vendor configuration:

- `organization.json` — companies, projects, workforce, workflows, tasks, policies, memory, activity, run receipts.
- `organization.json.bak` — last-known-good organization recovery copy.
- `providers.json` — provider metadata only; no API keys.
- `provider-secrets.json` — OS-backed encrypted provider credentials where secure storage is available.
- `engine-assignments.json` — per-AI-employee coding-engine routes; absence means `nd-harness`.
- Harness session storage — durable execution transcripts owned by the runtime adapter.

Organization state uses validated snapshots, serialized/atomic writes, backup recovery, and startup reconciliation for interrupted runs. Engine assignments use atomic writes and fail back to the primary ND Harness route if the assignment file is unreadable.

Provider credentials are write-only from the renderer's point of view. `ProviderStore.list()` returns `apiKey: ''` plus a `hasApiKey` flag; replacement and clearing use dedicated validated IPC calls. The decrypted value stays in the trusted main process and only enters the ephemeral environment inherited by the model-runtime child.

## Model providers are not coding engines

A **provider** supplies a model endpoint. A **coding engine** supplies an agent/execution environment.

```text
AI employee
   |
   +-- model route --------> DeepSeek / OpenAI-style / Anthropic-style / catalog / gateway
   |
   `-- coding engine ------> ND Harness / Codex CLI / future engine
```

`src/main/provider-runtime.ts` compiles enabled ND provider settings into provider+model routes. DeepSeek remains a seeded compatibility route; the company/task domain does not depend on it.

`src/main/engines/` owns the coding-engine registry and employee assignments. The current Codex route is deliberately marked **delegated** because an ND Harness parent session invokes the pinned one-shot Codex provider and then validates the resulting workspace. A future direct persistent Codex adapter can implement the same ND engine contract without changing organization semantics.

## AI company execution

```text
objective
  -> AI PM plan
  -> goal / milestones / dependency-aware tasks
  -> assigned employee
  -> resolve employee coding engine
  -> real workspace execution
  -> independent reviewer
  -> pass: memory + unlock dependency
     fail: block or bounded autonomy-4 rework
  -> next ready task
```

One organization run owns the shared runtime/workspace at a time. Cancellation never counts as completion. A desktop restart converts stale running receipts to explicit interrupted failures so projects cannot remain permanently locked.

## Approval and policy boundary

Organization-level plan/execute/review policy is checked before a run starts. Runtime permission escalations are also intercepted in the main process before they reach React.

For an approval-bearing organization run:

1. ND associates the session with its organization run.
2. A conservative classifier maps high-confidence requests to existing company actions such as `external.publish`, `production.deploy`, `money.spend`, or `data.destructive`.
3. `DENY` is rejected in the main process.
4. `ALLOW` is resolved as allow-once.
5. `ASK`, unknown requests, classification uncertainty, or gate errors remain human-visible.

The pinned Harness approval wire exposes tool name and reason, not arbitrary tool arguments. ND therefore does **not** claim perfect semantic enforcement for every possible command. Non-approval-bearing browser/MCP/external actions still need normalized action metadata before enterprise GA.

## Same-browser invariant

The browser visible to the user is the browser controlled by the agent. ND asks the embedded view's debugger for its exact CDP `targetId`, then binds agent-browser to that target. The CLI and MCP integration share the same generated agent-browser config/session so an agent cannot silently create a second hidden browser.

The product browser starts at `about:blank`; localhost development pages are opened only when explicitly requested.

## Renderer trust boundary

- Node integration: off.
- Context isolation: on.
- Renderer sandbox: on.
- Web security: on.
- Main-process IPC: trusted main frame only with bounded inputs.
- Browser permissions: denied by default.
- External URLs: HTTP/HTTPS only.
- Workspace reads: root-contained with realpath/symlink protections.
- Existing provider credentials: never returned to React; only existence/replacement/clear operations are exposed.

If the trusted preload or organization bridge is unavailable, the renderer fails closed with a runtime-unavailable screen. It does not create demo companies, fake sessions, mock workspaces, or localStorage product state.

## Coding-engine capability posture

ND advertises only capabilities it actually wires.

### ND Harness

- durable sessions and streaming
- filesystem and shell
- visible browser
- ND skills and MCP
- provider-neutral model routing
- human approvals/questions

### Codex CLI (current delegated adapter)

- same workspace
- filesystem and shell through Codex
- one-shot final result

ND does not yet advertise the delegated Codex route as having ND browser, ND MCP/skill compilation, human approval streaming, or persistent Codex threads. Native Codex account/auth/model/project configuration remains authoritative.

## Failure behavior

- Missing/unbuilt Harness: engine is unavailable and a run is rejected before a false run receipt is created.
- Missing/unbuilt Codex adapter: employees cannot be newly assigned to Codex and existing Codex-routed work is rejected before starting.
- Codex auth/trust failure: task remains a visible failure/blocker; ND does not invent completion.
- Missing provider credential: the active route reports its real model error; provider metadata never substitutes a fake result.
- Secure credential store unavailable: key remains memory-only instead of being persisted insecurely.
- Browser bridge unavailable: visible browser remains manual; agent browser capability reports unavailable.
- Approval policy gate failure: request falls back to human `ASK`, never implicit allow.
- App restart mid-run: stale organization run is reconciled as interrupted/failed.

## Public-beta release gates

Passing source CI is necessary but not sufficient for a public desktop release. Before publishing installers, ND still needs:

- packaged/bundled Node-compatible Harness and agent-browser runtime assets
- macOS signing/notarization and Windows signing
- installed-app E2E on supported platforms
- Codex authentication/health onboarding UX
- normalized action metadata for policy enforcement beyond Harness approval frames
- update/release provenance, SBOM/notices, and crash provenance policy

These are release engineering and policy-completeness gates, not mock functionality; the product runtime used by the desktop is real.
