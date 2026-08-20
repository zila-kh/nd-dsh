# Contributing

Use Node 24 and pnpm 11.7. Run `corepack pnpm bootstrap` once, then develop with
`corepack pnpm dev`.

Before submitting changes:

```bash
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Keep commits focused. Upstream dependency bumps must use
`corepack pnpm run dsh:update -- <tag-or-commit>`, identify the exact resulting
SHA, explain adapter or Cordis changes, and preserve the same-browser invariant.
