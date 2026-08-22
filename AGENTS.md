# ND-DSH contributor guidance

- ND owns the product control plane: companies, projects, roles, agents, tasks, skills, memory, policies, provider routes, and coding-engine contracts.
- Keep DeepSeek Harness as a pinned runtime submodule/adapter. Do not copy or patch its core into this repository.
- Treat DeepSeek as a model-provider compatibility route, not ND product identity.
- Treat Codex and future coding products as replaceable engine adapters. Do not leak engine-specific branching into organization-domain state machines.
- The embedded `WebContentsView` is the canonical browser. Never launch a hidden automation browser for agent tasks.
- Browser tools must share `ND_DSH_AGENT_BROWSER_CONFIG` and `ND_DSH_AGENT_BROWSER_SESSION`.
- Preserve context isolation, renderer sandboxing, loopback-only CDP, and workspace-scoped runtime policies.
- Never substitute mock companies, fake sessions, or demo workspaces in the production renderer when the trusted preload is unavailable; fail closed instead.
- Add desktop capabilities through narrow IPC contracts or engine adapters; do not expose Node directly to React.
- OpenPencil is a pinned MIT-licensed design-engine submodule under `vendor/openpencil`. Keep the upstream license notice in `vendor/openpencil.LICENSE` and the tested pin in `vendor/openpencil.json`.
- ND owns the Freeform UX, active-project/workspace binding, save/conflict lifecycle, IPC surface, and distribution. Normal ND users must not be required to install OpenPencil separately or configure PATH; production discovery is ND-bundled runtime only, with `ND_OPENPENCIL_BINARY` reserved as a developer override.
- Treat `.op` files as Freeform design artifacts, not production application source. Building a Freeform concept must target the active project's real HTML/React/shadcn/native source and remain visible as a normal Git diff.
- Keep the embedded OpenPencil child view sandboxed and context-isolated. Its managed daemon must bind to loopback only, use the per-instance token/allowed-origin contract, and never receive arbitrary privileged renderer IPC.
- Run `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before publishing changes.
