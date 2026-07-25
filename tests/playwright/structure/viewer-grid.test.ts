import { expect, type Locator, type Page, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// Browsers cap live WebGL contexts (~16) and evict the oldest: on the pre-WebGPU commit, 24
// viewers left 16 live and 8 blank. WebGPU has no such cap, so every canvas should stay drawn.
const VIEWER_COUNT = 24

// A GPU canvas reads back blank via drawImage once presented, so go through the compositor
// with an element screenshot (a blank one compresses to a tiny PNG). Retry since a viewport
// rebuilds its <Canvas> after device loss, detaching the element mid-capture.
const is_painted = async (canvas: Locator): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if ((await canvas.screenshot({ timeout: 15_000 })).byteLength > 2000) return true
    } catch {
      // element detached mid-capture — fall through and retry
    }
    await canvas.page().waitForTimeout(500)
  }
  return false
}

// navigator.gpu exists in any secure context, but headless Chromium only hands out an adapter
// with the WebGPU flags in playwright.config — so probe for a real one.
const has_webgpu_adapter = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    if (!(`gpu` in navigator)) return false
    try {
      return Boolean(await navigator.gpu.requestAdapter())
    } catch {
      return false
    }
  })

test.describe(`Viewer grid`, () => {
  test(`every viewer keeps its canvas across ${VIEWER_COUNT} simultaneous viewers`, async ({
    page,
  }) => {
    // 24 GPU canvases on a software adapter measured ~57s warm, ~5 min on a cold dev server
    // that must compile the route first. The timeouts below have the same cause.
    test.setTimeout(600_000)
    // Probe on a static asset first: that only needs a secure context, while the grid route
    // costs a compile plus 24 canvases before we could bail out.
    await page.goto(`/favicon.svg`, { waitUntil: `domcontentloaded` })
    const has_adapter = await has_webgpu_adapter(page)
    // Fail rather than skip on CI: the launch flags there guarantee a software adapter, so a
    // missing one is a regression and skipping would silently retire this guard.
    if (IS_CI) {
      expect(has_adapter, `WebGPU adapter from playwright.config launch flags`).toBe(true)
    } else test.skip(!has_adapter, `no WebGPU adapter on this machine`)

    // this route is server-rendered, so a cold compile delays even the HTML past goto's 30s
    await page.goto(`/test/viewer-grid?count=${VIEWER_COUNT}`, {
      waitUntil: `domcontentloaded`,
      timeout: 120_000,
    })

    const canvases = page.locator(`[data-testid="viewer-grid"] canvas`)
    await expect(canvases).toHaveCount(VIEWER_COUNT, { timeout: 120_000 })

    // An adapter proves the browser can do WebGPU, not that the viewers used it: three falls
    // back to WebGL on init failure, the context-capped path this test exists to catch.
    await expect(page.locator(`[data-testid="viewer-grid"]`)).toHaveAttribute(
      `data-backend`,
      `webgpu`,
      { timeout: 90_000 },
    )

    // Wait on the last viewer: eviction spares the newest canvases, so the earlier ones
    // checked afterwards are what actually detects it.
    await expect.poll(() => is_painted(canvases.last()), { timeout: 90_000 }).toBe(true)

    const unpainted: number[] = []
    for (let idx = 0; idx < VIEWER_COUNT; idx++) {
      if (!(await is_painted(canvases.nth(idx)))) unpainted.push(idx)
    }
    expect(unpainted, `viewers with a blank canvas`).toEqual([])
  })
})
