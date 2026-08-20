import { defineConfig } from 'vitest/config'

// ND-DSH's own tests live in tests/. The pinned DeepSeek Harness submodule
// ships its own spec suite, which must stay out of this repository's test run.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
