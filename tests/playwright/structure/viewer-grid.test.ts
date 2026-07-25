import { expect, type Locator, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// Browsers cap simultaneous live WebGL contexts (~16) and silently evict the oldest, which
// used to blank out earlier viewers on pages embedding many structures. Measured on the
// pre-WebGPU commit, 24 viewers left 16 live and 8 lost. WebGPU has no equivalent cap, so
// every canvas should stay drawn — this guards against regressing back to a capped backend.
const VIEWER_COUNT = 24

// A GPU canvas reads back blank via drawImage once the frame is presented, so go through the
// compositor with an element screenshot. A blank canvas compresses to a tiny PNG.
const is_painted = async (canvas: Locator): Promise<boolean> =>
  (await canvas.screenshot()).byteLength > 2000

test.describe(`Viewer grid`, () => {
  test.skip(IS_CI, `many simultaneous GPU canvases are too slow under CI software rendering`)

  test(`every viewer keeps its canvas across ${VIEWER_COUNT} simultaneous viewers`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto(`/test/viewer-grid?count=${VIEWER_COUNT}`, {
      waitUntil: `domcontentloaded`,
    })

    const canvases = page.locator(`[data-testid="viewer-grid"] canvas`)
    await expect(canvases).toHaveCount(VIEWER_COUNT)

    // Wait for the last viewer specifically: if the browser were evicting contexts, the most
    // recently created ones would survive and the earliest would go blank, so checking the
    // first canvas afterwards is what actually detects eviction.
    await expect.poll(() => is_painted(canvases.last()), { timeout: 90_000 }).toBe(true)

    const unpainted: number[] = []
    for (let idx = 0; idx < VIEWER_COUNT; idx++) {
      if (!(await is_painted(canvases.nth(idx)))) unpainted.push(idx)
    }
    expect(unpainted, `viewers with a blank canvas`).toEqual([])
  })
})
