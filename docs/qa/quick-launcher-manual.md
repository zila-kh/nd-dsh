# ND Quick Launcher — 3-layer validation gate

Status: PR #55 feature validation  
Branch: `feat/quick-launcher-capture`  
Scope: centered launcher, company/project switching, task/note/agent actions, clipboard/URL capture, and external screen capture entry points.

## Release rule

Do not mark the launcher ready for beta from one green test class.

The feature passes only when:

1. **Layer 1 — unit/TDD contracts** is green.
2. **Layer 2 — Electron E2E** is green against the built app.
3. **Layer 3 — manual desktop QA** passes every P0 row on the target Windows machine.

A repeated failure in any P0 row is a beta blocker even if another run passes.

---

## Layer 1 — Unit / TDD contracts

Purpose: catch deterministic logic regressions in milliseconds before Electron starts.

Run:

```bash
corepack pnpm typecheck
corepack pnpm test:launcher
```

Source:

- `tests/quick-launcher.test.ts`
- `src/renderer/src/lib/quick-launcher-model.ts`

Required assertions:

- `Ctrl+K` and `Cmd+K` are accepted.
- `Alt+Ctrl+K`, unrelated keys, and bare `K` are rejected.
- Launcher labels normalize whitespace and truncate predictably.
- Task titles are bounded to 120 characters.
- Note titles are bounded to 80 characters.
- Recent projects are newest-first, limited, and do not mutate organization state.
- Create-task builds a project-scoped `task.create` mutation with the required acceptance criterion.
- Quick-note / clipboard / URL capture builds scoped `memory.add` mutations.
- Company-only memory works when there is no active project.
- Tag arrays are copied rather than retained by mutable reference.

**Pass:** typecheck succeeds and every launcher unit test passes with no skipped test.

---

## Layer 2 — Real Electron E2E

Purpose: prove renderer → preload → main/organization behavior in the built desktop application.

Run:

```bash
corepack pnpm build
corepack pnpm e2e:launcher
```

Source:

- `e2e/quick-launcher.spec.ts`

The spec uses a disposable Electron profile and real temporary Git workspaces.

Required assertions:

| ID | Automated journey | Expected result |
| --- | --- | --- |
| E2E-01 | Open Settings → press `Ctrl/Cmd+K` | Centered **ND Quick Launcher** opens and input receives focus |
| E2E-02 | Press `Esc` | Launcher closes and the previous Settings route remains unchanged |
| E2E-03 | Type task text → **Create task** | Real organization task persists in the active company/project |
| E2E-04 | Type note text → **Quick note** | Real project-scoped memory persists with `launcher, manual` tags |
| E2E-05 | Main process sends the launcher event | Renderer opens the same launcher surface |
| E2E-06 | Select a recent project owned by another company | Active company and project switch together; no cross-company mismatch |
| E2E-07 | Reopen launcher | External Screen, External Capture Tools, and Clipboard commands are visible |
| E2E-08 | Whole spec | No renderer `pageerror` or console error is emitted |

**Pass:** all E2E rows green on one run from a clean build. Do not rerun a failure until green without first keeping the first failure/trace.

---

## Layer 3 — Manual Windows desktop QA

Purpose: validate OS behavior that CI/Xvfb cannot honestly prove: global shortcut ownership, focus/minimize behavior, real desktop capture, clipboard permissions, and human usability.

Before starting:

- Build/run the same PR #55 commit you intend to review.
- Have ND, Chrome, VS Code, and one ordinary desktop app open.
- Create at least **2 companies × 2 projects** so project/company switching is visible.
- Keep one project with a known browser URL open in ND.
- Record the commit SHA and tester name/date in the evidence notes.

### P0 — must pass

| ID | Test | Steps | Expected |
| --- | --- | --- | --- |
| M-01 | Global hotkey from another app | Focus Chrome or VS Code → press `Ctrl+Shift+Space` | ND restores/focuses and launcher opens |
| M-02 | Global hotkey while ND minimized | Minimize ND → press `Ctrl+Shift+Space` | ND restores once; no duplicate window |
| M-03 | In-app hotkey | From Company, Agent, Design, QA, Settings press `Ctrl+K` | Same launcher opens from every surface |
| M-04 | Return-to-work | Open launcher over each surface → `Esc` | Exact previous surface/context remains |
| M-05 | Project isolation | Select project in another company | Both company + project switch correctly; no old-company board data leaks |
| M-06 | Create task | Type real task request → Create task | One task only, correct company/project, correct full text |
| M-07 | Quick note | Type note → Quick note | One memory entry only, correct scope/tags |
| M-08 | Clipboard capture | Copy text in another app → launcher → Capture Clipboard | Text becomes memory; clipboard content is not altered unexpectedly |
| M-09 | Empty/blocked clipboard | Clear clipboard or deny read permission → Capture Clipboard | Clear non-crashing message; no empty memory created |
| M-10 | External full-screen capture | Launcher → Capture External Screen → switch to target app during countdown | Correct target screen is captured, sent to agent, and clipboard copy behavior matches UI |
| M-11 | Area capture | Launcher → External Capture Tools → Select Area | Selected area only; dimensions/content are correct |
| M-12 | Annotation | External Capture Tools → annotate target → confirm | Annotation reaches agent; app returns to usable ND state |
| M-13 | Focus recovery | Complete/cancel external capture | ND/float overlay does not remain stuck, invisible, or always-on-top |
| M-14 | URL capture | Open known URL in ND browser → Capture Current URL | Exact current URL becomes scoped memory |
| M-15 | No duplicate action | Double-tap Enter/click around task/note selection | One durable record only |
| M-16 | Restart durability | Create task/note, exit ND cleanly, reopen | Organization task/memory and active context persist |
| M-17 | Shutdown | Use launcher/capture several times → quit ND | No orphan ND/Electron/capture process remains |

### P1 — usability / polish

| ID | Test | Expected |
| --- | --- | --- |
| M-18 | Search relevance | Typing company/project/action words surfaces the expected command quickly |
| M-19 | Keyboard-only flow | Arrow keys + Enter + Esc can complete normal actions without mouse |
| M-20 | Long text | Long request stays readable; title is bounded but full description/memory content is preserved |
| M-21 | Small window | Launcher remains centered, scrollable, and usable at ND minimum window size |
| M-22 | Repeated open/close | 30 open/close cycles produce no obvious lag, focus loss, or duplicate listeners |
| M-23 | Shortcut conflict | If another app owns `Ctrl+Shift+Space`, ND logs the unavailable shortcut and remains usable through `Ctrl+K` |

### First-failure evidence

For every failed row, keep:

- test ID,
- commit SHA,
- exact steps,
- expected vs actual,
- screenshot/video when visual,
- ND diagnostic/log tail when runtime-related,
- whether the failure repeats after a clean restart.

Do **not** convert a failure into a pass just by retrying until it happens to work.

---

## Final sign-off

Use this small scorecard after the run:

```text
Commit:
Layer 1 unit/typecheck: PASS / FAIL
Layer 2 Electron E2E: PASS / FAIL
Layer 3 manual P0: __ / 17 PASS
Layer 3 manual P1: __ / 6 PASS
Renderer errors: 0 / __
Orphan processes after quit: 0 / __
Beta launcher verdict: READY / BLOCKED
Blockers:
Evidence location:
```

For PR #55, **READY** means Layers 1 and 2 are fully green and all **17 P0 manual checks** pass. P1 issues can be accepted only when they do not hide or weaken a P0 behavior.
