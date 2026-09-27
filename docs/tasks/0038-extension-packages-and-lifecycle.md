# TODO 0038 — Extension packages and lifecycle

> Priority: P1
> Owner: ND extensions
> Status: planned — implementation deferred
> Depends on: 0035, 0036
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Install one native ND package globally while maintaining independent context activation, settings, and permission grants.

## Scope

- Define nd-extension.json protocol nd.extension/1 with version/API compatibility, permissions/settings, and tool/skill-context/command/view/workflow contributions.
- Validate unique package-qualified contribution IDs and contained runtime/resource paths; reject escaping symlinks or traversal.
- Install local directories or private Git sources into immutable ND-managed snapshots with content identity and provenance; execute no package build/install scripts.
- Separate installation from context activation; preserve existing catalogs through adapters rather than destructive replacement.
- Implement explicit update and atomic version switch, previous-version rollback, disable, and uninstall. Permission increases require fresh grants before activation.
- Keep failed/declined updates from disturbing the current version; bind in-flight invocations to a version.
- Remove executable access on uninstall while retaining user-authored personal data. Do not persist secret values or credential-bearing repository URLs.

## Acceptance

- An installed package contributes multiple capabilities but executes nothing until authorized activation/invocation.
- Invalid versions, API ranges, duplicate IDs, path escape, and malformed contributions fail with useful errors.
- Installation without required prebuilt runtime artifacts reports the missing build instead of installing dependencies.
- Update failure, restart, rollback, disable, and uninstall preserve specified settings/data and revoke access correctly.
- Legacy agent capabilities/workflow installations remain usable through tested adapters.

## Validation

Run package validation, temporary-directory install/lifecycle, migration, and existing store tests; run pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/main/extensions/extension-store.ts`
- `src/main/workflows/workflow-plugin-store.ts`
- `src/shared/extensions.ts`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
