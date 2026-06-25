import type { Locator, Page } from '@playwright/test'

export async function ensure_pane_visible(pane: Locator, opener_btn: Locator): Promise<void> {
  // Try to make pane visible by clicking its opener button if needed
  try {
    if (!(await pane.isVisible())) await opener_btn.click()
    if (!(await pane.isVisible())) await pane.scrollIntoViewIfNeeded()
  } catch {
    // Best-effort fallback to avoid test flakiness
  }
}

// Open a DraggablePane through its toggle and retry while WebGL-heavy pages settle.
async function open_pane(
  page: Page,
  diagram: Locator,
  pane_selector: string,
  toggle_selector: string,
): Promise<Locator> {
  const pane = diagram.locator(`.draggable-pane.${pane_selector}`)
  const toggle = diagram.locator(toggle_selector).first()

  for (let attempt = 0; attempt < 5; attempt++) {
    await dom_click(toggle)
    await page.waitForTimeout(200)
    if (await pane.isVisible()) return pane
  }
  return pane
}

export const open_controls_pane = (page: Page, diagram: Locator): Promise<Locator> =>
  open_pane(
    page,
    diagram,
    `convex-hull-controls-pane`,
    `.legend-controls-btn, .convex-hull-controls-toggle`,
  )

export const open_info_pane = (page: Page, diagram: Locator): Promise<Locator> =>
  open_pane(page, diagram, `convex-hull-info-pane`, `.info-btn`)

export async function open_info_and_controls(
  diagram: Locator,
): Promise<{ info: Locator; controls: Locator }> {
  const info_btn = diagram.locator(`.info-btn`)
  await dom_click(info_btn)
  const info = diagram.locator(`.draggable-pane.convex-hull-info-pane`)
  await ensure_pane_visible(info, info_btn)

  const controls_btn = diagram.locator(`.legend-controls-btn`)
  await dom_click(controls_btn)
  const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
  await ensure_pane_visible(controls, controls_btn)

  return { info, controls }
}

// Position-sensitive rolling hash over every 4th canvas pixel. The previous
// sum-of-every-100th-pixel hash only sampled 8 fixed columns (stride 100 pixels in
// row-major order), so small marker changes between those columns went undetected.
export const get_canvas_hash = (canvas: Locator): Promise<string> =>
  canvas.evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext(`2d`)
    if (!ctx) return ``
    const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
    let hash = 0
    // Math.imul wraps to 32 bits, keeping the rolling hash in safe-integer range
    for (let idx = 0; idx < data.length; idx += 16) {
      hash = Math.imul(hash, 31) + data[idx]
    }
    return hash.toString()
  })

// Dispatch directly through Playwright so canvas overlays cannot intercept control clicks.
export const dom_click = (target: Locator): Promise<void> => target.dispatchEvent(`click`)
