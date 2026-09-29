---
id: "0008"
title: "Command Registry and Governed Native Extensions"
status: in-progress
created: 2026-09-27
---

# PRD 0008 — Command Registry and Governed Native Extensions

## 1. Product outcome

Take the useful architectural idea from launcher platforms such as Magibar — independent command sources feeding one searchable surface — without turning ND into an unrestricted plugin host.

ND gets one **Command Registry** that merges commands from:

- typed/core actions;
- context switching;
- capture and launcher utilities;
- ND Extensions;
- recent projects;
- companies.

The same registry drives both the in-app launcher and the global popup because both render the same `QuickLauncher` component.

ND Extensions remain data/manifest contributions. A third-party extension does **not** register arbitrary React, Electron, Node, or shell code into the launcher.

## 2. ActionSource-style command model

```text
Core source ───────────┐
Context source ────────┤
Capture source ────────┤
Extension source ──────┼──> ND Command Registry ──> Launcher / Popup
Project source ────────┤
Company source ────────┘
```

Each source contributes the same command descriptor: identity, source, group, icon, title, search text, optional shortcut and a bounded action.

Source ids must be unique. Ordering belongs to the registry, not to scattered JSX sections.

The extension source adapts already-authorized `NdCommandView` records from the PRD 0006 broker. This means an installed extension automatically becomes searchable without changing launcher code.

## 3. First native capability: wallpaper

Add one narrow capability:

- permission: `os.wallpaper.write`
- host method: `os.wallpaper.chooseAndSet`
- context ceiling: **Personal only**
- agent classification: **sensitive**, therefore explicit approval is required

The command is proven by the built-in **Wallpaper Manager** package and by a user-authored example manifest in `examples/nd-extension-wallpaper`.

## 4. Security boundary

The extension never receives or supplies the wallpaper file path.

```text
Extension command
      ↓
Invocation Broker
      ↓
permission + activation + context + policy
      ↓
ND-owned native file picker
      ↓
trusted wallpaper adapter
      ↓
host OS
```

Platform execution uses fixed binaries with `execFile`, never a shell:

- Windows: fixed Windows PowerShell executable; the selected path is passed only through a process environment variable.
- macOS: fixed `/usr/bin/osascript`; the selected path is passed only through a process environment variable.
- Linux: GNOME `gsettings` with a file URI as an argument; the dark-background key is best effort.

Unsupported platforms fail closed.

Host-method context ceilings are validated at install time **and re-checked at invocation time**, so a malformed or stale package cannot expose a Personal-only OS capability to Company/Project contexts.

## 5. User-created native extensions

Any local package may declare the allowlisted wallpaper host method with the required permission and Personal context. It then appears through the same extension command source after installation/activation.

This is the intended extension path:

```text
General user
  → create/install extension
  → manifest declares command + permission
  → command appears in launcher

Coding user
  → open/edit the same extension source
  → validate package
  → reinstall/update
```

No separate "coding extension" format exists.

## 6. Deferred native contributions

This slice deliberately does not add:

- arbitrary native executable authority;
- arbitrary renderer panels;
- widgets;
- window management;
- process termination;
- desktop file organization;
- background wallpaper rotation/scheduling;
- Raycast-compatible runtime execution.

Those should reuse the same command/contribution registry and capability broker when their contracts are separately reviewed.
