#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { electronTargetIdentity } from './e2e-electron-target.mjs'

const args = ['exec', 'playwright', 'test', 'e2e/beta-soak.spec.ts']
const releaseMode = process.argv.includes('--release')
const env = { ...process.env, ND_DSH_RUN_SOAK: '1', ND_DSH_SOAK_MINUTES: process.env.ND_DSH_SOAK_MINUTES || '1440' }
if (releaseMode) {
  if (electronTargetIdentity(env).kind !== 'packaged') {
    throw new Error('Release soak requires ND_DSH_E2E_EXECUTABLE pointing to the release artifact.')
  }
  if (!Number.isFinite(Number(env.ND_DSH_SOAK_MINUTES)) || Number(env.ND_DSH_SOAK_MINUTES) < 1440) {
    throw new Error('Release soak requires at least 1440 minutes; use e2e:beta:soak for a short diagnostic run.')
  }
}
console.log(`[beta-soak] requested duration=${env.ND_DSH_SOAK_MINUTES} minutes; target=${releaseMode ? 'release package' : 'configured E2E target'}`)
const pnpmEntrypoint = process.env.npm_execpath
const result = pnpmEntrypoint
  ? spawnSync(process.execPath, [pnpmEntrypoint, ...args], { stdio: 'inherit', env })
  : spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env,
    })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
