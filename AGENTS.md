# ND-DSH contributor guidance

- ND owns the product control plane: companies, projects, roles, agents, tasks, skills, memory, policies, provider routes, and coding-engine contracts.
- Keep DeepSeek Harness as an upstream-tracking runtime submodule/adapter (sync to latest at bootstrap or via `dsh:update`; no frozen commit pins during beta). Do not copy or patch its core into this repository.
- Treat DeepSeek as a model-provider compatibility route, not ND product identity.
- Treat Codex and future coding products as replaceable engine adapters. Do not leak engine-specific branching into organization-domain state machines.
- The embedded `WebContentsView` is the canonical browser. Never launch a hidden automation browser for agent tasks.
- Browser tools must share `ND_DSH_AGENT_BROWSER_CONFIG` and `ND_DSH_AGENT_BROWSER_SESSION`.
- Preserve context isolation, renderer sandboxing, loopback-only CDP, and workspace-scoped runtime policies.
- Never substitute mock companies, fake sessions, or demo workspaces in the production renderer when the trusted preload is unavailable; fail closed instead.
- Add desktop capabilities through narrow IPC contracts or engine adapters; do not expose Node directly to React.
- **ND Pencil** is ND's native Freeform design surface and product identity. Normal product UI, IPC names, runtime staging, settings, errors, and documentation must say ND Pencil, not OpenPencil.
- `vendor/openpencil` is pinned MIT-licensed upstream implementation source for ND Pencil only. Preserve the upstream notice in `vendor/openpencil.LICENSE` and the tested pin in `vendor/openpencil.json`; upstream branding may appear only in provenance/legal/source-integration contexts where attribution is useful or required.
- Do not expose upstream account/login, team/collaboration, cloud tenancy, built-in AI/provider configuration, update/billing, or standalone-app workflows through ND Pencil. ND owns identity, agents, projects, workspace, provider routing, and distribution.
- Normal ND users must not install OpenPencil separately or configure PATH. Production discovery is ND-bundled `resources/nd-pencil`; `ND_PENCIL_BINARY` is a developer override only.
- Treat `.op` files as Freeform design artifacts, not production application source. Building a Freeform concept must target the active project's real HTML/React/shadcn/native source and remain visible as a normal Git diff.
- Keep the embedded ND Pencil child view sandboxed and context-isolated. Its managed engine must bind to loopback only, use the per-instance token/allowed-origin contract, deny popups/permissions, and block upstream authentication, collaboration, and built-in AI network routes.
- ND Agent should manipulate an open Freeform document through ND Pencil's controlled editor/MCP bridge rather than writing the `.op` JSON concurrently through generic filesystem tools.
- Run `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before publishing changes.
