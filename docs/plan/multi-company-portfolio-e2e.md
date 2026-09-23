# Multi-company portfolio E2E + 3-model local validation

Status: **implementation prepared; local validation/evidence pending**  
Branch: `feat/e2e-multi-company-portfolio`

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

Copy `.env.e2e.example` to `.env` and fill:

```env
E2E_MODEL_BASE_URL=https://your-endpoint.example/v1
E2E_MODEL_API_KEY=your-key

E2E_MODEL_1=model-id-1
E2E_MODEL_2=model-id-2
E2E_MODEL_3=model-id-3
```

The configuration is all-or-none. If any E2E model variable is present, ND requires the base URL, API key and all three model ids. No credential is committed; `.env` is already gitignored.

The live-model path seeds one provider into its throwaway profile:

```text
provider: e2e-openai-compatible
format:   OpenAI compatible (/v1/chat/completions)
models:   E2E_MODEL_1, E2E_MODEL_2, E2E_MODEL_3
```

Ordinary Playwright fixtures do **not** change just because `.env` exists. They keep the existing deterministic OpenCode Go fixture unless a future spec explicitly calls `launchApp({ useConfiguredModels: true })`. This protects the current E2E suite from accidental provider-dependent drift.

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

## Why the two layers are separate

A multi-company correctness regression and a provider failure have different owners.

The deterministic portfolio suite answers:

> Is ND's company/project/workspace/task isolation correct?

The live portfolio matrix answers:

> Can three real model routes execute isolated work across two companies and three projects with correct worktree/review/integration evidence?

The autonomous stress driver answers:

> Can ND also distribute a larger single-project workload across multiple live model routes in parallel?

Keeping them separate makes a failed API key, rate limit or provider outage unable to hide a company-isolation bug.

## Local validation order

Run from `feat/e2e-multi-company-portfolio`:

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
