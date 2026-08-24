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

Keep commits focused. Harness runtime syncs use
`corepack pnpm run dsh:update` (upstream latest by default; an explicit
tag-or-commit is available for debugging or downgrades). Explain adapter or
Cordis changes in the commit and preserve the same-browser invariant.
