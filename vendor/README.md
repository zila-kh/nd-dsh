# Vendored upstreams

ND-DSH pins runtime/design engines as Git submodules so product code can target tested upstream revisions without copying their cores into the ND control plane.

## DeepSeek Harness

- repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- commit: `141eb6fef83422698aef7a981029e843e8161534`
- release at that commit: `0.1.0-rc.8`
- metadata: `deepseek-harness.json`

DeepSeek Harness is ND's pinned agent runtime adapter.

## OpenPencil

- repository: `https://github.com/ZSeven-W/openpencil.git`
- commit: `9c810776dab546076a5d9db791a49d9e8048dbd7`
- release at that commit: `0.8.4`
- license: MIT
- metadata: `openpencil.json`
- license notice: `openpencil.LICENSE`

OpenPencil is the embedded engine for **Design → Freeform**. ND owns the shell, project/workspace lifecycle, save/conflict behavior, and distribution. Normal users do not install OpenPencil separately; release builds stage the tested `op-host-web-server` runtime with ND. In a source checkout run `corepack pnpm openpencil:build` to compile and stage the local development runtime.

Run `corepack pnpm bootstrap` from the repository root. Bootstrap supports both a Git checkout and a downloaded source archive. Pass `--build-openpencil` when you also want the Freeform runtime compiled during bootstrap.
