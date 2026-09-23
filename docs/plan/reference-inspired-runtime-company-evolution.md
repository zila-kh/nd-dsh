# Reference-Inspired Runtime and Company Evolution Plan

Status: **P0/P1 implementation slice complete; local validation pending**  
Updated: 2026-09-24  
Related: [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · [PRD 0003](../prd/0003-engine-neutral-agent-teams-and-task-workspace-isolation.md) · [Agent orchestration reference matrix](agent-orchestration-reference-matrix.md) · [Performance benchmark suite](performance-benchmark-suite.md) · [Phase 2 company scale](phase-2-agent-company-scale.md)

## 1. Purpose

ND already has the product boundary that should remain authoritative:

```text
company
  -> project
    -> task transaction
      -> lease
      -> isolated workspace/worktree
      -> engine session
      -> exact checkpoint
      -> machine verification
      -> independent review
      -> integration
```

The external projects in the maintained reference matrix are not a replacement architecture. They are implementation references for the next layer of ND: a cleaner Rust runtime boundary, stronger crash/effect durability, optional sandbox providers, better observability, and richer long-running company coordination.

This plan deliberately keeps the current ND differentiators:

- company/project/task truth stays ND-owned;
- task remains the durable writable transaction boundary;
- worktrees remain provenance/rollback/checkpoint primitives;
- engines remain replaceable workers;
- ND remains the authority for leases, verification, review, policy, and integration;
- benchmark evidence decides migrations instead of language preference.

## 2. Current ND baseline

The implemented reference-architecture slice now has this Rust workspace:

```text
crates/
├── nd-protocol/
├── nd-runtime/
├── nd-core/
└── nd-browser-host/
```

`nd-protocol` owns the wire/error contract. `nd-runtime` owns system-heavy services, the canonical effect journal, and the typed decision kernel. `nd-core` is now a thin composition/dispatch binary with only `src/main.rs`. Electron main still owns organization/business truth, provider credentials/network transport, and engine orchestration.

This keeps crate boundaries tied to an independent protocol, durability contract, security boundary, or measurable runtime surface rather than mirroring another repository for appearance.

## 3. Reference synthesis

The maintained matrix keeps both the older references and the new research set.

### Control plane and long-horizon coordination

- **LoopX** — durable goals/gates/todos/evidence/quota, bounded continuation, peer claims/leases/handoffs, long-horizon recovery.
- **QM** — durable worker identity, child sessions, mailboxes, budgets, private worker computers.
- **Paperclip** — company/org/task governance, budgets, agent evaluation/training surfaces.
- **Orca** — worktree-first multi-agent workspace UX.
- **Gajae Code / LazyCodex / AWS Codex Agent Team sample** — bounded assignment contracts, planning/leadership boundaries, team-vs-subagent semantics, file/write scopes.

### Rust/runtime architecture

- **Bamboo-agent** — focused Cargo tiers and dependency direction: domain/core -> infra -> engine -> app.
- **Aex Brain** — canonical journal, commit-before-effect, interruption uncertainty, generated Rust contracts, capability-restricted Wasmtime workers.
- **Pioneer** — gateway/protocol/runtime-events/hooks/keystore/tasks/tools separation and local-first desktop/runtime composition.
- **Moltis** — modular Rust server, sandbox backends, security/release provenance, threat-oriented execution posture.
- **OpenAI Codex** — app-server/client/protocol/daemon seams, agent graph/identity/roles, typed Rust protocol surfaces.
- **Goose** — portable Rust agent runtime, ACP/MCP surfaces, feature-gated capabilities, telemetry/diagnostic patterns.
- **JCode** — performance-oriented Rust decomposition plus repository-owned memory/startup/session benchmarks.

### Execution isolation

- **kern** — fast rootless OCI execution, resource profiles, typed failures, daemonless per-call isolation.
- **Capsule runtime** — Wasm task isolation, resource limits, explicit allowed files/hosts/env, lifecycle/retry envelopes.
- **Moltis** also belongs here because it demonstrates multiple sandbox backends behind one agent product.

### Product/interoperability

- **PocketPaw** — A2A, agent ledger, alerts, external communication channels, local desktop/server product integration.

## 4. Target Rust shape

Do not jump from two crates to dozens of feature crates. Split only where the boundary pays for itself.

```text
crates/
├── nd-protocol/        # implemented P0
│   ├── request/response/event envelopes
│   ├── protocol versioning + frame limits
│   └── error vocabulary + TS parity checks
│
├── nd-runtime/         # implemented P0/P1 foundation
│   ├── scheduler/process/terminal
│   ├── workspace/git/search/revision
│   ├── deadline/cancellation/cache/metrics
│   ├── session journal
│   ├── effect_journal  # fsync + idempotency + recovery
│   └── decision        # typed threshold/escalation/receipts
│
├── nd-sandbox/         # P1, provider contract first
│   ├── policy
│   ├── host executor
│   ├── container executor
│   └── future wasm/remote providers
│
├── nd-browser-host/    # existing native messaging boundary
│
└── nd-core/            # thin composition binary
    ├── compose services
    ├── dispatch protocol methods
    └── startup/shutdown
```

Do **not** create `nd-domain` yet merely to mirror another repository. Add a pure domain crate only when Company/Project/Task/Lease/Run invariants materially move from Electron main into Rust.

## 5. P0 — protocol, durability, and runtime decomposition

### P0.1 Extract `nd-protocol`

Goal: Rust becomes the source of truth for the ND core wire contract.

Requirements:

- move request/response/event envelopes, protocol version, limits, error codes, and stable identifiers out of the binary crate;
- keep MessagePack framing unless measurement justifies a transport change;
- generate or machine-check the TypeScript client contract from Rust-owned schemas/types;
- compatibility tests must catch field drift, enum drift, version mismatch, oversize frames, and unknown methods;
- add `traceId`, typed resource identity, and optional idempotency metadata only through a versioned compatibility decision;
- preserve existing bounded priority queues, deadlines, cancellation, and fail-closed decode behavior.

Acceptance evidence:

- current Electron client works without semantic regression;
- schema/contract drift is caught locally;
- protocol extraction adds no material latency or allocation regression to the existing benchmark suite.

Primary references: Brain, Codex, Pioneer.

### P0.2 Add a canonical execution/effect journal

The current bounded session journal is useful but is not yet a full autonomous-company effect ledger.

Target invariant:

```text
persist intent/state before exposing an irreversible or externally visible effect
```

Minimum record families:

```text
lease acquired/released
workspace allocated/reconciled
engine session requested/bound/resumed
external effect intent
external effect result / uncertain outcome
checkpoint produced
verification receipt
review result
integration intent/result
policy gate/approval decision
```

Requirements:

- every record has company/project/task/run/resource identity where applicable;
- effects receive stable idempotency identities;
- restart distinguishes `not-started`, `known-complete`, `known-failed`, and `outcome-uncertain`;
- uncertain effects are reconciled rather than blindly repeated;
- derived UI/state projections may be rebuilt from canonical records where practical;
- keep private prompt/tool payload retention explicitly bounded and policy-aware;
- journal growth and replay/recovery cost become benchmarked quantities.

This complements task worktrees/checkpoints; it does not replace them.

Primary references: Brain, LoopX, QM.

### P0.3 Make `nd-core` a thin composition binary

Move implementation modules behind `nd-runtime` while retaining the same shipped `nd-core` binary.

Rules:

- dependency direction remains one-way;
- protocol types cannot depend on runtime implementations;
- runtime services cannot import Electron/product UI concepts;
- organization/business truth stays TypeScript-owned during this phase;
- no feature behavior may change merely because files moved crates;
- crate extraction is accepted only after equivalent correctness and performance evidence.

Primary references: Bamboo, Pioneer, JCode.

## 6. P1 — execution security, observability, and durable coordination

### P1.1 Pluggable sandbox/execution provider contract

Worktree isolation and execution sandboxing solve different problems and must remain separate.

```text
Task transaction
├── workspace/worktree     provenance, rollback, checkpoint
└── execution provider     filesystem/network/process/resource authority
```

Provider contract should support:

- host execution for current compatibility;
- optional container/rootless provider;
- future Wasm and remote worker providers;
- CPU/RAM/time/process/network/filesystem limits;
- explicit secret/environment exposure;
- typed stop/failure reasons such as timeout/OOM/policy denial;
- capability discovery before dispatch;
- fail-closed `require limits` style policy for company profiles that demand isolation.

Do not make Docker or any single sandbox technology part of the Company/Task schema.

Primary references: Moltis, kern, Capsule, Brain.

### P1.2 Agent Trace Inspector and replayable diagnostics

Build one ND-owned timeline over engine/runtime activity:

```text
task/run
  -> routing decision
  -> prompt/context envelope metadata
  -> model turn
  -> tool/action
  -> nd-core request
  -> approval/policy decision
  -> artifact/checkpoint
  -> verification/review
  -> cost/timing
```

Requirements:

- correlation/trace identity across Electron main, engine adapter, and nd-core;
- redact secrets and keep raw prompt retention opt-in/bounded;
- expose latency, token/cost, IPC crossings, tool counts, retries, and stop reason;
- export/import a support bundle with provenance;
- replay deterministic/local portions without claiming model determinism;
- make traces usable for benchmark debugging, not just UI decoration.

Primary references: Goose, Brain, JCode.

### P1.3 Durable agent/team mailbox and targeted wake

ND teams currently share coordination events; make the transport more explicit for long-running peer work.

Requirements:

- durable sender/recipient/task/run identity;
- message type such as handoff, blocker, evidence, request, answer, wake;
- delivery/consumption cursor;
- targeted wake without polling every worker;
- bounded mailbox size/retention;
- restart-safe delivery semantics;
- team communication never grants filesystem write authority by itself.

Primary references: LoopX, QM, LazyCodex.

### P1.4 Rust decision kernel and System One providers

The first Laya/Jev implementation in Electron main is the behavioral prototype, not the final runtime boundary. After `nd-protocol` and `nd-runtime` extraction stabilize, move the provider-neutral decision kernel into `nd-runtime`.

Implemented flow:

```text
Electron main provider gateway
  ├── Laya HTTP via upstream laya-serve
  └── Jev HTTPS + secure credential boundary
             │ typed provider observations
             v
nd-core / nd-runtime Rust decision kernel
  ├── threshold + selection
  ├── continue/escalate decision
  └── typed receipt
             v
existing ND policy / machine verification / independent review authority
```

Rules:

- Company/Project/Task business truth stays TypeScript-owned in this phase;
- provider credentials, HTTPS, timeout handling, and network policy stay in the existing Electron main provider gateway;
- Rust owns the reusable typed attempt/result validation, confidence threshold, selection, continuation/escalation semantics, and receipt;
- Laya stays out-of-process through upstream `laya-serve`; no model weights are bundled merely to make the boundary more native;
- Jev remains an optional HTTPS provider behind the same typed observation contract;
- one shared fixture corpus checks TypeScript/Rust cascade parity;
- future ONNX/native inference may replace the local provider transport without changing the Rust decision contract;
- decision support never overrides machine verification, policy gates, exact-evidence rules, or independent semantic review;
- Rust remains opt-in until local shadow/live-provider evidence promotes it.

Implementation ticket: [WIP 0034 — Rust Decision Kernel](../tasks/wip-0034-rust-decision-kernel.md).

## 7. P2 — company quality and interoperability

### P2.1 Employee evaluation and routing evidence

Add repeatable evaluation suites for roles/engines/skills:

- verified completion rate;
- first-review pass;
- rework;
- cost;
- latency excluding model latency where appropriate;
- human interruptions;
- evidence quality;
- policy violations;
- recovery behavior.

Use the results as routing evidence, not as silent security-policy mutation.

Primary references: Paperclip, JCode.

### P2.2 Company/project budget envelopes

Extend existing policy/capacity concepts with explicit budgets:

- model/token spend;
- runtime minutes;
- parallel worker capacity;
- sandbox resources;
- external action limits;
- escalation threshold.

Budget exhaustion produces a typed stop/gate, never an invented completion.

Primary references: Paperclip, LoopX, QM.

### P2.3 Portable company/project package

Design an export/import format for non-secret organizational configuration:

- roles and teams;
- skills/workflows;
- project policy templates;
- eval suites;
- routing preferences;
- optional sanitized operating lessons.

Secrets, provider credentials, local paths, and private memory are excluded or explicitly re-bound on import.

### P2.4 A2A and notification bridge

Keep ND's internal company protocol authoritative while allowing adapters for:

- A2A-compatible agent exchange where useful;
- alert/notification sinks;
- Slack/Discord/Telegram/email-style channels through scoped extensions;
- remote worker/event integrations.

External messages are signals/effects, not direct mutation authority.

Primary reference: PocketPaw.

## 8. Adoption order

| Order | Work | Priority | Why first |
| ---: | --- | --- | --- |
| 1 | `nd-protocol` extraction + generated TS contract | P0 | reduces cross-language drift before Rust expands |
| 2 | canonical execution/effect journal | P0 | improves autonomous crash/effect correctness |
| 3 | `nd-runtime` extraction + thin `nd-core` | P0 | creates clean growth seam without product rewrite |
| 4 | Rust decision kernel + Laya/Jev provider seam | P1 | moves reusable decision routing/receipts into the native control plane after its contracts stabilize |
| 5 | sandbox provider contract | P1 | separates provenance from execution security |
| 6 | trace inspector | P1 | makes future routing/perf/recovery work measurable |
| 7 | durable mailbox/wake | P1 | improves long-running team coordination |
| 8 | employee evals + budget envelopes | P2 | feeds measurable routing/company quality |
| 9 | portable company packages + A2A/notifications | P2 | interoperability after core authority is stable |

Orders 1–4 are implemented on `feat/reference-architecture-plan`; local correctness/performance/live-provider evidence is the remaining merge gate. Orders 5–9 remain follow-on work and are not silently claimed complete by this PR.

## 9. Benchmark and proof contract

Every architecture change must reuse or extend the existing repository-owned benchmark policy.

Required measurements:

| Area | Evidence |
| --- | --- |
| protocol | encode/decode, request latency, queue pressure, allocations/bytes |
| journal | append latency, bytes per verified task, recovery/replay time |
| runtime split | cold start, RSS/PSS where supported, task/terminal/workspace operations |
| sandbox | setup latency, incremental memory/disk, teardown, typed failure correctness |
| coordination | mailbox dispatch/wake latency, messages per verified completion |
| trace | capture overhead and retained bytes |
| company quality | verified completion, rework, human attention, cost |

Rules:

1. preserve raw evidence and exact code/upstream revisions;
2. compare verified outcomes, not process exits;
3. separate model/network time from ND runtime claims;
4. never publish a directional performance claim when the measurement does not support it;
5. retain failed/inconclusive runs;
6. external references are inspiration/bench subjects, not dependencies unless separately approved.

## 10. Explicit non-goals

This plan does not:

- rewrite the organization domain in Rust;
- replace Electron/React;
- replace worktrees with containers;
- make every feature its own crate;
- copy another project's agent loop;
- make a specific provider/runtime authoritative;
- add remote execution before local authority/recovery contracts are stable;
- claim ND is faster or safer than a reference without matched evidence.

## 11. Completion criteria

The plan is substantially complete when:

1. Rust owns one generated/machine-checked protocol contract shared with TypeScript.
2. An interrupted company task can reconcile durable effect state without blindly repeating uncertain effects.
3. `nd-core` is a thin binary over stable protocol/runtime crates with no correctness/performance regression.
4. The decision kernel can run in Rust with typed receipts and Laya/Jev as replaceable providers while preserving reviewer/verification authority.
5. Execution sandboxing is a provider choice independent from task worktree provenance.
6. One trace identity explains a task from route selection through checkpoint/review/integration.
7. Team handoffs and wakes survive desktop/runtime restart.
8. Employee/engine quality and budget decisions are backed by stored evidence.
9. The maintained reference matrix remains pinned and periodically refreshed rather than turning into unversioned competitor prose.
