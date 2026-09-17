import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

function firstExisting(overrideName: string, candidates: string[]): string | undefined {
  const override = process.env[overrideName]
  if (override) {
    const resolved = resolve(override)
    return existsSync(resolved) ? resolved : undefined
  }
  return candidates.map((entry) => resolve(entry)).find((entry) => existsSync(entry))
}

function npmBinCandidates(name: string): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : join(home, '.npm-global', 'bin')
  return process.platform === 'win32'
    ? [join(npmBin, `${name}.cmd`), join(npmBin, name), join(home, '.local', 'bin', `${name}.exe`), join(home, '.local', 'bin', `${name}.cmd`), join(home, '.local', 'bin', name)]
    : [join(npmBin, name), join(home, '.local', 'bin', name), '/usr/local/bin/' + name]
}

export function opencodeBinPath(): string | undefined {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return firstExisting('ND_DSH_OPENCODE_BINARY', [
    ...(process.platform === 'win32'
      ? [join(home, '.opencode', 'bin', 'opencode.exe'), join(home, '.opencode', 'bin', 'opencode.cmd')]
      : [join(home, '.opencode', 'bin', 'opencode')]),
    ...npmBinCandidates('opencode'),
  ])
}

export function gooseBinPath(): string | undefined {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return firstExisting('ND_DSH_GOOSE_BINARY', [
    ...(process.platform === 'win32'
      ? [join(home, '.local', 'bin', 'goose.exe'), join(home, '.local', 'bin', 'goose.cmd')]
      : [join(home, '.local', 'bin', 'goose'), '/usr/local/bin/goose']),
    ...npmBinCandidates('goose'),
  ])
}

export function jcodeBinPath(): string | undefined {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return firstExisting('ND_DSH_JCODE_BINARY', [
    ...(process.platform === 'win32'
      ? [join(home, '.local', 'bin', 'jcode.exe'), join(home, '.local', 'bin', 'jcode.cmd')]
      : [join(home, '.local', 'bin', 'jcode'), '/usr/local/bin/jcode']),
  ])
}

export function hermesBinPath(): string | undefined {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return firstExisting('ND_DSH_HERMES_BINARY', [
    ...(process.platform === 'win32'
      ? [join(home, '.local', 'bin', 'hermes.exe'), join(home, '.local', 'bin', 'hermes.cmd')]
      : [join(home, '.local', 'bin', 'hermes'), '/usr/local/bin/hermes']),
    ...npmBinCandidates('hermes'),
  ])
}

export function minimaxBinPath(): string | undefined {
  return firstExisting('ND_DSH_MINIMAX_BINARY', npmBinCandidates('mmx'))
}
