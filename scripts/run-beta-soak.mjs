#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const args = ['exec', 'playwright', 'test', 'e2e/beta-soak.spec.ts']
const env = { ...process.env, ND_DSH_RUN_SOAK: '1' }
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
