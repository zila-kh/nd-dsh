import type { CoreClient } from './core-client.js'

export interface CoreWorkspaceEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
}

export interface CoreWorkspaceListing {
  root: string
  path: string
  entries: CoreWorkspaceEntry[]
  truncated: boolean
  maxEntries: number
}

export interface CoreWorkspaceFile {
  root: string
  path: string
  data: string
  size: number
  truncated: boolean
  maxBytes: number
  byteSize: number
}

/**
 * The workspace filesystem as nd-core implements it: a bounded listing and a
 * bounded read, both resolving inside the active workspace root and both reporting
 * whether a bound was hit.
 */
export interface WorkspaceFileSystem {
  list(root: string, relativePath: string, maxEntries?: number): Promise<CoreWorkspaceListing>
  read(root: string, relativePath: string, maxBytes?: number): Promise<CoreWorkspaceFile>
}

/**
 * The single bound nd-core applies to a listing regardless of what a caller asks
 * for, mirrored here so the product can request the whole bounded window and then
 * apply its own filtering without silently losing entries.
 */
export const CORE_WORKSPACE_LIST_HARD_MAX = 4096

export function createCoreWorkspaceFileSystem(
  core: Pick<CoreClient, 'request'>,
): WorkspaceFileSystem {
  return {
    async list(root, relativePath, maxEntries) {
      const listing = await core.request<CoreWorkspaceListing>(
        'workspace.list',
        {
          root,
          path: relativePath,
          ...(maxEntries === undefined ? {} : { maxEntries }),
        },
        15_000,
      )
      return listing
    },
    async read(root, relativePath, maxBytes) {
      const file = await core.request<CoreWorkspaceFile>(
        'workspace.read',
        {
          root,
          path: relativePath,
          ...(maxBytes === undefined ? {} : { maxBytes }),
        },
        15_000,
      )
      return file
    },
  }
}
