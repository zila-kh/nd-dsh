# ND-DSH roadmap

This roadmap is ordered by release risk. ND-DSH is coding-first; broader business-company templates come after the software-company loop is reliable.

## Shipped foundation

The `ai-company-workflow` branch already contains the product vertical slice:

- Secure Electron/React desktop shell with one canonical visible browser target.
- Pinned Harness runtime behind an ND adapter and loopback gateway.
- Provider-neutral model routing with DeepSeek as a compatibility default rather than product architecture.
- OS-backed encrypted provider credentials when a secure key store exists.
- Existing provider credentials are write-only from React: Settings sees `has credential`, can replace/clear, and never receives the stored decrypted key.
- Multi-company and multi-project durable organization state.
- Teams, roles, AI employees, scoped skills, workflows, goals, milestones, tasks, memory, policies, activities, and run receipts.
- AI PM → assigned worker → independent reviewer workflow.
- Dependency-aware progression, autonomy 3 continuation, bounded autonomy 4 rework.
- Correct cancellation, restart/interruption recovery, backup organization state, and one-active-run runtime ownership.
- Global runtime approval/question UI.
- Product-owned coding-engine catalog.
- ND Harness primary engine plus the pinned official Codex app-server adapter as a delegated one-shot coding engine.
- Durable per-employee engine routing in the Workforce UI.
- Main-process company policy gate for approval-bearing organization runs.
- Production renderer fails closed when the trusted runtime is missing; no mock company/session/workspace fallback.
- Product browser starts blank rather than depending on a localhost development server.

## Public Beta P0 — release the desktop safely

These are blockers for a downloadable public beta, not optional polish.

### 1. Runtime distribution

- Package a Node-compatible runtime required by the Harness launcher, or remove the external Node dependency from the packaged path.
- Bundle the pinned Harness build and every runtime package required by the selected profile.
- Bundle/resolve agent-browser per supported platform.
- Make bootstrap a developer workflow only; an installed app must not require Git, pnpm, a submodule checkout, or a developer toolchain.
- Verify licenses and notices for redistributed runtime dependencies.

Success criterion: a clean supported machine can install ND-DSH and start the real agent runtime offline from developer tooling.

### 2. Signed installers and updates

- Choose the production packager (Electron Forge or electron-builder) and lock configuration in-repo.
- macOS signing + hardened runtime + notarization.
- Windows code signing.
- Release/update signature verification and channel policy.
- App icons, bundle identifiers, version metadata, uninstall behavior, and migration strategy.

Success criterion: downloaded installers are trusted by the OS and update without replacing user organization/session state.

### 3. Installed-app E2E

At minimum, automate this smoke path on supported platforms:

```text
install -> launch -> preload bridge -> open workspace -> browser target bound
-> configure fixture provider -> create company/project
-> PM plan -> worker edits fixture -> reviewer pass -> project 100%
-> close -> reopen -> organization + engine assignment + sessions survive
```

Add negative coverage for cancellation, crash/restart recovery, missing engine, corrupted primary organization state, rejected policy approval, and missing credentials.

Success criterion: source build success is no longer the only proof that a release artifact works.

### 4. Policy/action normalization

The current main-process gate is a real hard boundary for Harness approval frames, but the upstream frame exposes only tool name/reason. Before enterprise GA:

- Define an ND action envelope (`action`, target, risk, externality, destructive scope, cost, provenance).
- Emit it from ND-owned MCP/tools and engine adapters.
- Map browser external writes, deployments, remote Git mutations, destructive data actions, purchases, and messaging to company policy before execution.
- Store durable decision/audit receipts.
- Preserve fail-closed behavior when an engine cannot supply enough metadata.

Success criterion: sensitive actions are governed consistently across Harness, Codex, browser/MCP, and future engines rather than inferred from prompt text.

### 5. Engine onboarding and health

- Add Codex installed/authenticated/project-trust health checks without copying native Codex credentials into ND provider storage.
- Distinguish engine availability, authentication, degraded health, and rate limiting in Settings.
- Surface actionable remediation before a user assigns an unavailable/unhealthy engine to an AI employee.

Success criterion: users can tell why an engine is not ready before starting work and ND never fabricates readiness.

## Public Beta P1 — best-in-class AI development environment

### Editor and code intelligence

- Monaco editor with controlled write IPC and optimistic conflict detection.
- LSP supervisor per workspace: diagnostics, symbols, definitions, references, rename, code actions.
- Problems/Output panels linked to agent runs.
- Git status/diff/staging/commit surface with company-policy gates for remote mutations.

### Terminal and processes

- PTY terminal with process-group cleanup.
- Explicit terminal permission mode and organization action tagging.
- Attach running jobs/test output to task/run receipts.

### Browser engineering surface

- Multi-tab UI backed by known CDP target ids.
- Console/network drawers.
- Device/viewport presets and screenshot history.
- Element highlight/inspect overlays.
- Action timeline tying browser state to agent tool calls.
- Per-origin privacy controls and browser-data reset/private mode.

Success criterion: a software team can implement, debug, visually verify, review, and ship a normal application change without leaving ND-DSH.

## P1 — ND Skills and MCP control plane

ND should own reusable capability definitions even when an engine implements the protocol.

- Durable MCP server registry with transport, command/URL, encrypted credential references, health, company scope, and agent allowlists.
- ND skill schema with scope, instructions, required capabilities, allowed tools/MCP, and engine hints.
- Harness compiler for ND skills/MCP.
- Codex compiler when the direct adapter can honor equivalent capability controls.
- Capability inspector showing the exact resolved skills/tools/MCP/policies for a run.

Success criterion: changing coding engine does not require rebuilding the company's skills/integration configuration.

## P1 — provider/model routing

- Provider templates for common vendors without vendor conditionals in organization code.
- Live model discovery where supported.
- Company/project/role/agent/task model-route inheritance.
- Capability metadata: context, reasoning, vision, computer use, tool calling.
- Cost/token/latency metadata and budgets.
- Provider health, rate-limit circuit breakers, fallback routes, and explicit audit of every routing decision.
- Credential-source metadata (`secure-store`, `environment`, `ambient`) so Settings can explain what can and cannot be cleared locally without exposing a secret value.

Success criterion: ND can choose a model based on job requirements, budget, latency, and health without changing the employee/workflow identity.

## P2 — enterprise company operations

- Durable policy/audit ledger with actor, engine, model, tool/action, approval, evidence, and result.
- Organization budgets, token/cost limits, quotas, and SLOs.
- Scheduled and conditional workflows with bounded retries.
- Cross-project objectives, resource allocation, and portfolio planning.
- Team/user accounts, roles and administrative controls when ND moves beyond single-user desktop beta.
- Enterprise identity, managed configuration, export/retention controls, and organization backup/restore strategy.
- Remote supervision so a desktop execution host can be steered/approved from another trusted client.

## P2 — richer coding engines

- Direct persistent Codex app-server adapter with thread/resume/progress if the delegated one-shot route becomes limiting.
- Claude Code or other coding-engine adapters behind the same ND contract.
- Local/offline engine adapter.
- Remote/cloud workers with the same company/task/policy receipts.

No engine should require vendor-specific fields in Company, Project, Task, Role, Skill, or Workflow objects.

## Release labels

Until P0 distribution/signing/E2E gates are complete, use **ND-DSH Developer Preview / Private Beta** for source builds.

After those P0 gates pass, ship **ND-DSH Public Beta** with clear supported-OS/provider/engine limits.

Reserve **enterprise-ready / GA** claims for the normalized action-policy layer, audit/administrative controls, release operations, and support commitments—not merely for a successful desktop build.
