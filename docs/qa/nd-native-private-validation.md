# ND Agent private selection validation

This is the executable handoff for `codex/nd-native-private-milestone`. It does not convert private evidence into a public release claim.

## 1. Code gates

Run from a clean checkout:

```powershell
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test:engines
corepack pnpm test
corepack pnpm core:test
corepack pnpm build
node scripts/verify-release.mjs --config-only
git diff --check
```

The focused native coverage includes workspace-bound tool brokerage, atomic write/path containment, cancel-aware provider streaming, Token Saver compaction/bounded history, and the private selection gate.

## 2. Enable private selection

PowerShell:

```powershell
$env:ND_DSH_NATIVE_PRIVATE_SELECTION = "1"
corepack pnpm dev
```

This flag is intentionally required. Without it, `nd-native` remains unavailable even when the binary exists.

## 3. Same-project engine matrix

Use one disposable real project and the same provider/model where possible.

| Journey | ND Harness | ND Agent |
| --- | --- | --- |
| Read + explain file | record | record |
| Atomic edit existing file | record | record |
| Create file in existing directory | record | record |
| Git status/diff/add | record | record |
| Visible-browser navigate/read | record | record |
| Explicit skill invocation | record | record |
| Governed extension call | record | record |
| Cancel live provider turn | record | record |
| Restart and continue session | record | record |

Capture completion/failure, wall time, provider/model, input/output usage, and tool-call count. Do not treat the current Harness `0.1.7-rc.2` first-turn hang as a valid comparative baseline until it is separately resolved.

## 4. Failure drills

- Interrupt ND Core after an effect intent and before receipt; restart and verify the effect is marked `uncertain` and not replayed.
- Try `../`, absolute paths, missing write parent directories, and a symlink/junction escape.
- Request an unsupported Git operation and `nd_shell`; both must fail closed.
- Exercise an extension contribution that requires approval. Approval/grant state must come from the existing InvocationBroker.
- Cancel while the provider is connected but has not produced a response chunk.

## 5. Packaged gate

Build the exact Windows portable artifact, enable the private flag only for the validation run, and repeat startup, one edit/browser journey, cancellation, restart continuation, and old Harness chat continuation. Record the artifact hash and results before changing any release/default selection policy.
