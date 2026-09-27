# TODO 0035 — Extension context and scope contracts

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 — automated layers green; operator manual gate pending (docs/qa/nd-extensions-home-manual.md)
> Depends on: None
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Define explicit personal/company/project ownership independently of globally installed extensions and filesystem workspaces.

## Scope

- Add a discriminated context contract, supported-context declarations, context activation/settings records, and typed invocation identity shared by main, preload, renderer, and engine adapters.
- Validate company/project relationships on the trusted side. Bind sessions and runs to their initial context rather than current UI selection.
- Define compatibility adapters for existing agent-extension manifests, workflow bindings, and standalone workspace/session records.
- Preserve unattributed historical sessions under their original workspace; do not infer personal ownership or auto-transfer data.
- Keep global installation, context activation, resource grants, and executable trust as separate concepts.

## Acceptance

- Personal contexts exist without company/project IDs; malformed or mismatched project/company context is rejected.
- Changing visible context cannot rebind an existing chat or run.
- Contract tests cover all context kinds, unsupported contribution contexts, and legacy attribution.
- Migration fixtures retain existing route policy, workflow bindings, and standalone workspace associations.

## Validation

Run focused shared-contract and session-scope tests plus pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/shared/extensions.ts`
- `src/shared/workflow-plugins.ts`
- `src/shared/session-project-scope.ts`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
