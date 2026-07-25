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
    // 3D failures that only reproduce on CI's software renderer say nothing as a bare log
    // line. Only from the first retry: recording costs time on an already saturated box.
    trace: `on-first-retry`,
    launchOptions: {
      // Headless Chromium exposes navigator.gpu over localhost but hands out no adapter
      // without these flags, leaving WebGPURenderer to fall back to WebGL2 — which would hide
      // regressions in the backend we ship. --enable-unsafe-swiftshader stays for the 2D/WebGL
      // canvases elsewhere. The software adapter is forced on CI only so local runs exercise
      // the backend users actually get (measured no local speedup from dropping it).
      args: [
        `--enable-unsafe-webgpu`,
        `--enable-features=Vulkan`,
        `--enable-unsafe-swiftshader`,
        ...(is_ci ? [`--use-webgpu-adapter=swiftshader`] : []),
      ],
    },
  },
  // Software WebGPU spreads one canvas over several SwiftShader threads, so a worker per vCPU
  // no longer fits CI's 4 and starves the render path: measured on a 14-core box, shard 3/4
  // took 6.1 min with 4 failures at 4 workers vs 3.3 min with 1 at 2. A real GPU allows more.
  workers: is_ci ? 2 : 16,
  // Distribute tests across CI shards (npx playwright test --shard=x/4) at the individual-test
  // level instead of per-file. Files are very unevenly sized (structure.test.ts has ~130 tests,
  // most others have 1-4), so file-level sharding would pile the big files onto one runner.
  // Files that need ordering opt into test.describe.configure({ mode: `serial` }) explicitly.
  fullyParallel: true,
  // CI gets longer timeouts: on software WebGPU, 3D tests that run in ~4s alone were measured
  // at 25-50s alongside other GPU work.
  timeout: is_ci ? 90_000 : 30_000,
  // default expect timeout is 5s; give assertions more headroom on slower CI so transient
  // contention (theme/tooltip/render updates) doesn't trip them before retries can help
  expect: { timeout: is_ci ? 30_000 : 5000 },
  retries: is_ci ? 2 : 0, // Retry flaky tests in CI
  testDir: `tests/playwright`,
  // list reporter keeps each shard's pass/fail + error output readable in its CI log
  reporter: [[`list`]],
  // Playwright runs all tests by default (maxFailures defaults to 0, useful for CI to see total failures)
} satisfies PlaywrightTestConfig
