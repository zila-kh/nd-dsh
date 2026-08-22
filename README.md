# ND-DSH

ND-DSH is a desktop **AI Company Operating System for software delivery**. Instead of treating an AI model as a single chat box, ND owns companies, projects, roles, teams, agents, tasks, workflows, skills, memory, policies, model-provider routes, and coding-engine capabilities.

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
               +--> Codex CLI (delegated one-shot engine)
               +--> future engine adapters
```

ND owns identity, configuration, authorization, orchestration, and durable state. Coding engines own execution details such as the agent loop, shell/process mechanics, filesystem operations, model transport, and product-specific protocol handling.

## Current coding engines

### ND Harness

The primary engine is the pinned DeepSeek Harness runtime, used as infrastructure rather than product identity. ND adds its own provider routing, workspace scope, permissions, browser MCP, agent preset, organization context, and desktop lifecycle around it.

Pinned upstream release: **0.1.0-rc.8**  
Pinned upstream commit: **141eb6fef83422698aef7a981029e843e8161534**

### Codex CLI

The pinned Harness contains `@deepseek-ai/dsh-subagent-codex`, which depends on the official `@openai/codex` package and starts its package-local `codex app-server --stdio` process in the ND workspace. ND exposes that implementation as the `codex` coding-engine capability.

The current Codex integration is deliberately one-shot and delegated. Native Codex authentication, `HOME` / `CODEX_HOME`, model selection, project trust, and account settings remain authoritative. ND does not copy model-provider API keys into Codex credentials.

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
Assigned worker
      |
      +--> workspace files
      +--> shell / tests
      +--> visible browser
      +--> skills / MCP
      +--> optional Codex delegation
      |
      v
Independent reviewer
      |
      +--> pass -> durable memory -> unlock next task
      |
      +--> fail -> blocked or bounded automatic rework
```

Company autonomy levels control how much of that workflow may continue without another explicit human start. Sensitive product actions still need policy enforcement and approval work before ND should be considered an enterprise GA release.

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

Codex authentication is native to Codex. The ND adapter does not create or migrate a Codex account.

## Verification

Before publishing a change:

```sh
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

GitHub Actions runs the same repository invariants, type checks, unit tests, and production desktop build on branch/PR changes.

## Updating the pinned Harness

Harness is a pinned git submodule and must never silently track a moving upstream branch. Update it only through an explicit tag or full commit and review the resulting runtime/config compatibility:

```sh
corepack pnpm dsh:update -- <tag-or-commit>
```

The pin metadata in `vendor/deepseek-harness.json`, the submodule gitlink, this README, and `vendor/README.md` must remain aligned. The current required pin is release **0.1.0-rc.8** at **141eb6fef83422698aef7a981029e843e8161534**.

## Public beta status

The repository is being hardened for a desktop public beta. The runtime path is real; the product renderer must not fall back to mock companies, mock sessions, fake workspaces, or demo provider state when its trusted preload is unavailable.

Remaining release work is tracked separately and includes packaged runtime distribution, installer/signing/notarization, installed-app E2E coverage, normalized policy enforcement at the action/tool boundary across engines, Codex onboarding/auth status, and release/update infrastructure.

## Security boundaries

- Renderer: context isolation on, Node integration off, sandbox on.
- Browser pane: isolated Electron `WebContentsView`; permissions denied by default.
- Browser automation: attaches to the exact visible pane through loopback CDP; no hidden second browser.
- IPC: main-frame sender validation and narrow contracts.
- Workspace: path containment and symlink protections.
- Provider credentials: separated from provider metadata and encrypted at rest when OS secure storage is available.
- Codex delegated mode: fail-closed `never` approval policy by default; dangerous bypass is not selected by ND.
- Organization state: atomic writes, last-known-good backup, validation, and interrupted-run reconciliation.

## Repository layout

```text
src/main/                 Electron main process and ND services
src/main/organization/    AI company durable state and orchestration
src/main/engines/         coding-engine capability registry
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

See `LICENSE` and upstream dependency licenses. DeepSeek Harness and Codex remain third-party runtime dependencies governed by their respective licenses and distribution terms.
