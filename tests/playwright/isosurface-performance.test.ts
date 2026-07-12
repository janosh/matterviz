import { expect, type Locator, type Page, test } from '@playwright/test'
import process from 'node:process'
import { wait_for_canvas_rendered } from './helpers'

type ProfileEvent = {
  stage: string
  duration_ms: number
  meta: Record<string, boolean | number | string>
}

const detailed_profile = process.env.MATTERVIZ_PERF === `1`

const read_events = async (page: Page): Promise<ProfileEvent[]> =>
  JSON.parse(
    (await page.getByTestId(`profile-events`).textContent()) ?? `[]`,
  ) as ProfileEvent[]

const stage_events = (events: ProfileEvent[], stage: string): ProfileEvent[] =>
  events.filter((event) => event.stage === stage)

async function wait_for_stage(
  page: Page,
  stage: string,
  previous_count = 0,
  timeout = 30_000,
): Promise<ProfileEvent[]> {
  await expect
    .poll(async () => stage_events(await read_events(page), stage).length, { timeout })
    .toBeGreaterThan(previous_count)
  return read_events(page)
}

const benchmark_canvas = (page: Page): Locator =>
  page.getByTestId(`isosurface-benchmark-canvas`).locator(`canvas`)

async function goto_benchmark(
  page: Page,
  query: string,
  timeout = 45_000,
): Promise<ProfileEvent[]> {
  await page.goto(`/test/isosurface-performance?${query}`)
  const canvas = benchmark_canvas(page)
  await wait_for_canvas_rendered(canvas, { timeout })
  return wait_for_stage(page, `rebuild_total`, 0, timeout)
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

async function measure_updates(
  page: Page,
  events: ProfileEvent[],
  test_id: string,
  stage: string,
  iterations: number,
): Promise<[ProfileEvent[], number[]]> {
  const samples: number[] = []
  for (let iteration_idx = 0; iteration_idx < iterations; iteration_idx++) {
    const previous_count = stage_events(events, stage).length
    await page.getByTestId(test_id).click()
    events = await wait_for_stage(page, stage, previous_count)
    samples.push(stage_events(events, stage).at(-1)?.duration_ms ?? 0)
  }
  return [events, samples]
}

test.describe(`Isosurface performance harness`, () => {
  test.describe.configure({ mode: `serial` })

  test(`exposes stage-level metrics and renders a surface`, async ({ page }) => {
    const events = await goto_benchmark(page, `size=32&layers=1`, 20_000)
    expect(events.map((event) => event.stage)).toEqual(
      expect.arrayContaining([
        `prepare_geometry`,
        `marching_cubes`,
        `sample_scalars`,
        `apply_colormap`,
      ]),
    )
  })

  test(`profiles cold load, rebuild, recolor, FPS, and heap`, async ({ page }, test_info) => {
    test.skip(!detailed_profile, `Run with MATTERVIZ_PERF=1 for detailed profiling`)
    test.setTimeout(180_000)

    // Warm route compilation before measuring user-visible navigation.
    await page.goto(`/test/isosurface-performance?size=16&layers=1`)
    await wait_for_stage(page, `rebuild_total`)

    const scenarios = [
      [`unit-1-same`, 48, 1, `unit`, `same_grid`],
      [`integer-8-cross`, 64, 8, `integer`, `cross_grid`],
      [`fractional-4-cross`, 80, 4, `fractional`, `cross_grid`],
    ] as const
    const scenario_reports: Record<string, unknown>[] = []
    let events: ProfileEvent[] = []
    for (const [name, size, layers, range, color] of scenarios) {
      const scenario_start = performance.now()
      events = await goto_benchmark(
        page,
        `size=${size}&layers=${layers}&range=${range}&color=${color}`,
      )
      expect(events.some((event) => event.meta.worker_fallback)).toBe(false)
      if (size >= 64) expect(events.some((event) => event.meta.worker)).toBe(true)
      scenario_reports.push({
        name,
        size,
        layers,
        range,
        color,
        initial_ready_ms: performance.now() - scenario_start,
        events,
      })
    }

    const initial_heap_bytes = await page.getByTestId(`profile-heap`).textContent()
    let rebuild_samples: number[]
    ;[events, rebuild_samples] = await measure_updates(
      page,
      events,
      `change-isovalue`,
      `rebuild_total`,
      5,
    )
    const marching_before_recolor = stage_events(events, `marching_cubes`).length
    let recolor_samples: number[]
    ;[events, recolor_samples] = await measure_updates(
      page,
      events,
      `recolor`,
      `recolor_total`,
      7,
    )
    expect(stage_events(events, `marching_cubes`)).toHaveLength(marching_before_recolor)

    await page.getByTestId(`measure-fps`).click()
    await expect(page.getByTestId(`profile-fps`)).not.toHaveText(`pending`, {
      timeout: 5000,
    })
    const measured_fps = Number(await page.getByTestId(`profile-fps`).textContent())
    expect(measured_fps).toBeGreaterThan(1)

    const report = {
      rebuild_median_ms: median(rebuild_samples),
      recolor_median_ms: median(recolor_samples),
      fps: measured_fps,
      initial_heap_bytes,
      final_heap_bytes: await page.getByTestId(`profile-heap`).textContent(),
      scenarios: scenario_reports,
      events,
    }
    await expect(benchmark_canvas(page)).toBeVisible()
    await test_info.attach(`isosurface-profile.json`, {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: `application/json`,
    })
    console.info(
      `MATTERVIZ_BROWSER_PROFILE`,
      JSON.stringify({
        ...report,
        events: events.length,
        scenarios: scenario_reports.length,
      }),
    )

    expect(report.recolor_median_ms).toBeLessThan(report.rebuild_median_ms)
  })
})
