# ND-DSH — Competitive landscape (Top 5)

> Verified against the public landscape as of **2026-09-20**. Facts below come from the products' own sites, release posts, and 2026 press; sources at the bottom.
>
> Positioning lens follows [better-than-all-agent-harnesses.md](plan/better-than-all-agent-harnesses.md): ND-DSH does not compete as "a slightly better coding agent." ND competes on the **company layer** — companies, projects, roles, AI employees, durable task graphs, verification, provider routing — with coding engines as replaceable adapters.

## The top 5, at a glance

| # | Product | What it is | Where it runs | Closest ND overlap | Biggest ND differentiator |
|---|---------|------------|---------------|--------------------|---------------------------|
| 1 | **Factory.ai** (Factory 2.0 / Droids) | Enterprise "development-cycle automation" platform: Droid agents take tickets (Linear, Notion) to working code | Cloud platform + CLI/IDE/browser/Slack | Ticket → code delegation; agents across the SDLC | ND is a local desktop **company OS** for individual devs/small teams; Factory is an enterprise app-layer rollout. ND owns org state, approval cards, and engine routing locally |
| 2 | **Cognition — Devin** | Autonomous AI software engineer repositioned (2026) as a "collaborative AI teammate" platform for enterprise codebases | Cloud (freemium ~$20/seat, enterprise custom) | AI employees doing end-to-end engineering work | Devin is a **single proprietary worker**; ND orchestrates **any** engine (Harness, Codex, Gemini CLI, goose, …) as interchangeable employees, with the company/task graph/memory kept in ND |
| 3 | **Conductor** | macOS multi-agent IDE: runs many Claude Code / Codex agents in parallel, isolated git worktrees, GitHub/Linear integration, inline reviews | Local Mac app | The nearest UX analog: local app, parallel agents on a board, per-task workspaces | Conductor is Mac-only and engine-pinned to Claude Code/Codex; ND is cross-platform, engine-agnostic, and adds roles/skills/memory/policies + verification + ND Pencil design surface |
| 4 | **Vibe Kanban** (BloopAI) | Open-source kanban board that plans and drives coding agents (Claude Code, Codex, Gemini CLI) in git worktrees, with your own API keys | Local, self-hosted; hosted version sunsetting (community-maintained OSS) | Kanban planning + agent execution + review loop | Vibe Kanban orchestrates **tasks**; ND models a whole **organization** — companies, roles, durable engine assignments, policies, provider accounts, Token Saver. ND is a packaged desktop product, not a repo you run |
| 5 | **GitHub Copilot coding agent** | Assign a GitHub issue to Copilot; it works autonomously in GitHub Actions, opens draft PRs, runs tasks in parallel | GitHub cloud (Actions) | Issue → PR delegation, task-level autonomy | Copilot lives inside GitHub's world only. ND brings multi-engine routing, org workflow, approvals, and its own browser/design surface to the dev's machine; ND can treat any CLI engine as a worker |

## Why these five

- **Factory** and **Devin** define the "AI engineering organization" category at enterprise scale — the market ND's company-OS thesis grows into.
- **Conductor** and **Vibe Kanban** are the products a dev compares ND-DSH against today when they want "many agents working like a team, locally" — they are the closest like-for-like.
- **Copilot coding agent** is the distribution incumbent: every dev already has it. ND must answer "why not just assign the issue to Copilot?"

## Per-competitor notes (ND's edge in one line each)

1. **Factory.ai** — sells to the enterprise engineering org as an application layer over Jira/Linear/GitHub/Slack. ND's edge: local-first, per-dev control plane with fail-closed approvals and no vendor lock-in to one Droid runtime.
2. **Devin (Cognition)** — one autonomous engineer, cloud-hosted, now sold as a collaborative teammate (raised >$1B at a $26B valuation, May 2026; Cognizant enterprise partnership, Jan 2026). ND's edge: workers are swappable adapters — a company can mix Harness, Codex, and future engines without migrating its org state.
3. **Conductor** — best-in-class local parallel-agent UX, macOS only. ND's edge: cross-platform desktop app plus the company model (roles, skills, memory, policies, verification) that Conductor leaves to the user.
4. **Vibe Kanban** — the open-source crowd's choice; hosted version is sunsetting. ND's edge: a real product surface (workforce, Token Saver, ND Pencil, provider accounts) on top of the same engine-agnostic idea.
5. **Copilot coding agent** — zero-setup, issue-driven, but GitHub-bound and single-engine. ND's edge: engine choice, org workflow, and ND-owned state that survives outside any one forge.

## Watchlist (not top 5 yet)

- **OpenHands (All Hands AI)** — open-source autonomous dev agent platform; the OSS platform play.
- **Terragon** — parallel Claude Code fleets in the cloud; converging on Conductor's space.
- **Intent** — newer macOS agent orchestrator, compared against Conductor in 2026 reviews.
- **Cursor / Windsurf** — IDE incumbents; compete for the same dev's attention, not the same job.

## Not competitors: engines are workers

Per [AGENTS.md](../AGENTS.md), Claude Code, Codex CLI, Gemini CLI, goose, DeepSeek Harness (ND Harness), and future CLI engines are **replaceable engine adapters**, not competitors. They are listed in the read-only coding-engine catalog and assigned per AI employee.

## Inspiration already credited in-repo

- **OmniRoute / 9Router** — the desktop pattern behind ND's Token Saver flow ([third-party/token-saver.md](third-party/token-saver.md)).

## Sources

- Factory — [ai.engineer](https://ai.engineer), [ZenML overview](https://www.zenml.io)
- Conductor — [The New Stack review](https://thenewstack.io), [Nimbalyst: Conductor vs Vibe Kanban](https://nimbalyst.com)
- Vibe Kanban — [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban), [vibekanban.com](https://vibekanban.com)
- Devin / Cognition — [Cognizant–Cognition partnership](https://investors.cognizant.com), [2026 funding coverage](https://www.theaiconsultingnetwork.com), [Agentstant review](https://agentstant.com)
- Copilot coding agent — [GitHub: meet the coding agent](https://github.blog), [Microsoft developer docs](https://developer.microsoft.com)
