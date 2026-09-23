# Todo 0017 — `pnpm test` intermittently fails in worktree teardown on Windows

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)
> Priority: P2
> Owner: test infrastructure
> Status: todo — found while running the local gate on 2026-09-23, not yet reproduced on demand
> Updated: 2026-09-23

## What happens

Running the full suite (`corepack pnpm test`) on the Windows reference machine intermittently ends with two failures in `tests/task-worktree.test.ts`, both at teardown rather than in an assertion:

~~~text
FAIL  tests/task-worktree.test.ts > TaskWorktreeManager > keeps five independent writable tasks rollbackable without touching peers or the base checkout
Error: EBUSY: resource busy or locked, rmdir 'C:\Users\…\Temp\nd-worktree-sBFQMv\.nd-dsh-worktrees\b816c7533941\parallel-task-3-6979be38'
~~~

The same file passes on its own and the same tests passed their own assertions in the failing run; the suite went green on the next full run with no code change. Observed once in three consecutive full-suite runs, so it is a race under parallel load rather than a deterministic defect.

## Why it matters

Local gates are the only validation while GitHub Actions is parked as `.github-bk/`. A gate that is red for reasons unrelated to the change under test trains everyone to re-run until green, which is exactly the habit that lets a real failure through — the failure mode [done-0013](done/done-0013-windows-timing-flakes.md) removed for the Rust suite.

## What is known

- Teardown is `afterEach(() => rm(path, { recursive: true, force: true }))` over `%TEMP%` directories (`tests/task-worktree.test.ts:12`). `force` covers `ENOENT`, not `EBUSY`.
- The locked path is inside a task worktree, so the holder is almost certainly a Git child process the worktree manager spawned for that task; the suites that create and roll back five parallel worktrees spawn the most of them.
- Vitest runs test files concurrently, so the lock does not need to come from this file's own child.

## What is not known

- Whether the handle belongs to a Git process the product failed to await, or to an anti-malware scanner holding the freshly written files. That distinction decides whether the fix belongs in the product's process handling or only in the test.

## Direction (not decided)

- Close or await the spawned Git handles before removing a worktree, if the handle turns out to be the product's.
- A bounded retry on `EBUSY` in the test's teardown helper. Worth stating explicitly: a retry here is not a threshold relaxation, because no budget is being measured — but it does hide the symptom, so it is the fallback rather than the first choice.
- Serializing the worktree specs if neither of the above is enough.

## How to reproduce

`corepack pnpm test` (full suite, concurrent files) on Windows; `corepack pnpm vitest run tests/task-worktree.test.ts` passes.
