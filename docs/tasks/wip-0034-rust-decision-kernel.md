# WIP 0034 — Move Decision Support Kernel into Rust

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P1  
> Status: **parity tests + benchmark evidence recorded 2026-09-24; live Laya/Jev shadow comparison remains before Rust becomes the default**  
> Depends on: WIP 0031 and WIP 0033  
> Prototype: `src/main/organization/decision-support*.ts`  
> Owner: unassigned

## Objective

Move ND's provider-neutral decision **policy kernel** from Electron main into `nd-runtime` without changing the authority model.

## Implemented boundary

```text
Electron main
  provider gateway
  |- Laya HTTP + local routing
  |- Jev HTTPS + credentials
  `- provider observations
            |
            v
nd-core / nd-runtime
  Rust decision kernel
  |- typed attempts/results
  |- confidence threshold
  |- provider selection
  |- escalation/continue decision
  `- receipt
            |
            v
existing ND machine verification + policy + independent reviewer
```

The provider gateway intentionally remains in Electron main for this slice: that is where ND already owns secure credentials/network policy. Rust owns the reusable decision semantics and receives no provider secret. This avoids adding a second TLS/credential stack merely to move an HTTP call.

## Implemented

- Rust typed decision answer/result/attempt/evaluation/receipt contracts;
- `decision.evaluate` ND Core method;
- deterministic `assist | shadow | off` continuation/selection semantics;
- TypeScript fallback kernel extracted to the same pure input/output shape;
- one shared JSON parity corpus consumed by both Rust and TypeScript tests;
- opt-in `ND_DECISION_SUPPORT_RUNTIME=rust`;
- Laya stays the first local provider via upstream `laya-serve`;
- Jev remains optional escalation through the existing secure TypeScript provider gateway;
- high-confidence Laya stops before Jev;
- low-confidence/error Laya continues to Jev;
- all-low-confidence/provider failure produces no hint and falls back to the existing independent reviewer;
- Rust-kernel failure itself also falls back to the independent reviewer rather than blocking review;
- sanitized durable decision receipts record provider/model/confidence/latency/escalation without credentials or raw provider state;
- contract benchmark measures Rust decision evaluation latency;
- current TypeScript kernel remains available until local parity evidence approves the Rust default.

## Non-goals retained

- no Laya model port or model-weight bundling;
- no Company/Project/Task business migration;
- no provider may override machine verification, policy, exact-evidence rules, or independent semantic review;
- no quality/performance claim until matched local evidence exists.

## Future seam

A future native/ONNX local decision model can replace the Laya transport without changing the Rust decision contract.

## Acceptance status

Implementation is complete. Local evidence recorded 2026-09-24 on the Windows
reference machine, commit `d3de5be`:

- **Shared parity corpus** — `tests/fixtures/decision-kernel-parity.json` is consumed
  by both the Rust kernel tests (inside `pnpm core:test`) and the TypeScript kernel
  tests (`tests/decision-support.test.ts`), all passing alongside
  `tests/organization-approval-gate.test.ts` (16 focused tests).
- **Contract benchmark** — `contract-decision-kernel` in
  `benchmark-results/2026-09-24T09-20-59-580Z-win32-x64/`: evaluate p50 0.67 ms /
  p95 0.72 ms, `selectedProvider: jev`, `escalated: true`.
- **Full repository gates** — `pnpm verify`, `pnpm typecheck`, `pnpm test`
  (841 passed / 8 skipped, five consecutive green runs), `pnpm build` all pass.
- **Live provider comparison** — Laya TS shadow, Laya Rust shadow, and Rust assist +
  Jev are **SKIPPED for this run**: `laya`/`laya-serve` is not installed on this
  machine (it needs `pip install "laya[serve]"` plus a model preload) and no Jev
  credential was configured. Deterministic control semantics remain covered by the
  focused fixture tests; the live wire-compatibility confirmation is the remaining
  item before Rust becomes the default.
- Rust is **not** yet promoted to the decision-kernel default; the TypeScript kernel
  stays in place until the live shadow comparison is recorded.

## Handoff

See [Reference Architecture Local Validation Handoff](../plan/reference-architecture-local-validation-handoff.md).
