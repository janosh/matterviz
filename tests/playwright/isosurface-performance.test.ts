import { expect, type Page, test } from '@playwright/test'
import { wait_for_canvas_rendered } from './helpers'

type ProfileEvent = {
  stage: string
  duration_ms: number
  meta: Record<string, boolean | number | string>
}

const read_events = async (page: Page): Promise<ProfileEvent[]> =>
  JSON.parse(
    (await page.getByTestId(`profile-events`).textContent()) ?? `[]`,
  ) as ProfileEvent[]

test.describe(`Isosurface performance harness`, () => {
  test(`exposes stage-level metrics and renders a surface`, async ({ page }) => {
    await page.goto(`/test/isosurface-performance?size=32&layers=1`)
    const canvas = page.getByTestId(`isosurface-benchmark-canvas`).locator(`canvas`)
    await wait_for_canvas_rendered(canvas, { timeout: 20_000 })
    await expect
      .poll(
        async () => (await read_events(page)).some((event) => event.stage === `rebuild_total`),
        {
          timeout: 20_000,
        },
      )
      .toBe(true)
    expect((await read_events(page)).map((event) => event.stage)).toEqual(
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
    await page.goto(`/test/isosurface-performance?size=64&layers=2`)
    const canvas = page.getByTestId(`isosurface-benchmark-canvas`).locator(`canvas`)
    await wait_for_canvas_rendered(canvas, { timeout: 30_000 })
    await expect
      .poll(
        async () => (await read_events(page)).some((event) => event.stage === `rebuild_total`),
        { timeout: 30_000 },
      )
      .toBe(true)
    const events = await read_events(page)
    const marching = events.filter((event) => event.stage === `marching_cubes`)
    expect(marching.length).toBeGreaterThanOrEqual(2)
    expect(marching.every((event) => event.meta.worker === true)).toBe(true)
    expect(marching.every((event) => Number(event.meta.vertices) > 0)).toBe(true)
    expect(events.some((event) => event.meta.worker_fallback === true)).toBe(false)
  })
})
