import type { Locator, Page } from '@playwright/test'

export async function ensure_pane_visible(
  pane: Locator,
  opener_btn: Locator,
): Promise<void> {
  // Try to make pane visible by clicking its opener button if needed
  try {
    if (!(await pane.isVisible())) await opener_btn.click()
    if (!(await pane.isVisible())) await pane.scrollIntoViewIfNeeded()
  } catch {
    // Best-effort fallback to avoid test flakiness
  }
}

// Robustly open the controls pane with retries
export async function open_controls_pane(
  page: Page,
  diagram: Locator,
): Promise<Locator> {
  const pane = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)

  for (let attempt = 0; attempt < 3; attempt++) {
    // Use evaluate to directly toggle the pane's display via its show state
    // deno-lint-ignore no-await-in-loop -- sequential retry required
    await diagram.evaluate((el) => {
      const pane_el = el.querySelector(`.convex-hull-controls-pane`) as HTMLElement
      if (pane_el && getComputedStyle(pane_el).display === `none`) {
        pane_el.style.display = `grid`
        pane_el.classList.add(`pane-open`)
      }
    })
    // deno-lint-ignore no-await-in-loop -- sequential retry required
    await page.waitForTimeout(100)
    // deno-lint-ignore no-await-in-loop -- sequential retry required
    if (await pane.isVisible()) return pane
  }
  return pane
}

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

// Simple pixel hash of a canvas — sum of every 100th pixel's red channel
export function get_canvas_hash(canvas: Locator): Promise<string> {
  return canvas.evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext(`2d`)
    if (!ctx) return ``
    const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
    let hash = 0
    for (let idx = 0; idx < data.length; idx += 400) hash += data[idx]
    return hash.toString()
  })
}

export async function dom_click(target: Locator): Promise<void> {
  const handle = await target.elementHandle()
  if (handle) {
    await handle.evaluate((btn) => (btn as HTMLButtonElement).click())
    await handle.dispose()
  } else {
    await target.click({ force: true })
  }
}
