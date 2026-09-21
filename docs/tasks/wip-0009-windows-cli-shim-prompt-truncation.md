# Task 0009 — Windows `.cmd` shims truncate multi-line prompts

> PRD: [PRD-0002](../prd/0002-rust-sidecar-mvp-migration.md)  
> Priority: P1  
> Owner: ZCode/desktop  
> Branch: fix/windows-cli-shim-prompt-truncation  
> Updated: 2026-09-22  
> Found-by: task 0005 (agent-task measurement)  

## Claim status (2026-09-22)

Claimed by `ZCode/desktop` on branch `fix/windows-cli-shim-prompt-truncation`. Transport fix implemented; **2 of 5 criteria met, 2 open, 1 open for a stated residual**.

### What changed

`spawnCliCommand` (`src/main/engines/agent-cli/agent-cli-support.ts`) now resolves a `.cmd`/`.bat` shim to the node script it forwards to — a quoted `%dp0%`/`%~dp0` path ending in `.js`/`.cjs`/`.mjs` that exists on disk — and spawns `node <script> <args>` **without a shell**, removing `cmd.exe` from argument transport entirely. The interpreter mirrors the shim's own choice (a `node.exe` beside the shim, otherwise PATH `node`); deliberately not `process.execPath`, which is Electron in this process and would need `ELECTRON_RUN_AS_NODE` to act as node. Any shim that cannot be resolved falls back to the previous `cmd.exe` path unchanged.

This is fix direction 2 from the ticket, chosen because it lands at the single choke point every engine shares: `workerPrompt`/`reviewPrompt` need no change, no adapter contract changes, and `bytesToModel` keeps measuring what ND actually submitted.

### Verification

Pre-fix truncation reproduced independently, then the fix proved against the same scenario:

| Transport | What the child received |
| --- | --- |
| Pre-fix `cmd.exe /d /s /c` + `windowsVerbatimArguments` | 1 line, 30 of 104 chars — `"` and `&` stripped |
| Pre-fix without `windowsVerbatimArguments` | 6 argv entries — worse, so that is not the fix |
| Fixed: `node <script> <args>` | 104 chars, 4 lines, `"` `&` `\|` intact |

`tests/agent-cli-shim-prompt.test.ts` (3 tests, Windows-only: two assert the child's argv, one covers the non-node-shim fallback) passes. `pnpm typecheck` clean; `pnpm test` 751 passed / 8 skipped.

Criterion 2 was proved by running the identical scenario through a copy of the pre-fix `spawnCliCommand` body: promptLength 30 vs 104, lineCount 1 vs 4, `hasDoubleQuote`/`hasAmp` false vs true — every assertion the new test makes fails there.

### Still open

- Criterion 3: real `workerPrompt`/`reviewPrompt` content verified end to end through a shimmed engine needs a company run, not just a transport test.
- Criterion 4: the fix removes `cmd.exe` for node shims — the class that truncated — but a `.cmd` that is *not* a node shim still routes through `cmd.exe`, where prompt content can still be parsed as a command. No such shim was identified among the `StructuredCliAdapter` engines, so the residual is not hit today; the criterion says "ever", so it stays open rather than being claimed.

## Objective

On Windows, ND spawns a user-installed coding CLI through `spawnCliCommand` (`src/main/engines/agent-cli/agent-cli-support.ts`). An npm-style install resolves to a `.cmd` shim, and those go through `cmd.exe /d /s /c` with `windowsVerbatimArguments`. `cmd.exe` treats a newline inside an argument as a command separator, so the child receives **only the first line** of the prompt. Everything after the first `\n` is silently dropped.

ND's prompts are multi-line by construction: `workerPrompt` and `reviewPrompt` (`src/main/organization/orchestrator.ts`) are built with `\n`, and a user's chat message usually is too. So every task, review and chat turn handed to a `.cmd`-shimmed engine on Windows — OpenCode, Goose, JCode, Hermes (the `StructuredCliAdapter` engines), and any other `.cmd`-resolved binary — runs with a truncated prompt and reports success, because the CLI has no way to know something was missing.

## Evidence

Reproduced with the exact quoting `spawnCliCommand` uses, against a generated `.cmd` shim:

~~~text
exit 0
{"argvCount":6,"promptLength":70,"lineCount":1,
 "firstLine":"You are Builder acting as Software Engineer inside company Fixture Co.",
 "hasDoubleQuote":false,"hasAmp":false}
~~~

The prompt sent was four lines (~140 characters) containing a double quote and an `&`. The child saw one line, 70 characters, no quote, no ampersand: the argument was cut at the first newline and the remainder was parsed by `cmd.exe` as further commands (which is why quoting and shell metacharacters vanish too).

Observed again through the product: the agent-task fixture (`benchmarks/fixtures/agent-task-cli.mjs`, task 0005) is selected through `ND_DSH_OPENCODE_BINARY` and therefore resolved as a `.cmd` shim; the recorded result stamps `fixture.shim: "cmd-exe"` and `bytesToModel` counts the full prompt ND submitted, while the CLI itself receives only the first line. The fixture does not need the prompt, so its counters are unaffected — but a real engine would.

Not affected: direct-spawned `.exe` binaries (Codex, Claude Code, Cursor, Pi, Antigravity when their overrides point at an executable), the ND Harness path (prompt travels over the gateway), and everything on Linux/macOS, where no shim is involved.

## Fix direction

Do not teach the PTY or the prompt builder to avoid newlines; the transport is the defect. Options, in order of preference:

1. Pass the prompt out of band: write it to a temp file (or stdin) and give the CLI a `--prompt-file`-style argument, or an argv-safe encoding the adapter decodes. Requires each adapter to agree on the channel.
2. Spawn the shim's *target* directly when it can be resolved (read the `.cmd`/`.ps1` shim and exec the underlying `node` script), which removes `cmd.exe` from the path entirely. Node refuses to spawn `.cmd` without a shell, which is why the shim path exists at all.
3. As a last resort, escape newlines for `cmd.exe` so the argument survives quoting — but verify with a test that metacharacters (`"`, `&`, `|`, `^`) also survive, since the same parsing loses those.

Whichever fix lands, it needs a Windows test that sends a multi-line prompt containing quotes and `&` through the real spawn path and asserts what the child received. The bug is invisible to Linux CI by construction.

## Acceptance criteria

- [x] A multi-line prompt with quotes and shell metacharacters arrives intact at a `.cmd`-shimmed engine on Windows, demonstrated by a test that inspects the child's argv. — `tests/agent-cli-shim-prompt.test.ts`.
- [x] The same test fails on the current implementation (so the fix is proven, not assumed). — proved by running the identical scenario through a copy of the pre-fix `spawnCliCommand` body; see the claim status above.
- [ ] `workerPrompt`/`reviewPrompt` content is verified end to end for at least one shimmed engine. **OPEN** — needs a company run through a shimmed engine.
- [ ] No prompt content is ever interpreted by `cmd.exe` as a command. **OPEN (residual)** — met for node shims, which no longer touch `cmd.exe`; a non-node `.cmd` still does. See the claim status above.
- [x] If the chosen fix changes the adapter contract, every `StructuredCliAdapter` is updated together and the `bytesToModel` metric keeps measuring what ND actually submitted. — the fix does not change the adapter contract; it is entirely inside `spawnCliCommand`, which all adapters already share, and `bytesToModel` is untouched.

## Notes

- Found while measuring agent tasks; recorded here rather than fixed inside task 0005, which is measurement work. The measurement is unaffected because the offline fixture reads its scenario from the environment, not from the prompt.
- Task 0005's result document already records the transport (`fixture.shim`) so a reader of that evidence is not misled about what the engine saw.
