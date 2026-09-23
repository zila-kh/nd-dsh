# Local Agent Handoff Template

## Repository

- Repository: `<repo>`
- Feature branch: `<branch>`
- Feature head: `<sha>`
- Base branch: `<base>`
- Base head: `<sha>`
- Ahead/behind: `<ahead>/<behind>`
- Open PR: `<number/title or none>`

## Mission

State exactly what this branch/workstream is meant to accomplish and what state it is currently in.

## Critical rules

Include branch-safety, CI policy, architecture boundaries, platforms, and explicit non-goals.

## Implemented

Describe the completed behavior by subsystem. Prefer observable behavior and ownership boundaries over commit chronology.

## Intentionally not changed

List deferred work/non-goals and the evidence rule for reopening them.

## Validation status

State which checks have already run and which are still pending. Never convert planned checks into passed checks.

## Local correctness gates

```bash
<exact commands in order>
```

Explain known flakes/environment caveats and how to classify them.

## Manual smoke

Give step-by-step checks for process lifecycle, restart/recovery, persistence, UI-visible behavior, platform-specific behavior, or other non-automated invariants.

## Performance evidence

Include benchmark commands, scale points, metrics, baseline/reference requirements, and artifact paths expected from the local run.

## Defect handling

1. Save the failing command and first useful error.
2. Classify the failure.
3. Reproduce minimally.
4. Fix only demonstrated defects on the feature branch.
5. Add regression coverage.
6. Rerun focused and affected gates.
7. Commit with the repository's normal commit/CI convention.

## Known issues

List existing issues that may appear during validation without misclassifying them as new regressions.

## Required final report

### Branch
- branch
- final SHA
- base SHA
- ahead/behind

### Correctness gates
Report `PASS`, `FAIL`, or `BLOCKED` for every required command.

### Manual smoke
Report each manual invariant separately.

### Performance evidence
Report artifact path plus the important measured values and regressions/improvements versus the required baseline.

### Defects fixed
For each: symptom, root cause, files, regression coverage, commit SHA.

### Remaining known issues
Do not hide unrelated/pre-existing blockers.

### Merge readiness
Use exactly one factual state:
- `READY FOR MERGE`
- `NOT READY FOR MERGE`

Explain blockers when not ready. Do not infer readiness from implementation completeness alone.
