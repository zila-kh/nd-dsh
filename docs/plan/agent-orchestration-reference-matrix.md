# Agent orchestration reference matrix

Status: maintained research/reference document  
Updated: 2026-09-24

This file preserves the open-source systems explicitly studied while designing ND's multi-worker/company execution model. It is not a ranking and is not a claim that any project has a fixed architecture forever. Re-check the pinned source before using an observation for implementation or benchmark conclusions.

## Reference set

| Project | Repo | Observed revision | Why ND keeps it |
| --- | --- | --- | --- |
| LoopX | https://github.com/loopx-project/loopx | a038ad8d30703b42f1bb362eb9d0ab9bbf3aaaf0 | Long-horizon control plane: goals, gates, evidence, quotas, peer claims/leases, typed continuation and recoverable handoffs |
| QM | https://github.com/yc-software/qm | 861af65d75a1896418f8e1c7542b2ed34506324d | Durable subagent sessions/swarms, per-worker computers, mailboxes, leases/budgets |
| AWS Codex Agent Team sample | https://github.com/aws-samples/sample-codex-agent-team | 90b05ba04cbd49b0fb0e4f2ad7faecafad61ebb6 | Skill/spec-driven coordinator, explicit file scopes, shared checkout with worktree escalation |
| Orca | https://github.com/stablyai/orca | dac82f61bc710324f8883b11788869b6cf8a0ce2 | Worktree-first multi-agent workspace UX |
| Paperclip | https://github.com/paperclipai/paperclip | b41ccf097f26a2d75e31200301c447e17daa31eb | Company/task control plane, governance, budgets, scoped integrations, agent evaluation/training surfaces |
| Gajae Code | https://github.com/Yeachan-Heo/gajae-code | e87c91927b78c01c250a124ed2890488ac8bcb64 | Plan-before-mutation, durable goal ledger, bounded subagent contracts, leader-owned checkpoint state |
| LazyCodex | https://github.com/code-yeongyu/lazycodex | 86eff5079f555f3a67513cd487ec1410b29cc8f6 | Team-vs-subagent distinction, durable team state, adaptive worktree isolation |
| JCode | https://github.com/1jehuang/jcode | 1dcca5741e5797f27a8a0a3c274db662401f4c05 | Performance-oriented Rust decomposition plus repository-owned startup/session/memory benchmarks |
| Bamboo-agent | https://github.com/bigduu/Bamboo-agent | e65dd2c3015fa1344e2e84d1067b12fdb0c5b687 | Rust workspace layering, domain/core/infra/engine/app dependency direction, memory/compression/skills/MCP runtime structure |
| Aex Brain | https://github.com/aexhq/brain | f957a982affe3fe63f62ebca8f1a3bcab5260343 | Canonical journal, commit-before-effect, interruption uncertainty, generated Rust contracts, capability-restricted Wasmtime execution |
| Pioneer | https://github.com/pioneerdotai/pioneer | d566c5cbc70f2b16b8498580d7025b5d46c5f8a6 | Rust gateway/protocol/runtime-events/hooks/keystore/tasks/tools separation for a local-first desktop agent |
| Moltis | https://github.com/moltis-org/moltis | 1f6d28ea750d6654d52d5899b8be67727ebf7a19 | Modular Rust agent server, multiple sandbox backends, threat/security posture and release provenance |
| OpenAI Codex | https://github.com/openai/codex | e0a64cf2bc4535eb330c22857260a7856c1e8749 | Rust app-server/client/protocol/daemon seams and agent graph/identity/role surfaces |
| Goose | https://github.com/aaif-goose/goose | e678c3b64a1dfd3c262a6a2019f158d33d5dcab0 | Portable Rust runtime, ACP/MCP integration, feature-gated capabilities and observability/diagnostic patterns |
| kern | https://github.com/getkern/kern | aabe0c0d9e23c0e645a2f34030e219fe10fa3d09 | Fast daemonless rootless OCI isolation, resource profiles and typed agent-execution failures |
| Capsule runtime | https://github.com/capsulerun/runtime | b4be1fc4787d51abe177f3d0e38f3ffaf580ce9f | Wasm task isolation with resource limits and explicit file/host/environment exposure |
| PocketPaw | https://github.com/pocketpaw/pocketpaw | 0d2e337f439bace5d58957a7cf0090d4bb4a2ff7 | A2A, agent ledger, alerts, communication channels and local desktop/server product integration |

The revisions above are observation pins, not dependencies. ND does not vendor or require these projects.

## 1. LoopX

Observed design themes:

- long-horizon work is governed by durable goals, gates, todos, evidence, quotas and handoffs rather than by one chat/session;
- agent runtimes remain replaceable executors while the control plane owns continuation decisions;
- registered agents may act as peers, with claims, leases, capabilities and typed continuation deciding who acts next;
- human judgment and protected actions remain explicit gates;
- the board/UI is a projection of durable control state rather than the authority itself.

ND ideas to revisit:

- explicit typed continuation records for long-running company work;
- durable peer handoff and targeted wake semantics;
- quota/budget-driven continuation stops;
- stronger distinction between "needs human judgment" and "safe work can continue elsewhere";
- long-running evidence freshness and stale-evidence invalidation.

Benchmark/reference questions:

- human attention per verified completion over multi-session work;
- recovery time after interruption;
- stale-evidence rejection rate;
- messages/wakes per completed long-horizon objective;
- continuation efficiency before/after explicit quotas.

## 2. QM

Observed design themes:

- delegated work can live in persistent child sessions with its own transcript;
- swarm workers have durable identity, messaging, lifecycle state, and budgets;
- workers can receive dedicated private computers/sandboxes rather than inheriting one shared filesystem;
- an explicit shared forum computer is possible, but concurrent writers must still coordinate;
- completion and messages are durable rather than process-local.

ND ideas to revisit:

- durable team/member mailbox semantics;
- worker lifecycle/recovery after parent restarts;
- resource/budget bounds for recursive delegation;
- stronger sandbox providers as an execution-workspace backend.

Benchmark/reference questions:

- cost of private worker isolation versus Git-worktree isolation;
- worker wake/dispatch latency;
- durable message delivery overhead;
- parent/child recovery semantics under restart.

## 3. AWS sample-codex-agent-team

Observed design themes:

- the main thread is the coordinator;
- a durable spec/task document defines work;
- workers receive explicit file scopes, acceptance criteria, and verification instructions;
- same-checkout parallelism is acceptable when work is file-disjoint;
- worktrees are recommended when branch isolation is required or parallel work cannot remain file-disjoint.

ND ideas to revisit:

- compact worker assignment contracts;
- explicit no-edit boundaries;
- cheap planning/coordination through skills rather than heavy runtime machinery;
- keeping worktree isolation as a transaction primitive, not the only scheduling signal.

Benchmark/reference questions:

- coordination overhead of strict file-scope prompts;
- merge/rework rate for shared-checkout file-disjoint execution versus task worktrees;
- token/context overhead of coordinator-authored assignment contracts.

## 4. Orca

Observed design themes:

- multiple coding agents run side-by-side in separate Git worktrees;
- workspace/worktree identity is first-class in the product UX;
- the user can compare agent outcomes and integrate selected work;
- local/remote workspace concepts are exposed clearly.

ND ideas to revisit:

- task/workspace visibility in the UI;
- fast open/switch/inspect actions;
- branch/worktree cleanup ergonomics;
- remote execution workspace providers.

Benchmark/reference questions:

- worktree creation/recovery latency;
- disk overhead under 1/2/4/8/10 active tasks;
- user time to locate the worker/worktree that produced a change;
- cleanup/recovery after interrupted workers.

## 5. Paperclip

Observed design themes:

- task/company/org concepts are the control-plane abstraction, not Git;
- atomic task checkout/execution locks prevent duplicate ownership;
- blockers/dependencies are first-class;
- budgets/governance/heartbeats are first-class;
- execution workspace policy can choose shared or isolated behavior;
- issue-scoped worktree support exists in runtime/experimental form even when UI exposure is gated.

ND ideas to revisit:

- atomic task claim and durable lease semantics;
- company/org governance and scoped budget surfaces;
- task dependency wakeups;
- policy-driven workspace selection;
- keeping organizational truth independent of source-control state.

Benchmark/reference questions:

- scheduler claim/checkout throughput;
- recovery after orphaned worker runs;
- control-plane storage/event overhead;
- human-attention reduction from durable blocker/dependency modeling.

## 6. Gajae Code

Observed design themes:

- plan before mutation;
- durable goals/ledger carry progress and evidence;
- the leader owns goal/checkpoint/integration decisions;
- subagents are bounded by explicit target files/surfaces and acceptance criteria;
- parallel implementation is allowed for genuinely independent sub-domains;
- risky/overlapping work can request isolation/worktrees;
- heavyweight verification/review is performed at explicit boundaries.

ND ideas to revisit:

- leader/control-plane ownership of durable completion state;
- worker receipts rather than worker-authored completion;
- bounded subagent assignments and resumability;
- boundary-based verification to avoid redundant expensive review.

Benchmark/reference questions:

- token savings from subagent reuse/resumption;
- verification/review overhead per task versus per boundary;
- failure/retry rate for bounded parallel slices;
- context cost of durable goal/ledger execution.

## 7. LazyCodex

Observed design themes:

- plain subagents and coordinated teams are distinct abstractions;
- a team is used when members need cross-member coordination;
- durable team state records members/focus/status/artifacts;
- members are defined by concrete ownership/perspective rather than vague titles;
- worktrees are added when colliding members would touch the same files;
- leader owns integration and team lifecycle.

ND ideas to revisit:

- explicit team transport/coordination abstraction;
- durable team member state;
- structured peer handoffs;
- adaptive escalation from shared/read-only context to isolated writers.

ND intentionally differs on one point: for durable independent writable company tasks, task transaction isolation should be the default even if files appear disjoint. PR #21 showed that provenance/rollback/checkpoint isolation matters even without textual file overlap.

Benchmark/reference questions:

- coordination-message overhead versus serial execution;
- plain subagents versus team mode on partially coupled tasks;
- worktree escalation frequency;
- integration/rework rate with and without team communication.

## 8. JCode

Observed/repository-use theme:

- performance claims should be backed by benchmark code/results kept with the repository rather than architecture prose alone;
- Rust decomposition can remain highly modular while still exposing one primary product binary;
- session/startup/memory measurements should be reproducible and version-pinned.

ND already adopted this direction in PRD 0002 and docs/plan/performance-benchmark-suite.md.

Future benchmark/reference questions:

- startup cost;
- steady-state memory;
- terminal throughput/latency;
- repository/search operations;
- end-to-end coding task latency when a comparable deterministic fixture can be defined.


## 9. Bamboo-agent

Observed design themes:

- Cargo workspace tiers separate domain/core abstractions, infrastructure services, engine logic, and app entry points;
- core abstractions are intentionally dependency-light;
- memory, compression, skills, MCP, permissions, hooks, metrics and subagents are explicit runtime services rather than one monolith;
- desktop/server shells compose the engine instead of owning its core semantics.

ND ideas to revisit:

- extract `nd-protocol`, `nd-runtime`, and later `nd-journal` before the Rust surface grows further;
- keep dependency direction one-way and keep `nd-core` as a composition binary;
- avoid a crate-per-feature explosion until a boundary has an independent contract/security/durability reason.

## 10. Aex Brain

Observed design themes:

- one canonical journal commits durable records before effects are exposed;
- interruption preserves effect uncertainty instead of pretending success/failure;
- public contracts are generated from Rust types/route declarations;
- tools/environments use a consistent execution model;
- native components run in a capability-restricted Wasmtime worker.

ND ideas to revisit:

- canonical company execution/effect journal with idempotency and reconciliation;
- commit-before-effect for irreversible/external actions;
- generated TypeScript/Rust wire contracts;
- typed outcomes for uncertain interrupted effects.

## 11. Pioneer

Observed design themes:

- gateway, protocol, runtime events, hooks, keystore, tasks, tools, terminal, memory and provider concerns are separate crates;
- the gateway owns persistent state and execution while desktop surfaces remain clients;
- hooks add policy/context/diagnostics without turning the core loop into a product-specific monolith;
- secrets are purpose-separated from ordinary domain data.

ND ideas to revisit:

- clearer future local/remote ND Core gateway seam;
- typed runtime event surface;
- Rust-side hook interfaces for policy/diagnostics where measurement justifies migration;
- stronger secret-store separation as more runtime state moves native.

## 12. Moltis, kern, and Capsule

Observed design themes:

- Moltis supports multiple sandbox backends behind one agent product;
- kern makes rootless OCI isolation fast enough to consider per-call/task isolation and returns typed execution failures;
- Capsule models Wasm tasks with explicit CPU/memory/time, allowed files, allowed hosts, and allowed environment variables.

ND ideas to revisit:

- a provider-neutral `nd-sandbox` contract;
- keep Git worktrees for provenance/checkpoint isolation while sandbox providers enforce runtime authority;
- typed timeout/OOM/policy-denied outcomes;
- fail-closed company profiles that require enforceable resource limits.

## 13. OpenAI Codex

Observed design themes:

- Rust surfaces separate app-server client/server/daemon/protocol concerns;
- agent graph, identity and roles are explicit modules;
- the app-server protocol is a durable integration seam rather than UI-private plumbing.

ND ideas to revisit:

- stronger engine protocol/version contracts;
- reconnect/resume/health semantics shared by direct-engine adapters;
- schema-driven adapter tests.

## 14. Goose

Observed design themes:

- Rust runtime is usable from desktop, CLI and API surfaces;
- ACP/MCP are first-class integration seams;
- features are selectively compiled and capabilities remain explicit;
- telemetry/diagnostics are treated as product infrastructure.

ND ideas to revisit:

- one trace/correlation identity across Electron main, engine adapter and nd-core;
- exportable support/trace bundles;
- feature/capability posture that does not imply permission authority.

## 15. PocketPaw

Observed design themes:

- explicit A2A and agent-ledger surfaces;
- alerts and communication channels are product-level services;
- local server and desktop integration expose the same agent capabilities.

ND ideas to revisit:

- A2A as an optional interoperability adapter rather than internal authority;
- durable notification/alert routing;
- external communication as typed signals/effects under company policy.

## 16. ND synthesis

ND should not copy one reference architecture.

~~~text
ND control plane
  |
  +-- durable task graph / lease / team
  +-- workspace transaction
  +-- engine session binding
  +-- evidence / verification / review
  +-- integration queue
  |
  +-- execution providers
       ZCode / Codex / Claude / Cursor / Antigravity / Pi / Harness / future
~~~

Current design choice:

- task = durable work/transaction boundary;
- employee = organizational identity;
- team = coordination grouping;
- subagent = tactical subordinate lane;
- lease = exclusive task authority/version;
- worktree/workspace = writable isolation provider;
- engine session = replaceable runtime context;
- ND = checkpoint/verification/integration authority.

## 17. Comparative benchmark backlog

Comparisons must be reproducible and honest. Do not publish a "faster than X" claim unless workload, machine class, cold/warm policy, verification requirement, and completion definition are comparable.

| Dimension | ND metric |
| --- | --- |
| Task dispatch | ready -> lease -> engine start |
| Workspace setup | task ready -> isolated workspace ready |
| Parallel scale | 1/2/4/8/10 writable tasks |
| Memory | incremental RSS per logical task/session |
| Disk | worktree/sandbox delta per task |
| Coordination | model turns/messages per verified completion |
| Human attention | approvals/questions/manual recoveries per completion |
| Correctness | verified completion rate / first-review pass |
| Rework | retries + integration-conflict repairs |
| Isolation | rollback/cancel one task without changing peers/base |
| Recovery | restart -> reconciled runnable state |
| Integration | verified checkpoint -> merged project state |
| Cost | model/tool/runtime cost per verified task |

Benchmark rules:

1. compare verified outcomes, not merely process exit or claimed completion;
2. preserve raw evidence and provenance;
3. record exact upstream revision/configuration;
4. distinguish ND implementation benchmarks from external-system comparative experiments;
5. avoid network/model-latency claims unless both sides use equivalent providers/models and a documented setup;
6. retain failed/inconclusive experiments rather than cherry-picking only favorable runs.

## 18. ZCode/PR #21 reference incident

PR #21 in ND is retained as a local regression story, not as a claim about ZCode architecture.

Observed situation:

- direct ZCode-assisted development;
- multiple independently tracked tasks accumulated in one uncommitted checkout;
- the final branch name reflected the last task claim while the dirty tree contained several tasks;
- task-specific rollback/checkpoint/provenance could not be recovered after the fact.

Regression goal for ND company execution:

> Recreate a five-task, one-repository workload through ND with ZCode workers and prove five independently checkpointable/recoverable task transactions, while still sharing one nd-core and one ZCode app-server where appropriate.
