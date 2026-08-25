# ND-DSH — Better Than Every Individual Agent Harness

> Product strategy and execution plan for making ND-DSH the orchestration, verification, and software-company layer above the strongest coding-agent harnesses.

Status: strategic plan  
Updated: 2026-08-25  
Scope: product direction, architecture priorities, QA benchmark, beta-to-GA sequence

---

## 1. Product thesis

ND-DSH should not try to win by being a slightly better coding agent than Claude Code, Codex, Gemini CLI, goose, or DeepSeek Harness.

Those systems should be treated as replaceable workers.

ND should win at the layer above them:

> Give ND an idea, bug report, screenshot, design, customer feedback, or product objective. ND organizes the work, plans it, assigns the best worker, implements it, tests it, independently reviews it, fixes failures, preserves durable company knowledge, and prepares the result to ship with minimal supervision.

The core product promise is therefore:

```text
Idea / feedback / bug / design
              |
              v
        ND Company OS
              |
              v
      Product understanding
              |
              v
      Plan and dependency graph
              |
              v
     Best worker / engine routing
              |
              v
          Implementation
              |
              v
       Evidence-based QA
              |
              v
      Independent reviewer
              |
         +----+----+
         |         |
       PASS       FAIL
         |         |
         |      bounded rework
         |         |
         +----+----+
              |
              v
       Merge / PR / release
              |
              v
      Durable company memory
```

The target is not "best chat". The target is **best idea-to-verified-software system**.

---

## 2. Strategic positioning

The strongest agent products are already very good at individual execution:

- coding
- shell and filesystem work
- subagents
- skills
- MCP and extensions
- model-specific reasoning
- sandboxing and approvals
- resumable sessions

ND should avoid duplicating their strongest work where integration is possible.

The strategic positioning should be:

> **Claude Code, Codex, Gemini, goose, ND Harness, and future runtimes are workers. ND is the company that employs them.**

That means Company, Project, Task, Role, Skill, Workflow, Memory, Policy, QA evidence, and release state must never depend on one vendor-specific engine.

---

## 3. Top ten improvements

| Priority | Improvement | Required ND capability | Why it matters |
| --- | --- | --- | --- |
| 1 | Autonomy reliability | Idea -> plan -> build -> test -> review -> rework -> completion without babysitting | Primary product advantage |
| 2 | Parallel AI teams | Isolated concurrent workers, worktrees, processes, browser sessions, merge queue | Removes the one-active-run ceiling |
| 3 | Evidence-based reviewer | Diff + tests + browser + screenshots + console/network + acceptance criteria | Makes "done" trustworthy |
| 4 | Universal engine layer | Claude Code, Codex, Gemini CLI, ND Harness, goose/local/remote adapters | Competitors become ND employees |
| 5 | Company Brain | Durable product, architecture, design, code, feedback, incident, decision knowledge | Long-term organizational advantage |
| 6 | Real browser/device QA | Console, network, visual, responsive, accessibility, mobile/device coverage | Makes app verification real |
| 7 | Feedback -> task pipeline | Customer feedback, bug, screenshot, issue, crash log -> scoped delivery workflow | Makes ND useful after initial build |
| 8 | Smart model/engine routing | Route by quality, cost, latency, health, task type, historical performance | Removes model babysitting |
| 9 | Human takeover + reconciliation | Manual edits at any point without corrupting autonomous state | Keeps developers in control |
| 10 | Ship pipeline | Branch -> tests -> review -> PR -> CI -> preview -> deploy approval -> release | ND finishes the job |

---

## 4. Priority 1 — make autonomous completion reliable

The most important ND feature is not "more autonomy" by itself. It is **reliable autonomy with verifiable results**.

Today a worker can implement and a reviewer can pass or fail. The target state should require an evidence package before a task may be completed.

### Target task completion pipeline

```text
Worker implementation
        |
        v
      Git diff
        |
        v
 Static analysis / LSP
        |
        v
    Unit tests
        |
        v
 Integration / E2E tests
        |
        v
 Running application
        |
        v
 Browser/device verification
        |
        v
 Console + network inspection
        |
        v
 Screenshot / visual evidence
        |
        v
 Acceptance criteria check
        |
        v
 Independent reviewer
        |
     PASS / REWORK
```

### Evidence Pack

Every completed task should have a durable evidence object similar to:

```text
TASK-142 — Add signup page

Implementation
- 8 files changed

Build
- passed

Tests
- 23/23 unit tests passed
- signup E2E passed

Browser
- signup page loaded
- invalid input validated
- valid submit verified

Console
- 0 uncaught errors

Responsive
- 390px verified
- 768px verified
- 1440px verified

Reviewer
- independent engine/session
- verdict: PASS

Artifacts
- git diff
- test output
- screenshots
- browser trace
- reviewer receipt
```

### Rule

A task must never transition to `completed` only because a worker claims success.

Completion should be granted by ND based on required evidence and reviewer verdict.

---

## 5. Priority 2 — parallel AI teams

The current single-active-run model is appropriate for early reliability, but it must not remain the final execution architecture.

The target is safe parallel work:

```text
Project
 |
 +-- Task A -> worktree A -> Claude Code
 |
 +-- Task B -> worktree B -> Codex
 |
 +-- Task C -> worktree C -> Gemini CLI
 |
 +-- Task D -> worktree D -> ND Harness
 |
 +-------------------------------+
                 |
                 v
           Review queue
                 |
                 v
            Merge queue
```

Each worker needs:

- isolated Git worktree or equivalent snapshot
- isolated environment/process group
- isolated development ports
- isolated browser/session target
- scoped secrets
- scoped skills/MCP/tools
- task lease/ownership
- explicit resource budget
- conflict-aware merge/rebase handling
- evidence pack tied to its branch/worktree

The user should be able to give ND one objective and watch multiple employees work safely in parallel.

---

## 6. Priority 3 — evidence-based independent review

ND's reviewer should become stricter than a normal AI self-review.

The reviewer should receive:

- original task objective
- acceptance criteria
- implementation diff
- changed files
- build/test status
- browser trace
- screenshots
- console/network errors
- unresolved diagnostics
- previous failure/rework history
- relevant company/project memory

The reviewer should not rely on the worker's summary as evidence.

### Reviewer requirements

A reviewer should be able to fail a task for:

- missing acceptance criteria
- failing tests
- hidden console/runtime errors
- broken responsive behavior
- regression in existing behavior
- accessibility regression
- unsafe/security-sensitive behavior
- incorrect architectural direction
- incomplete documentation/migration work
- implementation that technically passes tests but violates product intent

### Cross-engine review

Where practical, ND should prefer a reviewer from a different model/engine family than the implementer.

Example:

```text
Frontend implementation -> Claude Code
Review                 -> Codex

Backend implementation  -> Codex
Review                 -> Gemini / ND Harness
```

This reduces shared blind spots.

---

## 7. Priority 4 — universal engine contract

ND should integrate strong coding harnesses instead of trying to reimplement all of them.

Target supported workers:

- ND Harness
- Codex
- Claude Code
- Gemini CLI
- goose
- local/offline runtimes
- remote/cloud workers
- future agents through a normalized adapter

### Required engine contract

Every engine adapter should normalize operations similar to:

```ts
interface CodingEngine {
  health(): Promise<EngineHealth>
  capabilities(): Promise<EngineCapabilities>

  startTask(input: TaskRunInput): Promise<EngineRun>
  resumeTask(runId: string, input?: ResumeInput): Promise<EngineRun>
  cancelTask(runId: string): Promise<void>

  streamEvents(runId: string): AsyncIterable<EngineEvent>
  respondToApproval(input: ApprovalResponse): Promise<void>

  changedFiles(runId: string): Promise<ChangedFile[]>
  artifacts(runId: string): Promise<RunArtifact[]>
  usage(runId: string): Promise<UsageReceipt>
}
```

Vendor-specific details must remain in adapters, not Company/Project/Task domain state.

### ND owns

- employee identity
- role
- task assignment
- project/company context
- skills and MCP policy
- authorization/policy
- durable memory
- workflow state
- evidence requirements
- review state
- cost/usage history
- release state

### Engine owns

- its internal agent loop
- vendor protocol
- model transport
- native session/thread protocol
- execution implementation details

---

## 8. Priority 5 — Company Brain

Durable memory should evolve from a list of context entries into a structured company knowledge system.

### Company Brain domains

```text
Company Brain

Product
 +-- mission
 +-- customers
 +-- terminology
 +-- requirements
 +-- product decisions

Architecture
 +-- systems
 +-- services
 +-- APIs
 +-- database schema
 +-- dependencies
 +-- ADRs

Code
 +-- symbols
 +-- ownership
 +-- tests
 +-- hotspots
 +-- known fragile areas

Design
 +-- tokens
 +-- components
 +-- screenshots
 +-- patterns
 +-- accessibility conventions

History
 +-- bugs
 +-- incidents
 +-- releases
 +-- failed approaches
 +-- migrations

Feedback
 +-- feature requests
 +-- complaints
 +-- support issues
 +-- observed usage problems
```

The goal is that a future employee begins with organizational context rather than re-learning the repository from zero.

### Required behavior

ND should know what is durable knowledge versus temporary run context.

It should automatically extract useful memory from:

- approved architecture decisions
- successful reviewer notes
- resolved bugs
- production incidents
- design conventions
- recurring QA failures
- user corrections
- release retrospectives

Memory should have provenance and should be correctable by the user.

---

## 9. Priority 6 — browser and device QA

The built-in visible browser is strategically important because ND can connect agent actions to exactly what the user sees.

The browser engineering surface should grow to include:

- multiple known tabs/targets
- console drawer
- network drawer
- viewport/device presets
- screenshot history
- visual before/after comparison
- element highlight/inspect
- source/component mapping
- accessibility inspection
- request/action timeline
- browser trace artifacts
- per-origin permissions/privacy
- browser data reset/private mode

### Definition of verified UI

For UI tasks, `completed` should increasingly mean:

- app loaded successfully
- required interaction flow exercised
- no blocking console errors
- no unexpected failed network requests
- required viewport(s) checked
- acceptance criteria visually confirmed
- screenshots/traces stored in evidence

Later, extend this model to real mobile/device targets where practical.

---

## 10. Priority 7 — feedback becomes first-class work

Users should not have to manually create a formal task for every change.

ND should accept:

- plain-language product idea
- customer feedback
- support complaint
- GitHub issue
- bug report
- screenshot
- crash log
- design
- feature request
- QA failure

and convert it into the company workflow.

### Example

Input:

> Users say signup is confusing.

Target flow:

```text
Feedback
  |
  v
Inspect existing signup flow
  |
  v
Open real application
  |
  v
Locate source + component system
  |
  v
Form product hypothesis
  |
  v
Create scoped plan/tasks
  |
  v
Implement
  |
  v
Browser-test
  |
  v
Independent review
  |
  v
Before/after evidence
```

The PM should determine whether a request is one small task or a project-level plan.

---

## 11. Priority 8 — automatic engine and model routing

Users should not be required to continuously decide which model or engine should perform each task.

The user-facing preference can be simpler:

```text
Quality: Maximum
Budget: $20
Priority: Fast
```

ND then chooses workers based on:

- task type
- required capabilities
- model quality
- engine health
- authentication state
- rate limits
- latency
- cost
- context size
- vision/tool/browser requirements
- historical first-pass rate
- rework rate
- repository-specific performance

### Routing telemetry

Store normalized outcomes:

```text
engine
model
task type
repository/project
latency
tokens
cost
build result
test result
review verdict
rework count
human intervention count
```

Over time ND can learn routing preferences from actual outcomes.

Example future insight:

> Codex currently has a 94% first-review-pass rate on backend refactors in this project, while Claude performs better on UI tasks.

---

## 12. Priority 9 — manual takeover without breaking autonomy

ND must remain useful to real developers who want to intervene.

A user should be able to:

- edit source manually
- modify design manually
- run terminal commands manually
- change a task
- stop/reassign an employee
- correct memory
- override a plan
- manually resolve a merge conflict

without corrupting autonomous state.

### Required reconciliation

When ND detects human changes during an active project, it should:

1. detect changed workspace state
2. identify whether the change overlaps active task ownership
3. pause/rebase/reconcile when necessary
4. refresh relevant context/evidence
5. avoid overwriting human changes
6. update the plan if the change materially changes assumptions
7. continue only when safe

The ideal product combines autonomous execution with expert manual control rather than forcing one mode.

---

## 13. Priority 10 — complete ship pipeline

ND should not stop at "I changed the code."

Target delivery path:

```text
Objective
  -> tasks
  -> implementation
  -> evidence QA
  -> independent review
  -> merge queue
  -> branch / commit
  -> PR
  -> CI
  -> preview environment
  -> deploy/release approval
  -> release notes
  -> production result
  -> rollback plan
  -> durable release memory
```

All external/irreversible operations remain governed by ND policy.

Release actions should produce durable audit receipts.

---

## 14. AI CTO / PM evolution

The PM must evolve from a one-time task generator into a continuous planner.

Target behavior:

```text
Business objective
      |
      v
Repository/product understanding
      |
      v
Architecture + risk analysis
      |
      v
Milestone plan
      |
      v
Dependency graph
      |
      v
Cost/resource estimate
      |
      v
Worker assignment
      |
      v
Observe execution/review outcomes
      |
      v
Re-plan dynamically
```

If task 3 discovers that the planned architecture is invalid, the PM should be able to modify tasks 4-8 instead of blindly executing a stale plan.

The PM should manage:

- scope
- sequencing
- blockers
- dependencies
- risk
- worker assignment
- rework
- project status
- technical debt created by the current objective
- release readiness

---

## 15. Design Mode as a defensible advantage

ND Pencil and the Design surface should become deeply connected to source rather than functioning as a detached mockup canvas.

Target relationship:

```text
Design element
      ^
      |
      v
React/component identity
      ^
      |
      v
Source location
      ^
      |
      v
Design token / variant
      ^
      |
      v
Live DOM/browser node
      ^
      |
      v
Git diff
```

Example user request:

> Make all buttons in the product match this selected design.

ND should understand:

- selected visual element
- actual Button component
- variant system
- design tokens
- source file
- usages across the project
- visual regression risk

and change the design system instead of blindly editing one DOM location.

---

## 16. Browser QA should compound into regression tests

A major quality multiplier is converting successful exploratory AI QA into deterministic reusable tests.

Example:

```text
AI manually tests signup
        |
        v
ND records meaningful actions/assertions
        |
        v
User/reviewer accepts scenario
        |
        v
Saved QA flow
        |
        v
Future releases replay it
        |
        v
CI regression test
```

Example saved scenario:

```text
QA Scenario: Customer Signup

1. Open /
2. Click Sign Up
3. Enter invalid email
4. Verify validation appears
5. Enter valid email
6. Submit
7. Verify dashboard loads
```

The first run may require model reasoning. Repeated runs should become as deterministic and cheap as practical.

This creates a compounding quality loop: each verified feature can leave behind another regression guard.

---

## 17. ND Real Software Benchmark

ND needs its own benchmark to determine whether it is actually better as a product.

The benchmark should measure **idea-to-verified-software success**, not only SWE-bench-style code patch success.

Use the real-world manual scenarios under `docs/qa/` and eventually automate as much as possible.

### Suggested metrics

| Metric | Target |
| --- | ---: |
| Idea -> working application | >90% |
| Tasks completed without human intervention | >90% |
| First independent-review pass | >80% |
| False completed tasks | <1% |
| Restart/recovery correctness | 100% |
| Tests green at final project completion | >98% |
| Browser acceptance criteria verified | >95% |
| Human approvals for normal internal work | <3 per small project |
| Wrong-file/wrong-component edits | <1% |
| Successful autonomous rework | >90% |

### Comparative benchmark

Run the same projects using:

```text
Claude Code alone
Codex alone
Gemini CLI alone
goose alone
ND Harness alone

ND + Claude Code
ND + Codex
ND + Gemini
ND + goose
ND + ND Harness
```

Primary benchmark score:

> **Idea-to-Verified-Software Success Rate**

Secondary metrics:

- completion time
- total model cost
- human interventions
- rework count
- review defects
- regression defects
- recovery success
- evidence completeness
- release readiness

ND wins if adding the ND control plane consistently improves final verified outcomes and reduces supervision compared with using the worker harness directly.

---

## 18. Target product experience

A new user should eventually be able to create:

```text
Company
Name: Acme
Mission: Build software for small restaurants
```

Then create a project with only:

> I want a SaaS where restaurants can create QR menus and customers can order from their phones.

ND should be able to drive:

```text
Research
  -> requirements
  -> architecture
  -> design
  -> project plan
  -> parallel implementation
  -> database
  -> frontend
  -> backend
  -> tests
  -> browser QA
  -> independent reviews
  -> automatic rework
  -> security/release review
  -> Git history
  -> PR
  -> CI
  -> preview deployment
```

The user should eventually receive something like:

```text
Project ready for approval

27 tasks completed
348 tests passing
12 browser flows verified
0 blocking console errors
responsive QA passed
security/release review passed

Cost: $14.27

[Open App] [Review Changes] [Ship]
```

This is the intended product experience: not "chat with an agent," but "operate an AI software company."

---

## 19. Recommended implementation order

### Phase A — beta trust

1. Finish installer/runtime distribution blockers.
2. Fix all E2E/smoke reliability problems.
3. Run the real-world manual beta QA suite repeatedly.
4. Add durable evidence packs for task completion.
5. Make reviewer evidence-aware.
6. Harden restart/recovery and cancellation.

Exit criterion: users can trust a completed task and a completed project.

### Phase B — orchestration advantage

1. Parallel worktree/task execution.
2. Merge/review queue.
3. Claude Code adapter.
4. Gemini CLI adapter.
5. goose/ACP-compatible adapter where useful.
6. Normalized engine capability/health/usage contracts.
7. Cross-engine independent review.

Exit criterion: ND can coordinate multiple best-in-class workers better than a user manually coordinating them.

### Phase C — compounding intelligence

1. Company Brain structured knowledge.
2. Feedback/bug/screenshot intake.
3. Dynamic PM replanning.
4. Historical engine/model performance store.
5. Automatic routing by task/cost/quality.
6. Deterministic QA scenario capture/replay.

Exit criterion: ND improves from company history instead of starting every task from zero.

### Phase D — full software-company delivery

1. PR/CI integration.
2. Preview environments.
3. release/deployment policy flow.
4. release notes and rollback plans.
5. production incident/feedback loop.
6. portfolio/cross-project objectives.

Exit criterion: ND can take a normal software objective from idea to release approval with minimal supervision.

---

## 20. Non-goals

ND should avoid wasting product effort on these traps:

- trying to own the best proprietary foundation model
- rebuilding every coding harness internally
- creating vendor-specific fields in organization state
- claiming completion based on agent narration
- maximizing autonomous action without verification
- adding more UI before core execution is reliable
- hiding failures to make demos look successful
- creating detached design mockups that do not map to production source

---

## 21. North-star metric

The main metric for ND should be:

> **Percentage of real software objectives that reach independently verified, release-ready completion without manual repair of ND itself.**

A second useful metric is:

> **Human interventions per verified objective.**

The goal is not zero human control. The goal is that human intervention is a choice for product judgment, not a requirement to continuously rescue the agent system.

---

## 22. Final strategic rule

Whenever deciding whether to build a feature, ask:

> Does this make ND better at turning an objective into verified shipped software, coordinating interchangeable workers, preserving company knowledge, or giving the human safer control?

If the answer is no, it is probably lower priority.

The desired moat is not one model, one agent loop, or one IDE feature.

The moat is:

```text
Persistent company state
+ interchangeable best-in-class workers
+ autonomous planning/execution
+ evidence-based independent verification
+ durable organizational knowledge
+ safe human control
+ complete delivery/release workflow
```

That is how ND-DSH can become more valuable than using any individual agent harness by itself.
