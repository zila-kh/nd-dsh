# TODO 0042 — Extension SDK and authoring guide

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 — schema, TypeScript types, CLI validator (shared production rules), example package, and authoring guide recorded
> Depends on: 0038, 0039, 0040, 0041
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Let local and team developers build native ND extensions against the implemented contract.

## Scope

- Publish a checked-in manifest schema, TypeScript contribution/view types, and a local validator using the same production validation rules.
- Provide a minimal package example and documented Daily Essentials/Project Workflow examples.
- Document build-before-install, local/private Git distribution, version/API compatibility, updates/rollback, supported contexts, grants, and settings.
- Document the shared UI/agent operation model, schema-driven views, MCP executable trust, environment-variable references, and ND-owned provider routing.
- Include deterministic fixture-based capability evaluation examples and instructions for manual real-runtime validation.
- Explicitly distinguish instruction-only hooks from executable behavior, process supervision from OS sandboxing, and supported APIs from deferred features.

## Acceptance

- A developer can follow the guide from a clean local example through validation, install, activation, invocation, update, and rollback.
- Examples contain only explicit dummy credentials or environment references and require no live secrets to validate.
- Validator results match runtime validation for invalid package cases.
- Docs do not promise public publishing, custom panels, arbitrary compatibility, or sandbox guarantees absent from v1.

## Validation

Validate all example packages and schema/type checks; perform the documented authoring walkthrough with fixture runtimes.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `examples/extension-counter/`
- `src/shared/extensions.ts`
- `docs/prd/0006-nd-extensions-and-personal-home.md`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
