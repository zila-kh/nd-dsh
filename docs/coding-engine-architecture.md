# ND Coding Engine Architecture

## Rule

ND owns identity, configuration, authorization, orchestration, and durable state. Coding engines own execution.

A coding engine is not a model provider. A provider answers LLM requests; an engine owns an agent/execution environment. Keeping those concepts separate lets one ND company use many model vendors while also choosing different coding runtimes.

## Control plane

```text
ND company / project / role / agent / task
                 |
                 +---- provider route ----> model vendor/gateway
                 |
                 +---- engine registry ----> execution adapter
                                             |-- ND Harness
                                             |-- Codex CLI
                                             `-- future engines
```

ND domain code must not branch on vendor package names. Engine-specific filesystem paths, process protocols, authentication details, or sandbox vocabulary belong inside adapters/probes.

## Current engines

### `nd-harness`

Primary runtime. Capabilities currently advertised by ND:

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

Delegated one-shot coding engine backed by the pinned Harness `subagent-codex` package and the official package-local Codex app-server. Current ND integration intentionally advertises only the capabilities ND actually connects today:

- same workspace
- filesystem
- shell
- one-shot final result

It does **not** currently advertise ND browser, ND skill compilation, ND MCP compilation, ND provider routing, a human approval bridge, streaming child activity, or persistent Codex threads. Codex itself may support additional native features; ND must not claim them until its adapter/control plane wires and governs them.

Native Codex authentication, `HOME` / `CODEX_HOME`, model configuration, project trust, and account state remain authoritative. The default ND profile uses Codex permission mode `never`, which fails closed on approval-requiring operations. ND does not silently select the dangerous sandbox bypass.

## Capability registry

The renderer never decides engine availability. The main process probes the installed/built runtime and returns `CodingEngineDescriptor` objects through a narrow IPC method. The UI therefore displays capabilities from the runtime control plane rather than maintaining a second hard-coded engine list.

An unavailable engine is still a known product capability and includes a reason. Availability is not the same as authentication or service health; those states should become separate fields as adapters gain richer lifecycle APIs.

## Next adapter contract

The registry is intentionally smaller than a full execution interface in the first beta increment. The next stage should promote adapters behind a contract shaped around ND concepts:

```ts
interface CodingEngine {
  descriptor(): CodingEngineDescriptor
  health(): Promise<EngineHealth>
  createSession(input: EngineSessionInput): Promise<EngineSession>
  run(input: EngineRunInput): Promise<EngineRunReceipt>
  cancel(runId: string): Promise<void>
}
```

The input is compiled from ND company/project/role/agent/task state. Engine adapters may translate that into Harness sessions, Codex threads, another CLI protocol, or a remote runtime without changing organization workflow semantics.

## Skills and MCP

ND skills and MCP configuration must become control-plane objects, not Harness- or Codex-owned product state.

```text
ND Skill / MCP Registry
        |
        +--> Harness compiler
        +--> Codex compiler
        `--> future engine compiler
```

Until a compiler exists for an engine, its descriptor must report that capability as false even if the underlying product supports something similar natively.

## Public-beta safety

- Production renderer fails closed when the trusted desktop bridges are missing; it does not install mock runtime services.
- Engine capability claims are conservative.
- Codex remains one-shot and fail-closed by default.
- Organization policy still requires a future action/tool-boundary enforcement layer before ND can claim enterprise-grade policy control across all engines.
- Runtime packaging and installed-app E2E remain release gates.
