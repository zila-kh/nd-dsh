import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// ND-DSH's own tests live in tests/ plus colocated renderer unit tests under
// src/. The pinned DeepSeek Harness submodule ships its own spec suite, which
// must stay out of this repository's test run. The `@renderer`/`@shared`
// aliases mirror the renderer target in electron.vite.config.ts so component
// modules resolve exactly as they do in the app build.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
})
