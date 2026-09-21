import { defineConfig } from '@playwright/test'

// ND-DSH end-to-end specs drive the real built app through Playwright's
// Electron launcher. Build first (`pnpm build`), then run `pnpm e2e`.
// One app instance at a time keeps specs deterministic (CI runs the same suite
// under xvfb-run in the `validate` job).
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
