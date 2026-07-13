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
})
