# Task 0017 — Laya + Jev decision support

Status: **implementation complete; local validation pending**

Integrated branch: `feat/reference-architecture-plan`  
Original implementation branch: `feat/decision-support-laya-jev`

## Goal

Add a typed System One decision-assist layer that improves ND review focus without weakening ND's existing correctness boundaries.

## Shipped scope

- `DecisionProvider` contract with typed `choice`, `score`, and `noul` answers.
- Generic HTTP System One adapter using the Jev-compatible `/v1/systemone` request shape.
- Laya support through upstream's official Jev-compatible `laya-serve`; Laya remains the preferred local first provider.
- Jev/TypeSafe support as the optional escalation provider.
- `shadow` mode: call configured providers, record receipts, never change reviewer context.
- `assist` mode: use the first provider that meets the configured confidence threshold; escalate from Laya to Jev when needed.
- Review-assist questions for acceptance coverage, scope risk, regression depth, and review route.
- Durable provider-attempt receipts appended to the review summary.
- Explicit invariant: decision support cannot establish PASS, override machine verification, waive policy, or replace independent workspace review.
- Unit coverage for high-confidence Laya, Laya→Jev escalation, all-low-confidence fallback, shadow mode, provider failure containment, Laya provider-default routing, and Jev bearer/model defaults.

## Runtime configuration

```text
ND_DECISION_SUPPORT_MODE=off|shadow|assist
ND_DECISION_SUPPORT_CONFIDENCE=0.78
ND_DECISION_SUPPORT_TIMEOUT_MS=4000

# Local Laya / compatible System One endpoint
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765
ND_LAYA_MODEL=<optional-local-model-id>

# Jev / TypeSafe
ND_JEV_API_KEY=<secret>
ND_JEV_SYSTEMONE_URL=https://api.typesafe.ai/v1/systemone
ND_JEV_MODEL=jev-latest
```

Current Laya ships an official Jev-compatible HTTP server. Keep it loopback-only for desktop use:

```bash
python -m pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PORT=8765 LAYA_PRELOAD=1 laya-serve
```

Then set `ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765`. Leave `ND_LAYA_MODEL` unset to let Laya's Router choose its English/multilingual checkpoint. Set it explicitly only when you intentionally want a particular Laya checkpoint. The configured endpoint may be either a base URL or the full `/v1/systemone` URL.

## Manual validation handoff

Run locally from the repository root:

```bash
git switch feat/reference-architecture-plan
git pull
pnpm typecheck
pnpm test -- decision-support
pnpm test
pnpm build
```

Then validate shadow mode with a reachable local System One endpoint:

```bash
ND_DECISION_SUPPORT_MODE=shadow \
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765 \
pnpm dev
```

Complete one organization task through review and verify:

1. the independent reviewer still receives no decision hints in shadow mode;
2. the final review summary contains an `<nd-dsh-decision-support>...` receipt;
3. a provider outage does not block review;
4. machine-verification failure still prevents review PASS from completing the task.

Then validate assist mode:

```bash
ND_DECISION_SUPPORT_MODE=assist \
ND_DECISION_SUPPORT_CONFIDENCE=0.78 \
ND_LAYA_SYSTEMONE_URL=http://127.0.0.1:8765 \
ND_JEV_API_KEY=<secret> \
pnpm dev
```

Verify a high-confidence Laya response avoids the Jev request; a low-confidence Laya response escalates to Jev; reviewer output remains the final semantic verdict.

## Follow-up evidence before broader authority

Do not promote System One providers from review-assist into controlling task lifecycle routes until ND has recorded enough real-task samples to measure calibration, false-allow rate, false-rework rate, rework count, verified completion rate, latency, cost, and human corrections.

The TypeScript provider transport remains the secure network/credential gateway. The reference architecture now has an opt-in Rust policy kernel via [WIP 0034](wip-0034-rust-decision-kernel.md); shared fixtures enforce parity while local live-provider validation remains the promotion gate.
