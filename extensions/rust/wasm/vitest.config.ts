import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [`tests/**/*.test.ts`],
    // WASM requires Node.js environment with experimental features
    environment: `node`,
    // Longer timeout for WASM initialization
    testTimeout: 30000,
  },
})
