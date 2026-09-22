# Task 0013 — Remove the Windows timing flakes in `protocol_contract.rs`

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P0  
> Owner: ZCode  
> Branch: fix/nd-core-format-lint-gate  
> Updated: 2026-09-23  

## Objective

Two tests in `crates/nd-core/tests/protocol_contract.rs` fail intermittently on the Windows CI runner, which keeps `Verify ND Core` — and therefore every Windows release gate in [blocked-0004](blocked-0004-windows-release-validation.md) — from being reliably green.

Both were invisible until [wip-0012](wip-0012-nd-core-format-lint-gate.md) repaired the gate, because `cargo fmt --check` aborted `pnpm core:test` before `cargo test` ever started. They pass on Linux, which is why `validate` has been green throughout.

## Defect 1 — the deadline test gives its child too little time to start

`deadline_expiry_stops_git_work_reports_its_code_and_leaves_no_orphan` spawns a PowerShell heartbeat child, kills it at the deadline, then requires at least one heartbeat line to have been written before it died. That precondition is deliberate: it stops the test passing vacuously when the child never ran.

Four seconds is too tight for that child on a Windows runner. Measured here, a warm start writes its first heartbeat after 0.44–0.55 s, so 4 s normally suffices — but two runs on the **same tree** (`6620ea32`) disagreed:

| Run | Job | Outcome |
| --- | --- | --- |
| [35768282861](https://github.com/zila-kh/nd-dsh/actions/runs/35768282861) | `windows-package` | passed — suite `finished in 5.33s` |
| [35773266896](https://github.com/zila-kh/nd-dsh/actions/runs/35773266896) | `windows-package` | failed — suite `finished in 4.17s`, `the interrupted child never started, so this run proves nothing` |

A cold start on a runner — image load, AMSI/Defender scan, JIT, plus `cargo test`'s parallel load — exceeds the window. The child is then killed before its first line and the precondition fires, which reads as a product failure but is an environment-timing failure.

- [x] The deadline allows a cold PowerShell start, with the orphan assertion unchanged. — Deadline 4 s → 15 s (~30x the warm start, ~3.5x the observed failure threshold), response timeout 20 s → 45 s; the promptness bound scales with it (`deadline_ms + 3_000`), so deadline enforcement is still asserted proportionally.

## Defect 2 — the metrics assertions sample an invariant that is not yet true

Both tests end by asserting that only their own observer request is in flight, sampling `metrics.snapshot` exactly once. Run [35775029407](https://github.com/zila-kh/nd-dsh/actions/runs/35775029407) failed the second one on `inFlightRequestCount` being 2 where 1 was expected.

The cause is ordering in `crates/nd-core/src/main.rs`, not a leak. A response is written from **inside** the dispatch job (`writer.send_result`), and the job's registry entry and dispatcher slot are released only when that closure returns — after the response is already on the wire:

```rust
dispatcher.submit(priority, move || {
    let _guard = guard;                      // released when this closure returns
    match dispatch(...) {
        Ok(result) => { writer.send_result(&job_id, &result); }   // response first
        Err(error) => { writer.send_error(...); }
    }
})
```

So a client that has just received a response can still see its own request counted as in flight. The dispatcher slot has the same inherent ordering, and it cannot be fixed by reordering the write: the write is what the job does. On a fast machine the gap is sub-millisecond and the next round trip sees the entry gone; on a loaded runner the closure's return can be scheduled after the metrics request. Sampling once turns that ordering fact into a flake.

- [x] Both assertions still detect a real leak. — A `settled_metrics` helper polls `metrics.snapshot` every 25 ms until the accounting settles or a 5 s bound expires, then the same two assertions run against the last sample with the same messages. A slot that actually leaked never settles, so it still fails the bound; only the race is removed.

## Acceptance criteria

- [x] No assertion is removed, skipped, or weakened, and nothing is `allow`-ed. — The subjects of both tests — `deadline_exceeded` is reported, the child really ran, no orphan survives, and no slot or dispatcher worker is retained — are asserted exactly as before.
- [x] Both tests pass repeatedly on Windows. — Deadline 4/4 and cancel 8/8 consecutive runs locally, and the full suite (`pnpm core:test`, 38 + 17) exits 0.
- [ ] `windows-package` completes green on a non-draft pull request, including the portable build, the forced-cleanup proof, and the packaged smoke. — **Deferred, not dropped:** CI usage was suspended on 2026-09-23 at the operator's direction to conserve compute. Both fixes are verified locally; this criterion needs a runner. Partial CI evidence exists: on run [35776684225](https://github.com/zila-kh/nd-dsh/actions/runs/35776684225) `windows-package` passed `Verify ND Core`, `Benchmark smoke on Windows`, and `Prove the terminal handshake fails loudly` before the job was canceled by the suspension, so the timing fixes are confirmed on a Windows runner up to the portable build.

## Notes

- The deadline test is now ~16.5 s instead of ~5.3 s. That is the cost of the headroom and is inside the job budget.
- Nothing in `crates/nd-core/src` changed: both defects are in test timing assumptions, not in the product. The `settled_metrics` bound is what keeps that distinction honest — if the accounting were genuinely leaking, these tests would now fail on the bound rather than pass by luck.
