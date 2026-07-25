import { expect, type Locator, type Page, test } from '@playwright/test'

// Browsers cap simultaneous live WebGL contexts (~16) and silently evict the oldest, which
// used to blank out earlier viewers on pages embedding many structures. Measured on the
// pre-WebGPU commit, 24 viewers left 16 live and 8 lost. WebGPU has no equivalent cap, so
// every canvas should stay drawn — this guards against regressing back to a capped backend.
const VIEWER_COUNT = 24

// A GPU canvas reads back blank via drawImage once the frame is presented, so go through the
// compositor with an element screenshot. A blank canvas compresses to a tiny PNG.
// Retry on failure: a viewport rebuilds its <Canvas> after a device loss, which can detach the
// element between resolving the locator and capturing it. Only a canvas that stays blank
// across retries counts as evicted.
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

// Gate on a real GPU adapter rather than on CI: navigator.gpu exists in any secure context,
// but headless Chromium only hands out an adapter when launched with the WebGPU flags in
// playwright.config. Skipping on IS_CI instead would mean this regression never runs on CI at
// all, which is precisely where a silent fallback to a context-capped backend would slip in.
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
    // Deliberately generous: 24 GPU canvases on a software adapter measured ~57s warm but
    // ~5min on a cold dev server that must compile the route first. Slow, but this is the
    // only guard against silently regressing to a context-capped backend.
    test.setTimeout(600_000)
    // Check the adapter on a static asset first: it only needs a secure context, whereas the
    // grid route costs a dev-server compile plus 24 canvases before we could bail out.
    await page.goto(`/favicon.svg`, { waitUntil: `domcontentloaded` })
    test.skip(!(await has_webgpu_adapter(page)), `no WebGPU adapter available`)

    // Explicit timeout: SvelteKit renders this route server-side, so a cold dev server has to
    // compile it before any HTML comes back — measured over 60s, well past goto's 30s default.
    await page.goto(`/test/viewer-grid?count=${VIEWER_COUNT}`, {
      waitUntil: `domcontentloaded`,
      timeout: 120_000,
    })

    // Generous timeout: on a cold dev server this route has to be compiled before it mounts,
    // which measured over 60s here and far exceeds the default 5s assertion window.
    const canvases = page.locator(`[data-testid="viewer-grid"] canvas`)
    await expect(canvases).toHaveCount(VIEWER_COUNT, { timeout: 120_000 })

    // An adapter proves the browser can do WebGPU, not that the viewers used it — three falls
    // back to its WebGL backend on init failure, which is the context-capped path this test
    // exists to catch. The route reports the live backend of a mounted viewer's renderer.
    await expect(page.locator(`[data-testid="viewer-grid"]`)).toHaveAttribute(
      `data-backend`,
      `webgpu`,
      { timeout: 90_000 },
    )

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
