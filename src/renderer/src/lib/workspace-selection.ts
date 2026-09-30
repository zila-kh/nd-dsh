import type { WorkspaceState } from '../../../shared/contracts.js'

/**
 * Whether the workspace the renderer holds is one the user actually chose.
 *
 * A workspace bound to an organization project is a selection by definition, so
 * the binding decides on its own: `selectedByUser` is optional on the wire, and
 * reading it alone would present a workspace that already knows its project as
 * "No project selected". Only the standalone case still needs the flag, since
 * that is the one where the root may just be the runtime cwd.
 */
export function isWorkspaceSelected(workspace: WorkspaceState | null | undefined): boolean {
  if (!workspace) return false
  if (workspace.selectedByUser === true) return true
  return workspace.binding !== undefined && workspace.binding !== 'standalone'
}
