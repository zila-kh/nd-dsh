# Task 0045 — Command registry + governed native wallpaper extension

> Owner: ND launcher + extensions  
> Status: implementation complete on `feat/magibar-command-native-extensions`; execution validation pending  
> Priority: P1  
> PRD: [0008 — Command Registry and Governed Native Extensions](../prd/0008-command-registry-native-extensions.md)  
> Depends on: PRD 0006 extensions/Home and PRD 0007 General/Coding workspace profiles

## Objective

Ship the first Magibar-inspired **architecture pattern**, not a clone: one ActionSource-style ND command registry plus a real native desktop extension capability governed by ND permissions.

## Implemented

- `LauncherCommandSource` and `LauncherCommandRegistry`.
- Core/context/capture/extension/project/company sources.
- Both launcher surfaces continue through the same `QuickLauncher`.
- `os.wallpaper.write` permission.
- `os.wallpaper.chooseAndSet` Personal-only sensitive host method.
- Wallpaper Manager built-in package, default Personal activation.
- User-authored wallpaper extension example.
- Windows/macOS/Linux trusted wallpaper adapters without shell execution.
- Install-time and runtime host-context ceiling enforcement.
- Launcher E2E checks that Wallpaper Manager is visible in Personal and absent in Project context.

## Safety invariants

- Extensions cannot pass arbitrary paths into the wallpaper adapter.
- Extensions cannot pass shell commands or executable paths.
- Native file selection is ND-owned.
- Company/Project contexts cannot invoke the wallpaper host method.
- Agent invocation requires explicit approval/grant.
- The registry does not execute extension code; it adapts broker-provided command descriptors.

## Required validation before merge

- `pnpm typecheck`
- `pnpm test`
- `pnpm e2e:launcher`
- `node scripts/validate-nd-extension.mjs --builtins`
- `node scripts/validate-nd-extension.mjs examples/nd-extension-wallpaper`
- Windows manual wallpaper change and cancel-path check

GitHub Actions remain parked, so no automated-run claim is made until these local gates are recorded.
