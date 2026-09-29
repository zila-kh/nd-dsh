import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { CoreClient } from '../core/core-client.js'
import type { EvidenceSource } from '../../shared/organization-control.js'

/** Hashing up to 1 GiB of untracked content plus a 512 MiB diff is slow but bounded. */
const EVIDENCE_TIMEOUT_MS = 5 * 60_000

export interface WorkspaceEvidenceCapture {
  fingerprint: string
  exact: boolean
  source: EvidenceSource
  changedFiles: string[]
  gitHead?: string
  capturedAt: number
}

export type WorkspaceEvidenceCapturer = (workspacePath: string | undefined) => Promise<WorkspaceEvidenceCapture>

interface CoreEvidenceResult {
  fingerprint: string
  gitHead: string
  changedFiles: string[]
}

/**
 * Bind review evidence to the exact current worktree state through nd-core's
 * `workspace.evidence`: HEAD, the binary tracked diff, and every untracked file's
 * content, so adding a new source file invalidates an older receipt as reliably
 * as editing a tracked one. Any failure is an inexact receipt, never a guess.
 */
export function createCoreEvidenceCapturer(core: Pick<CoreClient, 'request'>): WorkspaceEvidenceCapturer {
  return async (workspacePath) => {
    const capturedAt = Date.now()
    if (!workspacePath) return unavailableEvidence('missing-workspace', capturedAt)
    try {
      const result = await core.request<CoreEvidenceResult>('workspace.evidence', { root: resolve(workspacePath) }, EVIDENCE_TIMEOUT_MS)
      return {
        fingerprint: result.fingerprint,
        exact: true,
        source: 'git',
        changedFiles: result.changedFiles,
        gitHead: result.gitHead,
        capturedAt,
      }
    } catch {
      return unavailableEvidence(workspacePath, capturedAt)
    }
  }
}

/** Used when no nd-core is attached: evidence is reported as unobservable, which fails review closed. */
export async function unavailableEvidenceCapturer(workspacePath: string | undefined): Promise<WorkspaceEvidenceCapture> {
  return unavailableEvidence(workspacePath ?? 'missing-workspace', Date.now())
}

function unavailableEvidence(seed: string, capturedAt: number): WorkspaceEvidenceCapture {
  return {
    fingerprint: createHash('sha256').update(`nd-dsh-unavailable-v1\0${seed}`).digest('hex'),
    exact: false,
    source: 'workspace-unavailable',
    changedFiles: [],
    capturedAt,
  }
}
