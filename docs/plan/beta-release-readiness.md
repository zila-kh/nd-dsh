# Beta release readiness — gap list and order of work

> Updated: 2026-09-24 · Basis: full-tree review at `feat/real-user-prod-e2e` (`e276974`)
> Purpose: one ordered checklist of what stands between the current tree and a stable **Public Beta**, and what remains for **GA** after that. Roadmap context and gate definitions: [roadmap.md](../roadmap.md) ("Public Beta P0", "Release labels").

## Where the tree stands (2026-09-24)

- Every locally-runnable gate is green: `verify`, `typecheck`, unit tests (841 passed / 8 skipped), Rust `core:test` (fmt + clippy `-D warnings` + tests), full Playwright sweep (44 passed), `e2e:prod:user` real-user production journey (19/19 gates, incl. restart), portable Windows build + packaged runtime smoke + forced-core-crash cleanup proof, `bench:contract` 9/9, `bench:tasks:check` 136/0, budgets inside the committed baseline classes.
- Code-level hygiene: zero TODO/FIXME/stub markers in `src/`; `crates/` markers are test-only. Renderer fails closed; credentials are write-only from the renderer.
- Open task board: [blocked-0004](../tasks/blocked-0004-windows-release-validation.md) (runner-only release validation), [wip-0019](../tasks/wip-0019-browser-companion-mvp.md) (real-Chrome smoke remaining), [wip-0034](../tasks/wip-0034-rust-decision-kernel.md) (Laya/Jev shadow remaining; Rust kernel intentionally **not** default yet).
- CI is parked as `.github-bk/` (operator decision to conserve compute): all green evidence above is locally attested, not runner-attested.

## Beta gate (P0) — ordered

1. **Restore CI** — rename `.github-bk/` back to `.github/`. Operator call on compute cost; nothing else unblocks runner-attested evidence. The first run also discharges two of blocked-0004's three runner criteria (`validate` + `windows-package` reaching packaging/smoke) and should be the first real attempt of the `performance-evidence` bundle, filling `artifact.ciRun` in the committed baseline. **Accept:** green `validate` and `windows-package`; blocked-0004 exit criteria checked.
2. **Merge `feat/real-user-prod-e2e`** — 2 commits ahead of `main`: the real-user production journey driver plus the signal-killed runtime-child fix it exposed (`src/main/harness/harness-service.ts`). All gates green locally on this tree.
3. **Real-Chrome companion smoke** — the single remaining item of wip-0019 (14-step checklist inside the record). Needs a machine with real Chrome/Chromium and the companion native host registered. **Accept:** evidence recorded, wip-0019 archived.
4. **Clean-machine offline runtime proof** (roadmap §1) — the packaged app resolves Git from `PATH` (`src/main/git/git-cli.ts:495` falls back to `'git'`) and CLI-engine shims fall back to a PATH `node` when nothing is shipped beside them (`src/main/engines/agent-cli/agent-cli-support.ts:70`). Decide and implement bundle-vs-require for Git (portable Git distribution is the likely answer) and verify the app starts and runs the real agent runtime **offline on a machine with no dev tooling** (clean Windows VM). **Accept:** roadmap §1 success criterion demonstrated; any deferred bundle documented as an explicit OS prerequisite on the beta download page.
5. **Third-party license notices** — **implemented 2026-09-24.** `scripts/gen-third-party-notices.mjs` (`pnpm notices:generate`, run automatically by `release:stage`) writes `.release/THIRD_PARTY_NOTICES.nd-dsh.md`: direct npm runtime deps with license ids, the crates.io dependency closure of `nd-core`/`nd-browser-host` from `cargo metadata` (77 crates, all permissively licensed), and the bundled components table (Harness, agent-browser, ND Pencil, the vscode-derived Source Control panel, Electron, Chromium). It ships as `THIRD_PARTY_NOTICES.nd-dsh.md` via electron-builder `extraResources`; `release:verify` fails when it is missing, does not name every direct dependency, omits a bundled component, or when a redistributed root's license input is absent (harness `LICENSE`/`THIRD_PARTY_NOTICES.md`, agent-browser, ND Pencil, `vendor/openpencil.LICENSE`, `vendor/vscode-git.LICENSE`, Electron/Chromium notices). Proven with a doctored-file negative test. Optional follow-up: assert the file lands in the packaged artifact after electron-builder runs.
6. **Installed-app E2E** (roadmap §3) — extend `scripts/packaged-runtime-smoke.mjs` toward the full journey against the packaged artifact: create company/project → PM plan → worker edits fixture → reviewer pass → project 100% → close/reopen with organization + engine assignment + sessions surviving. Add the negative list (cancellation, crash/restart recovery, missing engine, corrupted primary organization state, rejected policy approval, missing credentials). **Accept:** source-build success is no longer the only proof an artifact works.
7. **Docs/QA hygiene** — **done 2026-09-24.** `docs/qa/README.md` now indexes the folder (which files are historical evidence vs operator manuals) and `beta-v1-handoff.md` carries a superseded banner pointing at the current dated evidence. (README status, the task board 0020–0030 archive, and this document were synced in the same pass.)

## Public beta distribution (immediately after the gate)

8. **Windows code signing** — choose certificate/Azure Trusted Signing, wire `electron-builder.yml` `win` signing, version metadata, and uninstall behavior. Unsigned binaries are the hard stop for anything beyond hand-delivered copies.
9. **Update channel** — electron-builder publish config plus staged update verification; updates must never replace user organization/session state (roadmap §2 acceptance).
10. **Beta page limits** — document supported OS, provider, and engine limits for the release label per the roadmap's release-label policy.

## Toward GA (not beta blockers)

11. **Rust decision kernel default** — wip-0034's live Laya/Jev shadow comparison is the last gate before promoting the Rust kernel over the TypeScript default. Skipping it for beta is safe (TS kernel remains default by design).
12. **Policy/action normalization** (roadmap §4) — normalized ND action envelope wired into `OrganizationApprovalGate` for browser external writes, deployments, remote Git mutations, destructive data actions; durable audit receipts. Pre-GA by definition.
13. **Engine onboarding and health** (roadmap §5) — Codex installed/authenticated/project-trust health checks surfaced before a user assigns an unavailable engine.

## Known limitations to document, not block on

- Codex threads are in-memory per app run; persistent Codex sessions are honestly reported unavailable (`README.md` "Current coding engines").
- Manual chats are global until explicit Global/Company/Project/Task chat scoping ships.
- CI parked ⇒ release evidence stays locally attested until item 1 lands.
