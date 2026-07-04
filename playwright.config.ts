import type { PlaywrightTestConfig } from '@playwright/test'
import process from 'node:process'

const is_ci = [`true`, `1`].includes(process.env.CI ?? ``)

export default {
  webServer: {
    command: `npx vite dev --port 3005`,
    port: 3005,
    reuseExistingServer: true,
    timeout: 60_000, // Allow 1 min for dev server to start on CI
  },
  use: {
    launchOptions: {
      // Headless Chromium intermittently fails WebGL context creation on our CI/dev hosts
      // (ANGLE/SwiftShader error: "Error creating WebGL context"). When that happens,
      // 3D test pages can throw runtime errors and downstream UI assertions become flaky
      // (e.g. controls-pane state not updating in /test/structure). These flags force a
      // stable software GL path via SwiftShader+ANGLE so Playwright sees deterministic
      // rendering and interaction behavior across environments.
      args: [`--enable-unsafe-swiftshader`, `--use-angle=swiftshader`, `--use-gl=angle`],
    },
  },
  // CI runners have 4 vCPUs and software WebGL (SwiftShader) is CPU-bound, so oversubscribing
  // workers starves the render path and makes timing-sensitive assertions miss their windows.
  // Keep CI at 1 worker/vCPU to avoid contention; allow more parallelism locally.
  workers: is_ci ? 4 : 16,
  // Distribute tests across CI shards (npx playwright test --shard=x/4) at the individual-test
  // level instead of per-file. Files are very unevenly sized (structure.test.ts has ~130 tests,
  // most others have 1-4), so file-level sharding would pile the big files onto one runner.
  // Files that need ordering opt into test.describe.configure({ mode: `serial` }) explicitly.
  fullyParallel: true,
  timeout: is_ci ? 45_000 : 30_000, // CI gets longer timeout due to slower shared resources
  // default expect timeout is 5s; give assertions more headroom on slower CI so transient
  // contention (theme/tooltip/render updates) doesn't trip them before retries can help
  expect: { timeout: is_ci ? 15_000 : 5000 },
  retries: is_ci ? 2 : 0, // Retry flaky tests in CI
  testDir: `tests/playwright`,
  // list reporter keeps each shard's pass/fail + error output readable in its CI log
  reporter: [[`list`]],
  // Playwright runs all tests by default (maxFailures defaults to 0, useful for CI to see total failures)
} satisfies PlaywrightTestConfig
