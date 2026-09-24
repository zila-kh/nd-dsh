# Multi-company portfolio E2E + 3-model local validation

Status: **merged to main via PR #42; layers 1–2 and the whole-app sweep validated green locally on 2026-09-24 — see “Local validation evidence” below**  
Historical branch: `feat/e2e-multi-company-portfolio`

> **Layer 4 — real-user production journey:** the coherent multi-company / multi-autonomy / parallel / restart end-to-end run (three companies, five tiny projects, switch-while-running evidence, restart recovery) lives in [`real-user-production-e2e.md`](./real-user-production-e2e.md) and runs with `corepack pnpm e2e:prod:user` (or the full matrix via `corepack pnpm e2e:prod`).

## Goal

Prove ND's strongest organization feature with a deliberately small fixture:

- multiple companies are hard isolation boundaries;
- one company can own multiple independent projects;
- each project keeps its own tasks, workspace, memory and visible board;
- company/project switching cannot expose another tenant's project/task data;
- forged cross-company ownership is rejected at the main-process store boundary;
- durable organization state survives a real Electron restart;
- optional live validation can use three real models behind one OpenAI-compatible endpoint.

This is intentionally not a large demo application. The fixture is **2 companies / 3 projects / 4 tiny tasks** so failures point at ND orchestration instead of app complexity.

## Test topology

```text
SwiftCab Labs
├── Dispatch Lite
│   ├── Dispatch status badge
│   └── Dispatch search
└── Driver Pocket
    └── Driver job card

TinyCart Studio
└── Catalog Mini
    └── Catalog item row
```

Every project gets a real temporary Git repository. Company A and Company B each receive their own seeded roles, teams and AI employees.

## Layer 1 — deterministic portfolio isolation

Command:

```sh
corepack pnpm build
corepack pnpm e2e:portfolio
```

Implemented in `e2e/organization-portfolio.spec.ts`.

Required assertions:

1. Exactly two companies, three projects and four tasks are created.
2. Company A owns two projects; Company B owns one.
3. Each company owns a distinct seeded workforce:
   - 4 roles;
   - 3 teams;
   - 4 agents.
4. Company/project memory remains scoped to its owner.
5. A task created with Company A + Company B's project is rejected.
6. A Company A agent cannot be assigned to a Company B task.
7. The top-level **Switch company** control changes the active tenant.
8. **Switch project** lists only projects belonging to the selected company.
9. The Company Workspace board shows only the active project's task cards.
10. Close Electron and relaunch with the same `userData`; companies/projects/tasks and active selection remain intact.

This layer does **not** require a model or network. It ignores the live E2E model configuration and should stay green even when provider credentials are unavailable.

## Layer 2 — live multi-company 3-model portfolio

Copy `.env.e2e.example` to `.env.e2e` and fill:

```env
E2E_MODEL_BASE_URL=https://your-endpoint.example/v1
E2E_MODEL_API_KEY=your-key

E2E_MODEL_1=model-id-1
E2E_MODEL_2=model-id-2
E2E_MODEL_3=model-id-3
```

The configuration is all-or-none. If any E2E model variable is present, ND requires the base URL, API key and all three model ids. No credential is committed; `.env.e2e` is gitignored and is read directly by the E2E fixtures and the beta driver, while plain `.env` only supplies non-model variables such as `ND_DSH_CDP_PORT`.

The live-model path seeds one provider into its throwaway profile:

```text
provider: e2e-openai-compatible
format:   OpenAI compatible (/v1/chat/completions)
models:   E2E_MODEL_1, E2E_MODEL_2, E2E_MODEL_3
```

Every E2E layer seeds that one provider; there is no second fixture route. Deterministic specs never execute a model, so when `.env.e2e` is absent they still receive the provider record filled with explicit dummy placeholders (`sk-test-placeholder`, `model-id-1..3`) and stay green offline. Live specs opt into strict mode with `launchApp({ useConfiguredModels: true })`, which fails fast on an incomplete configuration instead of drifting.

The primary live portfolio test is `e2e/organization-portfolio-models.spec.ts`.

It creates:

```text
SwiftCab Live
├── Dispatch Live  -> Builder @ E2E_MODEL_1
└── Driver Live    -> Builder 2 @ E2E_MODEL_2

TinyCart Live
└── Catalog Live   -> Builder @ E2E_MODEL_3
```

Each project starts as a separate temporary Git repository and receives one deliberately tiny task. The test activates each project sequentially, runs the real worker, waits for ND's execution receipt/checkpoint/worktree evidence, verifies the recorded execution route, explicitly runs the independent reviewer, and requires successful integration plus 100% project progress.

Reviewer routes remain different from their builders:

- Company A Reviewer -> `E2E_MODEL_3`
- Company B Reviewer -> `E2E_MODEL_1`

Run:

```sh
corepack pnpm build
corepack pnpm e2e:portfolio:models
```

This is the main local proof for **multiple companies + multiple projects + real model routing**.

## Layer 3 — full autonomous multi-agent stress loop

The existing full autonomous multi-model driver also consumes these same slots:

| ND employee | Route |
| --- | --- |
| AI PM | `E2E_MODEL_2` |
| Builder | `E2E_MODEL_1` |
| Builder 2 | `E2E_MODEL_3` |
| Reviewer | `E2E_MODEL_2` |
| Researcher | `E2E_MODEL_1` |

Run:

```sh
corepack pnpm build
corepack pnpm e2e:models
```

This stress layer uses one project but exercises more orchestration depth: PM plan → automatic task distribution → isolated Git worktrees → parallel builders → independent review → integration. It must observe both builder routes rather than manually repairing distribution. Keep it separate from the small portfolio test so failures can be attributed cleanly.

## Why the three layers are separate

A multi-company correctness regression and a provider failure have different owners.

The deterministic portfolio suite answers:

> Is ND's company/project/workspace/task isolation correct?

The live portfolio matrix answers:

> Can three real model routes execute isolated work across two companies and three projects with correct worktree/review/integration evidence?

The autonomous stress driver answers:

> Can ND also distribute a larger single-project workload across multiple live model routes in parallel?

Keeping them separate makes a failed API key, rate limit or provider outage unable to hide a company-isolation bug.

## Local validation order

Run from an up-to-date `main` checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm core:test
corepack pnpm build
corepack pnpm e2e:portfolio
corepack pnpm e2e:portfolio:models
corepack pnpm e2e:models
```

GitHub Actions are not required for this handoff; local evidence is authoritative for this branch.

## Evidence to record

For `e2e:portfolio`:

- pass/fail summary;
- OS + Node + pnpm versions;
- confirmation that restart used the same temporary profile;
- any renderer console/page errors.

For `e2e:portfolio:models`:

- all three tiny tasks reach review and then completed;
- execution route evidence reports the expected provider + model for each project;
- every execution run records a checkpoint and task workspace;
- review passes and integration state is `integrated`;
- all three projects reach 100%;
- final company/project ownership assertions remain isolated.

For `e2e:models`:

- terminal outcome;
- three configured model ids (never the API key);
- task → agent → model mapping;
- maximum simultaneous task executions;
- both builder model routes observed;
- task final states;
- project completion/progress;
- final-state artifact path;
- any auth/rate-limit/provider error.

## Acceptance gate

Do not call this portfolio proof complete until:

- `e2e:portfolio` is green;
- no cross-company mutation succeeds;
- project/task visibility remains scoped before and after restart;
- `e2e:portfolio:models` completes all three real-model project tasks with exact route evidence and integration;
- `e2e:models` reaches a completed autonomous project using all required live builder routes;
- no secret appears in logs or committed files.

If the deterministic suite passes but live models fail for an external provider reason, record the live-model evidence as **blocked by provider**, not as a tenant-isolation failure.

## Local validation evidence — 2026-09-24 (Windows, Node 24.18.0, Electron build from `main`)

| Gate | Command | Result |
| --- | --- | --- |
| Static | `pnpm verify`, `pnpm typecheck` | passed |
| Unit | `pnpm test` | 841 passed, 8 skipped (109 files) |
| Build | `pnpm build` | passed |
| Layer 1 | `pnpm e2e:portfolio` | 4/4 passed (20.4 s, re-verified at 29.9 s after the test-side fixes); the restart test reused the retained throwaway profile |
| Layer 2 | `pnpm e2e:portfolio:models` | passed three times: 4.0 min before the race fix, then 4.1 min and 8.2 min after it |
| Whole app | `pnpm exec playwright test` | 42 passed across all 8 spec files (7.1 min, exit 0) — includes the live portfolio layer. The earlier sweep's single failure (this live spec racing the workspace-switch guard) was fixed before this run |

Layer 2 route evidence (route asserted from each execution run's recorded output):

| Company | Project | Builder route (asserted) | Reviewer route (configured) | Result |
| --- | --- | --- | --- | --- |
| SwiftCab Live | Dispatch Live | `combo-free` (`E2E_MODEL_1`) | `combo-free-2` | execution reached review, review passed, `integrated`, project 100% |
| SwiftCab Live | Driver Live | `combo-free1` (`E2E_MODEL_2`) | `combo-free-2` | execution reached review, review passed, `integrated`, project 100% |
| TinyCart Live | Catalog Live | `combo-free-2` (`E2E_MODEL_3`) | `combo-free` | execution reached review, review passed, `integrated`, project 100% |

Every execution run recorded both a checkpoint commit and a task workspace. Worktree evidence (the throwaway profile is deleted after the run; the workspaces stay under `%TEMP%/nd-dsh-e2e-workspace-*`):

- `dispatch-status.txt` → `AVAILABLE` / `BUSY`
- `driver-job.txt` → `Pickup -> Destination`
- `catalog-item.txt` → `Widget | 9.99 | 3`

Each workspace holds the ND checkpoint commit (`nd-dsh: Create … artifact`) plus a merge of the task branch back into the base branch. Renderer console/page errors: none — every layer asserts an empty error list. No secret appears in the run output; routes are reported by model id only.

### What the whole-app sweep actually clicks (user-facing flows)

- shell chrome and navigation across Company / Agent / Design / QA / Settings, coding-surface switch, theme persistence;
- company creation dialog, project creation with the workspace folder picker, company and project switchers;
- Company Workspace board (Overview → Work), Operations and Strategy views, workflow integration panel;
- **AI PM plan** button and the full work loop (plan → task → execution → review);
- Settings: Models (seeded provider + model list), coding engines, gateway, capabilities, plugins, agent presets;
- Agent surface: chat composer and model picker, terminal PTY command, embedded browser controls, source-control commit/branch, explorer files and search;
- QA surface project checks, Design Live App panes with workspace and inspector.

### Fixes made while validating (test-side, no product behavior changed)

- `organization-portfolio.spec.ts` — the board assertion now selects the Company Workspace **Work** section; the workspace view opens on Overview since the dashboard refactor, and the section is re-selected after switching company.
- `deep-surfaces.spec.ts` — chat composer placeholder updated to the current copy (`@ files/browser targets`).
- `qa-functional.spec.ts` — Explorer search works with either workspace: the seeded project folder or the app's own checkout (many nested READMEs behind a capped result list).
- `organization-portfolio-models.spec.ts` — `completedTaskState` waits for run quiescence so `project.activate` cannot race the workspace-switch guard.

### Not yet run

Layer 3 (`pnpm e2e:models`) — the autonomous multi-agent stress loop.

### Known non-green signal — worker-teardown watchdog (reduced, not eliminated)

Playwright's worker-teardown watchdog (`Worker teardown timeout of 120000ms exceeded`, reported outside any test) can still make `pnpm exec playwright test` exit non-zero after every spec has passed. On this machine it is intermittent: before any fix it fired in roughly 5 of 5 qa-functional runs; after the changes below it fired once in 4 verification runs (qa-functional #2) while the full sweep exited 0.

What the diagnostics established (the app is not the cause):

- `closeApp` logs `path=graceful … exited=true descendantsBefore=0` on the hanging runs, so the app quits cleanly and no descendant survives.
- An env-gated handle dump (`ND_E2E_TEARDOWN_DIAG=1`) shows the worker holding Playwright's own Electron child handle plus its CDP sockets — the app's `ChildProcess` handle disappears once the `ElectronApplication` is disposed.
- The only handle that reports `ref` is the worker's own IPC pipe (fd 3), which is normal; the remaining sockets drain on their own in clean runs, so no single leaked handle is named yet.

Mitigation in place: after the app has exited, `closeApp` disposes the `ElectronApplication` with a bounded 15 s wait (`e2e/fixtures.ts`). This is what produced the first fully green full-sweep exit; it does not remove the flake, so task 0010 stays open until a run is shown to exit cleanly every time.
