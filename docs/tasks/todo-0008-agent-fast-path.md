# Task 0008 — Agent fast path: typed actions, cheap routing, escalation

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md) — scope origin: [agent-fast-path.md](../plan/agent-fast-path.md)  
> Priority: P2  
> Owner: unassigned  
> Branch: unassigned  
> Updated: 2026-09-22  
> Depends-on: done-0005, done-0006 (satisfied)  

## Objective

A cheap decision tier over a typed action space: resolve mechanical steps without a large-model call, execute them natively, verify, and escalate to a powerful model only when reasoning is actually required. The sidecar migration made ND cheaper to *operate*; this attacks the cost of *thinking* — the model calls and boundary crossings per unit of completed work.

The premise is falsifiable and must be treated as such: this work is worth keeping only if measured model round trips, tool calls, and IPC crossings per completed task improve on the same fixtures while completion rate holds. If the baseline shows round trips are not the dominant cost, the correct outcome is to **stop and record that**, not to ship a router.

**Ordering inside this task is not optional.** Tasks 0005 and 0006 are now complete, so all three sections are implementation-unblocked. Section 1 still lands first because the router must conform to the action envelope before any optional decision adapter is wired.

## 1. Action space conforms to the existing envelope (start here — unblocked)

ND already specifies the envelope that governs actions — [phase-3-autonomous-software-company.md](../plan/phase-3-autonomous-software-company.md) §P3.2 (`action`, `target`, `scope`, `risk`, `externality`, `destructive_level`, `cost`, `credential_scope`, provenance) with kinds such as `source.read`, `shell.execute`, `git.push`, `data.destructive`. The roadmap's policy/action normalization requires those actions be governed consistently across engines.

The failure this prevents: a second, parallel action vocabulary. If the fast path emits `READ_FILE` while policy evaluates `source.read`, the fast path is a policy hole by construction.

- [ ] Fast-path verbs (`READ_FILE`, `SEARCH_CODE`, `APPLY_PATCH`, `RUN_COMMAND`, `CHECK_GIT`, `OPEN_FILE`, `RETRY`, `DONE`, `ESCALATE`) are defined as envelope kinds, extending §P3.2 only where a verb is genuinely new.
- [ ] Each verb has typed parameters, a typed result, and a declared affected write scope.
- [ ] Escalation reuses the existing `runtime.escalation` class; no second escalation concept exists.
- [ ] A conformance test asserts every verb resolves to an envelope kind; adding a verb without a mapping fails the build.
- [ ] The mapping table is recorded as the contract of record.

## 2. Router with explicit escalation (unblocked; baseline exists)

- [ ] The router depends on a provider-neutral `DecisionEngine` contract; organization/orchestration code never branches on Jev or any other decision-model vendor.
- [ ] Deterministic routing is the required baseline/fallback and handles provable mechanical cases with zero model calls.
- [ ] Jev is an optional adapter only: no Jev package, credential, account, or network access is required for ND startup, normal execution, or CI.
- [ ] If Jev or another optional adapter is unavailable/invalid/timed out, ND records the reason and falls back to deterministic handling where provable, otherwise `ESCALATE`.
- [ ] The router emits only actions from the section 1 contract; the conformance test covers routed actions.
- [ ] The most mechanical verbs resolve with no model call at all; a deterministic-first strategy, not a prompt.
- [ ] No routed action executes without envelope evaluation; a denied action fails closed exactly as on the normal path.
- [ ] Destructive verbs (`source.write`, `shell.execute`, remote Git mutations, deployment/data kinds) are never executed by the router without the existing approval gate.
- [ ] Any action the router cannot express escalates with a durable receipt; it never silently no-ops.
- [ ] Model round trips per completed task decrease against the task 0005 baseline, same machine, same fixtures, same run count.
- [ ] Completion rate does not decrease; a fast path that quietly does less fails the check.
- [ ] Escalation rate is reported with a budget that fails the check when exceeded.
- [ ] A real-task fixture, not only synthetic workers, exercises the fast path end to end.
- [ ] Results carry provenance per the baseline policy from task 0004.
- [ ] No benchmark-only branch exists in the shipped path.

## 3. Composite core operations (unblocked by dependencies; still gated by measured IPC benefit)

A typical agent step costs several boundary crossings answering adjacent questions about the same workspace state — `stat`, `read`, `search`, `git status`, parse. The target is one crossing returning entries, reads, Git status, and matches together, with a revision marker so a caller can tell whether the result is current.

This is an optimization to be justified by measurement, not an architecture to adopt up front.

- [ ] A composite read exists with opt-in sections and a revision marker.
- [ ] The IPC-crossing reduction is measured against the task 0005 baseline, not asserted.
- [ ] Every call site adopting a composite has its superseded single-op calls removed in the same change.
- [ ] Truncation is explicit; a capped composite result cannot be mistaken for a complete one.
- [ ] Oversized requests degrade predictably rather than exceeding the protocol frame bound.
- [ ] A stale revision is detectable and never served as fresh.
- [ ] Task 0006's workspace-primitive decision is respected: no third filesystem layer is introduced.

## Out of scope

- Replacing or wrapping Harness, Codex, ZCode, or other coding-engine loops. The fast path operates ND-side, above the engine contract.
- Requiring Jev. Jev is a benchmark candidate/optional decision adapter, not part of ND correctness or startup.
- A new action vocabulary; section 1 owns the contract.
- Browser and Git surface routing beyond what the first iteration genuinely needs — scope creep here is the main delivery risk.
- A general RPC batching framework or query language.

## Notes

- Open questions to settle with data, not in advance: whether any optional decision adapter (starting with Jev) beats the deterministic baseline enough to justify its latency/cost, and whether the fast path is per-agent opt-in or company policy. The first router/interface lives in the TypeScript control plane; move it only if measurement proves the boundary is a bottleneck. Listed in [agent-fast-path.md](../plan/agent-fast-path.md) §9.
- Section 1 can be claimed and completed now, independent of everything it enables.
