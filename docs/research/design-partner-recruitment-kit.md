# Design partner recruitment kit

Date: 2026-09-30. Companion to the [market audit](market-audit-2026-09-30.md) and the
[pilot measurement plan](pilot-measurement-plan.md).

**Status: plan only. No outreach has been sent.** Sending anything is an owner
action; this kit prepares it. All interviews are founder-led and
problem-focused — the goal is to learn how agency leads coordinate work across
client repositories today, not to pitch ND or an "AI company" concept.

## Targets (days 1–14 window)

| Funnel stage | Target | Source |
| --- | --- | --- |
| Qualified list built | 30 agencies (+ ~10 product-team teams) | Founder + public sources, individually chosen |
| Outreach sent | All of the list, personalized | Founder-led |
| Workflow conversations | 10 | Reply → 30-min call |
| Qualified problem interviews | 12 (8 agency leads, 4 product-team leads) | Interview guide below |
| Supervised design partners recruited | 5 | Consent at end of interview |
| Gate (audit days 1–14) | ≥ 6 describe a recurring problem from recent real work; ≥ 5 consent to supervised pilots | Otherwise narrow or change the job |

## Ideal candidate profile

Recruit **Windows-compatible leads first** — the documented private artifact is
a Windows portable build. Track excluded Mac/Linux prospects in the pipeline
sheet as `os-blocked`, not as product rejection.

Primary (agency lead):

- Software agency or consultancy with roughly 3–15 developers.
- The person you reach is the owner or technical lead who also reviews work.
- Maintains ≥ 3 client repositories concurrently (maintenance, small features,
  migrations, bug-fix retainers).
- Current coordination stack: GitHub/Linear/Jira + a coding assistant + manual
  review. They personally pay for or approve tool spend.

Secondary (product-team lead): 2–10 engineers, tickets on their own product,
same review-coordination pain.

Disqualifiers (do not count toward the 12):

- No personal involvement in review/handoff of code changes.
- Only procurement contacts; no purchase or pilot authority.
- Enterprises needing authenticated remote collaboration on day one (note them;
  the audit routes them to a later identity/sync decision).
- Curiosity-only replies with no recent ticket to discuss ("interview tourism").

## Outreach (founder-led, individually relevant)

Rules: reference something specific about their agency or a public artifact of
their work; ask for a 25–30 minute conversation about their **last difficult
client-repo task**; never pitch features, pricing, or "AI company"; one
follow-up only; plain text; no attachments or links beyond a scheduling option.

### Template A — agency lead

> Subject: <Agency name>'s client repo juggling
>
> Hi <First name> — I saw <specific: their site, a repo, a post, a shared
> client>. I run a small tooling project for people who coordinate code work
> across several client repositories, and I'm not trying to sell anything —
> I'm doing research interviews with agency owners/leads about how they
> actually run maintenance and small-feature work across clients: where it
> gets stuck, how reviews happen, what falls through.
>
> Would you have 25–30 minutes in the next two weeks to walk me through your
> last difficult cross-client task? I'm happy to share what I learn from the
> series (anonymized) afterwards.
>
> — <Founder name>

### Template B — product-team lead

> Subject: how <Team> reviews agent/assistant work
>
> Hi <First name> — quick research ask, not a pitch. I'm interviewing
> engineering leads on small product teams about their last painful ticket:
> how it was scoped, who reviewed it, and how long the review loop took. If
> you have 25–30 minutes in the next two weeks, I'd love to hear how <Team>
> actually does it.

### Follow-up (single, 4–6 business days later)

> Hi <First name> — one nudge on the research interview below. If now's not
> the time, a quick "pass" is genuinely useful and I'll leave it there.

### Where to find them

Indiehackers/agency-owner communities, agencies publishing maintenance case
studies, contributors to clients' public repos with `work-for-hire` commit
patterns, local software-cooperative directories, and warm intros from the
first three interviews ("who else should I talk to?" — always ask).

## Interview guide (45 minutes)

Setting: video call, screen share on, recorded **with explicit consent**;
second founder note-taker when possible. Zero product demo before minute 35.

1. **Warm-up (5 min).** Role, team shape, kinds of clients/repos. Confirm
   Windows/macOS mix and record it.
2. **The last difficult ticket (15 min) — the core.**
   - "Walk me through the last task across a client repo that was harder than
     it should have been. What was the ticket, literally?"
   - Where did the instructions come from? How did you hand it to whoever/whatever
     did the work?
   - Show me on screen: the board/repo/chat trail from assignment to merge, if
     they can still open it.
   - What did the machine/assistant do, if anything? Where did you intervene?
   - How long until a human reviewed it, and how long did review take?
   - What interrupted it (client change of mind, conflicting work, context
     switching to another client)?
   - What did the client see at handoff?
3. **Current workflow and spend (10 min).** Tools touched in the last ticket,
   per-seat costs, assistant/model subscriptions, what they'd pay to remove the
   worst friction (asked concretely, not hypothetically: "what did the last
   similar purchase cost and who approved it?").
4. **Failure and recovery (5 min).** "When a run/tool was interrupted
   mid-task, what happened to the half-finished work?" (Listen for fear of
   dirty working trees, lost context, re-doing setup.)
5. **Restrictions (3 min).** Client policies about code leaving their
   machines/repos, NDAs, on-prem or VPN constraints.
6. **Purchase authority (2 min).** Who decides, what budget line, what
   evidence would they need.
7. **Close (5 min).** Only now may the founder describe what they are building
   in **one problem-shaped sentence** ("we're testing a local, lead-operated
   way to keep client work isolated, reviewed, and recoverable"). Then:
   - "Would you be willing to try this on one real, bounded, authorized task
     next week, with me supervising and a 30-minute weekly feedback call for
     four weeks?" (design-partner consent — record verbatim answer.)
   - "Who else coordinates work across client repos like you do?"

Scoring at the end (fills the pipeline sheet): recurring problem (Y/N),
recent-real-work evidence, Windows-compatible, review-time estimate,
purchase authority, pilot consent (Y/N), referral names.

## Supervised pilot agreement (skeleton, per partner)

- Scope: one bounded, authorized task on a repo the partner owns or has
  written client permission to use. No client secrets entered; provider keys
  are the partner's own (BYOK).
- Cadence: 30-minute weekly feedback call, four consecutive weeks.
- Data: anonymized task IDs, no client code or secrets exported; measurements
  per the [pilot measurement plan](pilot-measurement-plan.md).
- Exit: either side may stop any week; the workspace and all local data remain
  the partner's.
- Honesty clause: failures, cancellations, and timeouts are recorded in the
  denominator, not swept away.

## Pipeline stages (tracked in the workbook)

`listed → contacted → replied → call-done → qualified → pilot-consented →
active-week-1..4 → completed/withdrawn`

Weekly founder review: response rate, qualification rate, pilot conversion,
os-blocked count, and per-partner weekly activity. Any stage converting below
expectation for two consecutive weeks gets the template or targeting revised
before volume increases.
