# Vendored upstreams

`deepseek-harness` is a Git submodule pinned by this project to:

- repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- commit: `141eb6fef83422698aef7a981029e843e8161534`
- release at that commit: `0.1.0-rc.8`

The canonical machine-readable metadata is `deepseek-harness.json`. The root
bootstrap and verification scripts read that file; a real Git checkout also
stores the same SHA as the submodule gitlink.

Run `corepack pnpm bootstrap` from the repository root. Bootstrap supports both
a Git checkout and a downloaded source archive.
