# Current-feature release stability — 2026-10-01

Scope: Windows x64 portable private beta 0.1.1. Stabilize the currently exposed
features; keep ND Agent's private selection gate and existing capability
boundaries. No new product features or public-distribution claim are included.

## Candidate and evidence

The starting application source is `main` at `5a2f9cc`. Release-test hardening
and tester documentation are being prepared on `codex/release-0.1.1-stability`.
The effective Harness checkout is `21638c56315a` (`0.1.7-rc.2`), matching
`vendor/deepseek-harness.json`. The starting root Git index references a different
Harness commit; this branch reconciles the gitlink with the effective checkout
and metadata. No upstream runtime source was patched.

The running consolidated receipt will be written to:

`e2e-results/beta-automated-2026-10-01T03-52-09-063Z/beta-automated-summary.json`

This run started before the release-test additions below. Its recorded root
commit identifies the starting source; it must not be presented as attestation
of a later clean candidate commit. Raw local receipts and profiles are ignored
by Git. This report records reviewed outcomes without copying credentials or
trial data into the repository.

## Completed checks

| Check | Result | Scope |
| --- | --- | --- |
| Static verification | Pass | ND product, runtime, ND Pencil, and source-control boundaries. |
| TypeScript type checking | Pass | Rechecked after release-test additions. |
| App unit/integration suite | 1,108 passed; 9 skipped | Includes the stability changes. Initial sandbox failures cleared under normal Windows test permissions. |
| Rust core gate | Pass | Formatting, Clippy, and ND protocol/runtime/core/agent tests, including cancellation and restart contracts. |
| Browser native host gate | Pass | Formatting, Clippy, and the duplex-pipe contract. |
| Browser platform focus | 26 passed | Lease, policy, history, token, and extension coverage. |
| Production build | Pass | Rechecked after the approval-card fixes. |
| Full desktop acceptance suite | 60 passed; 3 skipped; exit 0 | Includes real model delivery, journal restart, isolation, launcher, terminal, ND Home, and extension tests. The long soak and two opt-in ad-block probes were skipped. |
| Explicit 3-company × 2-project matrix | Pass | Switching, forged ownership rejection, and full restart. |
| Release-test regressions | 20 passed | Target/profile isolation, exact-package evidence, actual soak duration, and Windows process identity. |
| Real-user production journey | Pass; 19 gates passed | Three companies, five projects, three model routes, peak five parallel runs, and restart during active work. Its separate existing-suite gate was not rerun inside this journey; the baseline desktop suite passed independently. Source target. |
| Approval/question UI regressions | 3 passed; exit 0 | Deferred replies prevent duplicate submissions, permit independent sessions, allow retry after transport failure, and show only matching redacted tool arguments. Source target; nine Windows descendants were observed and cleared. |
| Portable artifact selection | 3 passed | Old packages cannot satisfy current-version smoke tests; absent or ambiguous artifacts fail closed. |

The baseline desktop fixture did not enumerate descendants on Windows. Its
`descendantsBefore=0` logs establish no Windows descendant-cleanup claim. The
new fixture enumerates process ancestry and compares start-time identities;
subsequent desktop checks exercise this stronger contract.

## Release-test hardening

- Launchers accept `ND_DSH_E2E_EXECUTABLE` for a packaged target, reject an invalid
  path, record its SHA-256 identity, and force a disposable user-data profile.
- The consolidated release runner builds the package before acceptance tests,
  extracts the app directly from that portable for Playwright attachment, and
  passes that app to desktop and live journeys. A hash manifest checks all
  extracted files and ties each launch to the original portable's SHA-256;
  the portable launcher itself receives a separate runtime smoke. The runner
  checks a clean source commit before and after every stage, verifies the
  extracted payload again at completion, and requires the portable hash to match.
- Packaged smoke selects exactly one current-version portable executable instead
  of selecting an arbitrary old executable left in `dist`.
- The live production journey can target the package and records its identity.
- The soak records whether the runtime is packaged, which executable was used,
  actual start/end times, and successful cleanup before writing a PASS receipt.
- `release:soak` requires a package and at least 1,440 minutes. The soak wrapper
  defaults to 1,440 minutes; explicit shorter diagnostic runs remain possible
  through `e2e:beta:soak` and cannot satisfy the release gate.
- The final gate rejects a short actual soak, a source-checkout soak, and evidence
  naming a different artifact, even if its requested duration says 24 hours.
- Windows desktop teardown enumerates real descendants instead of treating an
  unsupported inventory as an empty process tree. Inventory errors fail closed;
  Windows command lines and environment values are not logged by this helper.
- Approval and question replies remain disabled while their response is pending.
  Failed responses remain retryable. Cards resolve context from their own session
  rather than the currently selected company/project and can show correlated tool
  arguments with common credential forms redacted.
- The autonomous model driver uses a fresh disposable Git workspace by default
  and refuses to seed a nonempty non-Git directory.

## Remaining release evidence

The autonomous multi-model stress run, benchmarks, fresh portable build,
and packaged smoke results are still running or pending. The final candidate
must be frozen and rechecked after any fixes. The [tester guide](../private-beta-tester-guide.md)
documents prerequisites, recovery, rollback limitations, and current boundaries.

The [beta release gate](../plan/beta-release-gate.md) also requires a packaged
journey, repeated-scenario evidence, clean-machine testing, real Chrome Companion
permission/capture checks, failure drills, a genuine 24-hour soak, and a human
release-owner decision. None of those pending outcomes is filled with sample
data or marked passed here. The candidate is not yet approved for distribution.
