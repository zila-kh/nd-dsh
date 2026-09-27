# TODO 0037 — ND Home personal storage and chat

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 — automated layers green; operator manual gate pending (docs/qa/nd-extensions-home-manual.md)
> Depends on: 0035, 0036
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Enable genuine personal use with no company, project, or manually opened workspace.

## Scope

- Add ND Home navigation and durable personal notes, artifact references, and scoped chat metadata in ND-managed user storage.
- Provide personal note create/search/open operations without organization-memory mutation.
- Give engines requiring cwd a managed per-chat directory; route provider/model selection through existing ND contracts.
- Persist context and working-directory bindings across restart. Do not rebind sessions when organization selection changes.
- Exclude personal records from company/project prompt context unless the user explicitly selects an authorized transfer.
- Preserve existing company/project notes and legacy standalone workspace/session behavior.

## Acceptance

- Fresh ND with zero companies/projects can save/find a personal note and start chat when a provider is configured.
- Missing provider configuration produces setup guidance without creating fake company/project data.
- Personal sessions remain personal across company navigation and restart.
- Managed cwd is not advertised as an OS sandbox; broader file/process access remains governed by task 0036.
- Existing notes/session history survive migration, including unattributed legacy workspace chats.

## Validation

Run personal persistence/session integration tests and fresh-profile Electron smoke; run pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/renderer/src/App.tsx`
- `src/main/engines/engine-session-router.ts`
- `src/main/workspace/project-workspace-coordinator.ts`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
