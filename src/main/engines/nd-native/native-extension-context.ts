import { resolve } from 'node:path'
import type { NdProjectContext } from '../../../shared/nd-context.js'
import { ND_NATIVE_ENGINE_ID } from '../../../shared/coding-engines.js'
import type { OrganizationSnapshot } from '../../../shared/organization.js'

function sameRoot(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

/**
 * Bind an ND Agent extension call to the project that owns its session/run.
 *
 * Organization task worktrees remain valid while the user views another
 * project, so ambient activeProjectId is not sufficient for those sessions.
 * Interactive chats have no organization run and safely fall back to the
 * currently active project; the tool broker separately verifies their cwd.
 */
export function nativeExtensionProjectContext(
  organization: OrganizationSnapshot,
  sessionId: string,
  cwd: string,
  worktree: boolean,
): NdProjectContext {
  const sessionRuns = organization.runs
    .filter((run) =>
      run.sessionId === sessionId
      && (run.engineId === undefined || run.engineId === ND_NATIVE_ENGINE_ID))
    .sort((left, right) => right.startedAt - left.startedAt)

  if (sessionRuns.length > 0) {
    // A session id belongs to its newest ND run. Never fall back to an older
    // run merely because its recorded root happens to match.
    const run = sessionRuns[0]!
    if (run.workspaceRoot !== undefined && !sameRoot(run.workspaceRoot, cwd)) {
      throw new Error('ND Agent extension context does not match the session worktree')
    }
    const project = organization.projects.find((item) => item.id === run.projectId)
    if (!project || project.companyId !== run.companyId) {
      throw new Error('ND Agent organization run no longer has a valid project context')
    }
    return { kind: 'project', companyId: run.companyId, projectId: run.projectId }
  }

  if (worktree) throw new Error('ND Agent task worktree has no organization run context')

  const projectId = organization.activeProjectId
  const project = organization.projects.find((item) => item.id === projectId)
  if (!projectId || !project) throw new Error('ND Agent extension calls require an active project context')
  return { kind: 'project', companyId: project.companyId, projectId }
}
