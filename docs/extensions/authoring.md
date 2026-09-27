# Authoring ND extensions

Status: **v1 platform, implemented locally 2026-09-27 (PRD 0006)**. Public
marketplace publishing, arbitrary HTML/React panels, and an OS sandbox for
external executables are explicitly out of scope for v1.

An ND extension is one folder with an `nd-extension.json` manifest. It
contributes **tools, skills, commands, views, and workflows** that ND renders
and executes inside its own trusted surfaces. Extensions never inject renderer
code, and contributions only reach the allowlisted ND host methods listed in
[ND_HOST_METHODS](../src/shared/extension-package.ts).

Launcher commands from installed/activated extensions are adapted into the same
ND Command Registry as core, company, and project commands. Extension authors
do not register launcher code or React components; they contribute command data
and the broker remains the execution boundary.

## 1. Manifest

Start from [`examples/nd-extension-journal`](../examples/nd-extension-journal)
and the JSON Schema at [`schema/nd-extension.schema.json`](../schema/nd-extension.schema.json).

```json
{
  "protocol": "nd.extension/1",
  "id": "com.example.standup",
  "name": "Standup Notes",
  "description": "Collect standup notes as ND notes.",
  "version": "1.0.0",
  "apiVersion": 1,
  "contexts": ["personal", "company"],
  "permissions": ["notes.read", "notes.write"],
  "settings": [{ "key": "template", "title": "Note template", "type": "string", "default": "Today: " }],
  "contributions": {
    "commands": [
      { "id": "standup-add", "title": "Add standup note", "host": "note.create", "keywords": ["standup"] }
    ],
    "views": [
      { "id": "standup-notes", "title": "Standup notes", "kind": "list", "host": "note.search",
        "itemTitleKey": "title", "itemBodyKey": "body",
        "actions": [{ "id": "open", "title": "Open", "host": "note.open" }] }
    ]
  }
}
```

Rules the validator enforces (all of them, with actionable messages):

- `protocol` must be `nd.extension/1` and `apiVersion` must be `1`.
- Contexts are `personal`, `company`, and `project`. A contribution may narrow
  the package's `contexts` but never widen them.
- Contribution ids are unique inside the package.
- Every host method used must appear in the allowlist, and the permission it
  needs must be declared in `permissions`.
- Tool contributions require an `executable` (`mcp-stdio`) runtime. `env` maps
  child variable names to **parent environment-variable names** — secret values
  in a manifest are rejected.

## 2. Environments and contexts

There is no separate development runtime: extensions run against the same
manifests, the same validator, and the same invocation broker in development
and in the product.

- **Installation is global to your ND profile.** It is availability, not data
  access.
- **Activation is per context** (Personal, a company, or a project). A
  project-only package is unavailable in Personal, and vice versa.
- **Every invocation carries exactly one context.** ND derives actor,
  company/project membership, engine/provider identity, and workspace from
  trusted records; a contribution cannot widen its own authority, and IDs
  supplied by a caller are validated against organization state.

## 3. The host methods v1 exposes

| Method | Permission | What it does |
| --- | --- | --- |
| `note.create` | `notes.write` | Save the note text in the selected context (Personal → ND Home, company/project → organization memory) |
| `note.search` | `notes.read` | List/search notes in the selected context |
| `note.open` / `note.delete` | `notes.read` / `notes.write` | Read or delete a note (personal notes only for delete, v1) |
| `capture.screen` | `capture.screen` | Capture a display (display under the pointer by default) and store it locally |
| `capture.area` | `capture.area` | Capture the rectangle the user selected in the ND overlay |
| `capture.list` / `capture.copy` / `capture.export` | `capture.read` | List captures, copy one to the clipboard, or export it through a save dialog |
| `clipboard.read` | `clipboard.read` | One explicit read that also saves the text as a note |
| `clipboard.write` | `clipboard.write` | Write text to the clipboard |
| `browser.openUrl` / `browser.search` | `browser.navigate` | Navigate the visible embedded ND browser |
| `browser.openExternal` | `browser.openExternal` | Open an http(s) URL in the system browser |
| `os.openTarget` | `os.launch` | Pick and open an app, file, or folder (user selection only; no shell strings) |
| `os.wallpaper.chooseAndSet` | `os.wallpaper.write` | Pick an image in an ND-owned native dialog and set it as the host desktop wallpaper; Personal only |
| `chat.ask` | `chat.start` | Start an ND chat/agent turn from typed text |
| `workflow.list` / `workflow.refresh` | `workflow.read` | Read (or refresh) the project's repository task board through the existing read-only mirror |

Views are described, not coded: `host` loads the rows, `itemTitleKey` /
`itemBodyKey` name the fields to render, and `actions` run through the same
broker with the same authorization checks.

## 4. Permissions, grants, and approval

- Declared permissions are a ceiling; activation is a second switch; a grant is
  the third.
- A **user** invocation is authorized by the explicit gesture (typing a command
  and running it, clicking a capture button, selecting an app in a picker).
- An **agent** invocation arrives through an opaque run credential bound to one
  context, engine, and permitted capability set. Sensitive reads
  (`capture.screen`, `capture.area`, `clipboard.read`) and sensitive OS effects
  such as `os.wallpaper.chooseAndSet` always require an explicit grant — remembered
  for routine use or granted once per action.
- Deny wins everywhere: an organization policy of `deny` blocks the action even
  for the user, and revoked grants, disabled activations, stale credentials, and
  cross-context calls fail closed.
- ND logs decision metadata (extension, host, context, caller, outcome) and
  never clipboard contents, screenshots, credentials, or run tokens.

## 5. Distribution and lifecycle

- **Validate**: `node scripts/validate-nd-extension.mjs <folder>`
- **Install**: Settings → Extensions → *Install from folder*, or hand a teammate
  a private Git checkout and install from that working copy.
- Packages ship **prebuilt**. ND snapshots content, records source provenance
  (including the resolved Git revision when available), and never runs
  `npm install`, `postinstall`, or build scripts.
- **Update** installs a new version only after it validates and permission
  review; **rollback** returns to the previous version; **uninstall** revokes
  activation and grants while leaving your notes and captures untouched.
- Symbolic links inside a package are rejected, because a link can escape the
  package root.

## 6. What v1 deliberately does not support

- Arbitrary extension HTML/React panels or renderer DOM access.
- Executable lifecycle hooks; instruction-only hooks remain instructions.
- A second general-purpose JavaScript runtime, or running Raycast/VS Code
  packages unchanged.
- An OS sandbox for external MCP executables: they run with your desktop user's
  OS permissions, which activation details say explicitly. Executable trust is
  separate from ND API grants.
- Public marketplace publishing, review, billing, and automatic updates.

## 7. Example: the ND-maintained packages

`Daily Essentials`, `Wallpaper Manager`, and `Project Workflow` ship with ND and
use exactly these contracts. Wallpaper Manager is the first native-host proving
package: it is Personal-only, permission-scoped, and uses the same manifest path
as the user-authored example in `examples/nd-extension-wallpaper`. Validate the
built-ins any time with:

```bash
node scripts/validate-nd-extension.mjs --builtins
```
