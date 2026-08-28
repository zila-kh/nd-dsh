import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

const MARKER = '# ND Gateway managed model catalog'

interface RouteJournal {
  version: 1
  endpoint: string
  previousRoute?: string
}

/** Owns only ND's one top-level Codex route line and restores the prior value on disconnect. */
export class CodexGatewayConfigManager {
  constructor(private readonly configPath: string, private readonly journalPath: string) {}

  async install(endpoint: string): Promise<void> {
    const current = await readOptional(this.configPath)
    const lines = split(current)
    const existingMarker = lines.indexOf(MARKER)
    const installedRoute = `openai_base_url = ${JSON.stringify(endpoint)}`
    if (existingMarker >= 0) {
      if (lines[existingMarker + 1] === installedRoute) return
      // An ND restart allocates a new loopback port while the previous managed
      // route can still be installed (e.g. ND was force-quit). Only the journal
      // distinguishes ND's own stale route from a user edit of the managed line.
      const journal = await readJournal(this.journalPath)
      if (!journal || lines[existingMarker + 1] !== `openai_base_url = ${JSON.stringify(journal.endpoint)}`) {
        throw new Error('An existing ND Gateway Codex route was changed; refusing to overwrite it')
      }
      lines.splice(existingMarker, 2, MARKER, installedRoute)
      await writeAtomic(this.configPath, render(lines, current))
      await writeAtomic(this.journalPath, JSON.stringify(routeJournal(endpoint, journal.previousRoute), null, 2))
      return
    }
    const routeIndex = lines.findIndex((line) => /^\s*openai_base_url\s*=/.test(line))
    const previousRoute = routeIndex >= 0 ? lines[routeIndex] : undefined
    const insertAt = routeIndex >= 0 ? routeIndex : firstTable(lines)
    if (routeIndex >= 0) lines.splice(routeIndex, 1, MARKER, installedRoute)
    else lines.splice(insertAt, 0, MARKER, installedRoute)
    await writeAtomic(this.configPath, render(lines, current))
    await writeAtomic(this.journalPath, JSON.stringify(routeJournal(endpoint, previousRoute), null, 2))
  }

  async uninstall(): Promise<void> {
    const journal = await readJournal(this.journalPath)
    if (!journal) return
    const current = await readOptional(this.configPath)
    const lines = split(current)
    const marker = lines.indexOf(MARKER)
    const installedRoute = `openai_base_url = ${JSON.stringify(journal.endpoint)}`
    if (marker < 0 || lines[marker + 1] !== installedRoute) {
      throw new Error('ND Gateway Codex route changed after setup; refusing to overwrite your configuration')
    }
    lines.splice(marker, 2)
    if (journal.previousRoute) lines.splice(marker, 0, journal.previousRoute)
    await writeAtomic(this.configPath, render(lines, current))
    await fs.rm(this.journalPath, { force: true })
  }
}

function split(text: string | undefined): string[] {
  return text ? text.replace(/\r\n/g, '\n').split('\n') : []
}

function render(lines: string[], previous: string | undefined): string {
  const newline = previous?.includes('\r\n') ? '\r\n' : '\n'
  return `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`
}

function firstTable(lines: string[]): number {
  const index = lines.findIndex((line) => /^\s*\[/.test(line))
  return index >= 0 ? index : lines.length
}

async function readJournal(path: string): Promise<RouteJournal | undefined> {
  const raw = await readOptional(path)
  return raw ? parseJournal(raw) : undefined
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, value, 'utf8')
  await fs.rename(temporary, path)
}

function routeJournal(endpoint: string, previousRoute: string | undefined): RouteJournal {
  return previousRoute ? { version: 1, endpoint, previousRoute } : { version: 1, endpoint }
}

function parseJournal(value: string): RouteJournal {
  const journal = JSON.parse(value) as Partial<RouteJournal>
  if (journal.version !== 1 || typeof journal.endpoint !== 'string' || (journal.previousRoute !== undefined && typeof journal.previousRoute !== 'string')) {
    throw new Error('ND Gateway Codex setup journal is invalid')
  }
  return journal as RouteJournal
}
