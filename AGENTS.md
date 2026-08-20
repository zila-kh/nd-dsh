# ND-DSH contributor guidance

- Keep DeepSeek Harness as a pinned submodule. Do not copy or patch its core into this repository.
- The embedded `WebContentsView` is the canonical browser. Never launch a hidden automation browser for agent tasks.
- Browser tools must share `ND_DSH_AGENT_BROWSER_CONFIG` and `ND_DSH_AGENT_BROWSER_SESSION`.
- Preserve context isolation, renderer sandboxing, loopback-only CDP, and workspace-scoped DSH policies.
- Add IDE features through narrow IPC contracts or Harness plugins; do not expose Node directly to React.
- Run `pnpm verify`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before publishing changes.
