---
name: gpt-web-local-agent-handoff
description: Create a complete, agent-neutral handoff from a ChatGPT/GPT-Web coding session to any local coding agent or CLI. Use when the user wants to continue work in Codex, Cursor, Claude Code, ZCode, JCode, OpenCode, Goose, Hermes, Pi, or another local agent and needs a portable prompt containing repo/branch state, completed implementation, constraints, validation commands, performance evidence requirements, known issues, defect-handling rules, and merge-readiness criteria.
---

# GPT-Web to Local Agent Handoff

Produce a self-contained handoff that a local coding agent can execute without needing the original ChatGPT conversation.

## Workflow

1. Establish repository truth before writing the handoff.
   - Resolve repository URL/name.
   - Resolve the working feature branch and current head SHA.
   - Resolve the base/default branch and its SHA.
   - Record ahead/behind status and open PR state when available.
   - Prefer live repository tools or local Git over stale conversation claims.
   - Never modify the default branch merely to prepare a handoff.

2. Reconstruct the implementation state.
   - State the original objective in one short paragraph.
   - Separate `implemented`, `intentionally not migrated`, `validation pending`, and `blocked` work.
   - Include only behavior actually present in the repository or explicitly documented.
   - If implementation is complete, tell the local agent to validate first and fix only demonstrated defects instead of reopening architecture work.

3. Capture non-negotiable constraints.
   - Preserve repository branch-safety rules.
   - Preserve CI policy exactly as the project currently uses it.
   - Preserve platform-specific validation requirements.
   - Preserve architecture boundaries and explicit non-goals.
   - Do not invent test results, benchmark results, PR state, or merge readiness.

4. Build the local validation plan.
   - List exact commands in execution order.
   - Separate focused tests from full-suite/build checks.
   - Include manual smoke tests for behavior that automation cannot prove.
   - Include known flaky tests or environment caveats and how to classify them.
   - Require first-failure capture rather than rerunning until green.

5. Build the performance-evidence plan when relevant.
   - List exact benchmark commands.
   - Name required scale points and metrics.
   - Keep external dependency/process memory separate from product overhead.
   - Distinguish smoke evidence from full/reference-machine evidence.
   - Do not claim a performance improvement before evidence is recorded.

6. Define defect-handling rules.
   - Capture the failing command and first useful error.
   - Classify the failure as regression, pre-existing issue, or environment/tooling issue.
   - Reproduce with the smallest focused check.
   - Fix only the demonstrated defect on the feature branch.
   - Add or strengthen regression coverage.
   - Rerun the focused check, then the affected gate.

7. End with a strict completion report contract.
   Require the local agent to report:
   - branch + final SHA + base SHA + ahead/behind;
   - PASS/FAIL/BLOCKED per gate, never PASS for an unrun command;
   - manual smoke outcomes;
   - benchmark artifact paths and measured values;
   - defects fixed with commit SHAs;
   - remaining known issues;
   - factual merge-readiness state.

## Repository context helper

When running inside a local checkout, execute:

```bash
bash scripts/collect-git-context.sh [base-branch]
```

Default base branch is `main`. Copy the result into the handoff rather than paraphrasing it.

## Output format

Use the structure in [references/handoff-template.md](references/handoff-template.md). Fill every relevant section and remove unused optional sections instead of leaving placeholders.

The result must be directly pasteable into a local coding agent. Prefer concrete commands, exact branch names, exact SHAs, exact file/task references, and explicit acceptance criteria over narrative history.

## Quality rules

- Make the handoff agent-neutral. Do not assume Codex/Cursor/Claude-specific commands unless the project itself requires them.
- Keep historical discussion only when it explains a current invariant, regression risk, or known issue.
- If repository truth conflicts with remembered conversation state, repository truth wins and the discrepancy is called out.
- If the current default branch advanced after the feature branch was created, report it explicitly before suggesting any sync operation.
- Never silently rebase, merge, force-push, enable CI, restore workflows, or merge the feature branch as part of handoff creation.
- A handoff may say `implementation complete` only when the remaining work is validation/evidence or explicitly deferred non-goals.
- A handoff may say `READY FOR MERGE` only after the project-required local gates have actually been run and no blocking defect remains.
