# TODO 0029 — Browser target picker and safe auto-routing UX

> Priority: P1
> Owner: ND product/browser
> Status: todo
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
