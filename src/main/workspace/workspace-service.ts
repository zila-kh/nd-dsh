import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { WorkspaceEntry, WorkspaceFile, WorkspaceState } from '../../shared/contracts.js'
import { resolveInside } from './path-utils.js'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 500
const SKIPPED_NAMES = new Set(['.git', 'node_modules', 'out', 'dist', '.dsh', '.sessions'])

export class WorkspaceService {
  private root: string

  constructor(initialRoot: string) {
    this.root = resolve(initialRoot)
  }

  state(): WorkspaceState {
    return { root: this.root, name: basename(this.root) || this.root }
  }

  async pick(): Promise<WorkspaceState> {
    const result = await dialog.showOpenDialog({
      title: 'Open workspace',
      defaultPath: this.root,
      properties: ['openDirectory', 'createDirectory'],
    })
    const selected = result.filePaths[0]
    if (!result.canceled && selected) this.root = resolve(selected)
    return this.state()
  }

  async setRoot(path: string): Promise<WorkspaceState> {
    const candidate = resolve(path)
    const stats = await fs.stat(candidate)
    if (!stats.isDirectory()) throw new Error('The selected path is not a directory')
    this.root = candidate
    return this.state()
  }

  async list(relativePath = '.'): Promise<WorkspaceEntry[]> {
    const absolute = await this.resolveExisting(relativePath)
    const stats = await fs.stat(absolute)
    if (!stats.isDirectory()) throw new Error('The selected path is not a directory')
    const entries = await fs.readdir(absolute, { withFileTypes: true })
    return entries
      .filter((entry) =>
        !SKIPPED_NAMES.has(entry.name)
        && !entry.isSymbolicLink()
        && (entry.isDirectory() || entry.isFile()),
      )
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => ({
        name: entry.name,
        relativePath: relativePath === '.' ? entry.name : join(relativePath, entry.name),
        kind: entry.isDirectory() ? 'directory' : 'file',
      }))
  }

  async read(relativePath: string): Promise<WorkspaceFile> {
    const absolute = await this.resolveExisting(relativePath)
    const stats = await fs.stat(absolute)
    if (!stats.isFile()) throw new Error('The selected path is not a file')

    const handle = await fs.open(absolute, 'r')
    try {
      const bytesToRead = Math.min(stats.size, MAX_FILE_BYTES)
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
      return {
        relativePath,
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: stats.size > MAX_FILE_BYTES,
      }
    } finally {
      await handle.close()
    }
  }

  private async resolveExisting(relativePath: string): Promise<string> {
    const candidate = resolveInside(this.root, relativePath)
    const candidateStats = await fs.lstat(candidate)
    if (candidateStats.isSymbolicLink()) throw new Error('Symbolic links are not exposed by the workspace API')

    const [realRoot, realCandidate] = await Promise.all([
      fs.realpath(this.root),
      fs.realpath(candidate),
    ])
    resolveInside(realRoot, relative(realRoot, realCandidate))
    return realCandidate
  }
}
