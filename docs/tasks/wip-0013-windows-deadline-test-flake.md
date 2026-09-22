# Task 0013 — Remove the Windows deadline-test flake

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ZCode  
> Branch: fix/nd-core-format-lint-gate  
> Updated: 2026-09-23  

## Objective

`deadline_expiry_stops_git_work_reports_its_code_and_leaves_no_orphan` fails intermittently on the Windows CI runner, which keeps `Verify ND Core` — and therefore every Windows release gate in [blocked-0004](blocked-0004-windows-release-validation.md) — from being reliably green.

## What is known

The test could not run at all until [wip-0012](wip-0012-nd-core-format-lint-gate.md) restored the gate, since `cargo fmt --check` aborted `pnpm core:test` before `cargo test` started. Once the gate was repaired the test ran twice on the **same tree** (`6620ea32`) with opposite outcomes:

| Run | Job | Outcome |
| --- | --- | --- |
| [35768282861](https://github.com/zila-kh/nd-dsh/actions/runs/35768282861) | `windows-package` | passed — suite `finished in 5.33s` |
| [35773266896](https://github.com/zila-kh/nd-dsh/actions/runs/35773266896) | `windows-package` | failed — suite `finished in 4.17s` |

The failure is the test's own precondition, not a wrong result:

```text
panicked at crates\nd-core\tests\protocol_contract.rs:334:5:
the interrupted child never started, so this run proves nothing
```

## Root cause

The test spawns a heartbeat child — on Windows, `powershell -NoProfile -NonInteractive -Command "<Add-Content loop>"` — and gives it a **4 000 ms** deadline, then asserts the child wrote at least one heartbeat line before the deadline killed it (`after_stop > 0`). That assertion is deliberate and correct: it stops the test passing vacuously when the child never ran.

The window is simply too tight for the child it uses. Measured here, a warm PowerShell start writes its first heartbeat after 0.44–0.55 s, so 4 s normally suffices — the passing run above fits inside it — but a cold start on a Windows runner (image load, AMSI/Defender scan, JIT, plus `cargo test`'s parallel test load) can exceed it. When it does, the child is killed before its first line and the precondition fires, which reads as a product failure but is an environment-timing failure.

## Acceptance criteria

- [x] The deadline allows a cold PowerShell start on a Windows runner, with the orphan assertion unchanged. — Deadline raised from 4 s to 15 s (~30x the warm start, ~3.5x the observed failure threshold) and the response timeout from 20 s to 45 s; the promptness bound scales with it (`deadline_ms + 3_000`), so deadline enforcement is still asserted proportionally.
- [x] No assertion is removed, skipped, or weakened, and nothing is `allow`-ed. — The subject of the test — `deadline_exceeded` is reported, the child really ran, and no orphan survives the stop — is asserted exactly as before.
- [x] The test passes repeatedly on Windows. — 3/3 consecutive runs pass locally, 16.5 s each.
- [ ] `windows-package` completes green on a non-draft pull request, including the portable build, the forced-cleanup proof, and the packaged smoke.

## Notes

- The test is now ~16.5 s instead of ~5.3 s. That is the cost of the headroom and is inside the job budget.
- The sibling `cancelling_one_request_leaves_its_peer_running_and_releases_only_its_own_slot` uses the same heartbeat child with a 20 s deadline and asserts no liveness precondition, so it is not affected.
- This is a test-robustness defect, not a product defect: nothing in `crates/nd-core/src` changed.
