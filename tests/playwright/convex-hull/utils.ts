import { expect, type Locator, type Page } from '@playwright/test'

// The performance page builds synthetic entries client-side (no fixture download), so it is
// the fast route to a hull of a given size; resolves to the rendered diagram
export const goto_perf_page = async (
  page: Page,
  dim: `2d` | `3d` | `4d`,
  query: string,
): Promise<Locator> => {
  await page.goto(`/test/convex-hull-performance?dim=${dim}&${query}`, {
    waitUntil: `networkidle`,
    timeout: 15_000,
  })
  return page.locator(`.convex-hull-${dim}`).first()
}

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

// Visible count X of an info-pane "Visible ... X / Y" row
export const visible_count = async (info: Locator, testid: string): Promise<number> => {
  const text = await info.getByTestId(testid).textContent()
  const match = text?.match(/(?<visible>\d+)\s*\//)
  if (!match?.groups) throw new Error(`unparsable ${testid} text: ${text}`)
  return Number(match.groups.visible)
}

// Position-sensitive rolling hash over every 4th canvas pixel, so small marker changes register
export const get_canvas_hash = (canvas: Locator): Promise<string> =>
  canvas.evaluate((element) => {
    const ctx = (element as HTMLCanvasElement).getContext(`2d`)
    if (!ctx) return ``
    const { data } = ctx.getImageData(0, 0, element.clientWidth, element.clientHeight)
    let hash = 0
    // Math.imul wraps to 32 bits, keeping the rolling hash in safe-integer range
    for (let idx = 0; idx < data.length; idx += 16) {
      hash = Math.imul(hash, 31) + data[idx]
    }
    return hash.toString()
  })

// Dispatch directly through Playwright so canvas overlays cannot intercept control clicks.
export const dom_click = (target: Locator): Promise<void> => target.dispatchEvent(`click`)

// The hull-face color mode buttons all render, `active` is selected and the uniform color
// picker shows only in Uniform mode; resolves to the button group
export const expect_face_color_modes = async (
  controls: Locator,
  active: `Uniform` | `Formation energy` | `Element` | `Index`,
): Promise<Locator> => {
  const mode_buttons = controls.locator(`.face-color-mode-buttons`)
  await expect(mode_buttons).toBeVisible()
  for (const label of [`Uniform`, `Formation energy`, `Element`, `Index`]) {
    await expect(mode_buttons.getByText(label)).toBeVisible()
  }
  await expect(mode_buttons.getByText(active)).toHaveClass(/active/)
  const color_picker = controls.locator(`input[type="color"]`).first()
  await expect(color_picker).toBeVisible({ visible: active === `Uniform` })
  return mode_buttons
}
