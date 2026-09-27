# Beta three-layer validation — operator handoff

> Updated: 2026-09-27  
> Purpose: turn the Beta Stable release decision into three independent validation layers: **Unit -> E2E -> Human**.

## Why three layers

No single test type is enough for ND-DSH:

- **Unit** proves deterministic rules and failure handling quickly.
- **E2E** proves the real Electron/Rust/provider/Git/browser integration.
- **Human** proves the product is understandable and usable in realistic desktop conditions.

For every beta-exposed feature, all three layers must pass before the release evidence gate can pass. Experimental or unfinished features must be disabled or marked non-beta-exposed.

This is a release-confidence system, not a mathematical claim that the product is literally 99% bug-free. If the team wants to target a 99% repeated scenario pass rate, set `scenarioRuns.targetPassRate` to `0.99` and collect enough repeated runs to make that number meaningful.

## Layer 1 — Unit

Run the deterministic repository gates:

```sh
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm core:test
```

Required coverage for beta-exposed P0/P1 behavior includes:

- company/project/task ownership and isolation;
- worktree and Git safety;
- provider retry/failover/auth handling;
- compute-budget correctness;
- credential/redaction boundaries;
- policy/approval rules;
- persistence/recovery;
- terminal/filesystem/path containment;
- browser leases/tokens/policy;
- MCP/skill malformed/timeout handling.

Record the exact command/run output or task/evidence document in the feature's `unit.evidence` array.

## Layer 2 — E2E

Build and exercise the real app:

```sh
corepack pnpm build
corepack pnpm e2e
corepack pnpm e2e:prod:user
```

Add the packaged-app and clean-machine journey from [beta-release-readiness.md](../plan/beta-release-readiness.md).

Critical E2E paths must include:

1. company -> project -> PM plan -> worker -> verification -> independent review -> Git/result;
2. multi-company/project switching while work remains active;
3. parallel agents in isolated task worktrees;
4. close/reopen and crash/recovery;
5. provider down / missing credential / unavailable engine;
6. cancellation and merge-conflict/refusal behavior;
7. browser/MCP failure without killing the whole session;
8. packaged artifact behavior, not only source checkout behavior.

Record the run/evidence reference in each feature's `e2e.evidence` array.

## Layer 3 — Human manual

Use [manual-beta-real-world.md](manual-beta-real-world.md) plus the RC-specific checks below.

A human tester must personally verify the visible behavior. The release agent must not fabricate or self-approve this layer.

Mandatory manual checks:

- create/switch among multiple companies and projects;
- leave work running while switching context;
- inspect board/task state and confirm ownership stays understandable;
- stop/cancel work and confirm no false completion;
- restart ND during active work and recover safely;
- trigger at least one provider/engine failure and judge the error message;
- inspect Git diff/result and confirm no unexpected workspace damage;
- test the packaged artifact on a clean machine;
- inspect diagnostics for secret redaction;
- perform the real-world beta matrix and soak checks from the readiness plan.

For every beta-exposed feature, fill:

- `human.status = "pass"`;
- `human.tester`;
- `human.recordedAt`;
- at least one human evidence note/reference.

## Evidence workflow

Copy the committed template to an RC-specific evidence file:

```sh
cp docs/qa/beta-three-layer-evidence.example.json docs/qa/beta-three-layer-evidence-<rc>.json
```

On Windows PowerShell:

```powershell
Copy-Item docs/qa/beta-three-layer-evidence.example.json docs/qa/beta-three-layer-evidence-<rc>.json
```

Fill the release identity, all three layers, repeated scenario counts, and final human decision.

Then run:

```sh
corepack pnpm beta:gate -- docs/qa/beta-three-layer-evidence-<rc>.json
```

The verifier fails when:

- any beta-exposed feature is missing Unit, E2E, or Human PASS;
- any layer lacks evidence;
- the human layer lacks a tester/date;
- P0 or core P1 issues remain open;
- repeated scenario pass rate is below the configured target;
- the final human release owner has not explicitly chosen `go`.

## Recommended feature matrix

At minimum keep separate evidence rows for:

| Feature | Risk |
| --- | --- |
| Core agent delivery flow | P0 |
| Multi-company/project isolation | P0 |
| Parallel agents + worktree safety | P0 |
| Git push + secret safety | P0 |
| Credential/provider scope | P0 |
| Persistence/restart/crash recovery | P0 |
| Security/policy/redaction boundaries | P0 |
| Provider/model failure handling | P1 |
| Browser + Browser Companion | P1 |
| MCP/skills failure containment | P1 |
| Budget/entitlement correctness | P1 |
| Diagnostics/observability | P1 |

Split rows further when one feature has materially different failure modes.

## Release rule

A Private Beta RC may be handed to invited users only when:

- every beta-exposed P0/P1 row passes **Unit + E2E + Human**;
- `p0Open = 0`;
- `p1CoreOpen = 0`;
- repeated scenario pass rate meets the configured target;
- the clean-machine packaged journey passes;
- the 24-hour soak has no P0/P1 result;
- the human release owner records `go`.

Do not weaken one layer because another layer is strong. A unit test cannot replace a real packaged E2E run, and automation cannot replace the final human usability/reality check.

## Local-agent handoff

1. Work from the current RC branch, not `main`.
2. Do not add unrelated features during validation.
3. Close missing Unit/E2E coverage first.
4. Build the packaged artifact and perform clean-machine E2E.
5. Hand the Human layer to a real tester.
6. Collect the RC evidence JSON.
7. Run `corepack pnpm beta:gate -- <evidence.json>`.
8. If it fails, treat every reported item as a release blocker or disable that feature from beta exposure.
9. Only the human release owner changes `humanDecision.status` to `go`.
