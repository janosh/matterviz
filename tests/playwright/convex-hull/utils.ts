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

// Robustly open a DraggablePane via direct DOM manipulation.
// (Svelte 5's event delegation prevents programmatic .click() from toggling state,
// so we bypass Svelte and set display + class directly.)
async function open_pane(
  page: Page,
  diagram: Locator,
  pane_selector: string,
  toggle_selector?: string,
): Promise<Locator> {
  const pane = diagram.locator(`.draggable-pane.${pane_selector}`)

  for (let attempt = 0; attempt < 5; attempt++) {
    // Force-open via DOM: set display and add class, matching DraggablePane's show=true state
    await diagram.evaluate(
      (el, { sel, toggle_sel }) => {
        const pane_el = el.querySelector(`.${sel}`) as HTMLElement
        if (pane_el) {
          pane_el.style.display = `grid`
          pane_el.classList.add(`pane-open`)
          if (toggle_sel) {
            const toggle = el.querySelector(toggle_sel)
            if (toggle) toggle.setAttribute(`aria-expanded`, `true`)
          }
        }
      },
      { sel: pane_selector, toggle_sel: toggle_selector ?? null },
    )
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
  open_pane(page, diagram, `convex-hull-info-pane`)

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

// Single protocol round-trip (locator.evaluate auto-waits for the element). The previous
// elementHandle -> evaluate -> dispose dance took 3 round-trips, which stalled for 80+ s
// on main-thread-saturated pages (10+ canvases with rAF pulse loops on the demo page).
export const dom_click = (target: Locator): Promise<void> =>
  target.evaluate((el) => (el as HTMLElement).click())
