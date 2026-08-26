# Token Saver third-party runtime notes

## RTK

ND does not vendor RTK source or bundle RTK into the base application in this beta. When a user explicitly enables external Codex optimization, ND downloads a pinned upstream release into ND user data.

- Project: `rtk-ai/rtk`
- Version: `v0.42.4`
- License: Apache-2.0
- Upstream release: `https://github.com/rtk-ai/rtk/releases/tag/v0.42.4`
- Telemetry: ND launches the managed helper with `RTK_TELEMETRY_DISABLED=1`.

Pinned archive SHA-256 digests:

| Platform | Asset | SHA-256 |
| --- | --- | --- |
| macOS arm64 | `rtk-aarch64-apple-darwin.tar.gz` | `f223ca074a0215af002679bc1d34ca92b93e25b3e8ae16aace6e84c06e586802` |
| macOS x64 | `rtk-x86_64-apple-darwin.tar.gz` | `84121316867613e61925c209607f033b2113bb0ce312c267a79d3e3e8f221e49` |
| Linux arm64 | `rtk-aarch64-unknown-linux-gnu.tar.gz` | `cc2b91c064eb670c097c184913c8fbcb1a943d53d7fe505375e96ba0c5b6459f` |
| Linux x64 | `rtk-x86_64-unknown-linux-musl.tar.gz` | `34975116da11e09e502501daf758143e0b22ed3a42a10eb67fb693a6270d9e36` |
| Windows x64 | `rtk-x86_64-pc-windows-msvc.zip` | `f0ec18963581657173bd6a51f5ba012b093823f844db749fec218581af30a568` |

ND verifies the selected digest before extracting/executing the helper.

## OmniRoute / 9Router inspiration

No OmniRoute/9Router application or source tree is embedded in ND. The Antigravity account implementation follows the same public native-client OAuth shape observed in those projects: Google browser authorization, loopback callback, offline refresh token, account metadata, and provider-specific scopes. ND implements its own IPC, lifecycle, secure storage, settings, and account state.

The Antigravity OAuth client credentials are public native-application client values, not ND secrets. Source stores them scanner-masked to avoid false secret alerts; user OAuth access/refresh tokens are never stored this way and instead use Electron `safeStorage` when a secure backend exists.
