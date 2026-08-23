import { defineConfig } from '@playwright/test'

// ND-DSH end-to-end specs drive the real built app through Playwright's
// Electron launcher. Build first (`pnpm build`), then run `pnpm e2e`.
// Kept out of CI for now; one app instance at a time keeps specs deterministic.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
