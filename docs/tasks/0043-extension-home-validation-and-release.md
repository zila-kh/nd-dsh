# TODO 0043 — ND Extensions and Home validation and release evidence

> Priority: P1
> Owner: ND extensions
> Status: in progress 2026-09-27 — automated layers green (unit/integration/E2E/verify/build); operator manual pass pending (docs/qa/nd-extensions-home-manual.md)
> Depends on: 0035, 0036, 0037, 0038, 0039, 0040, 0041, 0042
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Verify the entire platform and both proving packages before marking PRD 0006 implemented.

## Scope

- Create a QA matrix covering fresh personal-only use, company/project contexts, existing-data migration, and both proving packages.
- Exercise UI and agent invocation, routing, grants, revocation, stale credentials, and unavailable/unsupported engines.
- Test package install/update/rollback/restart/uninstall and invalid manifests/paths using contained fixtures.
- Run Electron journeys for launcher context, notes, capture-local-first, explicit chat attachment, website opening, app selection, and workflow.
- Record real Windows multi-display/DPI capture, popup focus/handoff, denied OS operations, and selected app/file opening.
- Check packaged runtime resources and restart behavior; record startup/launcher and first-invocation latency against the pre-feature baseline without inventing numeric targets.
- Document real command results, remaining limitations, and links to evidence; keep unverified claims marked pending.

## Acceptance

- All acceptance scenarios in PRD 0006 have recorded pass/fail/blocked results and truthful evidence.
- No personal/company/project leakage, stale authority reuse, implicit screenshot upload, secret logging, or hidden automation browser occurs.
- Legacy settings, workflow state, and session attribution remain intact after upgrade.
- Both actual UI and agent flows use shared invocation; fixture-only checks are not presented as real OS/engine validation.
- pnpm verify, pnpm typecheck, pnpm test, and pnpm build pass before publication; failures are resolved or explicitly keep release blocked.
- PRD/task status changes reflect actual implementation and validation rather than documentation completion.

## Validation

Run all four repository gates, targeted Electron E2E, migration fixtures, and real Windows checks. Inspect staged diff for secrets before any eventual commit.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `docs/prd/0006-nd-extensions-and-personal-home.md`
- `tests/`
- `e2e/`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
