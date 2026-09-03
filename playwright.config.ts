import type { PlaywrightTestConfig } from '@playwright/test'
import process from 'node:process'

const is_ci = [`true`, `1`].includes(process.env.CI ?? ``)

export default {
  webServer: {
    command: `npx vite dev --port 3005`,
    port: 3005,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    // chrome-headless-shell (the headless default) pins ANGLE to swiftshader-webgl while WebGPU
    // still asks for a real adapter, so the renderer never inits and 3D tests fail for reasons
    // unrelated to the code. This channel is the full browser, which has a working WebGPU stack.
    // CI is already green on the shell and forces a software adapter below, so leave it alone.
    ...(is_ci ? {} : { channel: `chromium` as const }),
    // 3D failures on CI's software renderer say nothing as a bare log line. First retry only:
    // recording costs time on an already saturated box.
    trace: `on-first-retry`,
    launchOptions: {
      // Without these, headless Chromium exposes navigator.gpu but hands out no adapter, and
      // WebGPURenderer quietly falls back to WebGL2 — hiding regressions in the backend we ship.
      // The software adapter is CI-only so local runs exercise the one users actually get.
      args: [
        `--enable-unsafe-webgpu`,
        `--enable-features=Vulkan`,
        `--enable-unsafe-swiftshader`,
        ...(is_ci ? [`--use-webgpu-adapter=swiftshader`] : []),
      ],
    },
  },
  // Software WebGPU spreads one canvas over several SwiftShader threads, so a worker per vCPU
  // starves the render path: shard 3/4 took 6.1 min with 4 failures at 4 workers, 3.3 min with
  // 1 at 2 workers. A real GPU allows more.
  workers: is_ci ? 2 : 16,
  // Shard by test, not by file: structure.test.ts holds ~130 tests and most files 1-4, so
  // file-level sharding would pile the big ones onto one runner. Ordering-sensitive files opt
  // into test.describe.configure({ mode: `serial` }).
  fullyParallel: true,
  // on software WebGPU, 3D tests that take ~4s alone were measured at 25-50s under load
  timeout: is_ci ? 90_000 : 30_000,
  // headroom for transient CI contention (theme, tooltip, render) before retries can help
  expect: { timeout: is_ci ? 30_000 : 5000 },
  retries: is_ci ? 2 : 0,
  testDir: `tests/playwright`,
  reporter: [[`list`]], // keeps each shard's pass/fail readable in its CI log
} satisfies PlaywrightTestConfig
