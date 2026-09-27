# Local Agent Handoff — General/Coding + Command Registry + Native Extensions

## Repository

- Repository: https://github.com/zila-kh/nd-dsh
- Merge order:
  1. PR #58 — `feat/general-coding-workspace-profile` → `main`
  2. PR #59 — `feat/magibar-command-native-extensions` → `feat/general-coding-workspace-profile`, then retarget to `main` after #58 lands
- PR #58 implementation head at handoff authoring: `f7f2bf9f178db4103435c935fc43bd61acf8ef1a`
- PR #58 base/main head at handoff authoring: `56b48a35fbf938fe0a16b234d4894903eab26610`
- PR #58 ahead/behind at handoff authoring: `19/0`
- PR #59 implementation head before this handoff-only documentation commit: `029d8429a92f76b9435635292a8087a74087c4c9`
- PR #59 base head at handoff authoring: `f7f2bf9f178db4103435c935fc43bd61acf8ef1a`
- PR #59 ahead/behind its stacked base at handoff authoring: `41/0`
- Both PRs were open, Draft, and GitHub reported them mergeable/clean before this handoff file was added.
- Important: this handoff commit advances PR #59 HEAD. Record actual SHAs from the checkout before validating.

## Mission

Finish executable and desktop validation for the two stacked slices without reopening the architecture unless a concrete defect is demonstrated.

PR #58 broadens ND from coding-only entry behavior into two human-facing workspace profiles:

- **General** for everyday AI work and non-coding users.
- **Coding** for General plus developer-specific surfaces such as ND/DSH, QA, and Git controls.

PR #59 applies the useful Magibar/Raycast-style source-registry idea to ND while retaining ND's stricter extension trust boundary:

- one ActionSource-style ND Command Registry;
- core/context/capture/extension/project/company command sources;
- the first governed native OS capability;
- a built-in and user-authored wallpaper extension proof.

Implementation and static review are complete. Local execution and real desktop behavior are the remaining evidence gates.

## Critical rules

- Never work directly on `main`.
- Do not merge either PR merely because source inspection looks correct.
- Validate and merge **#58 before #59**.
- Fix PR #58 defects on `feat/general-coding-workspace-profile`. After any parent fix, update the child branch before validating #59.
- Fix PR #59-only defects on `feat/magibar-command-native-extensions`.
- Do not enable or restore noisy GitHub Actions as part of this handoff.
- Do not force-push unless the operator explicitly requests it.
- General/Coding is presentation/authoring scope, **not execution state**. Switching profiles must not pause, stop, cancel, restart, or mutate running companies/tasks/agents/schedules/extensions.
- Existing ND/DSH remains a Coding-only surface selector; it is not the General/Coding profile control.
- Extension packages never gain arbitrary Electron, renderer DOM, Node, child-process, shell, or native-addon authority from this work.
- Extension command contributions remain manifest data. Execution stays behind the Invocation Broker and allowlisted Native Host API.
- `os.wallpaper.chooseAndSet` is Personal-only and sensitive for agent callers.
- A user-created wallpaper extension cannot supply a filesystem path or shell command; ND owns the picker and trusted OS adapter.
- Never claim a test/build/manual scenario passed unless it was actually run and recorded.

## Implemented — PR #58

### Workspace profile contract

- Added `WorkspaceProfile = 'general' | 'coding'`.
- Fresh settings default to General.
- Existing settings with the legacy persisted coding surface migrate to Coding.
- Profile state persists through typed main/preload IPC.
- Renderer keeps the profile unknown until persisted state loads, preventing a false General redirect of existing Coding deep links.
- Profile buttons wait for the trusted main-process setter before changing renderer-visible scope.

### General / Coding UI behavior

- General/Coding toggle is in the title bar.
- Existing ND/DSH selector is visible only under Coding.
- General keeps Home, Company, Agent, Design, Settings, launcher, Home and extensions.
- General hides QA and header Git controls.
- A stale `#/qa` route is redirected to Home only after General is known.
- Main rejects direct DSH activation while General is selected.
- Switching active DSH → General normalizes presentation to ND/workbench only.

### Regression coverage

- Shared profile unit contract.
- Fresh General → Coding Electron smoke.
- Persisted Coding + `#/qa` survives renderer reload.
- General rejects direct DSH activation.
- Coding QA journey explicitly selects Coding.
- UI preview satisfies the expanded DesktopApi contract.

## Implemented — PR #59

### ND Command Registry

Added `LauncherCommandSource` and `LauncherCommandRegistry`.

Current sources:

- `core.typed`
- `core.context`
- `core.quick-actions`
- `core.capture`
- `extensions`
- `organization.recent-projects`
- `organization.companies`

Both the in-app launcher and global popup continue through one `QuickLauncher`, now rendered from registry groups instead of one hard-coded JSX command list.

Activated extension commands are adapted into the extension source automatically.

### Wallpaper native extension proof

Added:

- permission: `os.wallpaper.write`
- host: `os.wallpaper.chooseAndSet`
- context ceiling: Personal only
- agent classification: sensitive
- built-in `nd.wallpaper-manager`
- user example: `examples/nd-extension-wallpaper/nd-extension.json`

Trusted adapters:

- Windows: fixed Windows PowerShell executable + fixed script; selected image path via process environment.
- macOS: fixed `/usr/bin/osascript`; selected image path via process environment.
- Linux: GNOME `gsettings`; file URI passed as `execFile` argument.
- Unsupported platforms fail closed.

No adapter uses `shell: true`; selected paths are not interpolated into scripts.

### Extension trust-boundary hardening

- Host-method context ceilings are checked during manifest validation.
- The same ceiling is re-checked in `InvocationBroker`.
- Built-in packages now pass the shared manifest validator and permission-gap validation before snapshotting.
- Persisted package versions re-check permission coverage before rollback/use.
- Reload drops persisted package-index entries whose declared permissions no longer cover their host contributions.
- Agent invocation of wallpaper requires approval/grant.

### Regression coverage

- command registry source ordering/execution/grouping;
- wallpaper adapter argument/path safety;
- wallpaper manifest/permission/context rules;
- broker user/agent/context authorization;
- built-in validation;
- persisted permission-gap rejection;
- launcher Personal visibility and Project-context absence.

## Intentionally not changed

- No arbitrary extension HTML/React renderer panels.
- No unrestricted JS/Electron/Node plugin runtime.
- No Raycast package compatibility runtime.
- No visual/no-code extension builder yet; user-created extensions use the documented manifest/package flow.
- No widget contribution type yet.
- No window-management, process-control, desktop-file organization, or background wallpaper scheduler yet.
- No wallpaper URL/download capability; the proof uses an ND-owned local image picker.
- Linux support in this slice is GNOME `gsettings`, not every Linux desktop environment.
- No performance improvement is claimed.
- No cloud sync/marketplace/billing work is included.

Reopen these only with explicit scope expansion or evidence of a correctness defect.

## Static-review defects already fixed

Before handoff, GPT-Web source review found and fixed:

1. PR #58 persisted Coding deep-link race.
2. PR #58 renderer/main profile-transition ordering race.
3. PR #59 incomplete `ContextOption` fixture in the command-registry unit test.
4. PR #59 built-in packages not actually passing the same shared runtime validator despite the previous comment claiming they did.
5. PR #59 host-method context ceilings existed in descriptors but were not independently enforced by install/runtime.
6. PR #59 persisted package reload/rollback did not re-check host permission coverage.
7. PR #59 initial cmdk group rendering used an extra wrapper; groups are now direct cmdk children.
8. PR #59 Windows-path construction was made platform-independent for unit testing and correct Windows output.
9. PR #59 wallpaper picker was restricted to broadly supported PNG/JPEG/BMP inputs.

Do not assume these fixes passed compilation until the local commands below run.

## Validation status

### Repository facts already established

At handoff authoring:

- `main` head: `56b48a35fbf938fe0a16b234d4894903eab26610`.
- PR #58 was 19 commits ahead / 0 behind main and mergeable/clean.
- PR #59 was 41 commits ahead / 0 behind PR #58 and mergeable/clean before the final handoff documentation commit.
- GitHub Actions are intentionally parked.
- No executable validation result is claimed by GPT-Web.

### Why local execution is still pending

The GPT-Web execution container cannot resolve `github.com`; even `git ls-remote` fails with:

```text
Could not resolve host: github.com
```

The GitHub connector can inspect/write repository files but cannot provide a runnable checkout to the Node/Electron toolchain.

Therefore typecheck, Vitest, Playwright, build, and real OS wallpaper behavior must be completed locally.

## Local correctness gates

Use Node >=24 and pnpm >=11. Repository package manager is currently pnpm 11.7.0.

### Phase A — validate PR #58 alone

```bash
git fetch origin --prune
git switch feat/general-coding-workspace-profile
git pull --ff-only origin feat/general-coding-workspace-profile

git status --short --branch
git rev-parse HEAD
git rev-parse main
git rev-list --left-right --count main...HEAD

corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm vitest run tests/workspace-profile.test.ts
corepack pnpm playwright test e2e/smoke.spec.ts e2e/qa-functional.spec.ts
corepack pnpm test
corepack pnpm build
```

If PR #58 is clean, record the exact SHA and keep it unchanged while validating the child.

### Phase B — validate PR #59 stacked on #58

```bash
git switch feat/magibar-command-native-extensions
git pull --ff-only origin feat/magibar-command-native-extensions

git status --short --branch
git rev-parse HEAD
git rev-parse feat/general-coding-workspace-profile
git rev-list --left-right --count feat/general-coding-workspace-profile...HEAD

corepack pnpm typecheck

corepack pnpm vitest run \
  tests/command-registry.test.ts \
  tests/wallpaper-native.test.ts \
  tests/nd-extension-package.test.ts \
  tests/nd-invocation-broker.test.ts \
  tests/nd-extension-lifecycle.test.ts \
  tests/quick-launcher.test.ts

node scripts/validate-nd-extension.mjs --builtins
node scripts/validate-nd-extension.mjs examples/nd-extension-wallpaper

corepack pnpm e2e:launcher
corepack pnpm test
corepack pnpm build
```

Because #59 includes #58 in its ancestry, do not continue if the child is unexpectedly behind the latest parent head.

### Failure classification

- A failure in a touched file or new focused test is a branch regression until disproved.
- Reproduce an unrelated failure on the relevant base branch before classifying it pre-existing.
- Missing Node/pnpm/Electron/Playwright dependencies are environment/tooling blockers, not PASS.
- Native wallpaper failures may be platform/desktop-specific; capture exact OS version and adapter error before changing code.
- Do not repeatedly rerun a full suite. Save the first useful failure, reproduce the smallest case, fix, then rerun focused + affected full gate.

## Manual smoke — PR #58

Use disposable local ND data if possible.

1. **Fresh profile**
   - Start with no prior ND settings.
   - Verify General is selected.
   - Verify QA, ND/DSH selector and header Git controls are absent.
   - Verify Home, Company, Agent, Design and Settings remain usable.

2. **Coding switch**
   - Choose Coding.
   - Verify ND/DSH appears.
   - Verify QA appears.
   - Enter DSH and return to ND.

3. **Persisted Coding deep link**
   - Leave Coding selected.
   - Navigate to `#/qa`.
   - Reload the renderer/app.
   - Verify Coding remains selected and `#/qa` is preserved.

4. **General DSH guard**
   - Switch to General while DSH is active.
   - Verify visible surface returns to ND/workbench.
   - Attempt direct DSH activation using the existing debug/E2E preload path.
   - Verify main rejects it.

5. **Execution-state invariant**
   - Start a real/disposable company task or agent run.
   - Switch Coding → General → Coding and navigate across Home/Company/Settings.
   - Verify the task/run state is unchanged. No pause, stop, cancel or restart may be caused by the profile switch.

## Manual smoke — PR #59

Run on the user's Windows machine first because that is the primary desktop target for this handoff.

1. **Registry regression**
   - Open in-app launcher and global popup.
   - Verify Context, Quick actions, Capture, Extensions, Recent projects and Companies render.
   - Verify task, quick note, project switch and company switch still work.

2. **Personal extension visibility**
   - Open global popup in Personal.
   - Verify **Choose wallpaper** appears under Extensions.

3. **Context ceiling**
   - Switch launcher context to a Company and then Project.
   - Verify **Choose wallpaper** disappears.

4. **Cancel path**
   - Return to Personal.
   - Run Choose wallpaper.
   - Cancel the native picker.
   - Verify no wallpaper change and no error/toast claiming success.

5. **Windows native effect**
   - Run Choose wallpaper again.
   - Pick a disposable PNG, JPEG, or BMP.
   - Verify Windows desktop wallpaper changes.
   - Verify ND reports success only after the native adapter succeeds.

6. **Extension management**
   - Open Settings → Extensions.
   - Verify Wallpaper Manager is ND-maintained, Personal-capable, and declares `os.wallpaper.write`.
   - Disable it in Personal and verify the launcher command disappears.
   - Re-enable it and verify the command returns.

7. **User-authored package**
   - Install `examples/nd-extension-wallpaper` from folder.
   - Activate it for Personal.
   - Verify **Choose my wallpaper** appears without modifying launcher code.
   - Disable/uninstall the local example and verify the contribution disappears.

8. **Agent approval**
   - If a local agent path can invoke extension capabilities, ask it to invoke Wallpaper Manager.
   - Verify the native effect does not run before the approval/grant flow.
   - Deny once and verify no OS change.
   - Approve once and verify only the approved call proceeds.

9. **General/Coding independence**
   - With the wallpaper/local extension active, switch General ↔ Coding.
   - Verify extension activation and launcher availability are unchanged.
   - Verify any existing company work continues.

### macOS/Linux claims

Do not mark macOS wallpaper support PASS without a real macOS run. Automation/Accessibility prompts may apply.

Do not mark Linux PASS unless tested on GNOME with `gsettings`. Other desktop environments remain out of scope for this slice.

## Performance evidence

No performance improvement is claimed by either PR, so no benchmark baseline is required for merge readiness.

If launcher performance visibly regresses with many extension commands, record a reproducible case before optimizing. Do not invent a percentage without before/after evidence on the same machine.

## Defect handling

1. Save the failing command/scenario and first useful error.
2. Classify: PR #58 regression, PR #59 regression, pre-existing, platform-specific, or environment/tooling.
3. Reproduce minimally.
4. Fix only the demonstrated defect on the correct feature branch.
5. Add/strengthen regression coverage.
6. Rerun focused checks.
7. Rerun affected full gate.
8. Update the PR/task/handoff if an invariant changes.
9. Never push the fix directly to `main`.

If a #58 fix is required after #59 has started validation, update the #59 branch from the corrected #58 head before resuming child validation.

## Known issues / caveats

- GitHub Actions are parked, so there is no remote green badge to substitute for local evidence.
- GPT-Web could not clone/run the repository because its container DNS cannot resolve GitHub.
- Windows wallpaper behavior has source-level coverage only until the local manual smoke runs.
- macOS and GNOME adapters are implemented but not yet live-validated by this handoff.
- The extension platform still deliberately does not support arbitrary renderer UI/plugin code.
- The user-authored example proves manifest-level native capability reuse; there is no no-code extension builder in this slice.
- PR #59 must remain stacked until #58 is merged or otherwise incorporated.

## Required final report

### PR #58

- branch
- final SHA
- main/base SHA
- ahead/behind
- `verify`: PASS / FAIL / BLOCKED
- `typecheck`: PASS / FAIL / BLOCKED
- workspace-profile focused unit: PASS / FAIL / BLOCKED
- Electron smoke + QA: PASS / FAIL / BLOCKED
- full unit suite: PASS / FAIL / BLOCKED
- build: PASS / FAIL / BLOCKED
- manual General/Coding scenarios: each PASS / FAIL / BLOCKED
- merge state: exactly `READY FOR MERGE` or `NOT READY FOR MERGE`

### PR #59

- branch
- final SHA
- parent/base SHA
- ahead/behind
- `typecheck`: PASS / FAIL / BLOCKED
- focused registry/extension/wallpaper tests: PASS / FAIL / BLOCKED
- built-in manifest validation: PASS / FAIL / BLOCKED
- user wallpaper example validation: PASS / FAIL / BLOCKED
- launcher E2E: PASS / FAIL / BLOCKED
- full unit suite: PASS / FAIL / BLOCKED
- build: PASS / FAIL / BLOCKED
- Windows manual wallpaper scenarios: each PASS / FAIL / BLOCKED
- user-authored extension install/activate/deactivate: PASS / FAIL / BLOCKED
- agent approval path: PASS / FAIL / BLOCKED
- merge state: exactly `READY FOR MERGE` or `NOT READY FOR MERGE`

### Defects fixed during handoff

For each defect report:

- symptom
- classification
- root cause
- files changed
- regression coverage
- commit SHA

### Remaining known issues

List every blocker honestly. A skipped manual scenario is not PASS.

---

## Local validation record — 2026-09-28

Validation ran after both PRs had already merged: PR #58 was on `main` (`2575336`) and PR #59 was on `feat/general-coding-workspace-profile` (`039d04e`), which `main` had not yet absorbed.

- The parent branch was merged into local `main` (`b3d16a8`, tree-identical to the branch; 48 ahead / 0 behind `origin/main`).
- Green gates: `verify`; `typecheck` (both projects — it was red before); focused vitest 69/69; built-in and example manifest validation; launcher E2E 4/4 after a fresh `pnpm build`; the full unit suite at 945 passed with only the known CRLF environmental failure and the live-CLI skips; `build`; `bench:tasks:check` (136 expectations, 0 deviations); the whole-app Electron sweep 52/52.
- Repairs: `2cdbf99` (typecheck includes and `.js` specifiers, `session-tree` narrowing and annotation, `SessionCard` optional props, platform-independent GNOME file URI, session/skill test fixtures) and `9e963d6` (Settings tab "Plugins" → "Extensions" in three e2e specs).
- The launcher E2E must run after a fresh `pnpm build`; against a stale `out/` the wallpaper command is legitimately absent.
- Still owed: every manual smoke scenario above (Windows wallpaper effect, user-authored extension install/activate, agent approval), plus the macOS/GNOME live claims.
