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

export const open_structure_control_pane = (page: Page) =>
  open_draggable_pane(page, {
    pane_selector: `.controls-pane`,
    parent_selector: `#test-structure`,
    checkbox_text: `Controls Open`,
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
