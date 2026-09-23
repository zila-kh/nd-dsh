# ND Agent Fast Path — typed action space, cheap routing, and bundled core operations

Status: **implemented as [task 0008](../tasks/done/done-0008-agent-fast-path.md) (2026-09-22), with its budgets wired 2026-09-23.** The typed action space, the deterministic-first router with fail-closed escalation, the revision-aware `workspace.snapshot`, and a matched normal-read/fast-read measurement are in the product path — the task record is the authority on exact scope. §5 step 3 is done: the counters are enforced as relative budgets ([performance-benchmark-suite.md](performance-benchmark-suite.md) §12.4). Of the §9 open questions, §9.1 is settled by the measured IPC-crossing counts (see §9); §9.2-§9.5 remain open. This plan is Phases 2 and 4 of the Rust-sidecar direction, not a separate architecture.
Updated: 2026-09-23
Related: [PRD 0002](../prd/0002-rust-sidecar-mvp-migration.md) · [Performance benchmark suite](performance-benchmark-suite.md) · [Phase 1 reliability](phase-1-beta-reliability.md) · [Phase 3 autonomous company](phase-3-autonomous-software-company.md) · [Roadmap](../roadmap.md)

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

**Resolved 2026-09-21 by [task 0006](../tasks/done/done-0006-nd-core-runtime-contract.md).** The
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

**Status (2026-09-23):** step 1 is done — the agent-task metrics and a committed normal-loop baseline landed with task 0005 — and step 2 is done with task 0008, which built the action space, the router, and the matched `normal-read` / `fast-read` measurement. Step 4's composite (`workspace.snapshot`) landed with it, measured rather than asserted. Step 3 is no longer the open half: the before → after comparison is enforced as a budget ([performance-benchmark-suite.md](performance-benchmark-suite.md) §12.4), recorded by `pnpm bench:tasks:baseline` and re-derived offline by `pnpm bench:tasks:check`. The recorded delta, per verified completion and inside one run: model round trips 2 → 0, model-visible tool calls 3 → 0, nd-core IPC crossings 12.5 → 9, completion rate unchanged at 1.0, escalations 0.

## 6. Non-goals

- **Not a new engine.** The Harness and Codex engine contracts, and their own agent loops, are unchanged. The fast path operates ND-side, above the engine contract.
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
- [ ] Agent-task benchmark reports, per task: total wall time, model round trips, tool calls, IPC crossings, bytes sent to the model, and completion rate — for both the normal loop and the fast path.
- [x] A recorded normal-loop baseline exists before the router is built, and the post-router comparison reports before → after on the same fixture set. — `benchmarks/baselines/agent-task-normal-loop.json` (task 0005) is the baseline; the matched `normal-read` / `fast-read` arms are compared per verified completion by `compareFastPath()`, enforced in the run verdict and re-derived offline by `pnpm bench:tasks:check`.
- [x] Escalation rate is reported as a metric, with a budget that fails the check when exceeded. — `fastPathComparison` fails the run when the fast arm's mean escalations per completed task exceed 0.1.
- [ ] No fast-path action executes without envelope evaluation; a denied action fails closed exactly as it does on the normal path.
- [ ] Destructive verbs (`source.write`, `shell.execute`, `git.push`, deployment/data kinds) are never executed by the router without the existing approval gate.
- [ ] Any composite core operation is justified by a measured IPC-crossing reduction and replaces, rather than layers over, single-op usage at that call site. — Half-evidenced: `workspace.snapshot` is asserted to be *one* crossing for the whole read set (`tests/fast-path.test.ts`) and it is the only workspace call in that path, but the counterfactual — the same reads and searches issued as separate `workspace.*` requests — has not been counted. A per-call-site crossing measurement is what closes it ([done-0016](../tasks/done/done-0016-agent-task-baseline-fast-path-budgets.md) notes).
- [ ] A real-task fixture (not only synthetic workers) exercises the fast path end to end.
- [ ] No benchmark-only or policy-free branch exists in the shipped path.

## 9. Open questions

1. Where does the router live — main process TypeScript, or nd-core? **Settled 2026-09-23 by measurement: main-process TypeScript.** The recording ([`benchmarks/baselines/agent-task-normal-loop.json`](../../benchmarks/baselines/agent-task-normal-loop.json), commit `029725f`, offline fixture, one run) measures the matched arms per *verified completion*: the normal loop pays 2 model round trips, 3 model-visible tool calls and **12.5 nd-core IPC crossings**; the fast path pays 0, 0 and **9**. The decision tier itself contributes none of those crossings — `parseFastActionPlan()` is pure parsing over the task's typed plan, and `prepareFastPath()` reaches only the injected main-process policy gate and audit sink (it takes no core client at all) — while all native state the fast path needs arrives in **one** composite crossing, `workspace.snapshot`, which `tests/fast-path.test.ts` asserts by counting the injected request function. The remaining crossings are the shared production scaffolding every task pays regardless of routing: run records, worktree preparation, the runtime permit, and machine verification evidence. Those are not the router's to remove, so moving the router into nd-core could not reduce them; it would *add* crossings for the plan and its policy/audit outcome, and it would put the company policy gate inside the Rust runtime, which the architecture forbids. Revisit only if a future measurement shows the *decision* costing crossings — and if a future verb needs native state per action, the executor is already injectable (`Pick<CoreClient,'request'>`) and can move without moving the router.
2. What is the cheap decision tier — a small local model, a rules engine, or a hybrid? **Settled 2026-09-23 as a deterministic-first hybrid.** Mechanical fast actions stay rules-only. Optional System One support runs behind the typed `DecisionProvider` contract: Laya is the preferred local first tier, Jev is the optional escalation/second-opinion tier, and neither can override machine verification, policy gates, stale-evidence rules, or the independent reasoning reviewer. The initial rollout is `shadow`/`assist` only; controlling additional turn routes requires committed ND-specific calibration evidence.
3. Does the router observe only workspaces, or also browser and Git surfaces? Scope creep here is the main risk to the first iteration.
4. Is the fast path per-agent opt-in, or a company/project policy? It interacts with autonomy level, which already gates dispatch.
5. How does the fast path interact with task worktrees and conflict-aware scheduling — does it declare write scope at plan time or at action time?
