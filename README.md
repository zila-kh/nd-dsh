# ND-DSH

> **Company team first. Built for devs, by real devs. Works with any CLI engine — Codex, DeepSeek Harness, and many more.**

ND-DSH is a desktop **AI Company Operating System for software delivery**. Instead of treating an AI model as a single chat box, ND owns companies, projects, roles, teams, agents, tasks, workflows, skills, memory, policies, model-provider routes, and coding-engine capabilities.

> **⚠️ Status: not beta yet — this project just started.**
> The core loop runs on real desktop/runtime state, but there is no downloadable beta, no signed installers, and no stability promise yet. Expect breaking changes at any time. See [What we ship and what's planned](#what-we-ship-and-whats-planned) and the [Roadmap](#roadmap).

The current product is coding-first: an AI PM plans work, assigned workers operate the real workspace and browser, an independent reviewer verifies the result, failed reviews can return to rework, durable memory is recorded, dependencies unlock, and the next task can continue automatically according to company autonomy and policy.

## Product boundary

ND-DSH is the product and control plane. Runtime vendors are replaceable implementation dependencies.

```text
ND-DSH desktop UI
        |
        v
ND company / project / role / agent / task control plane
        |
        +--> ND provider routes
        |      +--> DeepSeek compatibility route
        |      +--> OpenAI-compatible routes
        |      +--> Responses-compatible routes
        |      +--> Anthropic-compatible routes
        |      +--> provider-native/catalog routes
        |
        +--> ND coding-engine registry
               +--> ND Harness (primary)
               +--> Codex CLI (direct, ND-managed app-server)
               +--> Codex CLI (delegated one-shot engine)
               +--> future engine adapters
```

ND owns identity, configuration, authorization, orchestration, and durable state. Coding engines own execution details such as the agent loop, shell/process mechanics, filesystem operations, model transport, and product-specific protocol handling.

## Current coding engines

### ND Harness

The primary engine is the pinned DeepSeek Harness runtime, used as infrastructure rather than product identity. ND adds its own provider routing, workspace scope, permissions, browser MCP, agent preset, organization context, and desktop lifecycle around it.

Pinned upstream release: **0.1.0-rc.8**  
Pinned upstream commit: **141eb6fef83422698aef7a981029e843e8161534**

### Codex CLI (direct)

ND's main process spawns and manages the official Codex app-server itself, using the `@openai/codex` package pinned inside the vendored runtime (`ND_DSH_CODEX_BINARY` is a developer-only override). Each chat is a native Codex thread; progress streams into the workbench chat panel, interactive threads can request human approvals through ND's approval cards, and unassigned-to-Codex organization runs execute directly on this engine with a fail-closed `never` approval policy.

Native Codex authentication, `HOME` / `CODEX_HOME`, model selection, project trust, and account settings remain authoritative. ND strips its own runtime variables before spawning and never copies model-provider API keys into Codex credentials. Threads are in-memory per app run for now, so the catalog honestly reports persistent sessions as unavailable.

### Codex CLI (delegated fallback)

The pinned Harness also contains `@deepseek-ai/dsh-subagent-codex`, which starts its package-local `codex app-server --stdio` process as a one-shot delegate inside an ND Harness run (engine id `codex`). It remains available as a fallback when the direct engine is not usable.

AI employees can be assigned an available coding engine from Workforce. The assignment is durable ND state. Engine-specific worker guidance ships with each engine descriptor, so organization workflow code never branches on engine ids: delegated workers hand implementation to Codex and then validate the workspace themselves, while direct workers implement natively in Codex before the normal independent review step.

## AI company workflow

A normal autonomous delivery cycle is:

```text
Company objective
      |
      v
AI PM plan
      |
      v
Goal -> milestones -> dependency-aware tasks
      |
      v
Assigned worker + coding-engine route
      |
      +--> workspace files
      +--> shell / tests
      +--> visible browser when supported
      +--> skills / MCP when supported
      +--> optional Codex delegation
      |
      v
Independent reviewer
      |
      +--> pass -> durable memory -> unlock next task
      |
      +--> fail -> blocked or bounded automatic rework
```

Company autonomy levels control how much of that workflow may continue without another explicit human start. Approval-bearing organization runs pass through the ND main-process policy gate before a human approval card can be shown or resolved.

## Development setup

Requirements:

- Node.js 24+
- pnpm 11 through Corepack
- Git
- a supported Electron desktop OS

Clone with submodules, or let bootstrap initialize the pinned Harness checkout:

```sh
git clone --recurse-submodules https://github.com/zila-kh/nd-dsh.git
cd nd-dsh
corepack enable
corepack pnpm bootstrap
corepack pnpm dev
```

Configure model providers from **Settings -> Models**. `DEEPSEEK_API_KEY` remains an optional compatibility environment variable for the seeded DeepSeek route. Desktop API keys entered through Settings are stored with Electron OS-backed secure storage when a secure backend is available.

During development, opening the Vite renderer URL (normally `http://localhost:5173`) in a regular browser shows an explicitly labeled **UI Preview** populated with simulated fixtures. It exists only for reviewing navigation, layout, responsive behavior, and interaction states; agents, workspaces, Git, providers, ND Pencil, the shared browser, and organization runs function only in the Electron application. Preview fixtures are development-only and are not bundled as a production runtime fallback.

Existing stored API keys are not returned to the renderer. Settings receives only whether a credential exists and uses dedicated replace/clear operations. If a secure operating-system store is unavailable, a newly entered key remains memory-only rather than being persisted insecurely.

Codex authentication is native to Codex. The ND adapter does not create or migrate a Codex account.

## Verification

Before publishing a change:

```sh
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

End-to-end specs drive the real built app through Playwright's Electron launcher; they run locally (not in CI) and need a fresh production build first:

```sh
corepack pnpm build
corepack pnpm e2e
```

The QA view in the app runs the same unit and e2e suites from inside ND-DSH and streams their output; it requires a development checkout with runners installed.

GitHub Actions runs the same repository invariants, type checks, unit tests, and production desktop build on branch/PR changes.

## Updating the pinned Harness

Harness is a pinned git submodule and must never silently track a moving upstream branch. Update it only through an explicit tag or full commit and review the resulting runtime/config compatibility:

```sh
corepack pnpm dsh:update -- <tag-or-commit>
```

The pin metadata in `vendor/deepseek-harness.json`, the submodule gitlink, this README, and `vendor/README.md` must remain aligned. The current required pin is release **0.1.0-rc.8** at **141eb6fef83422698aef7a981029e843e8161534**.

## Project status

**ND-DSH is not beta yet — it just started.** There is no downloadable public build and no compatibility guarantee yet; expect breaking changes at any time.

What exists today is the source tree and a real running slice: the app runs on actual desktop/runtime state with no production fallback to mock companies, fake sessions, fake workspaces, or a localhost demo page, and the renderer fails closed if its trusted desktop bridges are missing.

A **Public Beta** still requires packaged runtime distribution, signed/notarized installers, installed-app E2E on supported platforms, Codex authentication/health onboarding, and broader normalized action metadata for policy enforcement beyond Harness approval frames.

## What we ship and what's planned

| Area | Status | Detail |
| --- | --- | --- |
| Desktop shell | 🚢 Shipped | Secure Electron/React app with one canonical visible browser pane; renderer fails closed without trusted bridges |
| Model routing | 🚢 Shipped | Provider-neutral routes: DeepSeek, OpenAI-compatible, Responses-compatible, Anthropic-compatible |
| Provider credentials | 🚢 Shipped | OS-backed encrypted storage when available; write-only from the UI (replace/clear, never read back) |
| Organization state | 🚢 Shipped | Companies, projects, teams, roles, AI employees, goals, milestones, tasks, memory, policies, run receipts |
| Delivery loop | 🚢 Shipped | AI PM → assigned worker → independent reviewer; dependency-aware progression and bounded rework |
| Coding engines | 🚢 Shipped | ND Harness (primary) + Codex CLI as a delegated one-shot engine, assigned per employee |
| Source Control | 🚢 Shipped | Built-in Git panel (status groups, stage/commit, diffs, branches, fetch/pull/push) derived from microsoft/vscode extensions/git (MIT) — see [`docs/source-control.md`](docs/source-control.md) |
| Policy gate | 🚢 Shipped | Main-process DENY/ALLOW/ASK enforcement for approval-bearing organization runs |
| Packaging & installers | 🛠 Planned | Bundled runtime, signed/notarized installers, offline install without dev tooling |
| Codex onboarding | 🛠 Planned | Native authentication and health checks in first-run onboarding |
| More CLI engines | 🛠 Planned | Additional adapters beyond Harness and Codex — any CLI engine can plug in |
| Broader company templates | 🛠 Planned | Non-coding business roles once the software-company loop is reliable |

## Roadmap

The full, ordered roadmap lives in [`docs/roadmap.md`](docs/roadmap.md), and the complete feature inventory / product requirements for contributors live in [`docs/prd-full.md`](docs/prd-full.md). Summary:

1. **Shipped foundation** — the coding-first vertical slice above, on real state.
2. **Public Beta P0** — runtime distribution, installers, installed-app E2E, onboarding.
3. **After the beta** — more engine adapters, broader action metadata for policy, business-company templates.

## Security boundaries

- Renderer: context isolation on, Node integration off, sandbox on.
- Browser pane: isolated Electron `WebContentsView`; permissions denied by default.
- Browser automation: attaches to the exact visible pane through loopback CDP; no hidden second browser.
- IPC: main-frame sender validation and narrow contracts.
- Workspace: path containment and symlink protections.
- Provider credentials: separated from provider metadata, encrypted at rest when OS secure storage is available, and never returned to React after storage.
- Codex delegated mode: fail-closed `never` approval policy by default; dangerous bypass is not selected by ND.
- Organization state: atomic writes, last-known-good backup, validation, and interrupted-run reconciliation.
- Organization approvals: explicit company DENY/ALLOW/ASK decisions are enforced in the main process for approval-bearing Harness runs; uncertain classifications fail back to human ASK.

## Repository layout

```text
src/main/                 Electron main process and ND services
src/main/organization/    AI company durable state, orchestration, policy gate
src/main/engines/         coding-engine catalog and employee assignments
src/main/harness/         primary Harness adapter
src/main/browser/         visible browser + agent-browser integration
src/preload/              trusted renderer bridge
src/renderer/             ND product UI
src/shared/               cross-process contracts
configs/dsh/              ND Harness overlay and agent preset
.dsh/skills/              repository-local ND skills
tests/                    product/unit contracts
vendor/deepseek-harness/  pinned runtime submodule
```

## License

Released under the **MIT License** — see [`LICENSE`](LICENSE). DeepSeek Harness and Codex remain third-party runtime dependencies governed by their respective licenses and distribution terms.

---

> **ND-DSH** — Company team first. Built for devs, by real devs. Any CLI engine: Codex, DeepSeek Harness, and many more. · *Not beta yet — just started.* · [Roadmap](docs/roadmap.md) · MIT License
