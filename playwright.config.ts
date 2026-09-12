/// <reference types="node" />
import type { PlaywrightTestConfig } from '@playwright/test'
import process from 'node:process'

const is_ci = [`true`, `1`].includes(process.env.CI ?? ``)
const e2e_mode = process.env.MATTERVIZ_E2E_MODE
// Playwright matches grep against filenames, titles and tags. @source marks individual
// tests that need development requests without moving their entire suite off production.
const source_tests = /structure\/host-tool\.test\.ts|@source\b/

export default {
  webServer: {
    command: `pnpm exec vite ${e2e_mode === `preview` ? `preview` : `dev`} --port 3005`,
    port: 3005,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    // Use Chromium's modern headless mode consistently in CI and local runs.
    channel: `chromium`,
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
        // Use one software Vulkan driver for Dawn, ANGLE and Chromium's compositor.
        // Selecting only the WebGPU adapter leaves the compositor on the system driver.
        ...(is_ci
          ? [
              `--use-webgpu-adapter=swiftshader`,
              `--use-vulkan=swiftshader`,
              `--use-angle=vulkan`,
              `--disable-vulkan-surface`,
            ]
          : []),
      ],
    },
  },
  // Software GPU browsers compete for a runner's CPU and memory. Keep each CI shard serial;
  // the shards still run in parallel on separate runners.
  workers: is_ci ? 1 : 16,
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
  // These suites inspect source registries or intercept development module requests. Others test
  // the production build in CI; ordinary local runs still run the complete suite on dev.
  ...(e2e_mode === `preview` ? { grepInvert: source_tests } : {}),
  ...(e2e_mode === `source` ? { grep: source_tests } : {}),
  reporter: [[`list`]], // keeps each shard's pass/fail readable in its CI log
} satisfies PlaywrightTestConfig
