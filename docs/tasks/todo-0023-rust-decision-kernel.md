# TODO 0023 — Move Decision Support Kernel into Rust

> Plan: [Reference-Inspired Runtime and Company Evolution](../plan/reference-inspired-runtime-company-evolution.md)  
> Priority: P1  
> Status: todo  
> Depends on: TODO 0020 and TODO 0022  
> Prototype: `src/main/organization/decision-support*.ts`  
> Owner: unassigned

## Objective

Move ND's provider-neutral decision cascade from Electron main into `nd-runtime` without changing the authority model.

The existing TypeScript implementation remains the behavioral prototype and local validation vehicle. The Rust migration is accepted only when it preserves or improves correctness, latency, observability, and packaging.

## Target boundary

```text
Electron / TypeScript
  organization workflow + UI
        |
        v
nd-core / nd-runtime
  decision kernel
  |- deterministic rules
  |- typed decision questions/results
  |- confidence threshold + escalation
  |- provider health/timeouts
  |- calibration/metrics
  |- durable decision receipt
  |- Laya provider
  |- Jev provider
  `- reasoning-model escalation signal
        |
        v
existing ND policy + machine verification + independent reviewer
```

## Scope

- define Rust-owned typed decision request/result/receipt contracts;
- expose one versioned core method for decision evaluation;
- keep deterministic rules first for mechanical decisions;
- support provider order `rules -> Laya -> Jev -> reasoning fallback`;
- call upstream `laya-serve` over loopback initially;
- call Jev over HTTPS with credentials supplied by the existing secure provider boundary;
- preserve provider timeout/failure containment;
- record confidence, latency, provider/model, disagreement/escalation, and outcome linkage;
- keep review-assist non-authoritative;
- make the same kernel reusable later for engine/model routing, retry/escalation, and worker/reviewer assignment.

## Non-goals

- do not port Laya's model implementation to Rust in this ticket;
- do not bundle Laya model weights into Electron or nd-core;
- do not let decision providers override red machine checks, policy gates, exact-evidence rules, or independent semantic review;
- do not move Company/Project/Task business truth into Rust as part of this change;
- do not claim speed/quality improvement without matched evidence.

## Future native local-model seam

If ND later has a validated ONNX/native export for Laya or an ND-specific fine-tuned decision model, replace only the local provider implementation:

```text
today:  nd-runtime -> localhost laya-serve
future: nd-runtime -> ONNX/native inference
```

The typed decision contract and downstream authority rules must remain unchanged.

## Acceptance

- TypeScript and Rust paths produce equivalent typed decisions on the same fixture corpus;
- shadow-mode receipts match provider order, confidence, failure, and escalation semantics;
- all-low-confidence and provider-failure cases still fall back to the existing reasoning reviewer;
- red machine verification remains authoritative;
- no credential is persisted in decision receipts or worker-visible state;
- matched benchmark records p50/p95 latency, core IPC crossings, provider calls, escalation rate, verified completion, first-review pass, false-allow/false-rework, and human corrections;
- Rust path becomes default only after local validation shows no correctness regression and acceptable performance;
- old TypeScript transport logic is removed only after parity evidence is committed.
