# TODO 0029 — Browser target picker and safe auto-routing UX

> Priority: P1
> Owner: ND product/browser
> Status: merged to main via PR #41 — implementation complete; UX smoke pending
> Depends on: 0021, 0022, 0023, 0028

## Objective

Make target choice obvious to users and deterministic for agents.

## Scope

- `@Browser` built-in target;
- `@Chrome` companion target;
- `@Tab` exact tab picker;
- Auto mode;
- current target/profile indicator;
- agent-control indicator;
- account/profile ambiguity prompt;
- inspectable routing decision in run provenance.

## Acceptance

Explicit selection always wins, Auto never silently crosses browser identity when
account intent is ambiguous, and the active target is visible during execution.

## Implementation evidence

- `src/renderer/src/components/BrowserPane.tsx` exposes Auto, `@Browser`,
  connected `@Chrome` targets and exact-tab selection.
- active built-in tabs are visible and selectable.
- approvals are surfaced inline in the browser pane.
- Chat/engine routing receives the unified browser context and access-token path.
- auto routing is constrained by target selection and capability/identity rules
  in `BrowserTargetRouter`.

Local UX smoke should verify target/profile ambiguity prompts and provenance.
