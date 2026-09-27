# Beta three-layer validation — local RC handoff

> Updated: 2026-09-27  
> Branch: `feat/beta-release-stability-plan-2026-09-27`  
> Purpose: produce reviewable evidence for **Unit -> E2E -> Human** on one exact RC before a supervised beta release.

## Release rule

A beta-exposed P0/P1 feature is ready only when all three independent layers pass:

1. **Unit** — deterministic logic, boundaries, recovery, refusal and failure classification.
2. **E2E** — real Electron/Rust/Git/browser/provider integration and packaged artifact behavior.
3. **Human** — a real tester verifies usability, state truthfulness and OS/browser behavior.

The final machine gate also requires:

- 0 P0;
- 0 core P1;
- repeated scenario pass rate meeting the configured target;
- automated RC summary = PASS;
- clean-machine packaged proof = PASS;
- real Chrome Companion proof = PASS;
- a **24-hour (1440 minute) soak** = PASS;
- explicit Human GO.

An agent must not fabricate the Human layer or final GO.

## Important Private Beta limitation

Provider API keys are currently **desktop-global operator resources**. The shared Harness/gateway consumes one global ProviderStore runtime configuration; keys are not yet isolated per company/project/environment.

For the supervised Private Beta:

- use one trusted human/operator security domain per ND desktop;
- companies/projects may select different provider/model routes, but their API-key storage is not a tenant-secret boundary;
- do not claim that mutually untrusted companies can safely store independent secrets in one ND desktop;
- true company/project/env secret isolation requires a runtime/gateway boundary change and is not faked by this release plan.

All other company/project state and writable task-workspace ownership must still remain isolated.

## What this hardening branch adds

- product-level Git push secret blocking in both normal push and session-branch push;
- explicit HTTP 429 / rate-limit retry classification;
- deterministic **3 companies x 2 projects** E2E matrix with forged cross-company rejection and restart persistence;
- Settings -> About -> Copy diagnostics E2E privacy proof;
- built-in browser runtime proof promoted into the release runner (cookie set/read/clear + real download);
- one-command automated RC runner with JSON receipt;
- Windows forced-nd-core-crash cleanup in the packaged release stage;
- configurable Electron soak harness with process/memory/state samples and JSON receipt;
- final three-layer gate that rejects a soak shorter than 24 hours.

## 0. Prepare the exact RC

Do not run this from `main`.

```powershell
git fetch origin
git checkout feat/beta-release-stability-plan-2026-09-27
git pull --ff-only
git status --short
git rev-parse HEAD
corepack enable
corepack pnpm install --frozen-lockfile
```

Record the SHA returned by `git rev-parse HEAD`. Do not add feature work after validation begins. If a P0/P1 fix is required, commit it, restart validation, and use the new SHA.

Configure live E2E models from the gitignored local file:

```powershell
Copy-Item .env.e2e.example .env.e2e
# Fill E2E_MODEL_BASE_URL, E2E_MODEL_API_KEY, E2E_MODEL_1, E2E_MODEL_2, E2E_MODEL_3
```

Never commit `.env.e2e`.

## 1. Run the automated Unit + E2E + artifact gate

On the Windows RC machine:

```powershell
corepack pnpm beta:automated
```

This intentionally runs the expensive release set:

- repository verification;
- TypeScript typecheck;
- full Vitest suite;
- Rust fmt/clippy/tests;
- browser-host Rust tests;
- browser platform tests;
- production build;
- full Playwright desktop suite;
- explicit 3x2 beta matrix;
- live-model `e2e:prod` journey/stress;
- built-in browser cookie/storage/download runtime proof;
- ND Core contract benchmark;
- committed agent-task budget check;
- Windows portable package;
- forced nd-core crash/descendant cleanup;
- packaged core/terminal/Git smoke.

Expected final line:

```text
Automated release status: PASS
```

The command writes:

```text
e2e-results/beta-automated-<timestamp>/beta-automated-summary.json
```

If it says PARTIAL or FAIL, do not continue to GO. The runner deliberately returns non-zero when Windows package evidence, live tests, benchmarks, or any required stage is skipped.

### Fast reruns during fixing

These are useful while fixing one layer, but they do **not** replace the final `beta:automated` run:

```powershell
corepack pnpm test
corepack pnpm e2e:beta:matrix
corepack pnpm e2e:prod
corepack pnpm bench:browser-runtime
corepack pnpm release:smoke:core-crash
corepack pnpm release:smoke:packaged
```

## 2. Run the real Chrome Companion check

Use your normal installed Google Chrome profile only for the dedicated companion test:

```powershell
corepack pnpm e2e:companion:chrome
```

Chrome may show a native optional-host-permission dialog. A real human must answer it.

Verify:

- extension/native host connects;
- intended origin is granted and an ungranted origin is refused;
- snapshot/click/fill/press/scroll/navigation work;
- stale refs fail;
- second writer is refused;
- disconnect revokes leases and reconnect succeeds;
- password values are redacted;
- built-in browser remains usable;
- perform the toolbar invocation needed by Chrome for `captureVisibleTab`, then verify screenshot behavior.

Record tester, date, and receipt path in `releaseChecks.browserCompanionChrome`.

## 3. Clean-machine packaged proof

Use a **clean Windows VM or separate clean machine** with no ND source checkout and no pnpm/Cargo developer environment.

Use the exact artifact produced by the RC run.

Required manual journey:

1. launch/install the packaged RC;
2. create a company and project;
3. link a small Git workspace;
4. configure a supported provider/model;
5. assign a supported coding engine;
6. PM plan -> worker -> machine verification -> independent review -> result;
7. close ND completely;
8. reopen and verify company/project/task/assignment/evidence state;
9. cancel one task and confirm it is not falsely completed;
10. test missing credential and unavailable engine messaging;
11. confirm no source-checkout, pnpm-store, Cargo-target, or developer-only-path dependency.

Git is currently resolved from the OS/PATH in some packaged flows. If the clean machine requires Git, record that as an explicit Private Beta prerequisite until Git is bundled.

Record tester/date/evidence under `releaseChecks.packagedCleanMachine`.

## 4. Run the 24-hour soak

The soak is skipped during normal `pnpm e2e`; only this dedicated command enables it.

PowerShell:

```powershell
$env:ND_DSH_SOAK_MINUTES="1440"
$env:ND_DSH_SOAK_SAMPLE_SECONDS="60"
$env:ND_DSH_SOAK_MAX_GROWTH_MB="512"
corepack pnpm e2e:beta:soak
```

It keeps one Electron lifetime alive while repeatedly switching a 3x2 company/project portfolio. It samples Electron process working set/process count and continuously asserts:

- exact company/project/task ownership;
- no duplicate entity IDs;
- active company/project correctness;
- renderer responsiveness;
- no unexplained process-count growth;
- bounded working-set growth.

Receipt:

```text
e2e-results/beta-soak/beta-soak-<timestamp>.json
```

The final release gate refuses `durationMinutes < 1440`. Review the start/mid/end memory/process samples manually as well; the numeric threshold is a guardrail, not proof that every leak is impossible.

## 5. Human real-world layer

Run [manual-beta-real-world.md](manual-beta-real-world.md) against the same RC. At minimum manually cover:

- normal idea -> implementation -> review flow;
- existing-code feature;
- bug diagnosis + regression test;
- multi-task dependency workflow;
- reviewer rejection + bounded rework;
- human interruption/manual edit/resume;
- restart/crash recovery;
- Git diff/result inspection;
- provider failure/error wording;
- company/project switching while work remains active.

The automated 3x2 matrix proves deterministic ownership. The human layer must still judge whether the UI makes that ownership and recovery understandable.

## 6. Build the final evidence record

Copy the template:

```powershell
Copy-Item docs/qa/beta-three-layer-evidence.example.json docs/qa/beta-three-layer-evidence-beta1.json
```

Fill:

- exact RC version/SHA/artifact hash or unique artifact name;
- `summary.p0Open = 0`;
- `summary.p1CoreOpen = 0`;
- Unit/E2E/Human PASS + evidence for every beta-exposed feature;
- `releaseChecks.automated` -> automated summary JSON;
- `releaseChecks.packagedCleanMachine` -> human clean-machine result;
- `releaseChecks.browserCompanionChrome` -> Chrome receipt/human result;
- `releaseChecks.soak24h` -> duration **>= 1440** + soak receipt;
- repeated scenario totals;
- final human release decision.

Default repeated-scenario threshold remains 95% with at least 20 recorded runs. If you set a target of 99% or higher, the gate requires at least **100 recorded runs** so “99%” is not claimed from a tiny sample.

## 7. Run the final gate

```powershell
corepack pnpm beta:gate -- docs/qa/beta-three-layer-evidence-beta1.json
```

Expected:

```text
Beta 3-layer gate: PASS
- beta-exposed features: ... passed Unit + E2E + Human
- repeated scenario pass rate: ...
- release checks: automated + clean-machine + Chrome + 24h soak passed
- P0 open: 0; core P1 open: 0
- human release owner: ...
```

If the gate fails, either fix the release blocker and rerun from the affected layer, or remove/disable that feature from the beta surface and update the evidence matrix honestly.

## Evidence review checklist

Before changing `humanDecision.status` to `go`, verify all evidence belongs to the **same RC SHA/artifact**. Do not mix an older green test bundle with a newer executable.

Check:

- [ ] automated summary PASS;
- [ ] no required stage was skipped;
- [ ] exact packaged artifact identified;
- [ ] real Chrome PASS;
- [ ] clean-machine PASS;
- [ ] soak >= 1440 minutes PASS;
- [ ] 0 P0;
- [ ] 0 core P1;
- [ ] scenario threshold met;
- [ ] every beta-exposed P0/P1 has Unit + E2E + Human evidence;
- [ ] provider credential global-scope limitation accepted/documented for supervised testers;
- [ ] tester-facing supported OS/provider/engine limitations documented;
- [ ] rollback/recovery instructions available.

Only the human release owner records final GO.
