# Beta Hardening v2

Status: implementation branch ready for CI/QA
Branch: `feat/beta-hardening-v2`
Baseline: `main` at `8864e4698830981e36291a92fb976c657eacc61d`

## Goal

Make the existing ND beta safer and faster without destabilizing the mature orchestration architecture already delivered by the beta-v1 reliability work.

This pass deliberately favors low-risk, measurable improvements over large renderer/control-plane rewrites immediately before beta.

## Implemented in this pass

### 1. Suspend idle Explorer filesystem polling

The Explorer previously listed the workspace root on a fixed interval whenever it was mounted. ND keeps major product views mounted and hides inactive views with CSS, so that could continue filesystem IPC while the user was in Company, Design, QA, Settings, another Explorer tab, or while a slow list request was still running.

New behavior:

- no overlapping root-list requests,
- no polling while the Electron document is hidden,
- no polling while the Explorer is CSS-hidden behind another product view,
- no root polling while Search or Source Control is active,
- focus/visibility recovery refreshes immediately,
- unchanged directory listings preserve the previous React state reference to avoid needless rerenders,
- recursive scheduling starts only after the prior list request settles.

### 2. Privacy-safe beta diagnostics

Settings → General → About now includes **Copy diagnostics**.

The report includes only support-relevant health information:

- ND version and platform,
- Harness runtime state and source readiness,
- provider/model identity,
- credential status (configured/missing/not required, never the credential),
- browser bridge health,
- workspace binding/project-linked booleans,
- bounded runtime/browser error text.

The report intentionally excludes credentials, session IDs, workspace paths, project names, and current browser URLs.

### 3. Repository hygiene

- `.pnpm-store/` is ignored.
- The accidentally tracked local pnpm index database is removed.

This prevents local package-manager cache churn from entering release commits and keeps checkout/install state deterministic.

### 4. CI cost and reliability

The main CI workflow now:

- cancels obsolete runs for the same branch/ref,
- caches pnpm dependencies from the lockfile,
- has an explicit Linux validation timeout,
- retains repository invariants, release config verification, strict TypeScript, unit tests, production build, and Playwright desktop smoke tests.

### 5. Windows package smoke gate

A dedicated `windows-latest` job now installs from the frozen lockfile and runs `pnpm dist:win:dir`.

That exercises the actual beta release path:

`release:stage → desktop build → release verification → electron-builder Windows directory package`

This prevents a Linux-only green CI result from being treated as proof that the Windows desktop beta is packageable.

## Review findings — keep after beta, not in the pre-beta patch

The following are real opportunities, but are intentionally deferred because they have wider regression radius than the changes above:

1. **Renderer decomposition / route-level code splitting.** `App.tsx` is large and `ChatPanel.tsx` is the largest renderer component. Split product views and chat subsurfaces after beta so initial renderer parsing and change isolation improve without risking navigation/session regressions immediately before release.
2. **Mount lifecycle for inactive product views.** Several major views remain mounted while hidden to preserve state. Introduce an explicit keep-alive/activation contract so background subscriptions can pause uniformly rather than each component inferring visibility.
3. **IPC module decomposition.** Main-process IPC is broad. Keep the current trusted-boundary behavior, then split registration by capability/domain to improve auditability without changing channel contracts.
4. **Performance telemetry.** Add local, privacy-preserving startup/interaction timings (renderer ready, first workspace render, session-open latency, browser-ready latency) before optimizing beyond measured bottlenecks.
5. **Packaged Windows E2E.** The new job proves package creation. A later release workflow should launch the unpacked packaged executable and execute a minimal first-run/session/browser smoke test on Windows.

## Beta ship gate

Before merging/shipping this branch:

- Linux `validate` job green.
- Windows `windows-package` job green.
- Manual packaged-app smoke: launch, choose workspace, open chat, run one coding-engine turn, open browser, switch Company/Agent/Design/QA/Settings, copy beta diagnostics.
- Confirm no credential, path, project name, session ID, or browser URL appears in copied diagnostics.
- Run one representative autonomous project acceptance flow already used by beta-v1 QA.

## Product assessment

The beta-v1 reliability architecture is already the strongest part of the product: isolated task worktrees, bounded retry/failover, run cancellation, stall recovery, machine verification, dependency validation, and worker capacity are present. For beta, stability and release evidence are more valuable than adding another broad feature surface.

This v2 pass therefore focuses on making the existing product cheaper while idle, easier to support, cleaner to build, and harder to ship in a platform-broken state.
