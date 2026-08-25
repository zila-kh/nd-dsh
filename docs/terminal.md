# Session-isolated terminal

ND's built-in terminal is a resource owned by a chat session, not a global IDE shell. Every operation carries both `sessionId` and `terminalId`; the trusted main process rejects a terminal id that is not owned by the supplied session.

## Architecture

`TerminalDock` runs xterm.js in the sandboxed renderer. A narrow preload bridge forwards validated calls to `TerminalManager` in Electron main. `TerminalManager` owns `node-pty` processes and starts each shell in the chat/worktree cwd when available, otherwise the active workspace root.

Each chat can own multiple terminal tabs and a split-pane layout. Switching chats changes the terminal resource set without killing terminals belonging to other chats. Renderer reloads reattach to the same live PTY and replay output by sequence number.

## Persistence and recovery

Terminal title, cwd, shell, dimensions, bounded scrollback, active terminal, active pane, and split layout are persisted under Electron user data. A full desktop quit necessarily ends local PTY child processes. On the next launch, terminals that were running are recreated with the same identity and configuration, and ND inserts a visible recovery marker so the UI never implies that the original OS process survived the desktop process.

## Platform support

Unix uses the requested shell, `$SHELL`, then zsh/bash/sh fallbacks. Windows uses the requested shell, `COMSPEC`, PowerShell/pwsh, then cmd. `node-pty` is rebuilt for the Electron ABI during install and ND repairs the Unix `spawn-helper` executable bit before first spawn when package extraction removed it.

## Security boundary

React never receives Node access. PTY creation, input, resizing, restart, rename, close, and layout mutation cross a main-frame-only IPC contract. The terminal is process/session isolated for ownership and workspace context; it is not itself a filesystem/security sandbox. ND's higher-level workspace and execution policies remain responsible for sandbox policy.
