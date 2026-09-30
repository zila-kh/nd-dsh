---
name: market-audit
description: Audit a product's market position, competitors, implementation evidence, and R&D priorities. Use for repository-grounded product and market reviews, especially early-stage developer tools; use a market-sizing workflow for standalone TAM/SAM/SOM estimates.
---

# Market audit

Produce a decision-ready, evidence-backed view of where the product can compete, which customer to serve first, and what to validate or build next. Ground product claims in the current repository and market claims in current public sources. Separate observed facts from inference and hypotheses.

## Scope the decision

- Identify the decision the audit should inform, product/repository, target geography, customer stage, and any known users, revenue, constraints, or strategic preferences. Reuse reliable context already supplied; ask only when a missing answer would materially change the work.
- Capture the review date and inspected revision or artifact where available. Treat today's product and market facts as time-sensitive.
- If the request only asks for a market-size estimate, use the available market-sizing workflow instead of turning this skill into a broad product audit.

## Inspect the product

- Read repository guidance first. Inspect relevant product plans, source contracts, release evidence, known issues, and tests only where they establish what the product can do.
- Classify evidence consistently: implemented in source, validated on a current artifact, recorded historical validation, competitor-advertised, externally measured, or untested hypothesis. Source presence does not prove the user-visible flow works.
- Check adoption friction and trust boundaries alongside features: setup, supported platforms, identity, data handling, credentials, isolation, provider costs, recovery, distribution, support, and any claimed reliability or compliance.
- Do not claim user research, live UX inspection, hands-on competitor testing, release readiness, or performance results unless those activities were actually completed. Name the limits of a source-only review.

## Research the market

- Browse for current claims that may change. Prefer a competitor's own product, pricing, changelog, or documentation page for that competitor's capabilities and availability. For market context, prefer original surveys, research, and official datasets over summaries.
- Record a source near each material claim. Distinguish generally available, beta/preview, announced, discontinued, regional, and unknown status. Do not turn vendor marketing into independent proof of quality or adoption.
- Map direct competitors and realistic substitutes: the tools and manual workflow a buyer could retain or combine to do the same job. Add adjacent references only when they reveal a relevant workflow pattern; say why they are adjacent.
- Compare the buyer, job, trigger, workflow, deployment, buyer cost, and switching obstacle. Engine adapters and integrations can also be commercial substitutes even when they are architectural components.
- Do not invent market size, competitor ranking, market share, willingness to pay, or differentiation. Size a market only with explicit definitions, traceable inputs, assumptions, and uncertainty; otherwise state what evidence is missing.

## Recommend a position and R&D

- Choose a narrow initial buyer and urgent job using fit, access, adoption friction, alternatives, and evidence. Describe differentiation as a hypothesis until a matched comparison supports it.
- Tie recommendations to inspected product evidence and competitor capabilities. Separate near-term reliability/adoption blockers from pilot features and longer-term options.
- For each proposed experiment, state the user/job, baseline, observable outcome, sample or task set where useful, pass/fail criterion, dependencies, and decision that follows. Label proposed thresholds as targets, not achievements.
- Prefer validating one end-to-end customer outcome before broadening feature count or market scope. Include a signal that would change the recommendation. Treat pricing and packaging as experiments when there are no paying users.

## Deliverable

For a repository-specific audit, write or update a dated Markdown report in the project's established research location and refresh its competitor map when that is in scope. Include:

1. A clear recommendation and the evidence that supports it.
2. Product state, research scope, and important evidence limits.
3. Customer segments/jobs, competitors/substitutes, and a testable positioning hypothesis.
4. Product, adoption, trust, and release gaps tied to repository evidence.
5. Staged R&D/validation priorities with measurable gates and decision points.
6. Sources linked beside claims and explicit unknowns.

Follow repository-specific product and security boundaries. Keep an audit read-only unless the user also requested changes. Do not contact customers, publish claims, change production, or start paid experiments without explicit authorization. Avoid editing application code as part of a research deliverable. For ND, follow the repository's AGENTS.md and existing market audit/competitor map; keep local identity distinct from authenticated collaboration, treat coding engines as replaceable but commercially competitive, preserve ND Pencil ownership boundaries, and do not claim cross-platform or cloud capability without current release evidence.
