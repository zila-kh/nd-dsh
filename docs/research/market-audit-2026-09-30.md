# ND market audit and R&D plan

Date: **2026-09-30**. Geography: **global developer teams and agencies**.
Owner-confirmed stage: **private beta, no paying customers yet**.

## Recommended decision

Focus the next milestone on **agency leads handling several client repositories**.
Prove that ND turns a bounded ticket into a tested, reviewed, recoverable change
with less human coordination. Start with one trusted operator per ND host.

ND has a substantial implementation foundation. Customer demand, willingness to
pay, release reliability, and incremental productivity are not yet established.
The next goal should be a narrow, repeatable customer outcome. A broad AI company
OS is difficult to explain and expensive to validate.

Positioning to test:

> ND helps software agencies coordinate AI work across client projects, review
> the actual changes, and keep delivery under human control.

This narrows the initial sales story, not the architecture. General, Coding,
ND Pencil, and the wider control plane can remain supporting capabilities.

## Scope and evidence

Inspected: repository feature contracts, task/worktree orchestration, local
collaboration, release records, native-agent plans, packaging, compute-budget
evidence, and primary competitor pages. The working checkout changed during
inspection and was clean at `main@0373960` before the research edits. This is a
source snapshot, not attestation of a released artifact.

Evidence levels:

- **Implemented:** observed in source; existence does not prove customer success.
- **Recorded validation:** reported in repository records, not rerun here.
- **Advertised:** stated by a competitor, not independently benchmarked.
- **Hypothesis:** a market, price, benefit, or priority requiring an experiment.

The running desktop was not accessible through the available browser surfaces.
No fresh UI screenshots or product journeys were captured. This is a source and
market review, not a visual UX/accessibility audit. No interviews, competitor
trials, or live-product benchmarks were performed. No outreach was sent and no
production code or release settings were changed.

See the [corrected competitor map](../competitors.md) for current primary sources.
The 2025 studies below are historical context, not a September 2026 survey.
No defensible TAM, reachable-account count, or revenue forecast is established.

## Product audit

| Area | Source evidence | Commercial implication |
| --- | --- | --- |
| Client/project structure | [organization.ts](../../src/shared/organization.ts) models companies, projects, roles, tasks, policy, memory, and run provenance | Fits multi-client operators. Logical company scoping is not authenticated tenant isolation. |
| Isolated delivery | [task-worktree.ts](../../src/main/organization/task-worktree.ts) creates baselines/checkpoints and blocks unsafe integration | A useful foundation. Demonstrate interruption recovery, stale review rejection, dirty human workspace handling, and conflicts. |
| Verification evidence | [control-plane.ts](../../src/main/organization/control-plane.ts) tracks fingerprints and invalidated evidence | Turn internal provenance into understandable delivery receipts. Matching fingerprints alone do not prove correct software. |
| Engine choice | [coding-engines.ts](../../src/shared/coding-engines.ts) describes capabilities and filters worker assignments | Focus on a small proven matrix. Several adapters lack persistent sessions or other capabilities; avoid claiming equivalent support. |
| Human collaboration | [store.ts](../../src/main/organization/store.ts) implements named local members, comments, decisions, and approvals | Useful local attribution. [The product split](../plan/nd-local-cloud-admin-product-split.md) explicitly defers strong identity and multi-machine sync. |
| ND Pencil | [Design boundaries](../nd-pencil.md) define controlled project design artifacts and editor integration | Supporting advantage only after design-to-real-source outcomes are demonstrated. |
| Compute controls | [Budget evidence](../evidence/compute-budget-correctness.md) distinguishes cash, reservations, and provider value | Promising transparency foundation. That evidence record says execution validation was pending; no savings percentage is proven. |
| Native agent | [Private milestone](../plan/nd-agent-private-milestone.md) gates selection and promotion; Harness remains default | Experimental R&D. Promote only after matched workflow, recovery, and artifact evidence. |
| Release readiness | [Release checklist](../plan/release-0.0.1-checklist.md) reports an incomplete live-model first turn and missing release evidence; [packaging](../../electron-builder.yml) targets Windows portable | Supervised private beta is appropriate. Revalidate the current artifact before changing the readiness claim. |

The September 29 checklist reports 1,013 unit tests passing after fixes, while the
live journey did not complete. Automated coverage is valuable, but a functioning
customer loop is a separate gate. This review did not rerun that journey or
identify the hang's root cause. The native-agent plan still explicitly requires
external evidence and baseline triage.

Public distribution also needs signed installation/update behavior, clean-machine
and installed-app validation, and runner evidence under the existing release plan.
Do not treat the documented Windows private artifact as proof of macOS/Linux
release support.

Trust wording needs care:

- Provider credentials are documented as desktop-global. Multiple companies on
  one host do not imply separate credential vaults.
- Local-first does not mean all AI runs offline or code never leaves the machine.
  Explain storage, execution, and remote model inference separately.
- Local human profiles provide attribution, not strongly authenticated remote
  users. Begin with lead-operated deployments until identity/sync is proven.
- The organization activity feed is capped at 500 entries in `store.ts`. Other
  journals may retain more, but that feed alone does not establish unlimited,
  immutable compliance history. Assess retention/export/integrity before making
  enterprise audit claims.

## Market opportunity and segment choice

Stack Overflow's **2025** survey reports 46% distrust of AI tool accuracy versus
33% trust. This supports researching verification burden; it does not establish
demand for ND or the agency segment.
[Survey source](https://survey.stackoverflow.co/2025/ai/).

DORA's **2025** research describes AI as amplifying organizational strengths and
weaknesses. The inference for ND is to measure the whole delivery process rather
than assume more generation improves outcomes.
[DORA source](https://dora.dev/research/2025/dora-report/).

The following rankings are judgments based on product fit, not measured demand.

| Priority | Buyer/segment | Job to test | Main adoption obstacle |
| --- | --- | --- | --- |
| First | Agencies with roughly 3–15 developers; owner/technical lead | Coordinate maintenance and small features across client repos, with review and handoff evidence | Existing tools may suffice; confidentiality and mixed operating systems matter. |
| Second | Product teams with roughly 2–10 engineers; engineering lead | Reduce coordination and review overhead on existing-product tickets | Added workflow/subscription fatigue and remote collaboration expectations. |
| Usability cohort | Freelancers maintaining multiple client projects | Separate context and recover interrupted work | Lower willingness to pay and onboarding support burden. |
| Later | Enterprise platform/engineering teams | Govern identity, spend, agent actions, and delivery evidence | Procurement, identity, retention, distribution, and support exceed current proof. |
| Later | General productivity users/nontechnical founders | Automate varied work or create applications | Broad onboarding and jobs; established work assistants and app builders. |

Recruit Windows-compatible leads first because that is the documented artifact.
Track excluded Mac/Linux prospects instead of counting them as product rejection.
Prioritize another OS when qualified demand and support capacity justify it.

The buyer is the owner/lead; developers and reviewers are users. Show the buyer
delivery visibility and client handoff. Show users a short route from an existing
ticket to an inspectable result. Do not require a fully modeled AI organization
before a first useful task.

## Competitive correction

Conductor now advertises four engines, cloud sandboxes, and real-time collaboration.
Paperclip already advertises roles, goals, budgets, and multiple companies.
Multi-engine support and an AI company model are therefore weak uniqueness claims.
[Conductor](https://www.conductor.build/), [Paperclip](https://paperclip.ing/).

Factory, Devin, GitHub Agent HQ, Cursor, Codex, and Claude also overlap parts of
ND's proposition. Being an adapter does not remove commercial competition. The
buyer may simply retain their current tool plus GitHub/Linear and manual review.
The [corrected map](../competitors.md) replaces historical single-engine and
cloud-only descriptions with current advertised facts.

The expanded comparison also includes Warp, Linear coding sessions, Xum
(formerly Mux), JetBrains Air, and Nimbalyst as direct delivery alternatives.
It records early-access/beta limitations and separates work-assistant/browser
references from repository-delivery competitors. See the
[additional alternatives](../competitors.md#additional-direct-alternatives) and
[prioritized adaptations](../competitors.md#rd-additions-what-to-adapt-and-when)
for primary sources and bounded experiments. This wider field strengthens the
need for matched pilot evidence; it does not establish a new segment or justify
building every adjacent feature. Choose one alternative relevant to each
pilot's existing workflow after passing the local reliability gate.

The candidate advantage is the complete agency job:

1. Separate client context and reusable delivery guidance.
2. Predictable isolated execution using supported engines.
3. Review tied to the precise checkpoint, required tests, and explicit approval.
4. Recoverable integration, honest task cost, and understandable client handoff.
5. Low setup and supervision effort on a supported desktop.

Competitors may do these too. Prove the combination works better for this buyer.
Longer-term defensibility could come from validated playbooks, customer trust,
integrations, and evidence that improves delivery. Feature breadth, Rust,
adapter count, and organization diagrams are not moats by themselves.

## R&D priorities

Targets below are proposed experiment gates, not current achievements. Define
task-specific deadlines in advance and report numerator and denominator.

| Priority | Work | Acceptance experiment |
| --- | --- | --- |
| P0 | Reliable first result | Triage the recorded hang. On the exact candidate artifact, run 20 bounded real-provider journeys over at least two supported routes. At least 18 produce an acceptance-checked result and at least 19 reach success or actionable failure within declared deadlines; none remain indefinitely running. Count useful completions separately from failures. |
| P0 | Recovery/review integrity | Exercise cancel, restart, network interruption, stale checkpoint, dirty human checkout, and merge conflict. Preserve human work/provenance and reject unsupported completion claims. |
| P0 | Short onboarding | Open existing repo, check engine/auth readiness, run one bounded ticket, inspect result. At least 8 of 10 qualified new operators produce a reviewable result within 15 minutes, recording all founder assistance and separating setup from run time. |
| P1 | Delivery receipt | Bind acceptance criteria, diff/checkpoint, test command/result, reviewer verdict, integration state, and limitations. In at least 8 of 10 cases, a qualified reviewer decides accept/rework without hunting through raw logs. |
| P1 | Cost per accepted task | Count worker, reviewer, retries, failures, and non-completions. Separate actual cash from estimated provider value/subscription usage. Reconcile a sample against provider records and disclose unknowns. |
| P1 | Proven engine matrix | Thoroughly support two pilot-used routes. Test auth, permissions, streaming, cancel, restart, and review; disclose unsupported combinations. Add engines for observed demand. |
| P1 | External handoff | Start with manual issue intake and Markdown delivery export. Add one GitHub/Linear integration if repeated transfer effort demonstrably blocks adoption. |
| P2 | ND Pencil outcome | Try three real visual-change tickets through the controlled editor to real source diffs and app validation. Continue if measured time/attention or pilot access improves without more regressions. |
| P2 | Native agent/fast path | Compare accepted-task workloads against the supported baseline on total cost, latency, human attention, escalation, and quality. Keep native opt-in until its workflow/security/artifact gates pass. |

Do not infer that a runtime update caused the recorded hang; capture the lifecycle
first. Keep Harness upstream-tracking and integrate through adapters, as required
by project guidance. Do not fork its core or introduce a frozen beta runtime pin
as a market tactic. Keep the canonical visible browser, controlled ND Pencil
bridge, task isolation, and narrow IPC boundaries. Use environment credentials
or dummy placeholders for tests.

Starting allocation of development time: 50% reliability/recovery, 25% onboarding
and delivery evidence, 15% pilot measurement/integration, 10% exploratory design
and efficiency. This is a suggested allocation, not a staffing estimate.

Defer a large marketplace, many extra engines, broad productivity bundles, cloud
admin infrastructure, and enterprise claims during the local milestone. Reopen
them when a customer problem and acceptance evidence justify the work.

## 90-day research and validation plan

Windows are planning targets; evidence gates authorize expansion.

| Window | Product work | Customer research | Gate |
| --- | --- | --- | --- |
| Days 1–14 | Live journey/recovery triage; define supported artifact and diagnostics | Interview 12 qualified leads: ideally 8 agency and 4 product-team leads | At least 6 describe a recurring problem from recent real work; at least 5 consent to supervised pilots. Otherwise narrow/change the job. |
| Days 15–30 | Short onboarding and minimal delivery receipt | Onboard 5 design partners on bounded, authorized repo tasks | At least 4 deliver a first accepted task; record setup failures and support minutes. |
| Days 31–60 | Fix recurring friction and improve evidence/cost visibility | Observe at least 50 eligible tasks across partners; compare existing workflows | At least 3 partners use ND in each of four consecutive weeks and demonstrate value on matched task classes. Small samples are directional. |
| Days 61–90 | Prepare another release only after exact-artifact gates | Test a scoped paid service offer; seek permission for case studies | Seek 3 actual paid service pilots or concrete demand for a future hosted service. Verbal interest is weaker than payment. |

Interview from the last difficult ticket, current tools/spend, human review time,
interruptions, client restrictions, and purchase authority. Ask participants to
show their workflow. Avoid leading questions about whether an AI company sounds
useful.

Primary acquisition experiment: build a list of 30 qualified agencies and seek
10 workflow conversations through individually relevant founder-led outreach.
This is a plan, not outreach authorization or a record of sent messages. Track
responses, interviews, pilot acceptance, activation, reuse, and payment separately.
Demonstrate one real bounded maintenance ticket; offer supervised pilots with
weekly feedback. Investigate Vibe Kanban migration needs through interviews.
Publish case studies only with permission and evidence. Broad paid advertising
should wait for repeatable activation and retention.

## Measurement design

Primary outcome: **accepted client tasks per active partner per week**. Guardrails:
human attention, elapsed time, seven-day defects, and total task cost. Acceptance
requires predeclared criteria, required checks, and explicit human reviewer
acceptance. Agent completion or a green AI review alone is weaker evidence.

Capture anonymized partner/task IDs, build/OS, engine/model version, ticket class,
baseline, start/end, human active minutes, checks, retries, review/integration,
actual/estimated cost, and defects discovered within seven days. Prefer opt-in
local export with no client code or secrets.

Proposed decision thresholds:

- Activation: 4 of 5 partners complete a first accepted task.
- Retention: 3 of 5 are active for four consecutive weeks.
- Value: target at least 20% lower median human active time on matched task
  classes, with no observed increase in seven-day defects. Report sample size
  and spread; a small pilot does not establish statistical certainty.
- Trust: zero observed cross-client leaks, human work loss, or unapproved
  external actions. A zero-incident pilot is not a general safety guarantee.
- Reliability: retain failures, cancellations, and timeouts in the denominator.

Use each partner's actual existing tool as the primary baseline. Match total
scope for parallelism comparisons and rotate comparable task classes. Reusing
an already solved task can bias the result. Keep engine/model/budget fixed where
feasible; label differing configurations as workflow comparisons. Count human
review and rework, not just generation time.

## Commercial model

The [local/cloud plan](../plan/nd-local-cloud-admin-product-split.md) promises local
stays complete and free forever; the repository states MIT licensing. Preserve
those boundaries. This audit does not introduce a local feature paywall.

After reliability gates, test paid **services**: onboarding, workflow setup,
training, and supervised support. One unvalidated price hypothesis is USD 300–1,000
for a bounded onboarding/support pilot, with explicit deliverables, support hours,
and exclusions. Set prices from observed value and delivery effort. Service
payment does not prove recurring software-subscription demand.

Later, optional implemented synchronization, managed backup, remote execution,
team identity, and support may support recurring revenue. Test need with research
offers clearly labeled as future concepts before building. Do not sell or promise
unavailable cloud features or make local core depend on them.

BYOK/native subscriptions separate model cost from ND services. Do not resell
third-party accounts, bypass vendor limits, or treat opaque subscriptions as
unlimited API budgets. A buyer pays for incremental value above existing tools.

## When to change direction

If people praise the concept but do not return, fix job fit/friction before adding
features. If they return but will not pay for services or identify a valuable
hosted need, retain the free-local strategy and revisit monetization. If only
founder-operated runs succeed, the offer is still primarily a service.

If agencies require authenticated remote collaboration before piloting, first
test whether lead-operated local delivery is useful. If not, change the initial
segment or explicitly approve a new identity/sync scope. Do not market local
profiles as secure remote team seats.

If ND cannot improve accepted-task attention, visibility, recovery, or cost
against existing tools, a broader autonomous-company story will not resolve it.
Reconsider the customer job before expanding the roadmap.

## Immediate backlog

1. Revalidate the recorded live-turn failure on the current exact candidate.
2. Complete cancel/restart/conflict/stale-review drills and tester limitations.
3. Conduct 12 problem interviews and recruit five supervised design partners.
4. Test existing-repo onboarding and the delivery receipt.
5. Measure four weeks of task outcomes before broadening engine, cloud, or native
   runtime investment.

Product publication still requires repository gates: `pnpm verify`,
`pnpm typecheck`, `pnpm test`, and `pnpm build`, plus Rust/installed-app/artifact
checks as applicable. This documentation review does not establish a release GO.
