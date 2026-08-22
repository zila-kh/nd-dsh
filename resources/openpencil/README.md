# ND OpenPencil runtime staging

`pnpm openpencil:build` compiles the pinned `vendor/openpencil` checkout and stages the platform-specific `op-host-web-server` binary under `resources/openpencil/bin/`.

The binary directory is generated and intentionally ignored by Git. Desktop packaging must copy this `openpencil` directory into Electron's `process.resourcesPath`, producing:

```text
<app resources>/openpencil/bin/op-host-web-server[.exe]
```

ND Design → Freeform resolves this bundled runtime first. Normal users should never need a separate OpenPencil installation or PATH configuration.
