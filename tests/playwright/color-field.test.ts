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

type CloudStats = { content_fraction: number; center_alpha: number; aspect: number }

// Fraction of pixels off the background (mean corner colour), the width / height of their
// bounding box, and the cloud's coverage at the centre estimated from the red channel
// (pixel = bg·(1-α) + cloud·α) over a 7x7 patch
async function cloud_stats(page: Page, case_id: string): Promise<CloudStats> {
  const canvas = await wait_for_3d_canvas(page, `#${case_id}`)
  const png = await canvas_screenshot(canvas)
  const decoded = await decode_canvas_png(page, png)
  try {
    return await decoded.evaluate(({ data, width, height, background }, cloud_red) => {
      let content = 0
      const min = [width, height]
      const max = [0, 0]
      for (let idx = 0; idx < data.length; idx += 4) {
        const delta = [0, 1, 2].map((channel) =>
          Math.abs(data[idx + channel] - background[channel]),
        )
        if (Math.max(...delta) <= 12) continue
        content++
        const pixel = [(idx / 4) % width, Math.floor(idx / 4 / width)]
        for (const axis of [0, 1]) {
          min[axis] = Math.min(min[axis], pixel[axis])
          max[axis] = Math.max(max[axis], pixel[axis])
        }
      }
      const aspect = (max[0] - min[0] + 1) / (max[1] - min[1] + 1)
      let red_sum = 0
      let n_patch = 0
      const [mid_x, mid_y] = [Math.floor(width / 2), Math.floor(height / 2)]
      for (let row = mid_y - 3; row <= mid_y + 3; row++)
        for (let col = mid_x - 3; col <= mid_x + 3; col++) {
          red_sum += data[(row * width + col) * 4]
          n_patch++
        }
      const center_alpha = (background[0] - red_sum / n_patch) / (background[0] - cloud_red)
      return { content_fraction: content / (width * height), center_alpha, aspect }
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
    const ids = [`cloud-1x1x1`, `cloud-2x1x1`, `cloud-sheared`]
    // wait until every cloud has drawn (the camera fit and texture upload land a few frames in)
    let stats: Record<string, CloudStats> = {}
    await expect
      .poll(async () => {
        const all = await Promise.all(ids.map((id) => cloud_stats(page, id)))
        stats = Object.fromEntries(ids.map((id, idx) => [id, all[idx]]))
        return Math.min(...Object.values(stats).map(({ center_alpha }) => center_alpha))
      })
      .toBeGreaterThan(0.2)
    for (const { content_fraction } of Object.values(stats))
      expect(content_fraction).toBeGreaterThan(0.1)
    // the 12x6 A 2x1x1 cloud must render its own footprint, not the 6x6 A base cell's (measured
    // 1.32x wider; the frame's fit and soft cloud edges keep it below the ideal 2x)
    expect(stats[`cloud-2x1x1`].aspect).toBeGreaterThan(1.2 * stats[`cloud-1x1x1`].aspect)
    const reference = stats[`cloud-1x1x1`].center_alpha
    // Every centre ray crosses one input cell along c, so opacities agree up to 8-bit
    // quantization, half-float density (~1e-3) and the sheared patch's partial rays. Measured:
    // 2x1x1 exact, sheared 1.2% low; absorbing over local steps (sqrt(2) per input cell when
    // sheared) measured +21%, so 4% separates the two.
    for (const id of [`cloud-2x1x1`, `cloud-sheared`])
      expect(Math.abs(stats[id].center_alpha / reference - 1), id).toBeLessThan(0.04)
  })
})
