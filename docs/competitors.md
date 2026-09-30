# ND-DSH competitive landscape

Reviewed: **2026-09-30**. Scope: global developer teams and agencies.

ND is a private beta with no paying customers reported by the owner. This is a
source-backed market comparison, not a hands-on competitor benchmark. Public
pages establish advertised capabilities, not comparative quality or reliability.
Unknown capabilities remain unknown.

See the [market audit and R&D plan](research/market-audit-2026-09-30.md) for customer
priorities, product gaps, validation experiments, and commercial recommendations.

## Closest competitors

| Product | Verified public offering | Implication for ND |
| --- | --- | --- |
| [Conductor](https://www.conductor.build/) | Claude Code, Codex, Cursor, and OpenCode; isolated cloud microVMs, shared workspaces, and real-time collaboration. Its download surface lists macOS. | Multi-engine orchestration is established competition. ND must prove a better specific workflow; Windows support alone is insufficient. |
| [Paperclip](https://paperclip.ing/) | Open-source agent management with roles, goals, budgets, tickets, governance, multiple companies, and runtime adapters; local or remote deployment. | The company-control-plane thesis already has direct competition. ND's desktop execution and checkpoint-bound delivery need measurable value. |
| [Vibe Kanban](https://www.vibekanban.com/) | Multi-engine tasks, parallel local worktrees, code review, browser QA, and collaborative issue tracking. Its site announces sunsetting with community-maintained open source continuing. | A free alternative sets a strong baseline. Interview users about migration needs; sunsetting does not establish an available customer base. |

## Additional direct alternatives

These products overlap coding delivery. Inclusion is not a market-share ranking.

| Product | Verified public offering and availability | Implication for ND |
| --- | --- | --- |
| [Warp Terminal](https://www.warp.dev/terminal) and [Warp Factories](https://www.warp.dev/factories) | Terminal advertises multiple coding agents, branch/worktree/PR session context, code review, and Mac/Linux/Windows downloads. Factories advertises model/harness choice, versioned factory definitions, evaluations, and customer-cloud deployment; it is **early access**. | A terminal-led orchestration alternative. Reusable delivery configuration and model choice need stronger proof than a feature checklist. Do not treat early access as demonstrated general availability. |
| [Linear coding sessions](https://linear.app/changelog/2026-06-11-coding-sessions) and [coding environments](https://linear.app/changelog/2026-08-20-coding-environments) | Linear Agent uses Claude Code and Codex for cloud coding sessions, with issue/workspace context. Its August update adds environment setup and browser testing with before/after screenshots. | The existing issue tracker can own intake, execution, and review. ND must justify the additional desktop step; begin with useful handoff instead of rebuilding a tracker. |
| [Xum, formerly Mux](https://github.com/coder/xum) | Coding-agent workspace with its own agent loop, multiple models, local directories/worktrees or SSH execution, Git divergence, and cost/token visibility. The repository records the rename and an AGPL-3.0 license. | Direct comparison for parallel local work and session visibility. Multiple models do not establish support for interchangeable external CLI engines. Study the workflow; this review proposes no source integration. |
| [JetBrains Air](https://www.jetbrains.com/air/) | Agent work inside JetBrains IDEs includes parallel sessions, compatible agents, and inline diff review. **Air Teams is early access**, advertising shared cloud environments, access management, automation, and governance. | The developer's existing IDE can become the orchestration surface. Compare onboarding and review effort; do not summarize Air solely as a separate Mac app. |
| [Nimbalyst](https://nimbalyst.com/) | Visual workspace for Codex/Claude Code with sessions, tasks, worktrees, code review, docs, diagrams, and mockups. It advertises Mac/Windows/Linux downloads, multiplayer, a free individual offering, and Teams free during beta. | Strong overlap with ND's coding-plus-design story. Cross-platform availability, a visual workspace, and task boards are insufficient uniqueness claims. Validate ND Pencil through changes to real project source. |

## Incumbents and broader substitutes

| Product | Verified public offering | Implication for ND |
| --- | --- | --- |
| [Cursor](https://cursor.com/pricing) | Teams lists cloud agents, shared context, code review, analytics, privacy mode, and SSO; displayed Standard plan: USD 40/user/month. [Cloud Agent documentation](https://cursor.com/docs/cloud-agent/capabilities) describes computer use and screenshots/videos/log references attached to PRs. | Competes for daily workflow and team budget. Evidence artifacts are already an advertised baseline. An engine integration can also be a commercial substitute. |
| [Codex](https://openai.com/codex/) | Parallel agents, browser/computer verification, cloud environments, code review, and plugins. [The app introduction](https://openai.com/index/introducing-the-codex-app/) documents worktrees and scheduled automations. | These capabilities are competitive baseline features, including on Windows. ND needs value beyond the existing subscription. |
| [Claude](https://claude.com/pricing) | Claude Code is included in paid plans; Team adds administration and spend controls. Standard seats display USD 25 monthly or USD 20/month billed annually. | General work plus coding already exists elsewhere. A buyer may not need another control plane. |
| [Factory](https://factory.com/) | Governed delivery across desktop, terminal, web, and CLI; model routing, mission control, analytics, automations, and local agent hardware. | Do not describe it as cloud-only or merely a ticket wrapper. Model choice and governance are not unique ND features. |
| [Devin](https://devin.ai/pricing) | Desktop, CLI, Cloud, multiple model providers, collaboration, and enterprise deployment controls. Displayed Teams pricing: USD 80/month plus USD 40/month per full developer seat. | The single-proprietary-worker description is too narrow. Compare actual agency workflows. |
| [GitHub Agent HQ](https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/) | GitHub's February 2026 announcement introduced Claude and Codex in public preview alongside Copilot, with shared work and review context. | Broader than a single-engine issue-to-PR agent. The announcement's preview status does not establish today's entitlements. |
| [OpenHands](https://www.openhands.dev/) | Open platform for cloud coding agents; inspectable, extensible foundation supporting local and self-hosted deployment. | Local ownership and openness alone are weak differentiation. Compare setup effort and delivery outcomes. |
| [Lovable](https://lovable.dev/pricing) / [Replit](https://replit.com/pricing) | Lovable advertises chat-based web-app creation and workspace credit pools; Replit presents integrated agent/app building with usage-based pricing. | Adjacent substitutes for new apps and prototypes. Existing-repository maintenance is a better initial hypothesis for ND. |

Prices were displayed on public pages on the review date. Usage, billing cycle,
taxes, geography, and plan selection affect comparisons. Retrieved Lovable and
Replit pages did not expose reliable current plan-card amounts; none are quoted.
These prices are context, not evidence of willingness to pay for ND.

## Adjacent workflow references

These products compete for parts of the workday or provide useful interaction
patterns. They are not all substitutes for repository delivery. Proposed ND
adaptations below are judgments, not capabilities claimed by these vendors.

| Reference | Primary-source evidence | Pattern worth testing in ND |
| --- | --- | --- |
| [Raycast v2](https://manual.raycast.com/new-in-v2) | Screen Awareness, reusable agents/skills, and chat-project context accompany the launcher workflow. | Short route from a command to a scoped task. Show captured context and destination before sending client material to an agent. Do not assume feature parity across operating systems. |
| [Perplexity Computer](https://www.perplexity.ai/products/computer) | Advertises background workflows, recurring tasks, subagents, skills, and connected services. Duration claims are vendor claims, not reliability measurements. | Visible durable status, clear requests for human input, and understandable outputs. Local schedules still need a running host; do not infer laptop-off execution. |
| [Notion AI](https://www.notion.com/product/ai), [Developer Platform announcement](https://www.notion.com/en-gb/blog/introducing-developer-platform), and [External Agents help](https://www.notion.com/en-gb/help/category/external-agents) | Custom Agents automate workspace tasks. The May announcement introduces hosted Workers in public beta and an External Agent API through private-beta access; current help lists Claude/Cursor integrations as beta. | Agent assignment and progress inside the workspace where people already coordinate. Treat API access and commercial terms as separate validation before proposing an ND integration. |
| [Dia](https://www.diabrowser.com/) and [Comet](https://www.perplexity.ai/comet) | Dia presents cross-tab context and browser profiles; its page lists macOS with Windows coming soon. Comet presents browser assistance across desktop/mobile. | Keep the task, relevant pages, and permission to act visible together. These pages do not establish ND's required browser security or approval contract. |
| [Pinokio](https://desktop.pinokio.co/) | Local app discovery, installation, launch/control, runtimes, and logs across Mac/Windows/Linux. | Clear install/start/stop/update state for future local capabilities. One-click installation is not evidence of an OS security sandbox or recoverable task execution. |

## Corrections to the previous comparison

1. **Conductor is broader than two engines on one local Mac.** Its current page
   describes four engines, cloud sandboxes, and multiplayer workflows.
2. **Devin is broader than one proprietary cloud worker.** Its pricing page
   describes multiple providers and desktop/CLI/cloud surfaces.
3. **GitHub supports multi-provider agent workflows.** Include Agent HQ.
4. **Paperclip directly overlaps the company layer.** Roles and multi-company
   support do not distinguish ND by themselves.
5. **Adapters can also be substitutes.** Architectural replaceability does not
   stop customers choosing Cursor, Claude Code, or Codex instead of ND.
6. **Cross-platform architecture is not a validated cross-platform release.**
   ND's documented private artifact is Windows; other OS releases need proof.
7. **Local member profiles are not authenticated multi-machine collaboration.**
   The [local/cloud plan](plan/nd-local-cloud-admin-product-split.md) distinguishes
   local attribution from strong identity and synchronization.
8. **Competitive superlatives require matched evidence.** Funding claims, broad
   homepage links, and adapter counts do not establish better delivery quality.
9. **Several inspiration entries are direct alternatives.** Warp, Linear coding
   sessions, Xum, JetBrains Air, and Nimbalyst overlap delivery. Compare the job
   customers buy, not just the product category or interface.
10. **Keep names and access status current.** Use Xum with the former Mux name for
    recognition. Warp Factories and Air Teams advertise early access. Notion's
    announcement is dated evidence of beta access, not proof of current API
    entitlement or pricing. Do not carry its expired free-until-August offer
    into a September pricing claim.
11. **A local task cannot execute on a sleeping or powered-off host.** Persistent
    state can support recovery when the host returns. Continuous remote
    execution requires a separate runtime and operating model.
12. **Do not equate supporting evidence with guarantees.** Artifact attachment
    does not prove correctness; worktrees do not isolate network/credentials;
    local app environments do not establish a security sandbox. State each
    verified capability separately.

## R&D additions: what to adapt and when

The [market audit](research/market-audit-2026-09-30.md#rd-priorities) owns release
and customer-validation gates. Use these patterns as staged experiments.
All targets below are proposed, and implementation depends on the preceding gate.

| Order | Adaptation | ND scope and proposed evidence |
| --- | --- | --- |
| First: unblock beta | Reliable, recoverable delivery | Complete the audit's live-provider, cancellation, interruption, conflict, and onboarding gates before expanding unattended work. Measure accepted outcomes and actionable failures separately. |
| Next: pilot priority | Review receipts and artifacts | Build on [checkpoint verification](../src/main/organization/control-plane.ts). Bind the diff, acceptance criteria, test results, relevant screenshots, and reviewer verdict to the reviewed checkpoint. A later change invalidates that evidence. Target 8/10 reviewer decisions without searching raw logs; review export for client data exposure. |
| Next: pilot priority | Divergence and accepted-task cost | Surface the relationship between human checkout, task baseline, current checkpoint, and integration state from [task worktrees](../src/main/organization/task-worktree.ts). Combine [budget evidence](evidence/compute-budget-correctness.md) with failed runs and reviewer/retry cost. Test stale-review and dirty-checkout drills; do not publish a savings percentage without matched accepted-task results. |
| After repeated demand | Intake to bounded task | Start with manual issue text and receipt export, then one GitHub/Linear connection. Preserve source link, company/project, acceptance criteria, owner, and duplicate detection. In 10 representative tickets, require an operator-approved task and account for correction time before measuring any time saved. |
| After the core loop | Reusable delivery configuration | Prototype an explicit, versioned export of roles, skills, policies, provider-route references, schedules, and tool requirements. Existing [company snapshots](../src/shared/organization-snapshots.ts) are not proof of a portable export. Exclude credentials, client memory, machine paths, and runtime state; preview import changes. Record tested versions without freezing the upstream-tracking Harness during beta. Test on a fresh workspace with dummy credentials. |
| After onboarding evidence | Launcher, skills, and chosen context | Use the existing [launcher contracts](../src/shared/quick-launcher.ts) and [command registry](../src/renderer/src/lib/command-registry.ts). Test one frequent agency action, with selected company/project and captured material visible. Compare against the current route in 10 attempts; prioritize only if effort falls without context mistakes. |
| After recovery gates | Persistent schedules and browser actions | Build on the [schedule runner](../src/main/organization/schedule-runner.ts): define missed-run behavior, duplicate prevention, cancellation, and visible failure. Test restart/network-loss recovery. Browser work must use ND's canonical visible embedded browser/session and workspace policy; show the destination and human gate for consequential actions. Remote execution remains a separate later decision. |
| Later, after usage proves need | Capability discovery and marketplace | First explain lifecycle and permissions for already supported capabilities. Study install/start/stop/failure patterns without adding an unrestricted installer. Require repeated pilot demand before funding discovery, package trust, update/rollback, and support. |

Each experiment needs a named owner, the exact candidate artifact, a task set,
baseline, pass/fail criteria, and a result log. A successful prototype does not
automatically become a public product promise. Do not promote the native agent
or a new engine because it produces a more impressive single demo.

Existing implementation inspiration is documented separately in
[Token Saver provenance](third-party/token-saver.md), including OmniRoute/9Router.
Attribution does not establish competitive superiority.

## Recommended competitive promise

**A local AI delivery workspace for agencies managing multiple client projects.**

The candidate advantage is a complete job: separate client context, execute
isolated tasks using supported engines, review the precise checkpoint, record
tests and approvals, recover interrupted work, and produce a client handoff.
This is a hypothesis to prove, not a claim that competitors lack these features.

The [release checklist](plan/release-0.0.1-checklist.md) records an incomplete live
journey and missing public-distribution evidence. The
[native agent milestone](plan/nd-agent-private-milestone.md) remains gated on
workflow and artifact validation. Describe demonstrated private-beta scope,
rather than public stability or enterprise compliance.

After the local reliability gate, compare ND against each pilot's existing
workflow and one close alternative. Match repository, task class, engine/model
where feasible, budget, and acceptance criteria. Count human attention,
accepted-task cost, time to approval, regressions, and recovery, including failed
and incomplete runs.

## Keep this comparison useful

For agency pilots, compare against the participant's existing stack first. Add
one relevant close alternative, such as Nimbalyst for visual coding work, Warp
for terminal-led work, or Linear when the tracker already owns delivery. These
are suggested comparison cohorts, not endorsements or a ranking of performance.

Record the tested date, plan/access status, OS, model/engine, setup effort, task
type, artifact, review time, recovery outcome, and total accepted-task cost.
Mark unknowns explicitly. Refresh a source before using its claim in customer
material; announcements and early-access pages age differently from shipped
feature documentation. Use competitor-owned sources for that competitor's
capabilities, rather than a rival's comparison article.
