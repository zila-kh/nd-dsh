# Beta release readiness — execution plan

> Updated: 2026-09-27  
> Basis: current `main` plus the current standing recorded in [beta-release-gate.md](beta-release-gate.md), updated 2026-09-26.  
> Goal: get ND-DSH to a **Beta Stable** release candidate without requiring every planned feature to be finished. Beta-exposed features must be predictable, recoverable, scoped correctly, and diagnosable.

## Release labels

### Private / supervised beta

May be released to a small invited group when the **Beta Stable gate** below passes. Local/manual release evidence is acceptable while GitHub Actions remains parked, as long as the exact RC commit, machine, commands, and results are recorded.

### Public beta

Requires the Private Beta gate plus signed distribution, update/rollback proof, and runner-attested Windows release evidence. GitHub Actions can remain parked until this phase.

## Current standing

The core product is already in a strong position:

- Core company/project/task/agent workflow is covered by unit + E2E tests.
- Multi-company/project isolation, task worktrees, parallel execution, persistence/recovery, terminal/filesystem boundaries, and compute-budget accounting have strong automated coverage.
- The latest gate record reports `pnpm typecheck` clean and **855 passed / 8 skipped** unit tests on the 2026-09-26 validation tree.
- The 2026-09-24 full local attestation already covered Rust `core:test`, full Playwright, real-user production E2E, portable Windows packaging, packaged runtime smoke, forced-core-crash cleanup, and benchmark budget checks.
- Real-Chrome Browser Companion smoke is recorded green.
- Laya/Rust decision-kernel live validation is recorded; Rust remains opt-in, so promoting it to default is **not** a beta blocker.
- Third-party notice generation/verification is implemented.

The remaining work is mostly **release hardening and real-artifact evidence**, not another feature round.

## Beta Stable gate

Declare the RC Beta Stable only when all are true:

1. **0 P0** — no known crash/data-loss/security/wrong-company-or-project defects.
2. **0 known P1** in the core path: create company/project → plan → worker → review → Git/result → restart/recover.
3. **Every beta-exposed feature has Unit PASS + E2E PASS + Human PASS** in the RC evidence record.
4. **≥95% repeated scenario pass rate** for the beta scenarios on the RC. Teams targeting 99% may set the evidence threshold to 0.99 once enough repeated runs exist to make that number useful.
5. All beta-exposed features are either:
   - verified and enabled, or
   - clearly marked Experimental / disabled behind a feature flag.
6. The exact packaged artifact, not only the source checkout, passes the release journey.
7. A rollback/recovery path is documented before users receive the build.
8. A human release owner explicitly records the final GO decision.

The three-layer evidence workflow is defined in [beta-three-layer-validation.md](../qa/beta-three-layer-validation.md) and machine-checked with `corepack pnpm beta:gate -- <evidence.json>`.

## Ordered execution plan

### Phase 0 — Freeze the RC scope

**Goal:** stop adding risk while validation runs.

- [ ] Create one RC branch/tag candidate from current `main`.
- [ ] No new feature work on the RC; only P0/P1 fixes and release-test changes.
- [ ] List beta-exposed features and explicitly disable unfinished/experimental surfaces.
- [ ] Record exact app version, commit SHA, Windows version, Node/pnpm/Rust versions, and test machine.

**Exit:** everyone tests the same immutable RC candidate.

### Phase 0.5 — Create the three-layer evidence matrix

- [ ] Copy `docs/qa/beta-three-layer-evidence.example.json` to an RC-specific evidence file.
- [ ] List every beta-exposed feature as its own row.
- [ ] Map existing Unit evidence to each row.
- [ ] Map existing E2E evidence to each row.
- [ ] Leave Human as pending until a real tester runs the scenario.
- [ ] Keep Experimental/disabled features out of beta exposure rather than marking untested behavior ready.

**Exit:** every beta-exposed feature has an explicit Unit / E2E / Human owner and evidence slot.

---

### Phase 1 — Close the security/scope blockers

These are the highest-risk gaps from the current gate.

#### 1A. Product-level pre-push secret scan

- [ ] Move secret detection out of the audit-only E2E driver and into the real Git push boundary.
- [ ] Block a push containing a confirmed credential/token/private key.
- [ ] Provide a clear refusal message and safe remediation path.
- [ ] Negative test: known fake secrets are blocked.
- [ ] Positive test: normal source pushes are unaffected.

#### 1B. Provider credential scope

- [ ] Decide the beta contract: project/environment-scoped credentials are preferred for the existing multi-company model.
- [ ] Ensure one company/project cannot silently resolve another project's credential.
- [ ] If full per-project/env storage is not ready, make the global scope explicit in UI/docs and disable any UI that implies stronger isolation.
- [ ] Add positive + negative cross-company/project tests.

#### 1C. Explicit local transport boundary tests

- [ ] Add a direct test that browser/CDP/native-host control is loopback/local-only.
- [ ] Confirm logs/diagnostics never export raw provider credentials or browser secrets.

**Exit:** no known secret-leak or wrong-scope credential path.

---

### Phase 2 — Prove the packaged app on a clean machine

#### 2A. Clean-machine offline runtime

On a clean Windows VM with no development tooling:

- [ ] Install/run the exact RC artifact.
- [ ] Verify ND Core, Harness/runtime, ND Pencil, browser host, and required CLI/runtime dependencies resolve.
- [ ] Decide whether Git/Node are bundled or explicit beta prerequisites.
- [ ] Start ND offline and confirm startup/recovery behavior is understandable.
- [ ] Confirm no accidental dependency on the source checkout, pnpm store, Cargo target, or developer PATH.

#### 2B. Installed-app E2E

Run against the packaged artifact:

- [ ] Create company + project.
- [ ] Assign provider/model + coding engine.
- [ ] PM creates work.
- [ ] Worker edits a fixture project.
- [ ] Machine verification runs.
- [ ] Independent review passes.
- [ ] Git/result is visible.
- [ ] Close ND completely.
- [ ] Reopen and verify company/project/tasks/assignments/evidence survive.

Negative cases:

- [ ] cancel a running task;
- [ ] kill ND Core mid-task and reopen;
- [ ] unavailable engine;
- [ ] provider down / no network;
- [ ] corrupted primary organization state;
- [ ] rejected approval;
- [ ] missing credential;
- [ ] merge conflict.

**Exit:** source-build success is no longer the only proof.

---

### Phase 3 — Close the remaining reliability gaps

Keep this focused; do not add unrelated features.

- [ ] Provider HTTP 429 / rate-limit backoff test.
- [ ] Sidecar kill/restart/backoff test during real work.
- [ ] Internet disconnect/reconnect drill.
- [ ] Invalid/unwritable data directory and disk-full-style failure drill.
- [ ] Browser download + cookie/storage behavior test for whichever parts are exposed in beta.
- [ ] MCP crash/misconfiguration test proving the session remains usable.
- [ ] Workflow-template UI create/edit/rerun test if that UI is beta-exposed.
- [ ] UI long-chat + multi-agent stress test for progressive freeze/memory growth.
- [ ] Diagnostics export smoke with secret redaction.

**Exit:** every beta-exposed subsystem has at least one failure-path proof.

---

### Phase 4 — Real-world beta matrix

Run the RC like a real user, not only a test fixture.

Minimum matrix:

- [ ] **3 companies × 2 projects each**.
- [ ] At least 2 different provider/model routes.
- [ ] At least 2 coding engines where locally available.
- [ ] Parallel work in at least 2 projects at the same time.
- [ ] Switch companies/projects while work remains active.
- [ ] Restart ND during the run.
- [ ] Create at least one rework/reviewer-fail path.
- [ ] Create at least one Git conflict/refusal path.

For each scenario record: PASS / FAIL, app commit, artifact hash/name, provider/engine, and any issue number.

**Exit:** ≥95% repeated scenario pass rate and no P0/P1 core defect.

---

### Phase 5 — 24-hour soak

Run the packaged RC for 24 hours with periodic real tasks.

Check:

- [ ] memory growth;
- [ ] CPU while idle;
- [ ] stuck/orphan workers;
- [ ] duplicate task execution;
- [ ] stale leases;
- [ ] zombie CLI/sidecar/browser-host processes;
- [ ] corrupted or missing organization state;
- [ ] journal/recovery errors;
- [ ] UI becoming progressively slower.

Take diagnostics at start, midpoint, and end.

**Exit:** no P0/P1 issue and no unexplained progressive degradation.

---

### Phase 6 — Private Beta release decision

Before sending the build to beta users:

```sh
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm core:test
corepack pnpm build
corepack pnpm e2e
```

Also require the clean-machine packaged E2E and soak evidence above.

Release only when:

- [ ] 0 P0.
- [ ] 0 known P1 in the core workflow.
- [ ] ≥95% repeated E2E/real-world pass rate.
- [ ] security/scope blockers in Phase 1 are closed.
- [ ] packaged clean-machine journey passes.
- [ ] rollback/recovery instructions exist.
- [ ] supported OS/providers/engines and known limitations are written for testers.

If a non-core feature is the only failing area, disable it for the beta rather than delaying the whole core release.

## Public Beta follow-up

These are **not required for a small supervised hand-delivered beta**, but are required before broad public distribution:

1. [ ] Restore `.github-bk/` → `.github/` and record runner-attested Windows release evidence from [blocked-0004](../tasks/blocked-0004-windows-release-validation.md).
2. [ ] Windows code signing / trusted installer.
3. [ ] Update channel with staged-update verification.
4. [ ] Prove previous-version rollback while preserving company/project/user state.
5. [ ] Publish supported OS/provider/engine matrix and beta limitations.

## Explicit non-blockers for the first beta

- Rust decision kernel becoming the default — keep the current stable default until separately promoted.
- Broader non-coding company templates.
- Extra engine adapters beyond the beta-supported matrix.
- Arbitrary Chrome-extension parity beyond the documented Browser Companion/built-in browser contract.
- Normalized cross-domain action policy beyond what is required for the beta-exposed actions; broader normalization remains pre-GA.

## Release evidence folder

For each RC, keep one evidence record under `docs/qa/` containing:

- RC commit + artifact name/hash;
- exact commands and pass/fail;
- clean-machine result;
- installed-app E2E result;
- real-world matrix result;
- soak result;
- known limitations;
- P0/P1 issue list;
- final **GO / NO-GO** decision made by the human release owner.

The detailed per-area coverage and open gaps remain authoritative in [beta-release-gate.md](beta-release-gate.md).
