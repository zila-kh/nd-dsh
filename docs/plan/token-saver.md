# ND Token Saver

## Status

Implemented on `feat/token-saver` as an app-first beta feature.

ND Token Saver is an ND-native product capability. It is not API-key-only and it is not a wrapper around a third-party router. The first release prioritizes built-in ND/Harness context reduction; external-app optimization is a separate opt-in and is off by default.

## Product rules

Normal users configure everything inside ND Desktop. They never need to run setup commands, edit TOML/JSON, set environment variables, choose localhost ports, or install compression tools themselves.

- **Save tokens in ND**: on by default in Automatic mode.
- **External apps**: off by default and independently controlled.
- **Per-app opt-in**: an external app is never modified until the user enables that app.
- **No machine-wide HTTPS interception**: no root certificate, transparent TLS proxy, or credential scraping.
- **Failure isolation**: external setup failure rolls the external setting back and never disables built-in ND saving.

## Built-in ND pipeline

ND uses two complementary built-in layers.

### 1. ND common-engine preprocessor

The ND-native service runs at the common coding-engine dispatch boundary, after ND extension context is assembled and before a turn is sent to ND Harness or direct Codex.

Prompt compaction is deliberately conservative: line-ending/trailing-space/excessive-blank normalization only, and only when the avoided payload is large enough to be meaningful. ND does not middle-truncate user instructions.

Generic/tool-output compaction supports deterministic repeated-line reduction and bounded head/tail clipping. Any lossy ND-local result stores its original in a bounded local recovery store and returns a local recovery reference. If storing/compacting fails and Quality protection is enabled, ND uses the original payload.

### 2. Harness-native history/tool-result compaction

The pinned DeepSeek Harness already provides two replay-safe context reducers:

- `@deepseek-ai/dsh-compaction-tool-result-pruner` — model-free pruning of oversized tool results while retaining the full original event in the append-only session log;
- `@deepseek-ai/dsh-compaction-basic` — automatic pressure/overflow compaction of older conversation history, reusing the provider's stable prefix where possible.

ND explicitly gates both plugins with **Save tokens in ND**. Switching Off disables those Harness reducers; switching back to Automatic/Advanced enables them. HarnessService checks the policy before every prompt/new-session launch boundary and transparently rebuilds the durable runtime when the setting changed, so an app restart is not required.

Harness pruning keeps the upstream safe defaults for this beta: prune text above 8,192 characters to a 4,096-character head plus 1,024-character tail and omission marker when a compaction trigger qualifies.

## Savings telemetry scope

The current Settings counter stores ND-local reductions only:

- original characters
- optimized characters
- avoided characters
- operation count
- fallback count

It does not persist prompt content in the savings counters. Harness compaction/pruning follows the same product switch but is not added to this UI percentage yet because ND will not fabricate token savings without an exact before/after measurement from the Harness token meter.

## External apps beta

### Codex — full beta support

When a user turns on External apps and enables Codex, ND itself:

1. downloads the pinned RTK `v0.42.4` release for the current supported OS/CPU;
2. verifies the upstream published archive SHA-256 digest before execution;
3. verifies the extracted executable reports the pinned version;
4. stores a local install manifest containing the archive digest and extracted-binary SHA-256;
5. re-verifies the installed binary before every later reuse and reinstalls from the pinned release if it was modified or the manifest is missing/corrupt;
6. disables RTK telemetry for the ND-managed helper;
7. atomically backs up the Codex `AGENTS.md` / `RTK.md` integration surface;
8. invokes RTK's global Codex integration non-interactively;
9. records managed-file hashes;
10. restores ND's exact before-state on disable when the files are still ND-managed, while preserving files the user edited after enablement.

The helper lives under ND user data. The user does not install it globally and never needs a terminal.

Supported helper payloads in this beta: macOS arm64/x64, Linux arm64/x64, and Windows x64. The pinned asset digests were rechecked against the upstream `v0.42.4` GitHub release before beta handoff.

### Antigravity — account support only in this beta

Antigravity can be connected as an account, but machine-global external Antigravity optimization is intentionally not exposed yet. Its current rule integration is not equivalent to the safe global Codex path, so the UI reports **Account only** instead of pretending full support.

## OAuth/provider-account scope

Only two account surfaces are exposed in this release.

### Codex

Codex authentication stays native to the pinned official Codex runtime. ND can launch `codex login` / `codex logout` from the app, but ND never reads, copies, or stores the Codex access/refresh token.

### Antigravity

The Antigravity flow is ND-native and inspired by the working OmniRoute/9Router desktop pattern:

- Google browser authorization
- loopback `127.0.0.1` callback on an ephemeral port
- random state validation
- offline access / refresh token
- Antigravity Cloud Code + userinfo scopes
- public native-client OAuth credentials distributed by the upstream client (scanner-masked in source; not treated as private secrets)
- account email discovery through Google userinfo
- refresh-token rotation handling

Access/refresh tokens are encrypted with Electron `safeStorage`. On Linux, ND refuses to persist OAuth tokens when Electron reports the insecure `basic_text` backend; the connected credential stays memory-only for that app session.

Antigravity is **account-only** in this beta, so OAuth success proves account connection rather than model-routing readiness; project bootstrap/discovery remains future provider integration work.

Claude, Gemini, OpenAI-native, and other OAuth account buttons are intentionally absent for now.

## Dependency strategy

ND owns the orchestration, UI, settings, safety, recovery, scope, provider-account boundary, and telemetry.

- **ND native**: product switch, prompt safety, settings, generic compaction, recovery, telemetry, app UX, Harness policy gating.
- **DeepSeek Harness built-ins**: replay-safe history compaction and tool-result pruning for ND Harness traffic.
- **RTK**: optional Codex external command/tool-output optimization; pinned, integrity-checked, and replaceable.
- **Caveman**: no hard dependency in this beta. The optimizer interface keeps a future slot; ND already adopts the important recoverability rule for lossy payloads.
- **OmniRoute/9Router**: architecture/OAuth reference only; no router application or source tree is embedded.

## UI target

```text
Token Saver

Save tokens in ND                         [ ON ]
Mode                         Automatic
Savings                 ~42,000 · 63%

External apps                            [ OFF ]

Codex                       Detected      [ OFF ]
Antigravity                  Account only

Accounts
Codex                     Connected / Connect
Antigravity                Connected / Connect
```

Advanced terms such as proxy, base URL, hook, RTK, protocol translation, and environment variables stay out of the normal-user UI.

## Acceptance criteria

- Built-in ND saving works with External apps disabled.
- The Save tokens switch gates Harness automatic history compaction and tool-result pruning as well as the ND-local preprocessor.
- A Token Saver policy change takes effect on the next Harness prompt/session without requiring an app restart; durable sessions survive the runtime refresh.
- A fresh user controls the feature entirely through ND Desktop.
- External integration remains disabled until explicit user action.
- Codex external setup downloads only a pinned, digest-verified helper.
- A previously installed external helper is binary-hash verified before reuse and automatically reinstalled if its integrity record no longer matches.
- Disabling external Codex restores backup state where safe without touching Codex credentials or overwriting user edits made after enablement.
- No unsupported OAuth provider is shown as connectable.
- Codex + Antigravity are the only account choices.
- Antigravity tokens use OS-backed encrypted persistence or memory-only fallback.
- A compression/setup failure falls back or rolls back safely.
- Lossy ND generic/tool payloads have an ND-local recovery reference; Harness pruning retains its original event durably in the Harness session log.
- Savings telemetry contains counts, not user prompt text, and the UI does not claim Harness savings are part of the ND-local percentage until exact accounting is available.
