import { expect, type Locator, type Page } from '@playwright/test'

interface OpenPaneOptions {
  pane_selector: string
  parent_selector?: string
  checkbox_text?: string
  toggle_selector?: string
  timeout?: number
}

// Helper function to open draggable panes and wait for positioning
export async function open_draggable_pane(page: Page, options: OpenPaneOptions) {
  const { pane_selector, parent_selector, checkbox_text, timeout = 5000 } = options

  const container = parent_selector ? page.locator(parent_selector) : page

  const pane_div = container.locator(pane_selector)

  if (checkbox_text) { // If checkbox_text is provided, use checkbox-based opening
    const test_page_checkbox = page.locator(
      `label:has-text("${checkbox_text}") input[type="checkbox"]`,
    )

    await test_page_checkbox.uncheck() // First ensure the checkbox is unchecked to reset state
    await test_page_checkbox.check() // Now check the checkbox to open the pane
  } else if (options.toggle_selector) { // If toggle_selector is provided, use button-based opening
    const toggle_button = container.locator(options.toggle_selector)
    await toggle_button.click()
  }

  // Wait for the pane to be visible
  await expect(pane_div).toBeVisible({ timeout })

  // Wait for pane to be properly positioned and rendered
  await page.waitForFunction(
    (selector) => {
      const pane = document.querySelector(selector)
      if (!pane) return false
      const rect = pane.getBoundingClientRect()
      const style = globalThis.getComputedStyle(pane)
      return rect.width > 0 && rect.height > 0 && style.display !== `none`
    },
    pane_selector,
    { timeout },
  )

  return { container, pane_div }
}

// Wait for a 3D canvas (WebGL) to be ready
// Useful for Structure, BrillouinZone, FermiSurface components
export async function wait_for_3d_canvas(
  page: Page,
  container_selector: string,
  timeout = 10000,
): Promise<Locator> {
  const container = page.locator(container_selector)
  const canvas = container.locator(`canvas`)

  // Wait for canvas to be visible
  await expect(canvas).toBeVisible({ timeout })

  // Wait for WebGL context to be ready (canvas has non-zero dimensions)
  await page.waitForFunction(
    (selector) => {
      const canvas_el = document.querySelector(`${selector} canvas`) as
        | HTMLCanvasElement
        | null
      if (!canvas_el) return false
      const rect = canvas_el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    },
    container_selector,
    { timeout },
  )

  return canvas
}

// Open scatter plot controls pane via the toggle button
export async function open_scatter_controls_pane(
  plot: Locator,
  timeout = 5000,
): Promise<Locator> {
  const toggle = plot.locator(`.scatter-controls-toggle`)

  // Toggle may only appear on hover
  await plot.hover()
  await expect(toggle).toBeVisible({ timeout })
  await toggle.click()

  const pane = plot.locator(`.scatter-controls-pane`)
  await expect(pane).toBeVisible({ timeout })

  return pane
}

// Open histogram controls pane via the toggle button
export async function open_histogram_controls_pane(
  plot: Locator,
  timeout = 5000,
): Promise<Locator> {
  const toggle = plot.locator(`.histogram-controls-toggle`)

  // Toggle may only appear on hover
  await plot.hover()
  await expect(toggle).toBeVisible({ timeout })
  await toggle.click()

  const pane = plot.locator(`.histogram-controls-pane`)
  await expect(pane).toBeVisible({ timeout })

  return pane
}

// Wait for page and optional selector to be ready
export async function goto_and_wait(
  page: Page,
  url: string,
  selector?: string,
  timeout = 10000,
): Promise<void> {
  await page.goto(url, { waitUntil: `networkidle` })

  if (selector) {
    await page.waitForSelector(selector, { timeout })
  }
}

// Hover over a point in a plot and wait for tooltip
export async function hover_for_tooltip(
  plot: Locator,
  point_selector: string,
  tooltip_selector = `.tooltip`,
  timeout = 5000,
): Promise<Locator> {
  const point = plot.locator(point_selector).first()
  await point.hover()

  const tooltip = plot.locator(tooltip_selector)
  await expect(tooltip).toBeVisible({ timeout })

  return tooltip
}

export const open_structure_control_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.controls-pane`,
    parent_selector: `#test-structure`,
    checkbox_text: `Controls Open`,
  })

export const open_structure_export_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.draggable-pane.export-pane`,
    parent_selector: `#test-structure`,
    toggle_selector: `.structure-export-toggle`,
  })

export const open_trajectory_info_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.trajectory-info-pane`,
    // Open via the info toggle button
    toggle_selector: `.trajectory-info-toggle`,
  })

// Get the chart SVG locator from a plot container.
// The `.scatter` class contains control-button SVG icons, so we target only the direct child chart SVG.
export const get_chart_svg = (plot: Locator): Locator =>
  plot.locator(`:scope > svg[role="img"]`)

export const random_sample = <T>(input_list: T[], n_samples: number): T[] => {
  // If the subset size is greater than the list size, return the original list
  if (n_samples >= input_list.length) return input_list

  // Generate a random subset
  const rand_sample: T[] = []
  const used_indices = new Set<number>()

  while (rand_sample.length < n_samples) {
    const rand_idx = Math.floor(Math.random() * input_list.length)
    if (!used_indices.has(rand_idx)) {
      rand_sample.push(input_list[rand_idx])
      used_indices.add(rand_idx)
    }
  }

  return rand_sample
}
