import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QaSuiteId } from '../../shared/contracts.js'

/**
 * Checks ND offers for a user project: the well-known package.json scripts a
 * vibe coder benefits from, in the order they should run. Only these curated
 * names are ever spawned — arbitrary scripts stay agent territory.
 */
const KNOWN_SCRIPTS: Array<{ name: string; label: string; description: string }> = [
  { name: 'test', label: 'Tests', description: "Runs this project's automated tests and reports what passes or fails." },
  { name: 'lint', label: 'Lint', description: 'Scans the code for style issues and common mistakes.' },
  { name: 'typecheck', label: 'Type check', description: 'Checks the code for type errors before runtime does.' },
  { name: 'type-check', label: 'Type check', description: 'Checks the code for type errors before runtime does.' },
  { name: 'build', label: 'Build', description: 'Compiles the project end to end, so broken code is caught before shipping.' },
]

export interface ProjectCheck {
  id: QaSuiteId
  label: string
  description: string
  /** Display form of the command, e.g. "pnpm run test". */
  displayCommand: string
  /** Executable + args used to spawn the check in the workspace root. */
  file: string
  args: string[]
}

/**
 * Detect runnable checks in a workspace root by reading its package.json.
 * Returns an empty list when there is no readable package.json or none of the
 * known check scripts exist — the renderer shows guidance either way.
 */
export function detectProjectChecks(root: string): ProjectCheck[] {
  let scripts: Record<string, unknown>
  try {
    const raw = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
    scripts = raw.scripts ?? {}
  } catch {
    return []
  }

  const seen = new Set<string>()
  const checks: ProjectCheck[] = []
  for (const known of KNOWN_SCRIPTS) {
    if (!(known.name in scripts) || typeof scripts[known.name] !== 'string' || scripts[known.name] === '') continue
    if (seen.has(known.label)) continue
    seen.add(known.label)
    const [file, args] = packageManagerCommand(root, known.name)
    checks.push({
      id: `script:${known.name}`,
      label: known.label,
      description: known.description,
      displayCommand: `${file} ${args.join(' ')}`,
      file,
      args,
    })
  }
  return checks
}

/** Pick the project's package manager from its lockfile; npm is the default. */
function packageManagerCommand(root: string, scriptName: string): [string, string[]] {
  const manager = existsSync(join(root, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(root, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(root, 'bun.lockb') || join(root, 'bun.lock'))
        ? 'bun'
        : 'npm'
  return [manager, ['run', scriptName]]
}
