# ND Token Saver

## Status

Implemented on `feat/token-saver` as an app-first beta feature.

ND Token Saver is an ND-native product capability. It is not API-key-only and it is not a wrapper around a third-party router. The first release prioritizes built-in ND compression; external-app optimization is a separate opt-in and is off by default.

## Product rules

Normal users configure everything inside ND Desktop. They never need to run setup commands, edit TOML/JSON, set environment variables, choose localhost ports, or install compression tools themselves.

- **Save tokens in ND**: on by default in Automatic mode.
- **External apps**: off by default and independently controlled.
- **Per-app opt-in**: an external app is never modified until the user enables that app.
- **No machine-wide HTTPS interception**: no root certificate, transparent TLS proxy, or credential scraping.
- **Failure isolation**: external setup failure rolls the external setting back and never disables built-in ND saving.

## Built-in ND pipeline

The ND-native service runs at the common coding-engine dispatch boundary, after ND extension context is assembled and before a turn is sent to ND Harness or direct Codex.

Prompt compaction is deliberately conservative: line-ending/trailing-space/excessive-blank normalization only. ND does not middle-truncate user instructions.

Generic/tool-output compaction supports deterministic repeated-line reduction and bounded head/tail clipping. Any lossy result stores its original in a bounded local recovery store and returns a local recovery reference. If storing/compacting fails and Quality protection is enabled, ND uses the original payload.

Telemetry stores counts only:

- original characters
- optimized characters
- avoided characters
- operation count
- fallback count

It does not persist prompt content in the savings counters.

## External apps beta

### Codex — full beta support

When a user turns on External apps and enables Codex, ND itself:

1. downloads the pinned RTK `v0.42.4` release for the current supported OS/CPU;
2. verifies the upstream published SHA-256 digest before execution;
3. disables RTK telemetry for the ND-managed helper;
4. backs up the Codex `AGENTS.md` / `RTK.md` integration surface;
5. invokes RTK's global Codex integration non-interactively;
6. records managed-file hashes;
7. runs RTK's Codex uninstall and restores ND-managed backup state when disabled.

The helper lives under ND user data. The user does not install it globally and never needs a terminal.

Supported helper payloads in this beta: macOS arm64/x64, Linux arm64/x64, and Windows x64.

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

Claude, Gemini, OpenAI-native, and other OAuth account buttons are intentionally absent for now.

## Dependency strategy

ND owns the orchestration, UI, settings, safety, recovery, scope, provider-account boundary, and telemetry.

- **ND native**: prompt safety, settings, generic compaction, recovery, telemetry, app UX.
- **RTK**: optional Codex external command/tool-output optimization; pinned and replaceable.
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
- A fresh user controls the feature entirely through ND Desktop.
- External integration remains disabled until explicit user action.
- Codex external setup downloads only a pinned, digest-verified helper.
- Disabling external Codex removes the ND-managed integration and restores backup state without touching Codex credentials.
- No unsupported OAuth provider is shown as connectable.
- Codex + Antigravity are the only account choices.
- Antigravity tokens use OS-backed encrypted persistence or memory-only fallback.
- A compression/setup failure falls back or rolls back safely.
- Lossy ND generic/tool payloads have an ND-local recovery reference.
- Savings telemetry contains counts, not user prompt text.
