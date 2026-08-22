# Vendored upstreams

ND-DSH pins implementation/runtime upstreams as Git submodules so product code can target tested revisions without mixing third-party product identity into the ND control plane.

## DeepSeek Harness

- repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- commit: `141eb6fef83422698aef7a981029e843e8161534`
- release at that commit: `0.1.0-rc.8`
- metadata: `deepseek-harness.json`

DeepSeek Harness is ND's pinned agent runtime adapter.

## ND Pencil upstream implementation

ND Pencil is ND's native **Design → Freeform** product surface. Its current low-level editor/runtime implementation is derived from the MIT-licensed OpenPencil project pinned here:

- upstream repository: `https://github.com/ZSeven-W/openpencil.git`
- commit: `9c810776dab546076a5d9db791a49d9e8048dbd7`
- release at that commit: `0.8.4`
- license: MIT
- metadata/provenance: `openpencil.json`
- required upstream notice: `openpencil.LICENSE`

The upstream checkout is implementation source, not a second product inside ND. ND owns the Freeform UI, active project/workspace, document lifecycle, agent bridge, provider routing, security policy and distribution. Account/login, teams/collaboration, cloud tenancy, upstream AI/provider settings, updates/billing and standalone-app workflows are not part of ND Pencil.

Normal users install only ND. Release builds stage the tested local engine under `resources/nd-pencil`; ND never requires an external OpenPencil install or PATH entry. In a source checkout run `corepack pnpm nd-pencil:build` to compile and stage the development runtime.

Run `corepack pnpm bootstrap` from the repository root. Bootstrap supports both a Git checkout and a downloaded source archive. Pass `--build-nd-pencil` when you also want the Freeform runtime compiled during bootstrap.
