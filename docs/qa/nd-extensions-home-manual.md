# ND Extensions & ND Home — validation gate

> `examples/nd-extension-journal` is not in this tree. Use [`examples/extension-counter`](../../examples/extension-counter) for a local package sample. Current release status: [release-0.0.1-checklist.md](../plan/release-0.0.1-checklist.md).

Status: implementation complete locally 2026-09-27 (PRD 0006, tasks 0035–0043);
automated layers recorded below; manual layer pending the operator run.
Branch: `feat/quick-launcher-capture`

Scope: extension packages (`nd.extension/1`), context activation and grants, the
shared invocation broker, ND Home personal notes/captures/chats, the launcher
context selector, the Extensions management surface, and the two ND-maintained
packages (Daily Essentials, Project Workflow).

## Release rule

**READY** means: Layer 1 and Layer 2 are green on one clean run, and every P0
manual row below passes. P1 issues may ship only when they do not hide or weaken
a P0 behaviour. Record real outcomes — never convert a skip into a pass.

## Layer 1 — unit and integration (authoritative locally)

```bash
pnpm typecheck
pnpm vitest run tests/nd-extension-package.test.ts tests/nd-extension-lifecycle.test.ts tests/nd-invocation-broker.test.ts tests/harness-session-scope.test.ts
pnpm ext:validate --builtins
pnpm ext:validate examples/nd-extension-journal
```

| Suite | Covers |
| --- | --- |
| `nd-extension-package.test.ts` | Context contract, built-in manifests, protocol/apiVersion/permission/host-method rejection, context widening, duplicate ids, executable + env-reference rules |
| `nd-extension-lifecycle.test.ts` | Install snapshot + provenance, no script execution, invalid manifest, symlink rejection, update/previous version/rollback, reload from disk; Home notes/captures/chats, managed per-chat folder, corrupt-record quarantine |
| `nd-invocation-broker.test.ts` | Activation gating, context support, company/project mismatch, deny-wins org policy, agent grant + approval + one-shot consumption, remembered grant + revocation, run-credential context/capability binding, expiry, content-free audit, view actions |
| `harness-session-scope.test.ts` | ND Home personal chats stay listed outside the active workspace |

Negative-case probe for the SDK CLI:

```bash
node scripts/validate-nd-extension.mjs /tmp/bad-nd-extension.json   # exits 1 with actionable issues
```

## Layer 2 — Electron end-to-end

```bash
pnpm build
pnpm e2e -- e2e/nd-home-extensions.spec.ts
```

| ID | Journey | Assertion |
| --- | --- | --- |
| E2E-01 | Fresh profile → Home | ND Home renders with zero companies; a note saves and lists |
| E2E-02 | Launcher (Ctrl/Cmd+K) | Context selector shows Personal active; typing a note saves it to ND Home |
| E2E-03 | Extensions surface | Daily Essentials and Project Workflow are installed; Daily Essentials is active for Personal |
| E2E-04 | Project scoping | Project Workflow commands are absent in Personal, absent before activation in the project, present after activation, and never appear back in Personal |
| E2E-05 | Whole spec | No renderer `pageerror` or console error |

## Layer 3 — manual (operator)

Run the built app (`pnpm dev` or the packaged build) and record each row.

### P0

| ID | Test | Steps | Expected |
| --- | --- | --- | --- |
| M-01 | Personal note, zero companies | Home → write → Save | Note appears instantly; Reveal storage opens ND-managed folder |
| M-02 | Launcher context defaults to Personal | With a company+project active, press `Ctrl+Shift+Space` | Popup opens with Personal selected, even though a project is current |
| M-03 | Launcher personal note | Popup → type note → Quick note | Saved to ND Home; popup hides; no company data touched |
| M-04 | Capture screen (local-first) | Home → Capture screen | No model request; capture appears in Captures; nothing leaves the machine |
| M-05 | Capture area | Home → Capture area → drag region → Capture Area | Region saved locally; cancel stores nothing |
| M-06 | Capture actions | Open a capture → Copy / Export / Ask ND | Copy fills the clipboard; Export writes a PNG; Ask ND is the only path that sends the image to a model |
| M-07 | Open Google / website | Launcher → Open Google (or type a URL) | Embedded ND browser navigates visibly; no hidden automation browser |
| M-08 | Open externally | Launcher → Open in system browser with a URL | Default browser opens; app does not navigate internally |
| M-09 | Open app/file/folder | Launcher → Open app, file, or folder | Native picker; chosen target opens; cancel does nothing |
| M-10 | Personal chat | Home → Ask | Chat starts in the Agent view bound to Personal with a managed per-chat folder; survives restart and company switching |
| M-11 | Project context gating | Launcher → switch context to Company · Project | Project Workflow command appears; switching back to Personal removes it |
| M-12 | Repository tasks view | Settings → Extensions → Project Workflow → Open Repository tasks | Read-only rows for the bound project; no mutation, no check execution |
| M-13 | Activation toggle | Deactivate Daily Essentials for Personal | Launcher no longer offers its commands; no error dialogs |
| M-14 | Install from folder | Settings → Extensions → Install from folder → `examples/nd-extension-journal` | Installs with provenance; commands appear only after activation |
| M-15 | No script execution | Install a folder whose package.json has a postinstall marker | Marker file is never created |
| M-16 | Update + rollback | Bump the example to 1.1.0, Update, then Rollback | Version switches; settings survive; previous version usable |
| M-17 | Uninstall | Uninstall the example package | Commands disappear; personal notes/captures remain |
| M-18 | Restart durability | Restart ND | Activations, grants, notes, captures, and chat bindings persist |
| M-19 | No leaks in logs | Inspect `%APPDATA%/nd-dsh/logs` after captures/clipboard | No clipboard text, screenshot bytes, or tokens recorded |
| M-20 | Quit cleanly | Use popup/capture/extension commands, then quit | No orphan ND/Electron/capture process (see the launcher gate for the process checks) |

### P1 — polish

| ID | Test | Expected |
| --- | --- | --- |
| M-21 | Multi-monitor area capture with mixed DPI | Selected region matches what was dragged; display label correct |
| M-22 | Empty clipboard | Clear, actionable message; no empty note |
| M-23 | Invalid URL | Clear validation error; nothing opens |
| M-24 | Unavailable model / provider unset | Personal chat shows setup guidance without inventing company data |
| M-25 | Denied organization policy | A `deny` policy for a host action blocks it with a plain-language reason |

## Results

```
Layer 1 unit/typecheck: PASS — pnpm typecheck green; new platform suites 39/39
  (package 11, lifecycle 11, broker 12, session-scope 5); SDK CLI validates the
  example and both built-ins and exits 1 on an invalid manifest.
  Full suite: 915 passed / 1 failed / 8 skipped (121 files). The single failure
  is tests/real-world-autonomous-loop.test.ts asserting LF content after a Git
  merge while this machine sets core.autocrlf=true — reproduced in isolation,
  and green (2/2) with core.autocrlf=false. Pre-existing, unrelated to PRD 0006.
Layer 2 Electron E2E: PASS — e2e/nd-home-extensions.spec.ts 3/3 and the existing
  e2e/quick-launcher.spec.ts 4/4 against a fresh `pnpm build`. Playwright still
  reports its known Windows worker-teardown watchdog after all tests pass; the
  per-test counts are the signal (see the teardown-watchdog note).
Layer 3 manual P0: __ / 20 PASS (operator run pending)
Layer 3 manual P1: __ / 5 PASS (operator run pending)
Renderer errors: 0 (both E2E specs assert zero pageerror/console errors)
Orphan processes after quit: not re-measured here; the launcher gate covers it
Blockers:
Evidence location:
```

### Behaviour deliberately changed by this work

- **In-app launcher context.** `Ctrl/Cmd+K` opens on the current company/project
  context; the OS-shortcut popup always opens on Personal. Both surfaces show a
  persistent context selector, and task/note writes follow the selector, never
  the window's active project. The launcher spec was updated to this contract.
- **Extensions surface.** Settings → *Plugins* is now labelled *Extensions*
  (route id unchanged), with packages, versions/rollback, per-context
  activation, settings, grants, pending approvals, and the decision log above
  the agent-capability catalog.

## Recorded limitations (v1, deliberate)

- **Agent-initiated extension calls are enforced but not yet reachable from a
  coding engine.** The broker mints opaque run credentials bound to context,
  engine, and permitted capabilities; sensitive reads (screen, clipboard) always
  require a grant or a fresh approval, and the rules are unit-tested. Wiring an
  external MCP child process to that broker (via the ND gateway bridge) is a
  follow-up task; until it lands, agent-side callers cannot reach ND native host
  methods in a built app.
- Area capture interprets the dragged rectangle on the display under the
  pointer; very large virtual desktops spanning several monitors are not yet
  split per display for area capture (screen capture does select the display
  under the pointer).
- Company/project notes can be created and read through the broker, but deletion
  stays in the Company workspace (the organization store exposes no memory
  removal mutation).
- Built-in packages are ND-maintained and cannot be uninstalled — only
  deactivated per context.
