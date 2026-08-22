import type { OrganizationPolicy, OrganizationSkill, OrganizationWorkflow } from '../../shared/organization.js'

const BUILTIN_SKILL_ROWS: Array<[string, string, string]> = [
  ['strategy', 'Company strategy', 'Turn a mission into objectives, priorities, tradeoffs, and measurable outcomes.'],
  ['project-plan', 'Project planning', 'Turn an objective into a roadmap, milestones, dependencies, risks, and acceptance criteria.'],
  ['task-breakdown', 'Task breakdown', 'Decompose goals into dependency-aware work that can be independently verified.'],
  ['implementation', 'Software implementation', 'Inspect a codebase, implement changes, run checks, and leave the workspace in a reviewable state.'],
  ['review', 'Independent review', 'Review completed work against requirements, tests, security, regressions, and maintainability.'],
  ['qa', 'Testing and QA', 'Design and execute meaningful verification across code, browser behavior, and edge cases.'],
  ['research', 'Web research', 'Research current information, compare sources, and produce decision-ready findings.'],
  ['browser', 'Live browser', 'Operate the shared visible browser through semantic snapshots and browser tools.'],
  ['release', 'Release management', 'Prepare release notes, rollout checks, risk controls, and post-release verification.'],
  ['memory', 'Organizational memory', 'Capture durable decisions and lessons for future agents without leaking company context.'],
]

export const BUILTIN_SKILLS: OrganizationSkill[] = BUILTIN_SKILL_ROWS.map(([id, name, description]) => ({
  id: `builtin:${id}`,
  scope: 'builtin',
  name,
  description,
  instructions: description,
}))

export function defaultPolicies(companyId: string): OrganizationPolicy[] {
  const rows: Array<[string, OrganizationPolicy['effect'], string]> = [
    ['internal.plan', 'allow', 'AI managers may create plans, goals, milestones, and internal tasks.'],
    ['task.execute', 'allow', 'AI workers may execute internal project tasks using the configured workspace policy.'],
    ['task.review', 'allow', 'Independent reviewers may inspect and validate completed work.'],
    ['external.publish', 'ask', 'Publishing content or messages outside the company requires human approval.'],
    ['production.deploy', 'ask', 'Production deployment requires human approval unless explicitly changed.'],
    ['money.spend', 'ask', 'Purchases and paid actions require human approval unless explicitly changed.'],
    ['data.destructive', 'deny', 'Destructive production data operations are denied by default.'],
  ]
  return rows.map(([action, effect, description]) => ({
    id: `${companyId}:policy:${action}`,
    companyId,
    action,
    effect,
    description,
  }))
}

export function defaultWorkflow(companyId: string): OrganizationWorkflow {
  return {
    id: `${companyId}:workflow:delivery`,
    companyId,
    scope: 'company',
    name: 'Plan → Execute → Review',
    steps: [
      { id: 'plan', name: 'AI PM plans work', kind: 'plan', requiredRole: 'Product Manager' },
      { id: 'execute', name: 'Assigned worker executes', kind: 'execute', requiredRole: 'Software Engineer' },
      { id: 'review', name: 'Independent reviewer validates', kind: 'review', requiredRole: 'Reviewer' },
    ],
  }
}
