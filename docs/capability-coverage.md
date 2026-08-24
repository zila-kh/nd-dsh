# Capability coverage across the Harness boundary

Outcome of the vendor audit over the tracked DeepSeek Harness checkout. It records, per runtime surface, how much ND wraps, passes through, or deliberately leaves engine-private today, and which surfaces are staged behind the capability registry (`src/main/capabilities/`) instead of being wired now.

## Status legend

| Status | Meaning |
| --- | --- |
| **Wrapped** | ND owns the product behavior and injects it into the runtime through adapters, compiled context/tools, or the sanctioned patch overlay. No vendored core changes. |
| **Passthrough** | ND relies on engine-native behavior unchanged; the surface is exercised through the gateway/RPC contract but not reimplemented or relocated. |
| **Engine-private by design** | The runtime owns the surface end to end. ND reads results through contracts and does not reach into internals. |
| **Planned provider slot** | Contracted capability slot in the registry (`src/shared/capabilities.ts`), unavailable until its integration ships; built-ins stay active meanwhile. |

## Coverage matrix

| Runtime surface | Status | Notes |
| --- | --- | --- |
| Sessions / persistence | **Engine-private by design** | Durable execution transcripts are owned by the runtime adapter (`docs/architecture.md`, control-plane state). ND associates runs and reads transcripts via IPC/gateway, never by relocating engine storage. See the `DSH_SESSION_ROOT` cleanup note below. |
| Compaction | **Engine-private by design** | Context compaction inside long worker sessions is runtime-owned; ND observes outcomes through the event stream only. |
| Projections / spill | **Engine-private by design** | Derived stores (session-query indexes, spill policies and their private local storage) are deployment decisions of the runtime, not product state. ND keeps them out of the control plane. |
| AGENTS.md instruction chain | **Passthrough** | Workspace-level instruction files load through the engine chain as-is; ND adds organization context (role, skills, memory, policies) around it, not instead of it. |
| Skills | **Wrapped** | Skills live in the organization store and compile into runtime context/tools per assignment; the engine has no independent skill configuration path in ND. |
| Presets | **Wrapped** | ND ships its own agent preset(s) (for example `nd-dsh`) through patch rows; the preset loader itself stays upstream. |
| MCP patch rows | **Wrapped** | Tool/MCP additions mount exclusively via the sanctioned harness patch overlay (`--patch`), the seam reserved for future in-loop plugins such as `nd-memory-mcp`. |
| LLM routing | **Wrapped** | `src/main/provider-runtime.ts` compiles enabled ND providers into model routes; DeepSeek remains a seeded compatibility route, not product identity. |
| Codex delegation / direct | **Wrapped** | Both Codex routes are replaceable engine adapters behind the ND coding-engine contract (delegated one-shot provider; direct managed CLI). Authentication/model config stay native to Codex. |
| Gateway RPC groups | **Passthrough** | Session, history, models, skill, and preset RPC groups are consumed through the narrow `dsh.rpc` bridge exactly as the gateway exposes them; ND neither forks nor filters the group schema. |
| Permissions / sandbox | **Wrapped** | Harness approval frames are intercepted in the main process under the company policy gate (DENY rejected, ASK human-visible, failures fall back to ASK); renderer sandboxing, loopback-only CDP, and workspace-write defaults stay enforced by ND. |
| Session search | **Planned provider slot** | Dormant upstream (model-facing query tools are opt-in and unmounted in shipped compositions). Staged as the `nd-session-recall` context slot, to be mounted as worker recall tools via the patch overlay when activated. |

Related staged memory/context slots from the same audit: `openviking-memory` and `graphify-context` (external integrations, not yet shipped) and `nd-memory-mcp` (in-loop organization-memory tools). All four adapter slots are visible-but-unavailable in the capability registry until their integrations land.

## `DSH_SESSION_ROOT` cleanup

A dead `DSH_SESSION_ROOT` override path existed in main-process code even though nothing consumed the variable. It was removed rather than wired: session storage location remains a decision of the runtime adapter. If ND ever needs to relocate harness session storage, that must arrive as an explicit adapter contract, not a silently ignored environment variable.

## Submodule rule

DeepSeek Harness is vendored as an upstream-tracking Git submodule (`vendor/README.md`). While ND-DSH is in beta it tracks upstream latest, synced at bootstrap or via `pnpm dsh:update`; there are no frozen commit pins. Its core must never be copied into or patched from this repository — every product integration goes through the adapter, the gateway contract, or the sanctioned patch overlay.
