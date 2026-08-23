# ND Coding Engine Architecture

## Rule

ND owns identity, configuration, authorization, orchestration, and durable state. Coding engines own execution.

A coding engine is not a model provider. A provider answers LLM requests; an engine owns an agent/execution environment. Keeping those concepts separate lets one ND company use many model vendors while also choosing different coding runtimes.

## Control plane

```text
ND company / project / role / AI employee / task
                 |
                 +---- provider route ----> model vendor/gateway
                 |
                 `---- employee engine ---> ND engine registry
                                             |-- ND Harness
                                             |-- Codex CLI
                                             `-- future engines
```

Engine-specific filesystem paths, process protocols, authentication details, or sandbox vocabulary stay inside adapters/probes. Company/task/workflow semantics do not branch on vendor package names.

## Employee engine routing

ND persists explicit non-default employee assignments in `engine-assignments.json`. Employees with no row use `nd-harness`.

The Workforce UI reads the engine catalog from the main process and lets the user select only available engines. Before an organization task creates a run receipt, the orchestrator resolves the assigned employee's engine and checks availability. This prevents an unavailable engine from leaving a false running task behind.

The current engine route applies to **assigned task execution**. PM planning and independent review remain on the primary ND Harness path for this beta. That boundary is intentional and should be generalized only when additional engines expose equivalent structured planning/review contracts.

## Current engines

### `nd-harness`

Primary runtime. Capabilities advertised by ND:

- workspace execution
- filesystem and shell
- visible browser integration
- ND skills
- MCP
- ND model-provider routing
- human approval/question bridge
- event streaming
- persistent sessions

### `codex`

Delegated one-shot coding engine backed by the pinned Harness `subagent-codex` package and its package-local official Codex app-server.

Capabilities ND currently advertises:

- same workspace
- filesystem
- shell
- one-shot final result

For a Codex-routed employee, ND starts the normal organization run in its primary runtime, instructs the parent agent to delegate the complete implementation through `subagent_codex`, and then requires the parent to inspect the real workspace and run validation before it reports the worker result. The independent ND reviewer still verifies the task afterward.

ND does **not** currently advertise the delegated Codex route as having ND browser integration, ND skill/MCP compilation, human approval streaming, provider routing, or persistent Codex threads. Native Codex authentication, `HOME` / `CODEX_HOME`, model configuration, project trust, and account state remain authoritative.

The default ND Codex provider configuration uses the pinned adapter's fail-closed `never` permission mode. ND never selects the dangerous sandbox bypass implicitly.

### `codex-cli`

Direct coding engine: ND's own main process spawns and manages the official Codex app-server (`@openai/codex`, resolved from the same pinned vendored payload the delegated adapter uses; `ND_DSH_CODEX_BINARY` is a developer-only override). One app-server child hosts one native thread per ND session; wire activity is translated into ND's shared event vocabulary so organization runs and the workbench chat consume it exactly like primary-runtime events.

Capabilities ND advertises:

- workspace execution (thread cwd is fixed at creation)
- filesystem and shell
- streamed progress in the workbench chat panel
- human approvals: interactive threads request escalation approval through ND's approval cards; unattended organization runs use the fail-closed `never` policy and never ask

ND does not yet advertise persistent sessions across restarts (threads live in memory per app run), browser integration, skill/MCP compilation, or ND model-provider routing for this engine; those descriptors stay honestly false. Native Codex authentication and model configuration remain authoritative, and ND strips its own runtime environment variables before spawning the child.

Engine-specific execution guidance for organization workers lives on each descriptor (`workerInstructions`) rather than in workflow code: plan/review still run on the primary ND Harness path, while assigned task execution creates its session directly on the assigned engine through the session router.

## Capability registry

The renderer never decides engine availability. `CodingEngineRegistry` probes the installed/built runtime and returns `CodingEngineDescriptor` values through narrow IPC.

Engine state should eventually distinguish:

- installed/available
- authenticated
- healthy/degraded
- rate-limited
- policy-compatible for the requested task

Today the registry implements installation/build availability and durable employee routing. Authentication/health probes are a public-beta release follow-up.

## Target direct-adapter contract

The delegated Codex path reuses the pinned Harness provider, while `codex-cli` already implements the direct shape: ND owns the child process lifecycle and translates its protocol into ND-owned events. Both engines sit behind the same seams — the catalog (descriptors + capability honesty), the registry (availability probes + durable routing), and the session router (which engine owns which session) — so Company, Project, Role, Task, Skill, or Workflow data never changes shape when another local/remote coding engine is added.

## Skills and MCP

ND skills and MCP configuration are product concepts even when an engine implements the protocol.

```text
ND Skill / MCP Registry
        |
        +--> Harness compiler
        +--> Codex compiler
        `--> future engine compiler
```

The current organization already owns scoped skill objects, while Harness supplies the execution/tool implementation. A durable ND MCP registry and engine-specific compilers are still future work. Until an engine compiler exists, its descriptor must report the corresponding capability as false even if the underlying product supports something similar natively.

## Policy boundary

Organization plan/execute/review policies are checked before workflow stages start. Approval-bearing organization runs also pass through `OrganizationApprovalGate` in the Electron main process before React sees them:

- explicit `DENY` -> rejected before UI
- explicit `ALLOW` -> allow-once
- `ASK` -> human approval UI
- uncertain classification or gate failure -> human approval UI

The pinned Harness approval wire currently exposes tool name/reason but not arbitrary tool arguments. The classifier is therefore deliberately conservative. Full enterprise policy consistency requires ND action envelopes from browser/MCP/engine adapters for operations that may not emit a Harness approval frame.

The delegated Codex one-shot path does not expose an ND human-approval stream; its default permission mode is therefore fail-closed rather than silently auto-escalating. The direct `codex-cli` engine does surface approval requests for interactive threads through the same gate and cards; its unattended organization runs keep the fail-closed `never` policy.

## Public-beta safety

- Production renderer fails closed when trusted desktop bridges are missing; no mock runtime is installed.
- Engine capability claims are conservative.
- Employee engine assignments are durable and validated before organization runs start.
- Codex stays fail-closed by default: delegated runs never ask, direct unattended runs use the `never` policy, and only interactive `codex-cli` threads can request a human approval.
- Main-process organization approvals respect company policy before reaching the renderer.
- Runtime packaging, signing, installed-app E2E, Codex auth/health onboarding, and normalized cross-engine action metadata remain release gates.
