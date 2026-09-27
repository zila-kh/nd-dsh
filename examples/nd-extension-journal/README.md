# Journal Example — a minimal ND extension package

One `nd-extension.json` and one README. It contributes:

- **Add journal entry** — a command that runs the allowlisted `note.create` host
  method in whichever context the launcher is set to (Personal or a company).
- **Journal entries** — a typed list view backed by `note.search`, with
  declared per-row actions (`note.open`, `note.delete`).
- **Journal prompt** — a nonsecret setting with a default that a context may
  override.

It contains no executable code, so installation cannot run anything.

## Validate

```bash
node scripts/validate-nd-extension.mjs examples/nd-extension-journal
```

The CLI executes the same validation rules as the runtime installer.

## Install and use

1. ND → Settings → **Extensions** → **Install from folder** → pick this folder.
2. Activate it for Personal, a company, or a project (activation is per
   context; installation alone grants nothing).
3. Open the launcher (`Ctrl+Shift+Space` or `Ctrl/Cmd+K`) and run
   **Add journal entry**, or open **Journal entries** from the Extensions card.

## Distribution notes

- Install from a local folder or a private Git checkout. Never put credentials
  in the manifest: an MCP runtime declares `env` entries as
  `{ "CHILD_VAR": "PARENT_ENV_VAR" }` names, and ND resolves the value at
  execution time.
- Packages ship prebuilt. ND never runs `npm install` or build scripts during
  installation; build dependencies before installing.
- Updates snapshot a new version and keep the previous one for rollback.
