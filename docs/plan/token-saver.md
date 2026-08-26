# ND Token Saver

## Decision

ND Token Saver is an ND-native product capability. It is not an API-key-only feature and it is not a wrapper around a third-party router.

The first release prioritizes **built-in ND compression**. External-app optimization is a separate, optional capability and is **off by default**.

## User experience

Normal users configure everything inside the ND desktop app. They are never required to run setup commands, edit TOML/JSON, set environment variables, choose localhost ports, or install RTK/Caveman separately.

### Primary switch

- **Save tokens in ND** — built-in ND optimization. Available without enabling any external integration.

### Optional external switch

- **Enable for external apps** — off by default.
- When enabled, ND detects supported apps and offers per-app enable/disable controls.
- ND must back up configuration before changing a supported external app and restore it when integration is disabled.
- "External" means apps with a safe supported integration path. ND does not install a root certificate or intercept arbitrary HTTPS traffic.

## Scope model

1. **ND only** — default. Optimize ND Harness and ND-managed coding-engine traffic only.
2. **External apps** — optional add-on. Supported apps are individually opt-in.

There is no implicit machine-wide interception mode.

## Optimization pipeline

ND owns the orchestration layer and chooses one optimizer per payload. Do not repeatedly apply lossy compression.

- Command/tool output: RTK adapter where supported.
- Large generic structured payloads: Caveman Engine adapter where it provides recoverable compression.
- Conversation/history compaction: ND-native.
- Repository relevance, AST/LSP selection, deduplication, cache policy, telemetry, safety, and recovery: ND-native.
- Original content must remain recoverable whenever a lossy optimizer is used.

Third-party engines are replaceable implementation details. The renderer and product model refer to **ND Token Saver**, not RTK or Caveman.

## Account/auth scope for this release

OAuth/provider-account UI is intentionally limited to:

- **Codex** — keep the existing Codex-native account/authentication flow.
- **Antigravity OAuth** — add as the only new OAuth provider-account adapter in this release.

Do not expose unfinished Claude, Gemini, or other OAuth account flows yet. Their future support must plug into the same provider-account interface without changing Token Saver scope/settings.

API-key model routes remain a separate existing provider capability.

## Safety requirements

- Token Saver is optional.
- ND built-in saving and external-app integration are independent switches.
- External integration defaults off.
- No TLS/root-certificate interception.
- No credential extraction from third-party apps.
- Preserve native provider authentication where supported.
- Back up before modifying external app configuration.
- Restore on disable/uninstall when possible.
- Failure of an external optimizer must not break ND built-in chat.
- Prefer original payload over compressed payload when safety/quality checks fail.

## UI target

```text
Token Saver

Save tokens in ND                         [ ON ]
Reduce repeated context and noisy tool output automatically.

Mode
( ) Off
(*) Automatic (recommended)
( ) Advanced

External apps                            [ OFF ]
Optional. Optimize supported AI coding apps on this computer.

When enabled:
Codex                                     [ ON ]
Other detected supported apps             [ OFF ]

Accounts available in this release
Codex                                      Connected / Connect
Antigravity                                Connected / Connect

Today
Original context        ...
Sent                    ...
Saved                   ...
Savings                 ...%
```

Advanced terminology such as proxy, base URL, adapter, hook, RTK, Caveman, protocol translation, and environment variables stays out of the normal-user UI.

## Delivery order

1. ND-native settings/state, telemetry contract, and ND-only pipeline.
2. Tool-output optimizer adapter interface and RTK adapter.
3. Recoverable generic-payload adapter (Caveman Engine where beneficial).
4. ND-native context dedupe/compaction and repo relevance.
5. Codex account integration reuse + Antigravity OAuth adapter.
6. Optional external-app detector/config backup/restore.
7. Per-app external enablement and savings telemetry.

## Acceptance criteria

- ND Token Saver works with External apps disabled.
- A fresh user can enable/disable saving entirely through the ND UI.
- External integration remains disabled until explicit user action.
- Disabling external integration restores any ND-managed external configuration backup.
- No unsupported OAuth providers are shown as connectable in this release.
- Codex and Antigravity are the only provider-account choices surfaced for OAuth/account login.
- A compression failure falls back to the original payload.
- Savings telemetry reports original size, optimized size, and avoided size without exposing secrets.
