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

  const parent_component = parent_selector ? page.locator(parent_selector) : page

  const panel_dialog = parent_component.locator(panel_selector)

  // If checkbox_text is provided, use checkbox-based opening
  if (checkbox_text) {
    const test_page_checkbox = page.locator(
      `label:has-text("${checkbox_text}") input[type="checkbox"]`,
    )

    // First ensure the checkbox is unchecked to reset state
    await test_page_checkbox.uncheck()

    // Now check the checkbox to open the panel
    await test_page_checkbox.check()
  }

  // Wait for the panel to be visible
  await expect(panel_dialog).toBeVisible({ timeout: 2000 })

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

  return { parent_component, panel_dialog }
}

export function open_structure_controls_panel(page: Page) {
  return open_draggable_panel(page, {
    panel_selector: `.controls-panel`,
    parent_selector: `#structure-wrapper .structure`,
    checkbox_text: `Controls Open`,
  })
}

export function open_trajectory_info_panel(page: Page) {
  return open_draggable_panel(page, {
    panel_selector: `.trajectory-info-panel`,
    // No checkbox - trajectory panels are typically opened via toggle button
  })
}

export function random_sample<T>(input_list: T[], n_samples: number): T[] {
  // If the subset size is greater than the list size, return the original list
  if (n_samples >= input_list.length) {
    return input_list
  }

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
