# ND Pencil runtime staging

`pnpm nd-pencil:build` compiles the pinned MIT upstream editor implementation and stages the platform-specific ND Pencil runtime under `resources/nd-pencil/bin/`.

Desktop packaging must copy this `nd-pencil` directory into Electron's `process.resourcesPath`, producing:

```text
<app resources>/nd-pencil/
├── LICENSE.openpencil
└── bin/
    ├── op-host-web-server[.exe]
    └── web-bundle/
```

The upstream executable name is an implementation detail. Product UI, settings and runtime discovery expose only **ND Pencil**. Account/login, team/collaboration, upstream AI/provider UI and cloud/standalone workflows are not part of ND Pencil.

Normal users never install OpenPencil separately and never configure PATH. The tracked `LICENSE.openpencil` notice ships because ND Pencil currently derives substantial engine code from that MIT-licensed upstream project.
