import { expect, type Page, test } from '@playwright/test'
import { wait_for_canvas_rendered, webgl_on_ci_for_tagged } from './helpers'

webgl_on_ci_for_tagged()

type ProfileEvent = {
  stage: string
  duration_ms: number
  meta: Record<string, boolean | number | string>
}

const read_events = async (page: Page): Promise<ProfileEvent[]> =>
  JSON.parse(
    (await page.getByTestId(`profile-events`).textContent()) ?? `[]`,
  ) as ProfileEvent[]

const count_rebuilds = async (page: Page): Promise<number> =>
  (await read_events(page)).filter((event) => event.stage === `rebuild_total`).length

// Load the harness at a grid size and wait for the surface to paint and the first rebuild to
// finish, returning the recorded events
const load_harness = async (
  page: Page,
  { size, layers, timeout }: { size: number; layers: number; timeout: number },
): Promise<ProfileEvent[]> => {
  await page.goto(`/test/isosurface-performance?size=${size}&layers=${layers}`)
  const canvas = page.getByTestId(`isosurface-benchmark-canvas`).locator(`canvas`)
  await wait_for_canvas_rendered(canvas, { timeout })
  await expect.poll(() => count_rebuilds(page), { timeout }).toBeGreaterThan(0)
  return read_events(page)
}

test.describe(`Isosurface performance harness`, { tag: `@webgl` }, () => {
  test(`exposes stage-level metrics and renders a surface`, async ({ page }) => {
    // 32^3 stays under the worker threshold, so this covers main-thread extraction
    const events = await load_harness(page, { size: 32, layers: 1, timeout: 20_000 })
    expect(events.map((event) => event.stage)).toEqual(
      expect.arrayContaining([
        `prepare_geometry`,
        `marching_cubes`,
        `sample_scalars`,
        `apply_colormap`,
      ]),
    )
  })

  test(`grids of 200K+ points extract in the geometry worker`, async ({ page }) => {
    // 64^3 = 262K points crosses the worker threshold; every marching-cubes stage must then
    // be tagged worker:true (a failing worker URL would silently fall back to the main thread)
    const events = await load_harness(page, { size: 64, layers: 2, timeout: 30_000 })
    const marching = events.filter((event) => event.stage === `marching_cubes`)
    expect(marching.length).toBeGreaterThanOrEqual(2)
    expect(marching.every((event) => event.meta.worker === true)).toBe(true)
    expect(marching.every((event) => Number(event.meta.vertices) > 0)).toBe(true)
    expect(events.some((event) => event.meta.worker_fallback === true)).toBe(false)
    const rebuild_count = await count_rebuilds(page)
    await page.getByRole(`button`, { name: `Benchmark prediction` }).click()
    await expect
      .poll(() => count_rebuilds(page), { timeout: 30_000 })
      .toBeGreaterThan(rebuild_count)
    const metrics = JSON.parse(
      (await page.getByTestId(`prediction-metrics`).textContent()) ?? `null`,
    )
    expect(metrics.publication_ms).toHaveLength(3)
    expect(metrics.publication_ms.every((duration: number) => duration > 0)).toBe(true)
    expect(metrics.export_ms).toBeGreaterThan(0)
    expect(metrics.density_bytes).toBe((64 ** 3 + 53 ** 3) * 8)
    expect(metrics.export_bytes).toBeGreaterThan(metrics.density_bytes)
  })
})
