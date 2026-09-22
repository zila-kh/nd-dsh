# Agent orchestration reference matrix

Status: maintained research/reference document  
Updated: 2026-09-22

This file preserves the open-source systems explicitly studied while designing ND's multi-worker/company execution model. It is not a ranking and is not a claim that any project has a fixed architecture forever. Re-check the pinned source before using an observation for implementation or benchmark conclusions.

## Reference set

| Project | Repo | Observed revision | Why ND keeps it |
| --- | --- | --- | --- |
| QM | https://github.com/yc-software/qm | ca47f5c83578886a561e53178c2823b009363603 | Durable subagent sessions/swarms, per-worker computers, mailboxes, leases/budgets |
| AWS Codex Agent Team sample | https://github.com/aws-samples/sample-codex-agent-team | 90b05ba04cbd49b0fb0e4f2ad7faecafad61ebb6 | Skill/spec-driven coordinator, explicit file scopes, shared checkout with worktree escalation |
| Orca | https://github.com/stablyai/orca | 33ba1ff3df247652c546985201d9a6f4edaec80b | Worktree-first multi-agent workspace UX |
| Paperclip | https://github.com/paperclipai/paperclip | 1483bb8bcf5571bbec68db22119f7c685290d970 | Company/task control plane, atomic checkout, blockers, governance, budgets, workspace policy |
| Gajae Code | https://github.com/Yeachan-Heo/gajae-code | a84f851d8dd557f21772f27364f007a0ccd7cda7 | Plan-before-mutation, durable goal ledger, bounded subagent contracts, leader-owned checkpoint state |
| LazyCodex | https://github.com/code-yeongyu/lazycodex | e64afc5e32170c363d1d89007f79e3d20fa093bc | Team-vs-subagent distinction, durable team state, adaptive worktree isolation |
| jcode | https://github.com/1jehuang/jcode | 2a4edaa02057ac994a601311c4f03ed450e1b3c9 | Repository-owned performance/startup/memory benchmark inspiration |

The revisions above are observation pins, not dependencies. ND does not vendor or require these projects.

## 1. QM

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

## 2. AWS sample-codex-agent-team

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

## 3. Orca

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

## 4. Paperclip

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

## 5. Gajae Code

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

## 6. LazyCodex

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

## 7. jcode

Observed/repository-use theme:

- performance claims should be backed by benchmark code/results kept with the repository rather than architecture prose alone.

ND already adopted this direction in PRD 0002 and docs/plan/performance-benchmark-suite.md.

Future benchmark/reference questions:

- startup cost;
- steady-state memory;
- terminal throughput/latency;
- repository/search operations;
- end-to-end coding task latency when a comparable deterministic fixture can be defined.

## 8. ND synthesis

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

## 9. Comparative benchmark backlog

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

## 10. ZCode/PR #21 reference incident

PR #21 in ND is retained as a local regression story, not as a claim about ZCode architecture.

Observed situation:

- direct ZCode-assisted development;
- multiple independently tracked tasks accumulated in one uncommitted checkout;
- the final branch name reflected the last task claim while the dirty tree contained several tasks;
- task-specific rollback/checkpoint/provenance could not be recovered after the fact.

Regression goal for ND company execution:

> Recreate a five-task, one-repository workload through ND with ZCode workers and prove five independently checkpointable/recoverable task transactions, while still sharing one nd-core and one ZCode app-server where appropriate.
