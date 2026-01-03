import type { PlaywrightTestConfig } from '@playwright/test'

export default {
  webServer: {
    command: `vite dev --port 3005`,
    port: 3005,
    reuseExistingServer: true,
    timeout: 60_000, // Allow 1 min for dev server to start on CI
  },
  workers: 12, // 3x vCPUs - testing if more parallelism helps I/O-bound browser tests
  timeout: 30_000, // Global timeout per test (increased for CI)
  testDir: `tests/playwright`,
  // maxFailures: 0 means run all tests even if some fail (useful for CI to see total failures)
} satisfies PlaywrightTestConfig
