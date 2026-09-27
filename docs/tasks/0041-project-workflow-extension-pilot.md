# TODO 0041 — Project Workflow extension pilot

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 — automated layers green; operator manual gate pending (docs/qa/nd-extensions-home-manual.md)
> Depends on: 0038, 0039
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Demonstrate that a globally installed package can offer real project-only capabilities without changing ND's workflow ownership.

## Scope

- Wrap the existing workflow integration as an nd.extension/1 package using nd.workflow/1.
- Provide searchable repository-task list/detail views and launcher open/refresh actions.
- Expose the same project snapshot and bounded context to agents through the shared invocation service.
- Reuse company/project bindings, provenance, source evidence, diagnostics, and cached stale-state behavior.
- Keep existing read-only Mirror semantics and project-owned upstream dependency lifecycle.

## Acceptance

- Package installs globally and is unavailable in Personal; activation binds an authorized company/project.
- UI and agent tools read the same scoped workflow state.
- Two projects using the package cannot read one another's snapshots through caller-supplied IDs.
- No command mutates repository tasks, executes project checks, installs upstream dependencies, or grants approval.
- Existing workflow bindings and saved snapshots survive compatibility migration.

## Validation

Run workflow manifest/store/service/CLI tests and UI-agent pilot integration/E2E; run pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/shared/workflow-plugins.ts`
- `src/main/workflows/workflow-service.ts`
- `src/renderer/src/components/WorkflowPluginsCard.tsx`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
