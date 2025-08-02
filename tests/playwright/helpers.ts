import { expect, type Page } from '@playwright/test'

interface OpenPanelOptions {
  panel_selector: string
  parent_selector?: string
  checkbox_text?: string
  timeout?: number
}

// Helper function to open draggable panels and wait for positioning
export async function open_draggable_panel(page: Page, options: OpenPanelOptions) {
  const { panel_selector, parent_selector, checkbox_text, timeout = 5000 } = options

  const container = parent_selector ? page.locator(parent_selector) : page

  const panel_div = container.locator(panel_selector)

  if (checkbox_text) { // If checkbox_text is provided, use checkbox-based opening
    const test_page_checkbox = page.locator(
      `label:has-text("${checkbox_text}") input[type="checkbox"]`,
    )

    await test_page_checkbox.uncheck() // First ensure the checkbox is unchecked to reset state
    await test_page_checkbox.check() // Now check the checkbox to open the panel
  }

  // Wait for the panel to be visible
  await expect(panel_div).toBeVisible({ timeout: 2000 })

  // Wait for panel to be properly positioned and rendered
  await page.waitForFunction(
    (selector) => {
      const panel = document.querySelector(selector)
      if (!panel) return false
      const rect = panel.getBoundingClientRect()
      const style = globalThis.getComputedStyle(panel)
      return rect.width > 0 && rect.height > 0 && style.display !== `none`
    },
    panel_selector,
    { timeout },
  )

  return { container, panel_div }
}

export const open_structure_controls_panel = (page: Page) =>
  open_draggable_panel(page, {
    panel_selector: `.controls-panel`,
    parent_selector: `#structure-wrapper .structure`,
    checkbox_text: `Controls Open`,
  })

export const open_trajectory_info_panel = (page: Page) =>
  open_draggable_panel(page, {
    panel_selector: `.trajectory-info-panel`,
    // No checkbox - trajectory panels are typically opened via toggle button
  })

export function random_sample<T>(input_list: T[], n_samples: number): T[] {
  // If the subset size is greater than the list size, return the original list
  if (n_samples >= input_list.length) return input_list

  // Generate a random subset
  const rand_sample = []
  const used_indices = new Set()

  while (rand_sample.length < n_samples) {
    const rand_idx = Math.floor(Math.random() * input_list.length)
    if (!used_indices.has(rand_idx)) {
      rand_sample.push(input_list[rand_idx])
      used_indices.add(rand_idx)
    }
  }

  return rand_sample
}
