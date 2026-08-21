import { expect, type Page, test } from '@playwright/test'
import { IS_CI } from './helpers'

// The page builds a seeded synthetic run from ?frames=&atoms= (see
// src/routes/test/trajectory-performance), so there is no fixture to host. Thresholds are
// tripwires for gross regressions on a software-rendered headless browser, not benchmarks.
type Metrics = {
  frames: number
  atoms: number
  build_ms: number
  mount_ms: number | null
  current_step_idx: number
}

const read_metrics = async (page: Page): Promise<Metrics> =>
  JSON.parse((await page.getByTestId(`perf-metrics`).textContent()) ?? `{}`) as Metrics

const load_page = async (page: Page, frames: number, atoms: number) => {
  await page.goto(`/test/trajectory-performance?frames=${frames}&atoms=${atoms}`)
  // The viewer is client-only, so nothing renders before the bundle has loaded and mounted
  // (mount_ms is set in onMount); a cold vite dev server can take several seconds to serve it
  await expect
    .poll(async () => (await read_metrics(page)).mount_ms ?? -1, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(0)
  const trajectory = page.locator(`.trajectory`)
  await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible()
  return trajectory
}

test.describe(`Trajectory performance`, () => {
  test(`mounts a 300x64 synthetic run and reports every frame`, async ({ page }) => {
    const trajectory = await load_page(page, 300, 64)
    const { build_ms, mount_ms } = await read_metrics(page)
    await expect(
      trajectory.locator(`.trajectory-controls span`).filter({ hasText: `/ 300` }),
    ).toBeVisible()
    console.info(`build ${build_ms.toFixed(0)} ms, mount ${mount_ms?.toFixed(0)} ms`)
    expect(build_ms).toBeLessThan(IS_CI ? 5000 : 1500)
    expect(mount_ms ?? Infinity).toBeLessThan(IS_CI ? 15_000 : 5000)
  })

  test(`auto-plays through frames without falling below 0.5 fps`, async ({ page }) => {
    test.setTimeout(120_000)
    await load_page(page, 300, 64)
    const start_step = (await read_metrics(page)).current_step_idx
    const frames_to_measure = 10
    const start_time = Date.now()
    await expect
      .poll(async () => (await read_metrics(page)).current_step_idx, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(start_step + frames_to_measure)
    const elapsed_ms = Date.now() - start_time
    await page.locator(`.play-button`).click() // pause before reading memory
    const actual_fps = (frames_to_measure / elapsed_ms) * 1000
    console.info(
      `${frames_to_measure} frames in ${elapsed_ms} ms (${actual_fps.toFixed(2)} fps)`,
    )
    // Software WebGPU renders a 64-atom scene at a few fps; anything under 0.5 is a regression
    expect(actual_fps).toBeGreaterThan(0.5)

    // Chromium-only heap probe: playback must not accumulate per-frame garbage
    const heap_mb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory
      return memory ? memory.usedJSHeapSize / 2 ** 20 : null
    })
    if (heap_mb !== null) expect(heap_mb).toBeLessThan(500)
  })
})
