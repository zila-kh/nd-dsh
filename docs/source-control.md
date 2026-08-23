# ND Source Control

ND-DSH's built-in **Source Control** panel (Explorer → Source Control tab) tracks Git repositories at the active workspace root. It is derived from the MIT-licensed Git extension of microsoft/vscode, pinned under `vendor/vscode-git` (see `vendor/vscode-git.json` for provenance and `vendor/README.md` for the attribution record).

## What it does

- Detects whether the workspace root sits inside a Git repository (`rev-parse --show-toplevel`) and renders an empty state when it does not.
- Groups `git status --porcelain -z -uall` entries into **Staged**, **Merge Changes** (unmerged paths), **Changes** (unstaged), and **Untracked Files**, using the upstream `GitStatusParser`.
- Stage / unstage / discard per file (discard is two-step confirmed in the UI), commit staged changes with a message (`Ctrl+Enter`), view a unified diff per file (staged or worktree).
- Branch overview from `for-each-ref` including upstream tracking and ahead/behind counts; switch or create branches.
- Fetch / Pull (`--ff-only`) / Push when remotes are configured.

## Architecture

| Layer | File | Origin |
| --- | --- | --- |
| Shared contract | `src/shared/contracts.ts` (`GitStatusSnapshot`, `DesktopApi.git`, `IPC.git*`) | ND |
| CLI plumbing + parsers | `src/main/git/git-cli.ts` | Derived from `extensions/git/src/git.ts` (MIT, © Microsoft Corporation) |
| Repository state service | `src/main/git/git-service.ts` | ND orchestration over derived parsers |
| IPC handlers | `src/main/ipc.ts` | ND narrow-contract pattern |
| Renderer panel | `src/renderer/src/components/SourceControlPanel.tsx`, `DiffView.tsx` | ND UI |

The VS Code Source Control *view* itself lives in VS Code core and is not used; the ND panel is a native React implementation.

## Security posture

- Git runs in the main process only; the renderer talks through validated IPC channels (`asString`/`asPathList` guards, trusted-sender check).
- No credentials are stored or proxied. Interactive credential prompts fail closed (`GIT_ASKPASS=echo`, `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=echo`) instead of spawning VS Code's askpass helper process, so remote operations surface an authentication error rather than blocking.
- Mutating operations (stage/unstage/discard/commit/checkout/push/pull/fetch) are serialized through an operation queue to avoid `index.lock` contention; discard requires explicit confirmation in the UI.
- Binary resolution follows the ND convention: `ND_DSH_GIT_BINARY` developer override, otherwise system `git`.

## Attribution

Upstream notice preserved verbatim in `vendor/vscode-git.LICENSE` ("Copyright (c) 2015 - present Microsoft Corporation"). Adapted source files carry Microsoft's copyright header with a derivation note, and the Source Control panel displays the credit line in-product. Parser unit suites were ported from `extensions/git/src/test/git.test.ts` into `tests/git-cli.test.ts`.
