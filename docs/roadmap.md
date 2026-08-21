# Roadmap

## Milestone 1 — vertical slice (implemented)

- Secure Electron/React shell.
- One visible `WebContentsView` with exact CDP target binding.
- agent-browser MCP on the shared target.
- Pinned DeepSeek Harness submodule and gateway adapter.
- Workspace explorer, source preview, agent chat, persistence, and subagents.

## Milestone 2 — AI company foundation (implemented on `ai-company-workflow`)

1. Multi-company isolation with persistent company identity, mission, autonomy, policies, memory, workforce, and activity.
2. Multi-project hierarchy with objectives, workspace binding, goals, milestones, dependency-aware tasks, and progress.
3. Seeded Product, Engineering, and Quality & Research teams with AI PM, worker, reviewer, and researcher roles/agents.
4. Built-in + company/project scoped skills and reusable workflow definitions.
5. Company dashboard with company/project switchers, work board, live runs, memory, policies, workforce, and skills.

Success criterion: a user can create multiple isolated companies, create multiple projects inside a company, and manage the organization from one desktop surface.

## Milestone 3 — autonomous PM workflow (implemented vertical slice)

1. AI PM produces machine-readable goals, milestones, dependencies, assignments, and acceptance criteria.
2. Ready tasks execute in fresh Harness worker sessions with company/project/role/skill/memory context.
3. Completed work moves to a fresh independent reviewer session.
4. Review pass completes/unblocks downstream tasks and captures durable lessons; review fail blocks the task.
5. Autonomy level 3+ can continue the Plan → Execute → Review loop automatically, subject to company policy.

Success criterion: one explicit project start can progress through planning, execution, independent review, and the next dependency-ready task without manual prompt chaining.

## Milestone 4 — real coding workspace

1. Replace the source preview with Monaco.
2. Add controlled read/write/edit IPC with optimistic conflict checks.
3. Start one language-server supervisor per workspace and map diagnostics, symbols, definitions, references, rename, and code actions into Monaco.
4. Add a PTY terminal surface with process-group cleanup and explicit shell permissions.
5. Add Problems, Output, and Git panels.

Success criterion: the user can implement and validate a normal web change without leaving the application.

## Milestone 5 — browser product surface

1. Render a desktop tab strip backed by agent-browser target ids.
2. Add console and network drawers fed by the same controller.
3. Add viewport presets, device emulation, screenshot history, and element highlight overlays.
4. Add a visible action timeline that links each Harness tool call to browser state before and after execution.
5. Add per-origin permission controls and ephemeral/private browser profiles.

Success criterion: every browser action is observable, attributable, and recoverable by the user.

## Milestone 6 — organization operations and safety

1. Add an organization approval queue for `ask` policies and map decisions to durable policy/audit records.
2. Project Harness jobs/subagent trees into company projects and task runs.
3. Add scoped secrets/integrations through the operating-system credential vault.
4. Add scheduled/conditional workflows, retries, service-level objectives, and failure recovery.
5. Add company-level objectives, cross-project planning, budgets, and resource allocation.

Success criterion: long-running AI-company work is safe to interrupt, inspect, approve, resume, and govern across multiple projects.

## Milestone 7 — distribution

1. Add electron-builder or Electron Forge packaging.
2. Sign and notarize macOS builds; sign Windows builds.
3. Bundle or acquire a compatible Harness runtime and agent-browser binary per platform.
4. Add SBOM, third-party notices, update signatures, crash reporting, and release provenance.
5. Add automated desktop smoke tests that launch Electron, bind the visible target, create a fixture company/project, and drive a deterministic organization workflow.

Success criterion: a clean machine can install, launch, update, and verify ND-DSH without a developer toolchain.
