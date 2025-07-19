import type { PlaywrightTestConfig } from '@playwright/test'

export default {
  webServer: {
    command: `vite dev --port 3005`,
    port: 3005,
    reuseExistingServer: true,
  },
  workers: 8,
  timeout: 15_000, // Global timeout per test
  testDir: `tests/playwright`,
} satisfies PlaywrightTestConfig
