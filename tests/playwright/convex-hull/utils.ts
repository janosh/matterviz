import type { Locator } from '@playwright/test'

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

export async function dom_click(target: Locator): Promise<void> {
  const handle = await target.elementHandle()
  if (handle) {
    await handle.evaluate((btn) => (btn as HTMLButtonElement).click())
    await handle.dispose()
  } else {
    await target.click({ force: true })
  }
}
