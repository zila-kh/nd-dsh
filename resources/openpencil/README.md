# ND OpenPencil runtime staging

`pnpm openpencil:build` compiles the pinned `vendor/openpencil` checkout and stages a complete platform-specific Freeform runtime under `resources/openpencil/bin/`.

The generated layout is:

```text
resources/openpencil/bin/
├── op-host-web-server[.exe]
└── web-bundle/
    ├── op_host_web.js
    ├── op_host_web_bg.wasm
    ├── assets/
    └── canvaskit/
        ├── canvaskit.js
        └── canvaskit.wasm
```

The binary directory is generated and intentionally ignored by Git. Desktop packaging must copy `resources/openpencil` into Electron's `process.resourcesPath`, preserving that layout.

ND Design → Freeform resolves this bundled runtime. Normal users should never need a separate OpenPencil installation, browser extension, or PATH configuration.
