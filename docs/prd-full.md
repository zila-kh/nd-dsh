# ND-DSH — Full Product Requirements Document (PRD)

> **Company team first. Built for devs, by real devs. Works with any CLI engine — Codex, DeepSeek Harness, and many more.**

| | |
| --- | --- |
| Document | Full PRD / feature inventory for new developers |
| Status | **Developer Preview / Private Beta — source builds only.** Public Beta remains blocked on the P0 release gates in §8. |
| Updated | 2026-08-26 |
| Audience | New developers joining ND-DSH who need the complete feature picture without reading every file |
| Related docs | [`../README.md`](../README.md) · [`architecture.md`](architecture.md) · [`ai-company-os.md`](ai-company-os.md) · [`coding-engine-architecture.md`](coding-engine-architecture.md) · [`provider-architecture.md`](provider-architecture.md) · [`roadmap.md`](roadmap.md) · [`plan/token-saver.md`](plan/token-saver.md) · [`qa/token-saver-manual.md`](qa/token-saver-manual.md) |
| License | MIT |

This document is the single exhaustive inventory of what ND-DSH **is**, what it **ships today** (verified against the source), what the **UI does not yet expose**, and what is **planned**. If a feature is listed here as shipped, it exists in code today; if it is listed as a gap, the backend supports it but no renderer surface uses it yet — do not rebuild it, wire it up.

---

## 1. Product summary

ND-DSH is a desktop **AI Company Operating System for software delivery**. Instead of treating an AI model as a single chat box, ND owns the whole organization layer: companies, projects, roles, teams, AI employees, goals, milestones, dependency-aware tasks, workflows, skills, memory, policies, activities, run receipts, model-provider routes, coding-engine contracts, extension routing, and the Token Saver efficiency layer.

The current product is coding-first: an AI PM plans work, assigned workers operate the real workspace and the visible browser, an independent reviewer verifies the result, failed reviews can return to bounded rework, durable memory is recorded, dependencies unlock, and the next task continues automatically according to company autonomy and policy. ND also reduces avoidable model context through a product-owned Token Saver path: conservative prompt optimization at the common engine boundary plus the pinned Harness's own history compaction/tool-result pruning, while optional external-app optimization stays separately opt-in.

### 1.1 Product boundary (non-negotiable)

- ND-DSH is the **product and control plane**. Model vendors and coding runtimes are **replaceable implementation dependencies**.
- DeepSeek is a **model-provider compatibility route**, not product identity.
- DeepSeek Harness is an **upstream-tracking runtime submodule/adapter** (tracks latest `master`; synced at bootstrap or via `dsh:update`). Never copy or patch its core into this repository.
- Codex and future coding products are **replaceable engine adapters**. No engine-specific fields or branching may leak into the organization-domain state machines (Company, Project, Task, Role, Skill, Workflow).
- The embedded `WebContentsView` is the **canonical browser**. Never launch a hidden automation browser for agent tasks; browser tools must share `ND_DSH_AGENT_BROWSER_CONFIG` and `ND_DSH_AGENT_BROWSER_SESSION`.
- Token saving is an **ND product capability**, not permission to scrape provider credentials or install a machine-wide HTTPS interception proxy. Built-in saving and external-app integration are independent scopes.

### 1.2 What ND-DSH is not

- Not a chat wrapper around one vendor.
- Not a mock/demo product: the production renderer **fails closed** when trusted bridges are missing — no mock companies, fake sessions, fake workspaces, or localhost demo pages, ever.
- Not Public Beta/GA yet: source builds and private beta workflows exist, but there is no signed public installer or stability promise until the P0 gates in §8 pass.

---

## 2. Users and personas

| Persona | What they do in ND-DSH |
| --- | --- |
| **Solo developer / founder** | Runs an AI company of one: chats with the agent workbench, lets the AI PM plan, assigns workers, reviews results. |
| **Tech lead / small team** | Creates multiple companies/projects, sets autonomy and policies, routes employees to different coding engines and model providers, watches the run ledger. |
| **Contributor / new developer** | Extends the control plane (IPC contracts, organization domain, engine adapters) without touching pinned vendor runtimes. |

Single-user desktop today; multi-user accounts and admin controls are P2 (see §8).

---

## 3. Core concepts (glossary)

Read this once; the rest of the document uses these terms exactly.

| Concept | Meaning |
| --- | --- |
| **Company** | Primary isolation boundary. Owns mission, autonomy level (0–4), workforce, workflows, memory, policies, projects. New companies are seeded with a default workforce (§4.3). |
| **Project** | Business outcome bound to one technical workspace path and optional repo URLs. Not the same as a filesystem workspace. Status `planning / active / blocked / completed / archived`, computed progress %. |
| **Goal → Milestone → Task** | The planning hierarchy the AI PM produces. Tasks carry `acceptanceCriteria[]`, priority `low/medium/high/critical`, and `dependsOn[]` task ids. |
| **Task statuses** | `backlog → ready → in_progress → review → completed`, with `blocked` for failures/rework. A backlog task becomes `ready` when all dependencies are `completed`. Only `blocked` tasks can be queued for rework. |
| **Role / Team / Agent** | An agent (AI employee) has a role (name, responsibility, system prompt, skills), may belong to a team, has status `idle/working/reviewing/blocked/offline`, a current task, and a last session id. |
| **Skill** | Scoped instructions: `builtin / company / project / team / role / agent`. Ten builtins ship: strategy, project-plan, task-breakdown, implementation, review, qa, research, browser, release, memory. Builtins are force-merged on every load. |
| **Workflow** | Company- or project-scoped steps of kind `plan / execute / review` with optional `requiredRole`. Default: Plan → Execute → Review. |
| **Memory** | Durable tagged context entries with source `human/pm/worker/reviewer`; capped at the last 30 entries per company/project during context assembly. |
| **Policy** | `action + effect` map with effects `allow / ask / deny`. Default-deny-to-ask: unspecified actions resolve to `ask`. |
| **Activity** | Append-only audit log, capped at 500 rows. |
| **Run receipt** | Durable record of a `pm-plan / task-execution / task-review` run: status, harness session id, output (capped 40k chars), error (capped 8k). |
| **Provider** | Supplies a model endpoint (DeepSeek, OpenAI-compatible, Responses-compatible, Anthropic-compatible, provider-native/catalog). Providers are **not** coding engines. |
| **Coding engine** | Supplies an agent/execution environment: **ND Harness** (primary) and **Codex CLI** (delegated one-shot) today. Employees are assigned an engine; the assignment is durable ND state. |
| **Token Saver** | ND-owned context-efficiency layer. Built-in saving combines conservative prompt optimization with Harness history compaction/tool-result pruning; external-app optimization is a separate explicit opt-in. `Off` means the ND prompt optimizer and Harness compaction/pruner are disabled for the next refreshed Harness runtime. |
| **Provider account** | Authentication surface used by an integration, distinct from a model-provider API key. Codex stays on native ChatGPT/Codex auth; Antigravity uses an ND-managed Google OAuth flow. |
| **Surfaces** | Three product views: **Company** (`#/company`), **Agent** workbench (`#/agent`, default), **Settings** (`#/settings`). The hidden Harness web surface is compatibility/debug infrastructure only. |

---

## 4. Shipped features — complete inventory

Everything in this section exists in the source today. Status legend: ✅ shipped.

### 4.1 Desktop shell

- ✅ Electron + React app (`ND · AI Company OS`), single instance, single `BrowserWindow` (1640×980, min 1180×720), strict renderer URL guard (dev origin or packaged file URL only), window-open denied.
- ✅ Hash routing between Company / Agent / Settings; views stay mounted, toggled with `active` class + `aria-hidden`.
- ✅ Titlebar: brand + workspace name, view nav, **camera button "Inspect any app"** (3-second countdown, captures the primary display and sends it to the agent, §4.9), theme toggle, harness status dot + model label, session-sidebar and workspace-pane collapse toggles.
- ✅ Status bar: workspace state, browser loading/ready/idle, workspace name, CDP port, agent-browser link state, runtime port, harness state, "AI Company OS".
- ✅ Theming: `system / light / dark` persisted via the main-process theme service, `data-theme` + `meta[color-scheme]`, pre-hydration `prefers-color-scheme` fallback.
- ✅ Toasts, global **RuntimePrompts "Agent needs you" overlay** that surfaces approvals/questions even outside the chat view.
- ✅ Accessibility basics: `aria-label` on nav/panes/toolbars, `role=tablist/tab`, `role=radiogroup/radio`, `role=separator` on the drag splitter, `role=status/alert` toasts, full keyboard support (mention menus, Esc dismissal).

### 4.2 Agent workbench (chat + composer)

- ✅ Sessions sidebar: New Session, workspace header (refresh/settings/new), session list with busy dot, title, relative time; blank sessions hidden unless active.
- ✅ Thread rendering from live `dsh.onEvent` frames folded with `session.history` (max 50 messages): user entries, streaming assistant messages (chunk → final message), tool cards (running/done/error, `fs_` path line, 2000-char result truncation), todo cards (`todo/write`), approval cards, question cards, error notices.
- ✅ Composer: Enter sends / Shift+Enter newline; prompt cap 100k chars.
- ✅ **Mentions**: `/` as leading token opens the skill catalog (`skill.list` per session, lazy-loaded once); `@` at any word start opens fuzzy file suggestions (`workspace.suggest`, 120 ms debounce, ≤10k-entry index, 30 s TTL). Menu capped at 12, keyboard navigable, hover descriptions; skill items get a violet accent, files get per-extension accents shared with the explorer/editor tabs.
- ✅ **Permission badge**: `read-only / workspace-write / danger-full-access`; changing mode restarts the runtime on the next prompt (launch-time policy).
- ✅ **Context badge**: count of read + edited files; flyout lists EDITED/READ files (click opens) and per-tool invocation counts.
- ✅ **Model picker**: provider groups from `session.models`; opening the flyout live-pings every provider (`providers.ping`) with status dot + latency ms per row; selecting a provider picks its first model; second list for models; "Manage models" deep-links Settings.
- ✅ **Reasoning-effort picker** shown only when the current model advertises efforts; persisted via `session.selectModel`.
- ✅ Send/stop: Stop button cancels the running turn (`harness.stop`); "Harness is working" / "Starting pinned runtime" indicators.
- ✅ **Approval cards**: shield icon, tool name, reason, Allow once / Reject, resolved labels. **Question cards**: single/multi-select options with descriptions, "Other…" free text, retry-safe by rpcId.
- ✅ Setup cards for actionable failures: "Harness not built — run `pnpm bootstrap`", "API key missing".
- ✅ Changed-files banner ("N files changed" + up to 4 chips) and the footnote "Browser actions run in the pane you can see."
- ✅ Editor → chat bridge: floating selection toolbar (Ask agent / Explain / Copy) routes a prompt into the composer and switches to the Agent view.
- ✅ **Built-in Token Saver dispatch**: after trusted extension context is assembled and before either ND Harness or direct Codex receives the turn, the common engine router applies the ND-native conservative prompt optimizer. User prompts are never middle-truncated. Harness launch policy is synchronized against the same Save tokens switch so the pinned runtime's own compaction and tool-result pruning are also disabled when the user selects Off.

### 4.3 AI Company console (Company view)

- ✅ **Company onboarding**: name + mission form. Creating a company **auto-seeds a usable workforce** — 4 roles (Product Manager, Software Engineer, Reviewer, Researcher) with system prompts and builtin skills, 3 teams (Product, Engineering, Quality & Research), 4 agents (AI PM, Builder, Reviewer, Researcher), the default `Plan → Execute → Review` workflow, 7 default policies, and the 10 builtin skills. No empty-state configuration.
- ✅ Multi-company switcher; autonomy selector (0–4, §4.4); "Agent ↗" jump to workbench; **Run next** button.
- ✅ Projects: tab bar with progress % and status, click to activate; inline create (name, objective, workspace path).
- ✅ Goals & milestones: created by the **AI PM plan** button (`planProject`); goal/milestone statuses and progress are derived rollups.
- ✅ **Work board**: 5-column kanban (ready / in_progress / review / blocked / completed); inline task creation (title, required outcome, priority); per-card actions Run (ready), Retry (blocked), Review (review state, disabled while a review session exists); assigned agent shown on cards.
- ✅ **Workforce section**: Teams card, AI workers card with per-agent **coding-engine selector** (`engines.assign`; unavailable engines disabled and marked "(unavailable)"; default `nd-harness`), Skills catalog (builtin/company/project).
- ✅ **Knowledge section**: Memory add form (title + durable context, tagged `manual`) with reverse-chronological list; Policies card with per-action **ALLOW / ASK / DENY** selects.
- ✅ Overview stats: project %, workforce active/total, tasks done/total/blocked, policy gate count; **Live runs** card (last 8 run receipts).

Default policy set: `internal.plan / task.execute / task.review = allow`; `external.publish / production.deploy / money.spend = ask`; `data.destructive = deny`; everything unspecified = `ask`.

### 4.4 Autonomy and the orchestration loop

Autonomy is a company-level dial that never overrides policy (`deny` blocks manual **and** automatic execution; `ask` blocks automatic continuation):

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | Ask | Ask before work; ND-DSH is an organizational console. |
| 1 | Plan | AI may plan; humans drive execution. |
| 2 | Internal (default for new companies) | Safe internal work on explicit user commands. |
| 3 | Workflow | Autopilot: after an explicit start, ready tasks execute and review continues automatically. |
| 4 | Autopilot | Level-3 loop **plus** automatic rework after failed review (bounded to **3 execution attempts** per task); creating a project or raising autonomy to 4 kicks off autopilot automatically. |

The delivery cycle (all shipped):

```text
Company objective
  → AI PM session → structured goal + milestones + dependency-aware tasks (<nd-dsh-plan> JSON)
  → next dependency-ready task
  → fresh worker session (assigned employee + resolved coding engine)
      → workspace files, shell/tests, visible browser when supported, skills/MCP, optional Codex delegation
  → fresh independent reviewer session → <nd-dsh-review> JSON {verdict, summary, issues[], memory[]}
  → pass: complete + durable memory + unlock dependents → next ready task
  → fail: blocked, or bounded autonomy-4 rework
```

- ✅ PM and reviewer outputs use tagged JSON envelopes (`<nd-dsh-plan>`, `<nd-dsh-review>`) so orchestration state is machine-readable while reasoning stays visible in the underlying session. A plan/review run with a missing/invalid structured result fails and blocks the task — ND never invents completion.
- ✅ Each worker/reviewer gets a **fresh session** containing only: selected company/project scope, role/agent instructions, resolved skills (agent+role+team+builtin union), allowed memory (≤30 entries), task requirements + acceptance criteria, previous review feedback on rework, and policies.
- ✅ **Dependency unlocking**: backlog → ready when all `dependsOn` are completed; PM-plan tasks may reference dependencies by title (remapped to ids after insert). Cross-company/project references are rejected.
- ✅ **One-active-run ownership**: only one organization run (across all projects) may be `running`; autopilot `runNext` silently no-ops if another project holds the runtime.
- ✅ **Agent selection** for a task: role matched by name hint → `/engineer/i` fallback → first role; prefers an idle agent of that role.
- ✅ **Cancellation** never counts as completion: stop marks the run failed and the task blocked with an explicit canceled message.
- ✅ **Restart/interruption recovery**: at startup, persisted `running` runs are converted to explicit interrupted failures, interrupted review runs return to `review`, execution runs to `blocked`, working/reviewing agents reset to idle, `run.interrupted` activity logged. No silent auto-resume of partial workspace changes.
- ✅ **Autopilot continuation**: after every run settles, the orchestrator attempts the next step (explicit=false: policy `ask` and autonomy <3 block it); continuation errors pause rather than crash.

### 4.5 Policy gate, approvals, and questions

- ✅ Organization-level policy check **before any run starts** (`assertPolicy`): deny always throws; ask throws unless the run was explicitly user-started; allow proceeds.
- ✅ **Main-process runtime approval gate**: for approval-bearing organization runs, Harness approval frames are classified (conservative regex) into `data.destructive / production.deploy / money.spend / external.publish / runtime.escalation`; `allow` → auto-respond allow-once; `deny` → rejected; `ask`, unknown requests, classification uncertainty, or gate errors → forwarded to the human. **Fail-safe, never implicit allow.**
- ✅ Non-org (direct chat) approvals and all question frames always reach the renderer for human decision.
- ✅ Known limitation (documented, P0 roadmap item): the Harness approval wire exposes tool name + reason only, not arbitrary arguments, so semantic enforcement beyond these classes awaits the normalized ND action envelope (§8, P0-4).

### 4.6 Coding engines

- ✅ **Product-owned engine catalog** with availability checks and capability advertisement:
  - **ND Harness** (`nd-harness`, integration `primary`): available when the vendored CLI bin + patch + presets exist. Capabilities: workspace, filesystem, shell, visible browser, ND skills, MCP, provider-neutral model routing, human approvals/questions, streaming, persistent sessions.
  - **Codex CLI** (`codex`, integration `delegated`): available only when Harness is ready **and** the pinned `@deepseek-ai/dsh-subagent-codex` adapter exists. One-shot: delegates implementation as a single self-contained `subagent_codex` tool call; the ND parent then validates the actual workspace itself. Native Codex auth, `HOME`/`CODEX_HOME`, model selection, project trust, and account settings remain authoritative — ND never copies provider keys into Codex credentials. Browser/skills/MCP/provider-routing/approvals/persistent sessions are **not** advertised for this route.
- ✅ ND only advertises capabilities it actually wires (no aspirational capability flags).
- ✅ **Per-employee engine assignment** is durable ND state (`engine-assignments.json`; absence/unreadable → defaults to `nd-harness`), edited from the Workforce UI; unknown or unavailable engines are rejected before a run starts.
- ✅ **ND Harness adapter** (`src/main/harness/`): spawns the pinned `dsh --profile web --patch <nd-dsh.patch.yml> --no-open --port <free-port>` child (env overrides `ND_DSH_HARNESS_ROOT / ND_DSH_PATCH / ND_DSH_PRESET_DIR`); readiness race (stdout URL regex vs HTTP poll, 120 s deadline); status machine `stopped/starting/ready/running/error`; gateway RPC retry on replaced gateway; graceful SIGTERM shutdown with 4 s kill fallback; durable sessions survive restarts; runtime restarts on provider revision change (next prompt), permission-mode change (launch), and Token Saver built-in policy change (next Harness run/session); pinned-port fallback to a free loopback port.
- ✅ Presets copied fresh into `userData/dsh-home/.agent-presets` each launch; bootstrapped-asset check with an explicit "Run pnpm bootstrap" error.

### 4.7 Model providers and credentials

- ✅ **Provider-neutral routing**: `deepseek` compiles to the Harness-native adapter (`deepseek-official`); every other enabled provider compiles to a generic profile with protocol mapped from its API format (`openai-completions / openai-responses / anthropic-messages`; unknown formats throw). Context labels (128K/1M) parse to numeric windows; base URLs must be absolute http(s).
- ✅ Credentials are injected into the runtime child env as `ND_DSH_LLM_KEY_<sha256-16-of-id>` — **never** into profile JSON; profiles ship via `ND_DSH_LLM_PROVIDERS_JSON` + default provider/model env.
- ✅ **Secure credential storage**: metadata lives in `providers.json` (no keys); keys are encrypted via Electron `safeStorage` into `provider-secrets.json`. On Linux, `basic_text`/`unknown` backends are refused — a new key stays memory-only rather than being persisted insecurely. Legacy plaintext keys are migrated on load. `DEEPSEEK_API_KEY` env remains an optional fallback for the seeded DeepSeek route.
- ✅ **Write-only credential semantics**: the renderer only ever sees `hasApiKey` (`apiKey` is always returned as `''`); replace/clear go through dedicated validated IPC. Decrypted values live only in the main process and the ephemeral runtime child env.
- ✅ **Provider ping**: real HTTP `GET <baseUrl>/models` with Bearer key; classifications ok / auth (401/403) / unreachable (6 s timeout), with latency + status; cached 30 s, force re-probe supported; surfaced in the model picker and Settings.
- ✅ **Provider accounts are separate from model-provider API keys**. Token Saver's account list intentionally exposes only Codex native authentication and Antigravity OAuth in this beta (§4.8); it does not turn every model provider into an OAuth login surface.

### 4.8 Token Saver and provider accounts

Token Saver is built into ND and is **not API-key-only**. Built-in ND saving works independently of external CLI/app integration.

- ✅ **Default behavior**: **Save tokens in ND** is on by default in **Automatic** mode. Modes are `Off / Automatic / Advanced`; Advanced exposes **Quality protection**, which falls back to original content if an optimization cannot be applied safely.
- ✅ **ND-native prompt optimization** runs at the common engine dispatch boundary after trusted extension context is assembled. It is deliberately conservative: line-ending/trailing-space/excessive-blank normalization only; ND never middle-truncates a user instruction.
- ✅ **Generic/tool-output optimization** supports deterministic repeated-line collapse and bounded head/tail clipping. Any lossy ND-native result stores the original in a bounded local recovery store and returns a recovery reference; the built-in demo verifies that recovery round-trip locally.
- ✅ **Harness-native compaction is part of the same built-in switch**. When saving is enabled, ND leaves the pinned Harness's `compaction-basic` and `compaction-tool-result-pruner` active; when the user selects Off, the next refreshed Harness runtime disables both. Durable Harness sessions survive that launch-policy refresh.
- ✅ **Telemetry is count-only**: original characters, optimized characters, avoided characters, operation count, fallback count. The Settings savings number is explicitly **ND-local measured savings**; Harness compaction savings are not invented or folded into that percentage without exact telemetry.
- ✅ **External apps are separate and off by default**. The external master switch changes nothing until the user also enables a supported app. No root certificate, transparent TLS interception, system-wide proxy, or credential scraping is used.
- ✅ **External Codex beta integration**: ND downloads pinned RTK `v0.42.4` only after explicit opt-in; supported helper payloads are macOS arm64/x64, Linux arm64/x64, and Windows x64. ND verifies the published archive SHA-256 before extraction, verifies the executable reports the pinned version, records the extracted binary SHA-256 in an ND install manifest, rechecks it before reuse, and repairs legacy/unverifiable installs by rebuilding from the pinned release rather than executing them.
- ✅ **Codex restore safety**: ND captures exact before-state for `~/.codex/AGENTS.md` and `RTK.md`, records managed hashes, and restores only where safe. User edits made while Token Saver is enabled are preserved instead of being blindly overwritten/deleted. Codex authentication is never part of this backup.
- ✅ **Codex account** stays native. ND launches the pinned official `codex login` / `codex logout` flow and detects native auth state, but never reads, copies, stores, or translates the Codex access/refresh credential.
- ✅ **Antigravity account** uses ND-native Google browser OAuth: ephemeral loopback `127.0.0.1` callback, random state validation, offline refresh access, Antigravity Cloud Code/userinfo scopes, account email discovery, and refresh-token rotation handling. Tokens are protected with Electron `safeStorage`; on Linux `basic_text`/insecure storage, the credential remains memory-only for that app session instead of being persisted.
- ✅ **Antigravity external optimization is intentionally not exposed yet**. It is labeled **Account only** in this beta; the UI does not pretend its current rule integration is equivalent to the safely managed Codex path.
- ✅ **Account scope is intentionally narrow**: only Codex and Antigravity connect/disconnect controls are shown. Claude, Gemini, OpenAI-native, and other OAuth buttons remain absent until ND has provider-appropriate, reviewable auth/integration paths.

### 4.9 Browser pane, UI inspection, annotation, app capture

The invariant: **the browser the user sees is the browser the agent drives.**

- ✅ One sandboxed `WebContentsView` (partition `persist:nd-dsh-browser`): permissions auto-denied, window-open navigates in place, URL allowlist http/https/about:blank, will-navigate guard; starts at `about:blank` (never a dev-server page). Toolbar: back/forward/reload (history-aware), address bar with https security dot, open-in-system-browser.
- ✅ **CDP binding**: the app runs with `--remote-debugging-port` (env `ND_DSH_CDP_PORT` honored only if bindable on 127.0.0.1, otherwise a free port); the controller reads the pane's exact CDP `targetId` via `webContents.debugger` and rebinds on navigation/renderer-gone. Loopback only.
- ✅ **Agent-browser integration**: the vendored `agent-browser` CLI is bound to that exact target (`tab <targetId>`), sharing one generated config (`userData/agent-browser.visible.json`, pinned session `nd-dsh-visible-browser`, screenshot dir `userData/browser-artifacts`, 30-minute idle timeout) and session env (`ND_DSH_AGENT_BROWSER_BIN/_CONFIG/_ENTRY/_SESSION`, `AGENT_BROWSER_CONFIG`, `AGENT_BROWSER_SESSION`) so the agent's MCP browser tool reaches the same visible tab — a second hidden browser is impossible by construction.
- ✅ **Interactive snapshot** button: semantic snapshot of the live page for the agent.
- ✅ **UI inspect mode**: in-page capture of tag/text/selector, bounded outerHTML (6k), ≤48 attributes, ~45 computed styles, ≤18 matched CSS rules with `file:line` source confidence (`exact/mapped/framework/inferred`) and React component hierarchy; selections ride the prompt as a hardened `[ND-DSH LIVE UI CONTEXT]` JSON block and are stripped from renderer-visible history.
- ✅ **Annotation mode**: frozen-frame overlay for freehand/rectangle/point marks; finishing produces a JPEG (≤1600px, ≤3.2MB) that rides the prompt as an image block.
- ✅ **Inspect any app (cross-app capture)**: primary-display screenshot (downscaled ≤1600px PNG) sent from the main process straight into the chat session with a fixed inspection prompt, optionally copied to clipboard; image bytes never cross renderer IPC. Replaces (never combines with) browser UI context in a prompt.

### 4.10 Workspace, files, editor

- ✅ Workspace picker (OS directory dialog) and open-by-path; switching roots stops the runtime first.
- ✅ File listing (≤500 entries; skips `.git`, `node_modules`, `out`, `dist`, `.dsh`, `.sessions`; no symlinks) and file read (≤1MB with truncation flag, realpath containment check).
- ✅ **@-mention file index** powering composer suggestions (§4.2).
- ✅ File explorer tree + editor tabs share one accent palette with mention chips.
- ✅ Editor with text selection → Ask agent / Explain / Copy bridge.

### 4.11 Settings

- ✅ **General**: workspace picker/open-by-path; ND runtime rows (adapter status, model route/provider, credential readiness, active session id, runtime error); agent-browser rows (link state, CDP port, current page); product-boundary blurbs; About (version, platform, project root).
- ✅ **Appearance**: system/light/dark.
- ✅ **Models**: provider list + add provider (OpenAI-compatible default); per-provider rename, enable/disable, **Test connection** (real ping with "Online · Xms · HTTP N" / "Reachable · credential rejected" / "No answer · timeout or network error"), delete; base URL; API-format select (native/catalog, chat completions, responses, Anthropic messages, OpenAI-compatible); **credential UI with write-only semantics** (stored/absent badge, save/replace/clear, show/hide); model list management (add/rename/context/delete).
- ✅ **Token Saver** (shown with Coding engines): Save tokens in ND switch; Off/Automatic/Advanced mode selector; Advanced Quality protection; ND-local savings estimate + Reset; deterministic **Run demo** with local recovery verification; external-app master switch; per-app Codex opt-in/setup state; Antigravity **Account only** scope; Codex/Antigravity connect/disconnect/refresh account controls.
- ✅ **Coding engines**: read-only catalog (ND Harness primary, Codex CLI delegated) with availability, capability summary, and unavailable reasons.
- ✅ **Agent presets**: list shipped + local presets; per-preset "New session" and "Set default".

### 4.12 Persistence and failure behavior

Durable state under Electron `userData`:

| File | Contents |
| --- | --- |
| `organization.json` (+ `.bak`) | Full org snapshot v1 (companies → run receipts). Atomic temp+rename writes, serialized saves; load recovery primary → backup → defaults; schema validation, builtin re-merge. |
| `engine-assignments.json` | Per-employee engine routes; unreadable → defaults with warning. |
| `providers.json` / `provider-secrets.json` | Provider metadata (no keys) / safeStorage-encrypted keys; atomic writes. |
| `settings.json` | Theme, active surface, permission mode. |
| `dsh-home/` | Harness home + presets copied per launch. |
| `sessions/` | Durable Harness sessions (`DSH_SESSION_ROOT`). |
| `agent-browser.visible.json`, `browser-artifacts/` | Agent-browser config and screenshots. |
| `token-saver/state.json` | Token Saver settings and count-only savings/fallback counters; no raw prompt/log content. |
| `token-saver/recovery/` | Bounded local originals referenced by lossy ND-native generic/tool-output optimizations. |
| `token-saver/provider-accounts.json` / `provider-account-secrets.json` | Antigravity account metadata / safeStorage-encrypted OAuth token material. Codex native credentials are never copied here. |
| `token-saver/rtk/v0.42.4/` | ND-managed pinned RTK helper plus binary-integrity manifest; reused only when the recorded hash still matches. |
| `token-saver/backups/codex.json` | Exact pre-integration Codex `AGENTS.md` / `RTK.md` backup metadata + managed hashes for safe restore. |

- ✅ **Fail-closed contract** (each row is shipped behavior, not aspiration):

| Failure | Behavior |
| --- | --- |
| Trusted preload / org bridge missing | Renderer shows "ND runtime unavailable"; never demos/mocks. |
| Missing/unbuilt Harness | Engine unavailable; run rejected **before** a false receipt exists. |
| Missing/unbuilt Codex adapter | New Codex assignments rejected; existing Codex work rejected before starting. |
| Codex auth/trust failure | Visible failure/blocker; ND does not invent completion. |
| Missing provider credential | Real model error surfaces; never a fake result. |
| Secure store unavailable | Provider key stays memory-only; never persisted insecurely. Antigravity OAuth likewise becomes session-only on insecure Linux storage. |
| Browser bridge unavailable | Visible browser stays manual; agent-browser capability reports unavailable. |
| Approval-gate failure/classification uncertainty | Falls back to human ASK; never implicit allow. |
| App restart mid-run | Stale run reconciled as interrupted/failed. |
| Corrupt org state | Backup snapshot recovery, else validated defaults. |
| ND Token Saver optimization failure | With Quality protection, original content is used and a fallback is counted; normal chat remains available. |
| External Codex setup/download failure | External setting rolls back; built-in ND Token Saver remains independent/on if it was on. |
| RTK install/manifest/hash mismatch | Install is treated as invalid and rebuilt from the pinned digest-verified release before execution. |
| External Codex disable after user edits | ND restores only files still equal to its managed hash (or safely missing); user-modified managed files are preserved. |

### 4.13 Security boundaries (shipped invariants)

- Renderer: context isolation **on**, Node integration **off**, sandbox **on**, web security **on**.
- IPC: main-frame sender validation (`event.sender === window.webContents`), bounded/validated inputs, narrow contracts; no Node exposure to React.
- Browser: permissions denied by default; external URLs HTTP/HTTPS only.
- Workspace: path containment with realpath/symlink protections.
- Credentials: separated from metadata, encrypted at rest when possible, never returned to React after storage.
- Token Saver: no root certificate/system-wide HTTPS interception, no native Codex credential extraction, no raw prompt/log content in savings counters, and unverifiable external helpers are never reused/executed.
- Antigravity OAuth: browser authorization + ephemeral loopback callback + random state validation; refresh tokens persist only through secure `safeStorage`, otherwise memory-only.
- Codex delegated mode: fail-closed `never` approval policy by default; the dangerous bypass is never selected by ND.
- Org state: atomic writes, last-known-good backup, validation, interrupted-run reconciliation; org approvals enforced in the main process.

---

## 5. Known gaps — backend exists, no UI yet

Do not rebuild these; the domain and IPC already support them (see `src/shared/organization.ts` mutation contract):

- Manual creation/editing of **roles, agents, teams, skills, workflows** (`role.create`, `agent.create`, `team.create`, `skill.create`, … are validated mutations with no renderer caller). Company creation seeding is the only workforce path today.
- Manual **goal/milestone creation** (`goal.create` unused; planning is PM-only today).
- Manual **task dependency editing** (`dependsOn` is PM-set only) and task assignment editing.
- **Project update** surface (status/repo-URL editing).
- Explorer **Search** and **Source Control** tabs are placeholders.
- No agent **trajectory inspection view** (full trajectory lives in the harness session store).

Legacy/unused renderer components: `ActivityRail.tsx`, `LeftSidebarToggle.tsx`, `RightSidebarToggle.tsx` (App has its own toggles).

Token Saver scope that is **intentionally deferred rather than a hidden backend/UI gap**: external Antigravity optimization, additional provider-account OAuth buttons, and broader external-app connectors remain out of this beta until ND has safe provider-appropriate integration contracts.

---

## 6. Non-functional requirements

- **Trust**: fail closed everywhere; no mock/demo fallbacks in production paths (AGENTS.md hard rule).
- **Determinism**: org state transitions are validated; runs produce explicit receipts; cancellation/interruption never masquerade as completion.
- **Isolation**: companies are hard isolation boundaries; no silent cross-company reuse of roles/memory/policies/workforce.
- **Replaceability**: no engine- or vendor-specific fields in organization-domain objects.
- **Efficiency without instruction loss**: Token Saver may remove redundant/noisy context but must not middle-truncate user instructions; lossy ND-native generic/tool-output transforms are locally recoverable; failed optimization falls back safely when Quality protection is active.
- **Verification gate**: `pnpm verify`, `pnpm typecheck`, `pnpm test`, `pnpm build` must pass before publishing changes; CI runs the same invariants. Desktop smoke tests are also part of CI for beta-facing changes.
- **Dev tooling**: Node 24+, pnpm 11 via Corepack; `corepack pnpm bootstrap` initializes the submodule runtime and syncs Harness to upstream latest; `corepack pnpm dsh:update` re-syncs on demand (an explicit tag-or-commit is available for debugging/downgrades), recording provenance in `vendor/deepseek-harness.json`.

---

## 7. Success metrics (how we judge the loop)

- A clean machine can go install → company → PM plan → worker edits real workspace → reviewer pass → project 100% (today: source build only; P0 makes it an installed-app E2E).
- No run ends in an ambiguous state: every receipt is completed/failed with a real reason.
- Every sensitive action is either auto-allowed by explicit policy, denied, or shown to a human — never silently allowed.
- Engine/provider swaps never require changes to organization-domain data.
- Token Saver **Off/On semantics are exact**: Off preserves normal chats while disabling ND prompt optimization and Harness compaction/pruning on the refreshed runtime; Automatic restores the built-in stack without enabling external apps.
- External token saving never becomes an implicit machine-wide change: fresh installs keep External apps off, app integrations require explicit per-app opt-in, and disabling a managed integration restores only ND-owned changes without touching provider authentication.
- Savings reporting never trades trust for a larger number: UI counters use measured ND-local reductions only and do not claim unmeasured Harness savings.

---

## 8. Roadmap

Full detail in [`roadmap.md`](roadmap.md); this is the authoritative summary. Ordered by release risk; coding-first — business templates come after the software-company loop is reliable.

### Shipped foundation (today, source builds)

Everything in §4 — the coding-first vertical slice running on real desktop/runtime state, including the ND-native Token Saver, Harness compaction/pruning control, Codex external beta integration, and Codex/Antigravity account surfaces.

### Public Beta P0 — release the desktop safely (blockers, not polish)

| # | Theme | Requirements | Success criterion |
| --- | --- | --- | --- |
| 1 | Runtime distribution | Bundle Node-compatible runtime (or remove external Node dep), pinned Harness build + runtime packages, per-platform agent-browser; bootstrap becomes dev-only — installed apps must not need Git/pnpm/submodules/toolchain; license/notices verification. | Clean machine installs and starts the real runtime offline from dev tooling. |
| 2 | Signed installers & updates | Production packager locked in-repo; macOS signing + hardened runtime + notarization; Windows code signing; update signature verification + channel policy; icons/bundle ids/uninstall/migration. | Downloaded installers are OS-trusted and update without replacing org/session state. |
| 3 | Installed-app E2E | Automated smoke: install → launch → bridge → workspace → browser bound → fixture provider → company/project → PM plan → worker edit → reviewer pass → 100% → close/reopen with state intact; negative coverage for cancel, crash/restart, missing engine, corrupt org state, rejected approval, missing credentials. | Release artifacts, not source builds, are the proof. |
| 4 | Policy/action normalization | ND action envelope (action, target, risk, externality, destructive scope, cost, provenance) emitted by ND-owned tools/engine adapters; map browser external writes, deployments, remote Git, destructive data, purchases, messaging to company policy pre-execution; durable decision/audit receipts; fail-closed when metadata is insufficient. | Sensitive actions governed consistently across Harness, Codex, browser/MCP, and future engines. |
| 5 | Engine onboarding & health | Codex installed/authenticated/project-trust checks without copying native Codex credentials into ND; distinguish availability/auth/degraded/rate-limited in Settings; actionable remediation before assignment. | Users know why an engine isn't ready; ND never fabricates readiness. |
| 6 | Token Saver release proof | Installed-app coverage for built-in Off/Automatic/Advanced behavior, deterministic demo/recovery, Harness policy refresh, first-time external Codex download/integrity/install/restore, legacy/tampered helper repair, external failure rollback, Codex native auth preservation, and Antigravity secure-storage/session-only fallback. | Token reduction is provably optional, recoverable where lossy, auth-safe, and does not degrade normal ND operation when external setup fails. |

### Public Beta P1 — best-in-class AI development environment

- **Editor & code intelligence**: Monaco with controlled write IPC + optimistic conflict detection; per-workspace LSP supervisor (diagnostics, symbols, definitions, references, rename, code actions); Problems/Output panels linked to agent runs; Git status/diff/staging/commit with policy gates for remote mutations.
- **Terminal**: PTY terminal with process-group cleanup; explicit terminal permission mode + action tagging; attach running jobs/test output to task/run receipts.
- **Browser engineering surface**: multi-tab on known CDP target ids; console/network drawers; device/viewport presets; screenshot history; element highlight/inspect overlays; action timeline tying browser state to agent tool calls; per-origin privacy controls and data reset/private mode.
- **ND Skills & MCP control plane**: durable MCP registry (transport, credentials, health, scope, allowlists); ND skill schema (scope, instructions, required capabilities, allowed tools, engine hints); Harness compiler (+ Codex compiler when the direct adapter supports it); capability inspector showing the exact resolved skills/tools/MCP/policies per run. Changing engines must not rebuild company skills config.
- **Provider/model routing**: provider templates without vendor conditionals; live model discovery; route inheritance (company/project/role/agent/task); capability metadata (context, reasoning, vision, tool calling); cost/token/latency budgets; health, circuit breakers, fallback routes, routing audit; credential-source metadata (`secure-store / environment / ambient`). Token Saver telemetry may join this routing view only when provider/Harness measurements are exact enough to avoid fabricated savings.

### P2 — enterprise company operations + richer engines

- Durable policy/audit ledger (actor, engine, model, action, approval, evidence, result); budgets/quotas/SLOs; scheduled + conditional workflows with bounded retries; cross-project objectives and portfolio planning; team/user accounts and admin controls; enterprise identity, managed config, export/retention, backup/restore; remote supervision of a desktop execution host.
- **Richer coding engines**: direct persistent Codex app-server adapter (thread/resume/progress) if one-shot delegation becomes limiting; Claude Code and other adapters behind the same ND contract; local/offline engine adapter; remote/cloud workers with the same company/task/policy receipts. No engine may require vendor-specific fields in domain objects.
- **Broader Token Saver/external routing**: add provider-appropriate external connectors and account flows only when they preserve native auth boundaries and have deterministic install/disable/restore semantics; do not generalize by credential extraction or machine-wide MITM.

### Release labels

- Until P0 passes: **ND-DSH Developer Preview / Private Beta** (source builds only).
- After P0: **ND-DSH Public Beta** with explicit supported-OS/provider/engine limits.
- **Enterprise-ready / GA** is reserved for the normalized action-policy layer, audit/admin controls, release operations, and support commitments — never just a successful desktop build.

---

## 9. Explicit non-goals (for now)

- No hidden automation browser, ever — the visible `WebContentsView` is canonical.
- No fork or patch of the Harness agent loop; composition happens at the gateway/runtime boundary.
- No vendor-locked organization domain.
- No mock companies/fake sessions/demo workspaces in production paths.
- No copying of model-provider API keys into Codex credentials.
- No machine-wide root certificate, transparent HTTPS interception, or system proxy as the Token Saver architecture.
- No reading/copying/repackaging of native Codex OAuth/ChatGPT credentials for Token Saver.
- No unsupported OAuth/provider-account buttons presented as production-ready; Codex and Antigravity are the intentionally bounded beta account set.

---

## 10. Developer quickstart

```sh
git clone --recurse-submodules https://github.com/zila-kh/nd-dsh.git
cd nd-dsh
corepack enable
corepack pnpm bootstrap
corepack pnpm dev
```

Configure model providers in **Settings → Models**. Token Saver is configured entirely from **Settings → Coding engines**; normal users do not need environment variables, localhost endpoints, or manual RTK installation. Before publishing any change:

```sh
corepack pnpm verify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Repository orientation: `src/main/` (Electron main + ND services: `organization/`, `engines/`, `harness/`, `browser/`, `capture/`, `token-saver/`), `src/preload/` (trusted bridges), `src/renderer/` (product UI), `src/shared/` (cross-process contracts), `configs/dsh/` (Harness overlay + agent preset), `.dsh/skills/`, `tests/`, `vendor/deepseek-harness/` (pinned submodule — do not patch).

---

*ND-DSH — Company team first. Built for devs, by real devs. Any CLI engine: Codex, DeepSeek Harness, and many more. · Developer Preview / Private Beta · MIT License.*