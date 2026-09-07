# External workflow plugins: ND company and Kanban integration

Review date: 2026-09-06. Status: delivery increments 1–3 implemented (scoped plugin foundation with install-on-demand, Scrum plugin reader over `nd.workflow/1`, company board mirror). Increment 4 (bounded context injection) and increment 5 (managed actions) remain unimplemented.

External workflows are plugins. Extend ND's existing plugin infrastructure with company/project bindings and typed workflow contributions; package the Scrum integration separately from ND's organization domain. Start with one supported template: the locally installed `@next-mmo/agent-workflow-scrum@0.1.0` in `C:/Users/dila/Documents/GitHub/awesome-dev`. Bind that plugin explicitly to an existing ND company/project, display its repository tasks on that project's board, and inject bounded project context into supported sessions. ND owns identity, authorization, assignments and execution. Repository workflow files remain authoritative for task contracts, lifecycle records and evidence.

The supplied path ending in `awesome-de` does not exist. The sibling `awesome-dev` is the inspected checkout. This review makes no claim of compatibility with arbitrary Scrum/agent frameworks or other package versions.

## Findings from the current checkout

| Evidence | Consequence for integration |
| --- | --- |
| `package.json` installs the workflow from a local 0.1.0 tarball; `.agents/config.json` is schema 1, standard mode, npm. | Detect the actual installed version/configuration. Do not install, update, vendor or initialize the package during discovery. |
| Task lifecycle is encoded in paths: `todo-*`, `wip-*`, `blocked-*`, and `done/done-*`. | Parse paths and Markdown contracts; CLI context output is not a complete board API. |
| The checker permits at most one active WIP/blocked task; top-level instructions say exactly one. | Zero is a valid idle board; multiple active records are a diagnostic. Do not invent a task when none exists. |
| `wip-0003-dark-mode.md` has six checked criteria but remains WIP; its PRD is draft and absent from the index. | Show In progress plus PRD/evidence warnings. Checked boxes do not imply completion or human acceptance. |
| Both archived records retain `wip-*` names inside `done/`. | Treat these as legacy archived records, retain the original path, and show the filename warning. Do not mistake them for active tasks. |
| Task 0001 records human acceptance; Task 0002 records browser evidence without an explicit human acceptance record. | Separate source-reported completion, evidence and acceptance. A repository statement is not a new ND approval event. |
| PRD 0002 has unchecked criteria despite its archived task being checked; `CONTEXT.md` still describes the pre-server scaffold although `server.js` exists. | Preserve contradictory source facts and show drift; do not overwrite the ND objective with stale summaries. |
| Configured product test/build checks are null. | Display unconfigured checks, not passing product verification. |
| Workflow roles are procedural guidance, not a structured employee roster in the inspected config/tasks. | Keep ND agents and teams; do not create employees from Markdown role names or auto-import all skills into company scope. |

Read-only diagnostics executed against the installed package:

- `check --root <awesome-dev> --json`: exit 0, schema 2, no errors, two archived-filename warnings, zero changed paths. The source checker evaluates product/PRD synchronization against changed scope, so this clean-tree pass does not establish whole-repository consistency.
- `context --root <awesome-dev> --provider local --level 0 --budget 1500 --json "workflow company kanban dark mode"`: exit 0, schema 5, one active task, linked Dark Mode PRD, ranked summaries, approximately 1,034 estimated tokens. L0 returns no full document bodies.
- Passing a literal `--` before the scope to the installed CLI failed with `unknown option: --`. Use tested argument arrays rather than copying a documentation command string blindly.
- `git status --short` in awesome-dev was clean. No repository workflow files were changed.

## Existing ND integration points and corrections to the earlier plan

- `src/shared/organization.ts` already defines company/project relationships, agents, roles, tasks, policies and simple plan/execute/review workflows. That workflow structure is an execution configuration, not an importer or general Scrum interpreter.
- `src/main/workspace/project-workspace-coordinator.ts` establishes company/project workspace context. Picking another folder can rebind the active project, so adapter enablement must be invalidated or revalidated when the root changes.
- `src/shared/workspace-context.ts` renders workspace metadata and strips it from displayed history. It does not load repository workflow state.
- `src/main/engines/engine-session-router.ts` adds workspace metadata to direct workspace engines. Harness adds it separately in `src/main/harness/harness-service.ts`. Organization planning and review also call Harness directly. Router-only injection would miss these paths.
- Organization task sessions can be created in dedicated worktrees, while the current router/Harness metadata paths use the globally selected workspace. The integration must resolve context from the run/session's project and actual working directory, not blindly append the currently selected workspace.
- ChatGPT Web does not receive `appendWorkspaceContext` at the router boundary, but it does receive its own Git transport context in `compileChatGptGitPrompt`. It needs a deliberate transport-specific context policy; local filesystem instructions cannot be assumed valid remotely.
- `src/main/organization/store.ts` automatically promotes dependency-free backlog tasks to Ready in `refreshProject`; `nextReadyTask` selects them for execution. Importing ordinary OrganizationTask records is therefore not passive.
- `src/main/organization/orchestrator.ts` supports parallel task worktrees, automatic advancement, completion without a review step, and completion/integration after an agent review passes. These do not implement this template's human acceptance rule.
- The active Company Workspace work board is implemented in `OrganizationDashboardLegacy.tsx`, reached through `OrganizationDashboard.tsx`. It renders five columns (Ready, In progress, Review, Blocked, Completed), although the shared task domain has six statuses including Backlog.
- The package's `worktree-core.mjs` implements ordinary Git worktree operations. It does not establish a shared Scrum task lease or a cross-worktree acceptance protocol.

ND's working tree already contained extensive unrelated edits and an unmerged index entry for the router. Implementation must start from an agreed, resolved version of those files; this review does not resolve or overwrite them.

## Plugin foundation: extend what already exists

The user's architecture decision is to make external workflows plugins and adapt ND core/company features to host them. This replaces the earlier proposal to ship a Scrum-specific adapter inside `src/main/workflows/adapters/`.

Current code already provides:

- `AgentExtensionManifest` in `src/shared/extensions.ts`: plugin/MCP/skill/command/hook/memory/subagent surfaces, instructions, executable MCP stdio runtime, global enablement, engine routes and provider routes.
- `ExtensionStore` and Settings > Plugins: persistent catalog, validation, enable/disable, removal and route preview.
- `ExtensionRouter`: engine/provider compatibility and prompt decoration.
- `scripts/nd-extension-mcp.mjs` and `scripts/nd-extension-runtime.mjs`: stable MCP gateway and shell proxy, current catalog/engine checks, limited environment inheritance and MCP subprocess calls.
- The capability registry in `src/shared/capabilities.ts`: existing engine/memory/context provider assignments for agents, roles and teams. Preserve this registry's purpose; a workflow plugin supplements its chosen providers rather than becoming another coding engine.

Missing pieces are company/project binding, per-contribution permissions, namespaced plugin state, a versioned workflow protocol, normalized board contributions, real lifecycle hooks, and run/session-bound authorization at every tool call. Current manifests have no company/project identity. `ExtensionRouter.bindings(engineId, providerId)` has no project argument. The shell proxy checks catalog/engine enablement but has no ND company/project/session authorization context. Its runtime inherits `process.cwd()` rather than a validated binding root. These are core changes, not requirements an external plugin can solve alone.

Current `appendExtensionContext` labels the entire extension block trusted configuration. Split host-selected metadata from plugin-authored instructions/results before adding external workflow content. Installation must not elevate third-party prose into ND policy. Current `hook-bridge` only supplies prompt guidance; managed workflow checks require actual awaited hooks with typed results.

| Layer | Changes and ownership |
| --- | --- |
| ND plugin catalog | Versioned package manifest, provenance/integrity, compatible ND API version, optional contribution list, installation/update/remove lifecycle |
| Company/project | Explicit plugin bindings, granted permissions, project settings, optional agent/role assignments, audit events |
| ND plugin host | Resolve authenticated run scope, invoke declared contributions, validate results, bound output/time, namespaced state, revoke calls on disable |
| ND workflow service | Generic snapshots, source identities, stable board projection, sync transactions and later action/acceptance coordination |
| ND renderer | Native plugin settings, source-backed cards, source/health details and schema-driven plugin configuration; no third-party renderer JavaScript |
| Scrum plugin package | Detect 0.1.0/config schema 1, parse this template's Markdown/path conventions, map lifecycle, emit diagnostics/context, later propose canonical transition patches |
| Project repository | Existing npm workflow dependency and tracked `.agents/` documents; no extra plugin runtime copied into product source |

Separate three records: an installed package (versioned code/manifest), a company/project binding (activation and grants), and per-binding runtime state (snapshots/cursors/health). Installing once does not activate everywhere. Company policy is an upper bound; project bindings opt in explicitly; agent/role assignment can narrow usage and cannot widen grants. Resolve effective permission as the intersection of package declaration, company policy, binding grants, assigned subject scope and actual transport capability. A denial wins.

Keep `surface: plugin` as the package identity and add typed contributions, so one package can supply workflow data, context, skills and commands without several independent installations. Proposed manifest fragment (design sketch, not accepted by the current schema):

```json
{
  "schemaVersion": 2,
  "id": "agent-workflow-scrum",
  "version": "0.1.0",
  "surface": "plugin",
  "ndApiVersion": "1",
  "contributions": [
    { "kind": "workflow", "id": "scrum", "protocolVersion": 1 },
    { "kind": "context", "id": "active-increment" },
    { "kind": "command", "id": "workflow-status" }
  ],
  "requestedPermissions": ["project.workflow.read", "board.project", "context.contribute"]
}
```

Plugin version and upstream npm workflow version are distinct fields in the complete manifest; detection reports supported upstream versions/config schemas. Start with a local, reviewed plugin package and the installed project dependency. A marketplace, remote publishing and unrelated plugin formats are outside the pilot. Do not claim Codex/ChatGPT plugin packages are automatically ND-compatible; import/mapping is a separate compatibility feature.

Extend the existing catalog/sanitizer and migrate old manifests explicitly. Existing extensions keep their declared legacy behavior; they gain no company API access or workflow contribution permissions implicitly. New workflow plugins require a validated project binding even if an older manifest has `enabled: true`. Reuse current engine routing for delivering tools/context, but board synchronization is an ND host capability and must work without starting a coding engine. Report support per contribution (board, context, tools, managed actions), not one global supported boolean.

## Versioned workflow plugin protocol and host boundary

Use the existing MCP transport where appropriate with typed ND workflow requests/results; do not let an arbitrary MCP server become a board writer merely by naming a tool `workflow.sync`. Require a declared, version-compatible workflow contribution and validate every response in ND core.

Pilot protocol methods are `detect`, `readSnapshot`, and `buildContext`. Future methods are `validateTransition` and `proposeTransition`. ND owns the transaction that accepts a snapshot or applies a transition. Plugin output cannot call `OrganizationStore`, write `organization.json`, create a company, approve a task, or change policy directly. A future plugin can request narrow ND actions through the host with a human/agent actor and recorded authorization.

Pass a minimal, immutable invocation context: plugin/binding revision, company/project IDs, permitted subject IDs, actual session/worktree/source identity and granted contribution permissions. Include names/mission only when required for the declared contribution; do not export all company memory, unrelated projects, credentials or routes. Keep plugin state partitioned by company/project/plugin/binding, including when the same package is enabled in two companies.

For engine MCP/proxy calls, add a host-issued session binding rather than trusting engineId, companyId or cwd supplied in tool arguments. Both transport paths must resolve live grants through the main-process broker and fail closed after project rebind, disable, uninstall or permission change. Permission checks only during prompt generation are insufficient. Use typed permissions rather than trying to infer every plugin operation from command-name regexes.

External plugin code must not load into Electron's main process or renderer. Reuse a supervised subprocess transport for the reviewed pilot package with explicit cwd, minimal environment, deadlines and cancellation. A subprocess is not an OS sandbox: the current stdio runtime executes with the desktop user's permissions, so manifest grants alone cannot prevent its own filesystem/network activity. Untrusted third-party execution requires a proven sandbox/broker-only runtime before ND can advertise that guarantee. The initial plugin is reviewed/trusted; ND still enforces all company APIs and publication of plugin results through the host.

Lifecycle behavior is explicit: crashes/timeouts preserve a stale last-good board; disable revokes calls and context immediately and shows existing cards as disconnected; uninstall retains namespaced audit/history without touching project files; updates validate API/version compatibility, require grants for added privileges, migrate state atomically and retain a rollback version. No package update automatically promotes Mirror to Managed.

For future real hooks, core emits scoped project-open/run-before/run-after/action-before events. Plugin hooks return bounded typed diagnostics/preconditions; ND decides the allowed action. Reject reentrant execution and cyclic hooks, deduplicate event IDs, and treat timeouts on required managed preconditions as a paused action. Plugins may add restrictions within an enabled workflow contract; they cannot grant themselves permission or declare human acceptance.

## Ownership and explicit enablement

Add a project-specific Workflow setting with Off (default) and Mirror. Detection proposes `Agent Workflow Scrum 0.1.0`; a user enables it for the selected company/project/root. This plan does not enable any live company, since no target company/project was selected in this review.

Persist the binding in ND-owned plugin binding storage, not in repository `AGENTS.md` or `.agents/config.json`. Scope it by company ID, project ID, plugin ID/version/contribution, canonical workspace root, and repository identity. Include the chosen source branch/root and independent context-injection enablement. Rebinding a project or changing the plugin compatibility version requires validation before further sync. A company-level policy can deny integration; a detected file cannot enable it.

| Owner | Fields |
| --- | --- |
| ND | Company, project identity/objective, employees, teams, provider/engine routes, execution permissions, optional ND assignee/priority annotations |
| Repository | Task number/title/outcome/scope/criteria, source lifecycle, linked PRDs and their statuses, evidence and recorded decisions |
| Derived by adapter | Board projection, source diagnostics, hashes, freshness, source links and context excerpts |

Project guidance is subordinate to the current authorized request and ND's enforced permissions. Imported prose cannot create approval, authorize commands, change company policy, or assign an engine. Keep the package installed in the project; do not copy its runtime into ND or modify Harness core.

## First release: company and Kanban mirror

Use a separate persisted workflow snapshot and a board-view union such as `nd-task | repository-task`. Repository cards live beside ND cards in the same project board, but do not enter `OrganizationSnapshot.tasks`, `nextReadyTask`, agent capacity calculations or ND delivery-progress metrics. Show source counts separately where metrics need them. This makes the first release materially smaller than adding execution exclusions to every existing task mutation and scheduler path.

Proposed narrow contracts:

- `ProjectWorkflowBinding`: plugin-binding identity, contribution compatibility, mode, contextEnabled, validated source root/ref.
- `ProjectWorkflowSnapshot`: schema version, binding identity, scan revision/time, branch/HEAD/dirty state, tasks, PRDs, diagnostics, last error and stale flag.
- `RepositoryWorkflowTask`: stable external key, source path/hash, reported lifecycle, display status, criteria including checked state, PRD references, evidence excerpts, acceptance-record status, optional ND annotations.
- External Scrum plugin contribution: `detect`, `readSnapshot`, `buildContext`. Keep Scrum parsing in the plugin package. `src/main/workflows/` contains only generic protocol validation, sync and projection services; shared/rendering code receives normalized records.
- Narrow IPC: inspect, enable/disable, refresh, read snapshot, and changed event. Resolve paths/company ownership in the main process; the renderer cannot supply an arbitrary filesystem root or command.

| Repository record | Board column | Additional treatment |
| --- | --- | --- |
| `todo-*` | Ready | Ready in repository; no ND Run action in Mirror mode |
| `wip-*` | In progress | Preserve lifecycle even if every checkbox is checked |
| `blocked-*` | Blocked | Show recorded blocker; no automatic ND retry |
| `done/done-*` | Completed | Label source-reported completion; show acceptance separately |
| Existing `done/wip-*` | Completed | Legacy archive warning; same source-reported completion semantics |
| Missing/ambiguous lifecycle, conflicting duplicate IDs | No invented status | Show in a Needs attention area; preserve last valid projection |
| PRD, proposal, plan | Linked project documents | Do not create a task, overwrite objectives or mark goals complete just because the document exists |

Expected first import: three cards, one In progress (Dark Mode) and two source-reported Completed (Bootstrap, Express/Todo). No Ready, Review or Blocked records. Show draft/missing-index warnings on Dark Mode, archive naming warnings, and missing explicit acceptance on Task 0002. None creates a run or a human-acceptance event.

Sync semantics:

1. Read only the enabled binding's canonical root. Validate real paths, junction/symlink containment, file sizes/counts, schema and supported version before parsing; reject merge conflict markers or malformed contracts as diagnostics.
2. Use binding identity plus task number as the external key. Keep it across slug/prefix/location renames. Duplicate numbers within one binding are conflicts; do not silently collapse them. Unnumbered records need an explicit mapping before import.
3. Hash file contents and preserve the source revision/dirty state. Scan one selected source checkout, not every discovered worktree. Retry if files change during the scan; publish one consistent snapshot atomically.
4. Refresh manually and when the bound project opens; refresh at relevant run boundaries after context support exists. No-op refreshes create no duplicate cards or activity spam. Continuous watchers can wait.
5. Never delete an ND task when a file disappears. Mark a previously observed repository card source-missing until a successful reconciliation; failed scans retain the last valid snapshot marked stale.
6. Filter every snapshot/event by company/project/binding revision. Switching projects during a scan must not publish the old project's cards or context into the new one.
7. Mirror controls are Refresh, Open source, Inspect context and Disable. ND annotations may be edited separately. Run, Retry, Review, lifecycle drag/drop and automatic promotion are unavailable for repository cards and rejected server-side if a caller tries them.

## Context injection

After the mirror works, extend `ExtensionRouter` with one main-process context resolver used by both router and direct Harness entry paths. Resolve project-bound plugin contributions and render the same normalized envelope once per turn; deduplicate startup persona/turn blocks and strip only ND-owned blocks from displayed history. Keep filesystem reads outside `src/shared`.

The resolver takes an explicit run context: companyId, projectId, ND task ID if any, external task key if selected, session ID, actual cwd and source revision. An interactive session uses its validated project binding. A background task uses its owning project and registered worktree. Global UI selection must not override an existing session's context.

Inject a compact envelope containing:

- ND company/project identity and optional assigned agent/role; only authorized project-scoped memory/skills relevant to the selected task.
- Adapter/version, mode, actual cwd, source branch/HEAD, dirty state and snapshot freshness.
- Selected/active repository task, outcome/scope, exact relevant criteria, linked PRD and its approval state.
- Applicable workflow rules: one active increment, required evidence, checks configured or missing, human acceptance, and Mirror capability limits.
- Source paths and actionable diagnostics. Summaries are advisory; do not infer approval from text or checked boxes.

Use an ND-enforced total budget (proposed default 1,500 tokens). The config's AGENTS/CONTEXT budgets are per-document budgets, not the injected-envelope budget. Never truncate away binding identity, restrictions, approval state or diagnostics; summarize optional content and retain links. Escape envelope delimiters and treat Markdown as source data. Prompt instructions describe capabilities; main-process policy enforces them.

Passive sync runs no project commands. Optional on-demand context/diagnostics can invoke the verified project-local CLI with fixed argument arrays, `shell: false`, time/output limits, no automatic installation and `--provider local`. Check ND policy before command execution. Do not run configured `verify` commands during background refresh: those are executable project code, not just parsing. Source reads supply the complete board; CLI summaries augment context.

Initially support local workspace engines and Harness, including organization planning/review call paths. Keep ChatGPT Web workflow injection explicitly unavailable until a tested envelope contains remote repository/ref facts, respects its existing Git transport rules, and has an explicit policy for sending local/uncommitted content. Do not silently claim parity.

## Later: ND-controlled template actions

Only after mirror/context acceptance, add a separate Managed mode. Map the existing company PM/engineer/reviewer roles explicitly; retain human acceptance as its own event. An AI reviewer passing a task produces review evidence, not a human completion decision.

Managed actions are commands against a bound source task (start, block, submit for review, accept), not unrestricted file writes or a second independent status field. They need a compare-and-swap source revision, per-project task lease, auditable actor/reason, and visible Git diff for each canonical repository update. Keep an ND link to the existing external task instead of creating duplicate board cards. Preserve prose and unrelated edits; stale/conflicting source changes pause the command for reconciliation.

Start with one active managed increment across the project. ND may have multiple employees but must serialize template lifecycle changes. ND owns worktree creation and integration; do not also ask the template's CLI to create nested worktrees. Before starting, account for an existing active repository task and uncommitted files absent from new worktrees. Before accepting, require fresh verification tied to the exact worktree revision and recorded human acceptance, then apply the canonical completion/archive change with recoverable Git integration. Do not bypass the acceptance gate through the no-review workflow path or autopilot.

ND-only tasks remain available, but planning/execution in a Managed template project must respect the shared workflow lease and cannot create a competing active increment. Automatic PRD approval, policy changes, arbitrary template discovery and general bidirectional sync remain separate future work.

## Delivery order and acceptance checks

1. **Scoped plugin foundation:** extend `src/shared/extensions.ts`, `ExtensionStore`, extension IPC/preload and Settings > Plugins with manifest contributions, package identity and explicit company/project bindings. Add the host broker/session authorization seam to MCP/proxy calls. Test old-manifest migration, denied/forged bindings, disable/rebind revocation and same-plugin/two-company isolation. No new arbitrary plugin installer or marketplace is needed for this increment.
2. **Scrum plugin and reader:** add the external reviewed plugin package, generic workflow protocol/service/storage and detection preview. Fixtures cover this checkout's real legacy filenames, State/Status metadata variants, draft/missing PRDs, duplicate IDs, malformed files, path escapes and unsupported versions. Contract tests must prove the plugin can be disabled/replaced without Scrum-specific organization branches.
3. **Company board mirror:** add preload/IPC and repository-card rendering to the existing board. Verify three expected cards, stable IDs after rename, repeat/restart idempotence, source-missing/stale handling, atomic snapshots and company isolation. Verify no ordinary task record/run/progress change is produced; forged Run/Review requests cannot act on repository keys. The board works with no coding engine running.
4. **Bounded plugin context:** add the scoped resolver to direct/Harness paths and diagnostic preview. Verify opt-out, company/project switches, actual task worktree cwd, exactly one envelope, history handling, budget/delimiter protection and explicit unsupported Web behavior. Test background project A while the UI selects B; test plugin-authored policy cannot override host grants.
5. **Managed actions, separate increment:** implement real typed lifecycle hooks, revision checks, project lease, lifecycle patching, explicit role mapping and human acceptance gate. Test concurrent starts, stale edits, hook retries/timeouts/reentrancy, crash/restart recovery, rework, no-review/autopilot bypasses and worktree integration failures.

Before publishing implementation changes, run `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build`, as required by ND contributor guidance. This review ran the template's read-only diagnostics only; it did not build or test ND's unrelated in-progress changes.
