import type { PlaywrightTestConfig } from '@playwright/test'
import process from 'node:process'

const is_ci = process.env.CI === `true`

export default {
  webServer: {
    command: `vite dev --port 3005`,
    port: 3005,
    reuseExistingServer: true,
    timeout: 60_000, // Allow 1 min for dev server to start on CI
  },
  workers: 16, // 4x vCPUs - testing higher parallelism for I/O-bound browser tests
  timeout: is_ci ? 45_000 : 30_000, // CI gets longer timeout due to slower shared resources
  retries: is_ci ? 2 : 0, // Retry flaky tests in CI
  testDir: `tests/playwright`,
  // Playwright runs all tests by default (maxFailures defaults to 0, useful for CI to see total failures)
} satisfies PlaywrightTestConfig
