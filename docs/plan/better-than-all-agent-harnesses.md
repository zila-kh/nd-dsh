# ND-DSH — AI Software Company OS Strategy

> Strategy index for making ND-DSH the software-delivery operating system above the strongest coding-agent harnesses.

Status: strategic plan  
Updated: 2026-08-25

## Product thesis

ND-DSH should not try to win by being a slightly better coding agent than Claude Code, Codex, Gemini CLI, goose, DeepSeek Harness, or whatever becomes best next.

Those systems should be treated as replaceable workers.

ND should win at the layer above them:

> Give ND an idea, bug report, screenshot, design, customer feedback, production signal, or product objective. ND organizes the work, plans it, assigns the best workers, executes bounded work, verifies exact outcomes, fixes failures, preserves durable company knowledge, manages cost and risk, and prepares the result to ship with minimal human supervision.

The scarce resource in AI-era software development is shifting from code generation to **direction, verification, coordination, governance, and human attention**.

ND should therefore optimize for two primary product metrics:

> **Idea-to-Verified-Software Success Rate**

> **Human Attention per Verified Outcome**

## Product invariants

1. **Engines are executors, not durable truth.** Company/project/goal/task state must survive sessions, engines, restarts, and model changes.
2. **If safe valuable work exists, keep working.** The user should not become the scheduler for ordinary software delivery.
3. **If no verified useful transition exists, stop spending.** Timers and scheduler wakes are not permission to burn tokens.
4. **Human Action is not always a Human Gate.** Scope blocking decisions so independent lanes can continue.
5. **Done means verified.** Completion must be backed by current evidence for the exact source state/diff.
6. **A source change invalidates stale proof.** Old review/evidence cannot silently authorize merge or release.
7. **Human corrections become company learning.** Durable operating lessons should survive the chat/session that produced them.
8. **The UI should optimize human attention.** `Needs You` matters more than forcing managers to watch agent chats or raw Kanban state.
9. **Capabilities are stable; providers and engines are replaceable.** Company policy should not depend on whichever vendor happens to execute today.
10. **Sensitive authority stays explicit.** Production, destructive actions, external publication, money, secrets, and high-impact product decisions remain governed.

## Execution phases

### Phase 1 — Beta Reliability and Verified Delivery

See [`phase-1-beta-reliability.md`](phase-1-beta-reliability.md).

Focus:

- beta blockers, packaging, release CI, installed-app E2E
- ND Task Control Kernel with typed turn decisions/results
- exact-diff evidence receipts and stale-proof invalidation
- independent review
- scoped Human Action vs Human Gate
- provider credential isolation from autonomous worker environments
- interruption/restart recovery and company snapshots
- safe human takeover/resume
- feedback as input
- real-world manual QA gate

Exit outcome: ND can reliably turn a small real-world objective into verified working software without requiring the user to micromanage implementation, and the product cannot confuse agent prose with durable completion truth.

### Phase 2 — Agent Company Scale and Differentiation

See [`phase-2-agent-company-scale.md`](phase-2-agent-company-scale.md).

Focus:

- parallel AI workers and isolated worktrees
- per-task leases, versions, TTLs, and write scopes
- universal coding-engine contract
- Claude/Codex/Gemini/goose/ND Harness as interchangeable workers
- ND Capability / Provider / Extension boundary
- smart model and engine routing from verified outcomes
- Company Brain and durable operating lessons
- continuous AI PM/CTO replanning
- Signal Inbox and Strategic Anchors
- `Needs You`, Agent Lanes, and Review Feed
- AI employee performance by quality/cost/human attention
- source-aware Design Mode
- browser regression capture
- feedback-to-work automation

Exit outcome: ND is materially more capable than using any single coding harness by itself because it coordinates multiple workers, persistent company knowledge, scoped authority, verification, design, routing, and attention-efficient human supervision.

### Phase 3 — Autonomous Software Company and Shipping

See [`phase-3-autonomous-software-company.md`](phase-3-autonomous-software-company.md).

Focus:

- full PR/CI/preview/deployment/release pipeline
- normalized policy/action envelope
- deterministic `shouldRun()` continuation contract
- compute quota, budgets, quiet no-op, and stop conditions
- scheduled and conditional workflows
- lifetime company goals and long-horizon recovery
- cross-project portfolio planning and strategic anchors
- autonomous signal/feedback operations
- enterprise controls and remote supervision
- cost/quality/human-attention SLO management
- 24h / 72h / 7-day controlled soak tests
- ND Real Software Benchmark

Exit outcome: ND can take a business/product objective through a complete reviewed release workflow and continue operating over time with bounded human oversight, explicit budgets, durable state, and low attention cost.

## Overall target architecture

```text
Idea / feedback / bug / design / production signal
                       |
                       v
                 ND Company OS
                       |
        +--------------+--------------+
        |                             |
        v                             v
   Company Brain                  AI PM / CTO
                                      |
                                      v
                           dependency task graph
                                      |
                           ND Task Control Kernel
                                      |
                 +--------------------+--------------------+
                 |                    |                    |
                 v                    v                    v
              Claude                Codex                Gemini
              / other               / ND                 / goose
                 |                    |                    |
                 +--------------------+--------------------+
                                      |
                                      v
                           exact evidence receipts
                                      |
                                      v
                            Independent review
                                      |
                            +---------+---------+
                            |                   |
                          PASS                REWORK
                            |                   |
                            +---------+---------+
                                      |
                                      v
                             PR / CI / Preview
                                      |
                                      v
                              policy-approved ship
                                      |
                                      v
                        feedback / production evidence
                                      |
                                      +----> next governed loop
```

## Management surface target

The default company experience should answer management questions before exposing raw technical internals:

```text
Company
├── Needs You
├── Running
├── Watching
├── Ready to Review
├── Strategic Anchors
├── Projects
├── Team / Employee Performance
└── Cost / Quality / Attention
```

Advanced users can still inspect chat, source, terminal, browser, Git, tasks, traces, and engine details.

## Final differentiated claim

ND should not claim to own the best coding model.

The long-term product claim is:

> **ND is the AI software-company operating system that turns ideas, feedback, and real-world signals into verified shipped software using the best available AI workers while minimizing the human attention required to supervise them.**
