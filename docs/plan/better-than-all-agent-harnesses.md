# ND-DSH — Better Than Every Individual Agent Harness

> Strategy index for making ND-DSH the orchestration, verification, and software-company layer above the strongest coding-agent harnesses.

Status: strategic plan  
Updated: 2026-08-25

## Product thesis

ND-DSH should not try to win by being a slightly better coding agent than Claude Code, Codex, Gemini CLI, goose, or DeepSeek Harness.

Those systems should be treated as replaceable workers.

ND should win at the layer above them:

> Give ND an idea, bug report, screenshot, design, customer feedback, or product objective. ND organizes the work, plans it, assigns the best worker, implements it, tests it, independently reviews it, fixes failures, preserves durable company knowledge, and prepares the result to ship with minimal supervision.

Primary product metric:

> **Idea-to-Verified-Software Success Rate**

## Execution phases

### Phase 1 — Beta Reliability and Verified Delivery

See [`phase-1-beta-reliability.md`](phase-1-beta-reliability.md).

Focus:

- beta blockers and release CI
- evidence-based task completion
- independent review
- interruption/restart recovery
- safe human takeover
- feedback as input
- real-world manual QA gate

Exit outcome: ND can reliably turn a small real-world objective into verified working software without requiring the user to micromanage implementation.

### Phase 2 — Agent Company Scale and Differentiation

See [`phase-2-agent-company-scale.md`](phase-2-agent-company-scale.md).

Focus:

- parallel AI workers and isolated worktrees
- universal coding-engine contract
- Claude/Codex/Gemini/goose/ND Harness as interchangeable workers
- smart model and engine routing
- Company Brain
- stronger AI PM/CTO replanning
- source-aware Design Mode
- browser regression capture
- feedback-to-work automation

Exit outcome: ND is materially more capable than using any single coding harness by itself because it coordinates multiple workers, persistent company knowledge, verification, design, and routing.

### Phase 3 — Autonomous Software Company and Shipping

See [`phase-3-autonomous-software-company.md`](phase-3-autonomous-software-company.md).

Focus:

- full PR/CI/preview/deployment/release pipeline
- normalized policy/action envelope
- scheduled and conditional workflows
- cross-project portfolio planning
- autonomous issue/feedback operations
- enterprise controls and remote supervision
- cost/quality/SLO management
- ND Real Software Benchmark

Exit outcome: ND can take a business/product objective through a complete reviewed release workflow with bounded human oversight.

## Overall target architecture

```text
Idea / feedback / bug / design
              |
              v
        ND Company OS
              |
      +-------+--------+
      |                |
      v                v
  Company Brain     AI PM / CTO
                       |
                       v
              dependency task graph
                       |
          +------------+------------+
          |            |            |
          v            v            v
       Claude         Codex        Gemini
       / other        / ND         / goose
          |            |            |
          +------------+------------+
                       |
                       v
                Evidence pipeline
                       |
                       v
              Independent review
                       |
              +--------+--------+
              |                 |
            PASS              REWORK
              |                 |
              +--------+--------+
                       |
                       v
              PR / CI / Preview
                       |
                       v
               policy-approved ship
```

## Final differentiated claim

ND should not claim to own the best coding model.

The long-term product claim is:

> **ND is the software-company operating system that turns ideas and feedback into verified shipped software using the best available AI workers.**
