import { expect, type Page, test } from '@playwright/test'
import {
  canvas_screenshot,
  decode_canvas_png,
  wait_for_3d_canvas,
  webgl_on_ci_for_tagged,
} from './helpers'

webgl_on_ci_for_tagged()

// The route's cloud colour in 8-bit sRGB, red channel (straight RGB 0.1, 0.3, 0.9)
const CLOUD_RED = 0.1 * 255

type CloudStats = { content_fraction: number; center_alpha: number }

// Fraction of pixels off the background (mean corner colour), and the cloud's coverage at the
// centre estimated from the red channel (pixel = bg·(1-α) + cloud·α) over a 7x7 patch
async function cloud_stats(page: Page, case_id: string): Promise<CloudStats> {
  const canvas = await wait_for_3d_canvas(page, `#${case_id}`)
  const png = await canvas_screenshot(canvas)
  const decoded = await decode_canvas_png(page, png)
  try {
    return await decoded.evaluate(({ data, width, height, background }, cloud_red) => {
      let content = 0
      for (let idx = 0; idx < data.length; idx += 4) {
        const delta = [0, 1, 2].map((channel) =>
          Math.abs(data[idx + channel] - background[channel]),
        )
        if (Math.max(...delta) > 12) content++
      }
      let red_sum = 0
      let n_patch = 0
      const [mid_x, mid_y] = [Math.floor(width / 2), Math.floor(height / 2)]
      for (let row = mid_y - 3; row <= mid_y + 3; row++)
        for (let col = mid_x - 3; col <= mid_x + 3; col++) {
          red_sum += data[(row * width + col) * 4]
          n_patch++
        }
      const center_alpha = (background[0] - red_sum / n_patch) / (background[0] - cloud_red)
      return { content_fraction: content / (width * height), center_alpha }
    }, CLOUD_RED)
  } finally {
    await decoded.dispose()
  }
}

test.describe(`ColorFieldVolume across supercells`, { tag: `@webgl` }, () => {
  test(`a 2x1x1 and a sheared supercell absorb per input cell like 1x1x1`, async ({
    page,
  }) => {
    await page.goto(`/test/color-field`, { waitUntil: `networkidle` })
    const read_all = async () =>
      Object.fromEntries(
        await Promise.all(
          [`cloud-1x1x1`, `cloud-2x1x1`, `cloud-sheared`].map(
            async (id) => [id, await cloud_stats(page, id)] as const,
          ),
        ),
      )
    // wait until every cloud has drawn (the camera fit and texture upload land a few frames in)
    let stats: Record<string, CloudStats> = {}
    await expect
      .poll(async () => {
        stats = await read_all()
        return Math.min(...Object.values(stats).map(({ center_alpha }) => center_alpha))
      })
      .toBeGreaterThan(0.2)
    for (const { content_fraction } of Object.values(stats))
      expect(content_fraction).toBeGreaterThan(0.1)
    const reference = stats[`cloud-1x1x1`].center_alpha
    // Every centre ray crosses one input cell along c, so the opacities agree up to 8-bit
    // quantization (1/230 per pixel, averaged over 49), half-float density (~1e-3) and the
    // sheared centre patch's partial rays (the sheared prism's footprint is 2 cells wide and
    // only its centre column crosses the full slab: a 3 px offset loses ~3 px / L_px of path).
    // Measured: 2x1x1 matches exactly, sheared is 1.2% low. Absorbing over the local steps
    // (sqrt(2) per input cell when sheared) measured +21%, so 4% separates the two.
    for (const id of [`cloud-2x1x1`, `cloud-sheared`])
      expect(Math.abs(stats[id].center_alpha / reference - 1), id).toBeLessThan(0.04)
  })
})
