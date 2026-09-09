import { expect, type Page, test } from '@playwright/test'
import { IS_CI } from './helpers'

// The page builds a seeded synthetic hierarchy from ?top=&mid=&leaf= (see
// src/routes/test/sunburst-performance), so there is no fixture to host. Thresholds are
// tripwires for gross regressions on a software-rendered headless browser, not benchmarks.
type Metrics = {
  n_nodes: number
  build_ms: number
  mount_ms: number | null
  zoom_root_id: string | number | null
}

const read_metrics = async (page: Page): Promise<Metrics> =>
  JSON.parse((await page.getByTestId(`perf-metrics`).textContent()) ?? `{}`) as Metrics

// 12 groups x 12 subgroups x 10 leaves = 1596 nodes, the size where the pre-veil hover
// dimming (one fill-opacity rewrite per arc) fell well below 60 fps
const load_page = async (page: Page) => {
  await page.goto(`/test/sunburst-performance?top=12&mid=12&leaf=10`)
  await expect
    .poll(async () => (await read_metrics(page)).mount_ms ?? -1, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(0)
  const svg = page.locator(`svg[role="application"]`)
  await expect(svg.locator(`.arcs path`).first()).toBeVisible()
  const box = await svg.boundingBox()
  if (!box) throw new Error(`sunburst svg has no bounding box`)
  return {
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    radius: Math.min(box.width, box.height) / 2 - 20,
  }
}

// Count rAF ticks for `duration_ms` and report the longest gap between two of them
const sample_frames = (page: Page, duration_ms: number) =>
  page.evaluate(
    (run_ms) =>
      new Promise<{ frames: number; longest_ms: number }>((resolve) => {
        const start = performance.now()
        let last = start
        let frames = 0
        let longest_ms = 0
        const tick = () => {
          const now = performance.now()
          longest_ms = Math.max(longest_ms, now - last)
          last = now
          frames++
          if (now - start < run_ms) requestAnimationFrame(tick)
          else resolve({ frames, longest_ms })
        }
        requestAnimationFrame(tick)
      }),
    duration_ms,
  )

test.describe(`Sunburst performance`, () => {
  for (const n_leaf of [392, 1400]) {
    test(`expands ${n_leaf} patterned leaves and keeps subsequent hovering responsive`, async ({
      page,
    }) => {
      await page.goto(
        `/test/sunburst-performance?top=4&mid=4&leaf=${n_leaf}&max_children=12&patterned=1`,
      )
      const bucket = page.locator(`.arcs path[aria-label^="Other:"]`).first()
      await expect(bucket).toBeVisible()
      // Exercise a real tween after the component's initial 500 ms settling window.
      await page.waitForTimeout(550)
      const zoom_frames = sample_frames(page, 700)
      await bucket.dispatchEvent(`click`)
      const zoom = await zoom_frames
      await expect(page.locator(`.arcs path`)).toHaveCount(n_leaf)
      await expect(page.locator(`.arc-paints path`)).toHaveCount(1)
      expect((await read_metrics(page)).zoom_root_id).toBe(`T0/M0`)

      // All jobs retain their own hit target, but a run of identically patterned
      // leaves paints one annulus. WebKit previously repainted the texture hundreds
      // of times per hover (400+ ms frames for just 392 leaves).
      const paint = page.locator(`.arc-paints path`)
      const painted_path = await paint.getAttribute(`d`)
      expect(painted_path?.match(/M/g)?.length).toBe(2) // outer circle + inner hole
      await expect(page.locator(`.arcs path[fill="transparent"]`)).toHaveCount(n_leaf)
      const hover = await page.evaluate(async () => {
        const chart = document.querySelector(`svg[role="application"]`)
        if (!chart) throw new Error(`Sunburst SVG missing`)
        const box = chart.getBoundingClientRect()
        const center_x = box.x + box.width / 2
        const center_y = box.y + box.height / 2
        const radius = (Math.min(box.width, box.height) / 2 - 20) * 0.8
        let previous = performance.now()
        let longest_ms = 0
        let total_ms = 0
        for (let step = 0; step < 30; step++) {
          const angle = (step / 30) * 2 * Math.PI
          const client_x = center_x + Math.sin(angle) * radius
          const client_y = center_y - Math.cos(angle) * radius
          const target = document.elementFromPoint(client_x, client_y)
          target?.dispatchEvent(
            new MouseEvent(`mousemove`, {
              bubbles: true,
              clientX: client_x,
              clientY: client_y,
            }),
          )
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          })
          const now = performance.now()
          longest_ms = Math.max(longest_ms, now - previous)
          total_ms += now - previous
          previous = now
        }
        return { longest_ms, total_ms }
      })
      await expect(page.locator(`.plot-tooltip`)).toContainText(`Leaf`)
      await expect(paint).toHaveAttribute(`d`, painted_path ?? ``)
      console.info(JSON.stringify({ n_leaf, zoom, hover }))
      expect(zoom.longest_ms).toBeLessThan(IS_CI ? 400 : 150)
      expect(hover.longest_ms).toBeLessThan(IS_CI ? 250 : 100)
      expect(hover.total_ms).toBeLessThan(IS_CI ? 4000 : 1500)
      await page.getByRole(`button`, { name: `all`, exact: true }).click()
      await expect.poll(async () => (await read_metrics(page)).zoom_root_id).toBeNull()
    })
  }

  test(`mounts 1.6k arcs and reports metrics`, async ({ page }) => {
    await load_page(page)
    const { n_nodes, build_ms, mount_ms } = await read_metrics(page)
    expect(n_nodes).toBe(1596)
    expect(await page.locator(`.arcs path`).count()).toBe(n_nodes)
    console.info(`build ${build_ms.toFixed(0)} ms, mount ${mount_ms?.toFixed(0)} ms`)
    expect(build_ms).toBeLessThan(IS_CI ? 2000 : 500)
    expect(mount_ms ?? Infinity).toBeLessThan(IS_CI ? 15_000 : 5000)
  })

  test(`hover sweep across the outer ring dims via one veil path and keeps frames short`, async ({
    page,
  }) => {
    const { cx, cy, radius } = await load_page(page)
    // A hover must not touch per-arc fill-opacity: dimming is the single .hover-veil path
    await page.mouse.move(cx + radius * 0.8, cy)
    await expect(page.locator(`.hover-veil`)).toHaveCount(1)
    expect(
      await page.locator(`.arcs path[fill-opacity]:not([fill-opacity="1"])`).count(),
    ).toBe(0)

    const sampling = sample_frames(page, 600)
    for (let step = 0; step < 30; step++) {
      const angle = (step / 30) * 2 * Math.PI
      await page.mouse.move(
        cx + Math.sin(angle) * radius * 0.8,
        cy - Math.cos(angle) * radius * 0.8,
      )
    }
    const { frames, longest_ms } = await sampling
    console.info(`hover sweep: ${frames} frames / 600 ms, longest ${longest_ms.toFixed(1)} ms`)
    // Pre-veil this ran ~15 frames with 65 ms hovers; a software renderer still clears 30
    expect(frames).toBeGreaterThan(IS_CI ? 15 : 30)
    expect(longest_ms).toBeLessThan(IS_CI ? 250 : 100)
  })

  test(`zooming in and out animates without multi-hundred-ms frames`, async ({ page }) => {
    const { cx, cy, radius } = await load_page(page)
    // 12 o'clock sits on a pad gap between groups, so aim slightly clockwise of it
    const target = [
      cx + Math.sin(0.3) * radius * 0.45,
      cy - Math.cos(0.3) * radius * 0.45,
    ] as const
    await page.mouse.move(...target)
    const zoom_in = sample_frames(page, 500)
    await page.mouse.click(...target)
    const zoom_in_frames = await zoom_in
    expect((await read_metrics(page)).zoom_root_id).toBe(`T0`)
    console.info(
      `zoom in: ${zoom_in_frames.frames} frames, longest ${zoom_in_frames.longest_ms.toFixed(1)} ms`,
    )

    const zoom_out = sample_frames(page, 500)
    await page.mouse.click(cx, cy) // center hole zooms back out
    const zoom_out_frames = await zoom_out
    expect((await read_metrics(page)).zoom_root_id).toBeNull()
    console.info(
      `zoom out: ${zoom_out_frames.frames} frames, longest ${zoom_out_frames.longest_ms.toFixed(1)} ms`,
    )

    // Pre-gating a zoom rebuilt the layout and re-measured every label (~60 ms spikes at
    // 5k arcs); zooming out remounts ~1.5k paths in one frame, hence the looser cap.
    // longest_ms is the actual tripwire, so it is asserted first: a genuine stall then reports
    // as a stall instead of as a frame shortfall. The frame count is only a liveness check, and
    // its CI floor was a disguised fps threshold - a shared runner software-rendering 1.6k arcs
    // came in at 6-7 frames per 500 ms against a floor of 9, failing all three attempts.
    for (const { frames, longest_ms } of [zoom_in_frames, zoom_out_frames]) {
      expect(longest_ms).toBeLessThan(IS_CI ? 400 : 150)
      expect(frames).toBeGreaterThan(IS_CI ? 3 : 15)
    }
  })
})
