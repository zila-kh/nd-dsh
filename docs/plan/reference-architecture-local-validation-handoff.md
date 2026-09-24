# Reference Architecture Local Validation Handoff

Status: **local validation recorded 2026-09-24 — WIP 0031–0033 closed as done; WIP 0034 open only on the live Laya/Jev shadow comparison**  
Validation target: current `main` (create a feature branch from `main` for any fixes)  
Tasks: [done-0031](../tasks/done/done-0031-nd-protocol-extraction.md) · [done-0032](../tasks/done/done-0032-canonical-execution-effect-journal.md) · [done-0033](../tasks/done/done-0033-nd-runtime-crate-extraction.md) · [WIP 0034](../tasks/wip-0034-rust-decision-kernel.md)

## Evidence recorded (2026-09-24)

Windows reference machine, commit `d3de5be` (Windows 10.0.26100, rustc 1.98.1,
node v24.16.0, pnpm 11.7.0):

```text
cargo metadata --locked: PASS        cargo fmt --all --check: PASS (Cargo.lock unchanged)
pnpm core:test: PASS                 pnpm verify: PASS
pnpm typecheck: PASS                 focused decision/approval tests: PASS (16)
pnpm test: PASS (841 passed / 8 skipped, five consecutive runs)
pnpm build: PASS
pnpm bench:contract: PASS  benchmark-results/2026-09-24T09-20-59-580Z-win32-x64/
pnpm bench:runtime: PASS   benchmark-results/2026-09-24T09-21-42-507Z-win32-x64/
                           (budget classes hold; baseline host differs — no speed claim)
pnpm bench:tasks:check: PASS (136 expectations, 0 deviations)

effect journal app smoke: PASS   benchmark-results/effect-journal-smoke/
restart/replay smoke: PASS       (16 -> 32 records, seq monotonic, all known-complete ids survived)
Laya TS shadow: SKIPPED          (laya-serve not installed on this machine)
Laya Rust shadow: SKIPPED        (same)
Rust assist + Jev: SKIPPED       (no Jev credential configured for this run)
machine-verification red-gate check: PASS (tests/beta-reliability.test.ts)
unexpected diffs: none
```

Section 7–9 below remain the checklist for the single open item: the live
Laya TS/Rust shadow and optional Jev assist comparison that gates promoting the
Rust decision kernel to the default. Nothing in sections 2–6, 10, or 11 is open.

## 1. Sync current main without editing it

```bash
git fetch origin
git switch main
git pull --ff-only
git status --short
```

Run validation read-only on `main`. If a defect is found, create a `fix/...` or `feat/...` branch from the failing `main` commit; do not patch `main` directly.

Expected: clean working tree before validation.

## 2. Toolchain and lock integrity

The workspace requires the Rust version declared by the crates and Node/pnpm versions declared by `package.json`.

```bash
corepack pnpm install --frozen-lockfile
cargo metadata --locked --no-deps
cargo fmt --all --check
```

If `cargo fmt --all --check` reports formatting only, run `cargo fmt --all`, inspect the diff, and report it back rather than silently treating the branch as validated. Do not merge a formatter delta that changes semantics.

After metadata/formatting:

```bash
git diff --exit-code Cargo.lock
```

Expected: no Cargo.lock regeneration.

## 3. Rust extraction + protocol + recovery gates

```bash
corepack pnpm core:test
```

This must cover all three crates:

```text
nd-protocol
nd-runtime
nd-core
```

Required behavior covered by Rust tests:

- protocol version/frame/error vocabulary and TS contract parity;
- existing bounded MessagePack queue/decode behavior;
- canonical effect journal known-complete dedupe after reload;
- uncertain effect recovery and blind-retry refusal, including unmatched persisted `intent` records becoming `outcomeUncertain` after restart;
- Rust decision kernel high-confidence, escalation, all-low fallback and shadow semantics;
- the shared Rust/TypeScript decision fixture corpus.

Also confirm the composition boundary:

```bash
find crates/nd-core/src -maxdepth 1 -type f -print
```

Expected: only `crates/nd-core/src/main.rs`.

## 4. Desktop/static/full repository gates

```bash
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm exec vitest run tests/decision-support.test.ts tests/organization-approval-gate.test.ts
corepack pnpm test
corepack pnpm build
```

Do not waive a failure because the focused tests pass.

## 5. Runtime contract/performance evidence

Run the contract benchmark after the development core build:

```bash
corepack pnpm bench:contract
```

The result bundle must include:

```text
contract-revision-marker
contract-git-status-cache
contract-git-log-cache
contract-search
contract-stop-latency
contract-deadline-expiry
contract-effect-journal
contract-decision-kernel
contract-cache-metrics
```

For `contract-effect-journal`, record:

- append p50/p95;
- replay p50/p95;
- journal bytes/record count;
- known-complete duplicate suppression = true;
- uncertain state = `outcomeUncertain`.

For `contract-decision-kernel`, record:

- evaluation p50/p95;
- selected provider = `jev` in the low-Laya/high-Jev fixture;
- escalation = true.

Then run the broader runtime benchmark used by this repository:

```bash
corepack pnpm bench:runtime
```

Compare against the currently committed compatible baseline. Do not make a speed claim if the host/runtime conditions are not matched.

## 6. Durable effect-journal app smoke

Use an isolated user-data directory so the canonical journal is easy to inspect.

### macOS/Linux

```bash
export ND_DSH_USER_DATA_DIR=/tmp/nd-ref-arch-validation
rm -rf "$ND_DSH_USER_DATA_DIR"
corepack pnpm dev
```

### PowerShell

```powershell
$env:ND_DSH_USER_DATA_DIR = "$env:TEMP\nd-ref-arch-validation"
Remove-Item -Recurse -Force $env:ND_DSH_USER_DATA_DIR -ErrorAction SilentlyContinue
corepack pnpm dev
```

Run one real organization task through worker -> machine verification -> independent review -> integration.

Inspect:

```text
<ND_DSH_USER_DATA_DIR>/effect-journal.jsonl
```

The completed flow should produce relevant records from this set:

```text
lease.acquire
lease.release
workspace.allocate
engine.session
checkpoint
verification.receipt
decision.review-assist        # when decision support is enabled
review.result
integration
policy.decision               # when an approval-bearing action occurs
```

Verify:

1. records have company/project/task/run/resource identity where applicable;
2. integration intent is written before the integration outcome;
3. failed/conflicted integration is `failed`; an unknown outcome is `uncertain`;
4. the journal contains no API key, Authorization header, raw provider credential, or full provider request state;
5. `metrics.snapshot` reports effect journal count/bytes/max bytes;
6. red machine verification still prevents task completion regardless of reviewer text.

The journal has a fail-closed 64 MiB retention bound. Reaching it must refuse new effect records rather than silently discard canonical history.

## 7. Laya server

Current upstream Laya exposes the Jev-compatible System One HTTP endpoint.

```bash
python -m pip install "laya[serve]"
```

### macOS/Linux

```bash
LAYA_HOST=127.0.0.1 LAYA_PORT=8765 LAYA_PRELOAD=1 laya-serve
```

### PowerShell

```powershell
$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PORT = "8765"
$env:LAYA_PRELOAD = "1"
laya-serve
```

Leave `ND_LAYA_MODEL` unset for the normal router unless intentionally testing a specific checkpoint.

## 8. TypeScript vs Rust decision-kernel shadow comparison

The provider network/credential gateway remains in Electron main. Only the typed threshold/selection/escalation kernel changes.

First run TypeScript shadow mode:

### macOS/Linux

```bash
ND_DECISION_SUPPORT_MODE=shadow \
ND_DECISION_SUPPORT_RUNTIME=typescript \
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765 \
corepack pnpm dev
```

Then run an equivalent task with the Rust kernel:

```bash
ND_DECISION_SUPPORT_MODE=shadow \
ND_DECISION_SUPPORT_RUNTIME=rust \
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765 \
corepack pnpm dev
```

### PowerShell Rust shadow

```powershell
$env:ND_DECISION_SUPPORT_MODE = "shadow"
$env:ND_DECISION_SUPPORT_RUNTIME = "rust"
$env:ND_LAYA_SYSTEMONE_URL = "http://127.0.0.1:8765"
corepack pnpm dev
```

Confirm:

- both paths call the same configured providers;
- shadow never injects a decision hint into reviewer context;
- Rust decision receipts are persisted;
- provider/kernel failure does not block the independent reviewer;
- no machine/policy/evidence authority changes.

Automated shared-fixture parity is enforced by `tests/fixtures/decision-kernel-parity.json` on both Rust and TypeScript.

## 9. Assist mode + optional Jev

With a real Jev credential:

### macOS/Linux

```bash
ND_DECISION_SUPPORT_MODE=assist \
ND_DECISION_SUPPORT_RUNTIME=rust \
ND_DECISION_SUPPORT_CONFIDENCE=0.78 \
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765 \
ND_JEV_API_KEY="<secret>" \
corepack pnpm dev
```

Expected control semantics:

```text
high-confidence Laya
  -> Rust selects Laya
  -> no Jev request

low/error Laya
  -> Rust says continue
  -> TS secure provider gateway calls Jev

high-confidence Jev
  -> Rust selects Jev

all low/error
  -> no System One review hint
  -> existing independent reasoning reviewer remains final semantic review
```

The focused unit/fixture tests deterministically cover all four routes; live provider validation confirms wire compatibility and real credentials/network behavior.

## 10. Restart/recovery smoke

The Rust unit suite verifies journal reload semantics. Also do one desktop restart smoke:

1. launch with isolated user data;
2. complete at least one journaled task;
3. close ND cleanly;
4. relaunch with the same user-data directory;
5. confirm startup succeeds and the existing `effect-journal.jsonl` is replayed;
6. run another task and confirm sequence numbers continue monotonically;
7. confirm the previous known-complete idempotency records are still present;
8. if you use a fixture/debug RPC to leave an unmatched `intent`, restart and confirm `effectJournal.state` reports `outcomeUncertain` and rejects a blind new `intent` until reconciled.

Do not intentionally repeat a real external side effect merely to test dedupe.

## 11. Evidence to return

Return the following to close WIP 0031–0034:

```text
commit tested:
OS / architecture:
rustc --version:
node --version:
pnpm --version:

cargo metadata --locked: PASS/FAIL
cargo fmt --all --check: PASS/FAIL
pnpm core:test: PASS/FAIL
pnpm verify: PASS/FAIL
pnpm typecheck: PASS/FAIL
focused decision/approval tests: PASS/FAIL
pnpm test: PASS/FAIL
pnpm build: PASS/FAIL
pnpm bench:contract: PASS/FAIL + result folder
pnpm bench:runtime: PASS/FAIL + result folder

effect journal app smoke: PASS/FAIL
restart/replay smoke: PASS/FAIL
Laya TS shadow: PASS/FAIL
Laya Rust shadow: PASS/FAIL
Rust assist + Jev (if credential available): PASS/FAIL/SKIPPED
machine-verification red-gate check: PASS/FAIL

unexpected diffs:
notes:
```

When these gates are green, archive WIP 0031–0034 as done and update PR #36 with the recorded evidence.
