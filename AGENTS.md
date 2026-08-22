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
- Run `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before publishing changes.
