# ND Agent Fast Path — typed action space, cheap routing, and bundled core operations

Status: **proposed — not started.** This plan is Phases 2 and 4 of the Rust-sidecar direction, not a separate architecture. The decision tier is provider-neutral; Jev is an optional adapter/reference, never a required runtime dependency.
Updated: 2026-09-22
Related: [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · [Performance benchmark suite](performance-benchmark-suite.md) · [Agent orchestration reference matrix](agent-orchestration-reference-matrix.md) · [Phase 1 reliability](phase-1-beta-reliability.md) · [Phase 3 autonomous company](phase-3-autonomous-software-company.md) · [Roadmap](../roadmap.md)

## 1. Why this exists

The sidecar migration moved system work into Rust and made ND cheaper to *operate*. It does not by itself make ND cheaper to *think*.

An agent turn today still costs one large-model call plus one IPC round trip per tool invocation, regardless of whether the work is "read this file" or "decide which of three architectural approaches to take." Both are paid at the expensive tier.

This plan attacks the second cost center: **the number of model calls and boundary crossings per unit of completed work**, with a compact typed action space, a cheap decision tier, and composite core operations that answer several questions per crossing.

The premise is deliberately falsifiable. It is only worth building if measurement shows the agent-task metrics in [performance-benchmark-suite.md](performance-benchmark-suite.md) improving on the same fixtures. Phase 2 is therefore **gated on Phase 3 instrumentation existing first** — see §5.

## 2. Target loop

```text
Electron UI
    ↓
nd-core Rust
    ↓
compact state / observations          (bounded projection, not a file dump)
    ↓
typed action space                    (enumerated, policy-aware, provenance-carrying)
    ↓
fast decision / router                (cheap tier; deterministic where possible)
    ↓
native executor                       (nd-core performs the action)
    ↓
verification                          (machine check, not prose)
    ↓
escalate to a powerful model only when reasoning is actually required
```

Two rules make this safe rather than merely fast:

- **The router is a tier, not a bypass.** Every routed action carries the same provenance and passes the same policy gate as a large-model-issued action. The repository's existing anti-cheating rule — "No benchmark-only fast path" ([performance-benchmark-suite.md](performance-benchmark-suite.md) §2.9) — extends to "no policy-free fast path."
- **Escalation is explicit and recorded.** When the router cannot resolve an action within confidence/cost bounds it escalates, and the escalation is a durable receipt, not a silent retry at a bigger model.

### 2.1 Decision-engine contract — provider-neutral by construction

The cheap tier is an **ND interface**, not a Jev interface. ND must be able to ship, start, run tasks, and pass normal CI with no Jev package, API key, account, or network dependency.

Conceptually, the router consumes a bounded request and returns one decision from the action set ND already allowed for that step:

~~~text
DecisionRequest
  task / company / project provenance
  bounded observation + revision
  allowed actions
  compatible targets per action
  policy/risk context
  latency/cost budget

DecisionResult
  selected action
  selected target when applicable
  confidence/probability metadata when the engine exposes it
  decision-engine id/version
  escalation/fallback reason when no safe decision is returned
~~~

Initial implementations should be interchangeable behind that contract:

1. **Deterministic rules — required baseline/fallback.** Mechanical cases that can be proven from state should use no model call at all.
2. **Jev — optional adapter.** When explicitly configured and available, Jev may choose among the same ND-provided actions/targets. It does not define the action vocabulary and it is never required for ND correctness.
3. **Small generative model — optional future adapter.** Useful only where a constrained decision still needs language understanding that deterministic rules do not provide.

Provider-specific output is normalized immediately into the ND decision result. The rest of the control plane never branches on `jev`, model vendor names, or provider-specific probability shapes.

Failure semantics are explicit:

- if an optional decision engine is unavailable, times out, rejects the request, or returns an invalid choice, ND records that outcome and follows the configured fallback policy: deterministic handling where provable, otherwise `ESCALATE`;
- fallback must never silently reinterpret an unsafe/invalid choice as another mutation;
- every executed action still passes the normal action envelope and approval policy;
- optional-provider credentials remain provider credentials, not organization truth, and are never required by nd-core.

The first implementation should keep this interface in the TypeScript control plane. Moving it into Rust would couple a vendor/decision concern to the native execution layer before measurement proves that boundary is a bottleneck.

### 2.2 Jev is a reference and optional acceleration path, not the architecture

TypeSafe introduced Jev as an early-access "System One" decision model: unstructured state in, typed probabilistic decisions out, without general string generation. Browser Use's `jev-ultrafast` is useful because it demonstrates several ideas that map cleanly to ND:

- build a **dynamic action/target set from observed state** instead of asking a model to invent arbitrary executable operations;
- choose operation + compatible target in one decision request;
- call a generative text model only when text generation is actually required;
- resolve execution targets from observed state and revalidate freshness before mutation;
- treat `DONE` as a proposal that still needs independent outcome verification.

The reference repository reports a 3-vs-3 matched Google Flights experiment where both arms completed and median task time moved from 9.450 s to 7.092 s while browser protocol calls moved from 1,092 to 101. That is a useful hypothesis about reducing boundary/model round trips, **not** a general reliability or ND performance claim: it is one browser task, one profile, and a very small sample.

ND should therefore borrow the **shape** of the loop and benchmark Jev as one optional implementation of `DecisionEngine`; ND must not depend on Jev, copy browser-specific action semantics, or publish its numbers as evidence for coding/company workloads.

## 3. The action space already exists in ND — extend it, do not fork it

This is the single most important architectural decision in this plan.

The action vocabulary in the target loop (`READ_FILE`, `SEARCH_CODE`, `APPLY_PATCH`, `RUN_COMMAND`, `CHECK_GIT`, `OPEN_FILE`, `RETRY`, `DONE`, `ESCALATE`) **must not become a second, parallel vocabulary**. ND has already specified the envelope that governs actions:

- [phase-3-autonomous-software-company.md](phase-3-autonomous-software-company.md) §P3.2 — the normalized action/policy envelope: `action`, `target`, `scope`, `risk`, `externality`, `destructive_level`, `cost`, `credential_scope`, `engine`, `model`, `agent`, `task`, `capability/provider`, `provenance`, `requested_at`; with illustrative kinds `source.read`, `source.write`, `shell.execute`, `git.commit`, `git.push`, `browser.external_write`, `deployment.*`, `data.destructive`, `money.spend`.
- [roadmap.md](../roadmap.md) §4 — policy/action normalization, which requires that sensitive actions are governed consistently across Harness, Codex, browser/MCP, and future engines rather than inferred from prompt text.
- [phase-1-beta-reliability.md](phase-1-beta-reliability.md) §P1.2 — the typed turn contract (`ready`, `repair_required`, `replan_required`, `human_action_required`) that governs whether an execution slice may start at all.
- `src/main/organization/approval-policy.ts` — the existing `runtime.escalation` classification class, and the main-process DENY/ALLOW/ASK gate behind it.

The fast-path action space is therefore the **action half of P3.2** — a concrete, enumerable subset with typed parameters and a typed result — and the router is a producer of P1.2 turn decisions. Mapping:

| Fast-path verb | P3.2 envelope kind | Notes |
| --- | --- | --- |
| `READ_FILE` | `source.read` | bounded read; reuse `workspace.read` |
| `SEARCH_CODE` | `source.read` | not implemented in nd-core today — see §4 |
| `APPLY_PATCH` | `source.write` | write scope must be declared for conflict-aware scheduling |
| `RUN_COMMAND` | `shell.execute` | already routed through the Rust process supervisor |
| `CHECK_GIT` | `git.status` / `git.commit` / `git.push` | remote mutations stay policy-gated |
| `OPEN_FILE` | (surface action) | UI-side; no policy risk, no Rust execution |
| `RETRY` | (control action) | bounded by the existing retry/backoff and rollback primitives |
| `DONE` | (control action) | must carry machine verification evidence, not prose |
| `ESCALATE` | `runtime.escalation` | extends the existing class with a model-tier dimension |

Anything the fast path can express, a large model must also be able to express, and both must resolve to the same envelope, the same policy evaluation, and the same receipt shape. If a verb cannot be expressed in the envelope, it is not ready to be added.

## 4. Phase 4 — bundled operations: one boundary crossing, many answers

The sidecar protocol today is one request per question. A typical agent step therefore costs `stat` + `read` + `search` + `git status` + parse as five crossings, even though four of them are answering adjacent questions about the same workspace state.

The target is a composite read that returns as much useful state as one crossing can carry:

```text
workspace.snapshot(root, paths[], includeGit, includeSearch(pattern))
  → { entries[], reads[], gitStatus?, matches[], truncated, revision }
```

A `revision`/generation marker is required so a caller can tell whether a cached snapshot is still valid — that is also the seed of the "state/cache primitives" the sidecar MVP lists but has not built.

### 4.1 Do not build this before resolving the unused primitive layer

**Resolved 2026-09-21 by [task 0006](../tasks/wip-0006-nd-core-runtime-contract.md).** The
decision is recorded in [PRD 0002 §5.0.3](../prd/0002-rust-sidecar-mvp-migration.md#503-decision-record--nd-core-runtime-contract-task-0006-2026-09-21):
`workspace.list` and `workspace.read` are now called from `src/` by the workspace
browser, and `realpath`, `stat`, and `atomicWrite` were removed from the protocol. The
"unused primitive layer" this section warned about no longer exists, and the sequencing
rule below still applies when composite operations are proposed.

A finding that changes the sequencing: **`workspace.*` was implemented in Rust with no product caller.** All five methods existed (`crates/nd-core/src/main.rs:237-261`; `realpath`, `stat`, `read`, `list`, `atomicWrite`), and the only caller anywhere in the repository was the benchmark harness (`benchmarks/run-suite.mjs:74`, `workspace.stat`). No file under `src/` invoked any of them.

So the MVP box "migrate the workspace filesystem primitives required by migrated services" landed as *capability* without a *consumer*. Adding composite operations on top would leave three overlapping states:

1. single-op Rust RPCs that nothing calls,
2. new bundled Rust RPCs,
3. TypeScript still doing its own filesystem work directly.

Pick one. The recommended order:

1. Identify which TypeScript call sites do per-file filesystem work in an agent/tool path.
2. If a single-op RPC is sufficient, consume the existing one — do not add a composite.
3. Introduce a composite only where measurement shows ≥2 crossings in a row for one logical step, and then **replace** the single-op usage at that call site rather than layering.

Bundled operations are an optimization to be justified by the IPC-round-trip counter (§5), not an architecture to be adopted up front.

## 5. Dependency on measurement — do this first

The fast path claims "fewer model calls, fewer tool calls, fewer IPC crossings, fewer bytes to the model." **None of those are measurable in this repository today.** The benchmark suite measures runtime behaviour (startup, memory, terminal, Git, event-loop lag, cancellation) and has no agent-task-level metrics at all — no model round trips, no tool-call counts, no IPC call counts, no bytes-to-model, no completion rate.

That makes the honest build order:

1. **Instrument the agent-task metrics** (Phase 3 additions, [performance-benchmark-suite.md](performance-benchmark-suite.md) §12.1) and record a normal-loop baseline.
2. **Build the action space and router** against that baseline.
3. **Prove the delta** on the same fixtures, same machine, same run count.
4. **Only then** decide whether bundled core operations are needed.

Without step 1, step 3 is unfalsifiable and this plan becomes an unverifiable architecture claim of exactly the kind PRD 0002 §8.17 rules out.

## 6. Non-goals

- **Not a new coding engine.** The Harness, Codex, ZCode, and other coding-engine contracts and their own agent loops are unchanged. The fast path operates ND-side, above the engine contract.
- **Not a Jev dependency.** Jev is one optional `DecisionEngine` adapter/reference. No Jev package, API key, account, or network access may be required for ND startup, normal task execution, or normal CI.
- **Not a replacement for engine reasoning.** The router wins on mechanical, enumerable steps. Planning, design, debugging, and review stay at the reasoning tier.
- **No policy bypass.** No verb executes without envelope evaluation.
- **No benchmark-only path.** Production code paths only, per the existing anti-cheating rule.
- **No second action vocabulary** competing with P3.2.
- **Not a Rust rewrite of TypeScript product logic.** The router and action space are ND control-plane logic and belong where organization truth already lives until measurement says otherwise (see PRD 0002 §5 "gradual migration" disposition).
- **No silent capability reduction.** Any action the router cannot express must escalate, never silently no-op.

## 7. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Router misexecutes a plausible-looking wrong action | A cheap tier is confident by construction; a wrong `APPLY_PATCH` is destructive | Typed parameters + declared write scope + verification step; destructive verbs require the same approval gate as any engine |
| Two action vocabularies drift | Policy evaluates one; the fast path emits the other | Fast-path verbs are P3.2 kinds; a conformance test asserts every verb maps to an envelope kind |
| Escalation becomes the common case | Then the fast path adds latency and cost for nothing | Escalation rate is a first-class benchmark metric with a budget; a high rate fails the plan rather than the model |
| Composite ops entrench an unused layer | Three overlapping filesystem paths (§4.1) | Composite ops gated on the IPC-crossing metric and require replacing single-op usage |
| Product value measured only on synthetic fixtures | Optimization that does not survive real work | Include a real-task fixture (the beta QA driver) alongside synthetic ones |
| Router hides engine/policy provenance | Breaks the audit trail the roadmap requires | Every routed action carries the full envelope and a durable receipt |

## 8. Acceptance criteria

Measurable, on the same machine, fixtures, and run count, with results committed as evidence:

- [ ] Every fast-path verb resolves to a P3.2 envelope kind, asserted by a conformance test rather than by review.
- [ ] The router depends on a provider-neutral `DecisionEngine` contract; organization/orchestration code contains no Jev-specific branch.
- [ ] A deterministic decision implementation exists and the normal offline/CI fast-path tests require no external decision provider.
- [ ] Jev, if implemented, is explicit opt-in and removable: ND starts and completes supported tasks with Jev unconfigured/unavailable.
- [ ] Optional-provider failure produces a recorded fallback/escalation reason; it never silently changes a mutation into another action.
- [ ] Decision receipts record the decision-engine id/version and whether the result was deterministic, optional-model, fallback, or escalation.
- [ ] Agent-task benchmark reports, per task: total wall time, model round trips, tool calls, IPC crossings, bytes sent to the model, and completion rate — for both the normal loop and the fast path.
- [ ] A recorded normal-loop baseline exists before the router is built, and the post-router comparison reports before → after on the same fixture set.
- [ ] Escalation rate is reported as a metric, with a budget that fails the check when exceeded.
- [ ] No fast-path action executes without envelope evaluation; a denied action fails closed exactly as it does on the normal path.
- [ ] Destructive verbs (`source.write`, `shell.execute`, `git.push`, deployment/data kinds) are never executed by the router without the existing approval gate.
- [ ] Any composite core operation is justified by a measured IPC-crossing reduction and replaces, rather than layers over, single-op usage at that call site.
- [ ] A real-task fixture (not only synthetic workers) exercises the fast path end to end.
- [ ] No benchmark-only or policy-free branch exists in the shipped path.

## 9. Open questions

1. Where does the router live — main process TypeScript, or nd-core? It is control-plane logic, which argues for TypeScript until measurement argues otherwise; but a router that must consult native state cheaply argues for the core. Decide with the IPC-crossing metric in hand, not before.
2. Which optional decision adapters earn their keep beyond the deterministic baseline? Deterministic rules are the required first tier. Jev is the first external adapter worth benchmarking because its structured choice model matches the constrained action problem; a small local/generative model remains another candidate. Keep an adapter only if verified-completion metrics justify it.
3. Does the router observe only workspaces, or also browser and Git surfaces? Scope creep here is the main risk to the first iteration.
4. Is the fast path per-agent opt-in, or a company/project policy? It interacts with autonomy level, which already gates dispatch.
5. How does the fast path interact with task worktrees and conflict-aware scheduling — does it declare write scope at plan time or at action time?
