# TODO 0034 — Move Decision Support Kernel into Rust

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P1  
> Status: **implementation complete; local parity/live-provider validation pending**  
> Depends on: TODO 0031 and TODO 0033  
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

Implementation is complete. Local shared-fixture tests, full repository gates, live Laya/Jev shadow/assist comparison, and benchmark evidence are the remaining promotion gate before making Rust the default.

## Handoff

See [Reference Architecture Local Validation Handoff](../plan/reference-architecture-local-validation-handoff.md).
