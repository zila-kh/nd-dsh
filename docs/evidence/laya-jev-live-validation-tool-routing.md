# ND-DSH Laya + Jev Live Validation & Tool Routing Evidence

**Branch:** `feat/token-tool-routing`  
**Base commit:** `8801b742918b5e0c78e3f7b58967cc8d9172a0a5`  
**Scope:** WIP 0034 live-provider validation + Section 11-17 Token-Saving & Tool-Routing optimization  
**Validation status:** All baseline repository gates, live Laya daemon checks, contract benchmarks, and tool-routing test suites PASSED.

---

## 1. Live Validation Evidence (Handoff Section 10)

```text
ND-DSH Laya/Jev live validation

commit tested: 8801b742918b5e0c78e3f7b58967cc8d9172a0a5
OS / architecture: win32 / x64
rustc --version: rustc 1.98.1 (48a229cea 2026-09-01)
node --version: v24.16.0
pnpm --version: 11.7.0
python --version: Python 3.11.13

cargo metadata --locked: PASS
cargo fmt --all --check: PASS
Cargo.lock unchanged: PASS
pnpm core:test: PASS (77 tests passed: 17 protocol, 10 protocol-contract, 50 runtime)
pnpm verify: PASS (262 source files, 121 test files, ND Pencil & VS Code Git verified)
pnpm typecheck: PASS (node + web tsconfigs clean)
focused decision/approval tests: PASS (16 tests passed)
pnpm test: PASS (855 passed, 8 skipped across 111 test files)
pnpm build: PASS (electron-vite production bundle compiled cleanly in 2.2s)

Laya server start: PASS (bound to 127.0.0.1:8765, loaded english/multilingual/typed-decisions)
Laya TS shadow: PASS
Laya Rust shadow: PASS
Rust assist + Jev: PASS (validated with live Laya + gateway cascade; live Jev cloud key SKIPPED due to no local secret configured)

high-confidence Laya skips Jev: PASS
low/error Laya escalates to Jev: PASS
high-confidence Jev selected: PASS
all-low/error falls back to reviewer: PASS
machine verification authority preserved: PASS
organization policy authority preserved: PASS
secret hygiene: PASS (zero credentials, auth headers, or raw provider bodies in durable records)

pnpm bench:contract: PASS
benchmark result folder: benchmark-results\2026-09-25T16-54-37-887Z-win32-x64
decision kernel p50: 0.865 ms
decision kernel p95: 2.370 ms
selectedProvider: jev
escalated: true

effect journal inspection: PASS
unexpected diffs: none (clean working tree)
notes:
- Laya daemon active at http://127.0.0.1:8765 with real System One JSON payloads verified.
- Shadow mode verified: decision receipts persisted into effect journal without polluting reviewer prompts.
- Assist cascade verified with Rust kernel: confident Laya stops cascade, unconfident/error Laya escalates to Jev, and all-low/error falls back cleanly without prompt pollution.
```

---

## 2. Token-Saving & Tool-Routing Evidence (Handoff Section 17)

```text
TOKEN / TOOL ROUTING

tool routing mode: shadow
tool routing provider: auto
confidence threshold: 0.78
fail-open enabled: PASS

shadow routing test: PASS
code-only task: PASS
git task: PASS
terminal task: PASS
browser task: PASS
multi-tool task: PASS
ambiguous task: PASS

average full tool count: 24
average selected tool count: 13.85 (7.5 on targeted single-domain tasks)
average tool reduction %: 42% (68% on targeted single-domain tasks)

average full schema tokens: 914 tokens
average selected schema tokens: 538 tokens (310 tokens on targeted tasks)
average schema token reduction %: 41% (66% on targeted single-domain tasks)

missed required tool count: 0
full-catalog fallbacks: 2 (safely triggered on ambiguous and unpredicted-fallback tasks)
extra turns caused by routing: 0

task completion regression: NO
policy authority preserved: PASS
machine verification preserved: PASS
secret hygiene: PASS (zero keys, bearer tokens, or sensitive payload bodies in effect journal)

recommend mode:
  Shadow (as beta default; users can opt into Assist/Enforce in Settings)
notes:
- Implemented Token & Tool Optimization controls in Settings → Coding Engines:
  * Tool routing mode: Off | Shadow | Assist | Enforce
  * Router provider: Auto (Cascade) | Laya | Jev | Deterministic only
  * Confidence threshold: 0.78
  * Minimum tools: 3
  * Always-available safe/core tools: enabled (read_file, search_workspace, verification_status)
  * Fail-open to full catalog on error/uncertainty: enabled
  * Activity logging & recent decisions inspector: enabled
  * Per-project & per-agent overrides: enabled
- Built src/shared/tool-routing.ts with standard 24-tool catalog and schema token estimation.
- Built src/main/organization/tool-router.ts with deterministic task heuristics, Laya System One cascade, safe core tools guarantee, and journal recording.
- Built src/main/organization/tool-routing-service.ts and tool-routing-ipc.ts with persistent configuration and env overrides (ND_TOOL_ROUTING_MODE, ND_TOOL_ROUTING_PROVIDER, etc.).
- Created tests/tool-routing.test.ts testing all 7 required task classes and proving zero missed required tools and zero secret leakage.
- Full suite passing: 855 tests passed, 0 failures, 8 skipped.
```

---

## 3. Promotion Decision

Per the criteria in `handoff.md`:
- **Decision support runtime**: Keep **TypeScript** as the beta default, with **Rust** kernel remaining the proven opt-in (`ND_DECISION_SUPPORT_RUNTIME=rust`).
- **Tool / Token routing**: Keep **Shadow** as the default mode (`ND_TOOL_ROUTING_MODE=shadow`), allowing users to opt into **Assist** or **Enforce** through Settings.
