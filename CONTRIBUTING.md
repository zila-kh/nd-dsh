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

## CI triggers and the skip directive

The `ci` workflow runs on pushes to `main` and on non-draft pull requests.

A commit message containing the skip directive — `[skip ci]`, `[ci skip]`,
`[no ci]`, `[skip actions]`, or `[actions skip]` — suppresses that workflow for
pushes and for pull requests alike. GitHub matches the token anywhere in the
message, including prose in the body and inside backticks, so a commit that
merely *describes* the convention silently skips CI. That is how the 2026-09-23
`Verify ND Core` regression reached `main` unvalidated, and a pull request that
explained it in its own commit message had every run suppressed until the
message was reworded.

Two consequences worth remembering:

- A pull request that never appears in the Actions tab is usually this, not a
  broken trigger. Reword the head commit, or dispatch the workflow explicitly,
  which ignores the directive:

  ```bash
  gh workflow run ci.yml --ref <branch> -f full_benchmark=false
  ```

- Concurrency is per ref, and `cancel-in-progress` is on. Dispatching a second
  run on a branch while one is still in flight cancels the first, even when the
  two runs target different jobs. Wait for the running job, or dispatch on
  another ref.
