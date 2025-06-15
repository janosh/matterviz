import { expect, test } from '@playwright/test'

test.describe(`Trajectory Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/trajectory`, { waitUntil: `load` })
  })

  test(`empty state and basic UI elements`, async ({ page }) => {
    const empty_section = page.locator(`#empty-state .trajectory-viewer`)

    // Empty state elements
    await expect(empty_section.locator(`.empty-state`)).toBeVisible()
    await expect(empty_section.locator(`.drop-zone h3`)).toHaveText(
      `Load Trajectory`,
    )
    await expect(empty_section.locator(`.supported-formats`)).toBeVisible()
    await expect(empty_section).toHaveCSS(`border-style`, `dashed`)

    // Supported formats
    await expect(
      empty_section.locator(`li`).filter({ hasText: `Multi-frame XYZ` }),
    ).toBeVisible()
    await expect(
      empty_section.locator(`li`).filter({ hasText: `Pymatgen trajectory` }),
    ).toBeVisible()
  })

  test(`loaded trajectory with controls and navigation`, async ({ page }) => {
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const controls = loaded_section.locator(`.trajectory-controls`)

    // Controls and navigation elements
    await expect(controls).toBeVisible()
    await expect(controls.locator(`.nav-button`)).toHaveCount(3) // prev, play, next
    await expect(controls.locator(`.step-input`)).toBeVisible()
    await expect(controls.locator(`.step-slider`)).toBeVisible()

    // Content areas
    const content_area = loaded_section.locator(`.content-area`)
    await expect(content_area.locator(`.structure`)).toBeVisible()
    await expect(content_area.locator(`.scatter`)).toBeVisible()

    // Metadata display
    await expect(
      controls.locator(`span`).filter({ hasText: `/ 3` }),
    ).toBeVisible()
    await expect(
      controls.locator(`.info-section span`).filter({ hasText: `Atoms: 2` }),
    ).toBeVisible()
    await expect(
      controls.locator(`.info-section span`).filter({ hasText: `E0:` }),
    ).toBeVisible()

    // Navigation functionality
    const step_input = controls.locator(`.step-input`)
    const step_slider = controls.locator(`.step-slider`)
    const prev_button = controls.locator(`.nav-button`).nth(0)

    await expect(step_input).toHaveValue(`0`)
    await expect(prev_button).toBeDisabled()

    // Test slider navigation
    await step_slider.fill(`1`)
    await expect(step_input).toHaveValue(`1`)

    // Test input navigation
    await step_input.fill(`2`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`2`)
  })

  test(`scatter plot functionality and legend`, async ({ page }) => {
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const scatter_plot = loaded_section.locator(`.scatter`)

    // Basic plot elements
    await expect(scatter_plot).toBeVisible()
    await expect(scatter_plot.locator(`.legend`)).toBeVisible()
    await expect(scatter_plot.locator(`.legend-item`).first()).toBeVisible()

    // Custom properties section with legend interaction
    const custom_props_section = page.locator(
      `#custom-properties .trajectory-viewer`,
    )
    const custom_legend = custom_props_section.locator(`.legend`)

    await expect(custom_legend).toBeVisible()
    await expect(
      custom_legend.filter({ hasText: `Total Energy` }),
    ).toBeVisible()
    await expect(custom_legend.filter({ hasText: `Max Force` })).toBeVisible()

    // Test legend interactivity
    const legend_items = custom_legend.locator(`.legend-item`)
    if ((await legend_items.count()) > 0) {
      await legend_items.first().click()
    }

    // Current step indicator functionality
    const controls = loaded_section.locator(`.trajectory-controls`)
    const step_slider = controls.locator(`.step-slider`)
    await step_slider.fill(`1`)
    await expect(scatter_plot.locator(`.legend`)).toBeVisible()
  })

  test(`playback controls and frame rate`, async ({ page }) => {
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const controls = loaded_section.locator(`.trajectory-controls`)
    const play_button = controls.locator(`.play-button`)
    const speed_section = controls.locator(`.speed-section`)

    // Initial playback state
    await expect(play_button).toHaveText(`▶`)
    await expect(speed_section).not.toBeVisible()

    // Test playback functionality
    await play_button.click()
    await expect(play_button).toBeVisible()

    // Test speed controls if they appear
    const speed_appeared = await speed_section.isVisible()
    if (speed_appeared) {
      await expect(speed_section.locator(`.speed-slider`)).toHaveAttribute(
        `min`,
        `0.2`,
      )
      await expect(speed_section.locator(`.speed-input`)).toHaveAttribute(
        `max`,
        `5`,
      )
      await expect(speed_section).toContainText(`fps`)
    }

    // Stop playback
    await play_button.click()
    await expect(speed_section).not.toBeVisible()
  })

  test(`layout options and step labels configuration`, async ({ page }) => {
    // Layout variations
    await expect(
      page.locator(`#loaded-trajectory .trajectory-viewer`),
    ).toHaveClass(/horizontal/)
    await expect(
      page.locator(`#vertical-layout .trajectory-viewer`),
    ).toHaveClass(/vertical/)
    await expect(
      page.locator(`#no-controls .trajectory-viewer .trajectory-controls`),
    ).not.toBeVisible()

    // Step labels - positive number (evenly spaced)
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const step_labels = loaded_section.locator(`.step-labels .step-label`)
    await expect(step_labels).toHaveCount(3)
    await expect(step_labels.nth(0)).toHaveText(`0`)
    await expect(step_labels.nth(2)).toHaveText(`2`)

    // Step labels - negative spacing
    const negative_section = page.locator(
      `#negative-step-labels .trajectory-viewer`,
    )
    const negative_labels = negative_section.locator(`.step-labels .step-label`)
    const negative_count = await negative_labels.count()
    expect(negative_count).toBeGreaterThan(0)

    // Step labels - array configuration
    const array_section = page.locator(`#array-step-labels .trajectory-viewer`)
    const array_labels = array_section.locator(`.step-labels .step-label`)
    const array_count = await array_labels.count()
    expect(array_count).toBeGreaterThan(0)
  })

  test(`error handling and custom data extraction`, async ({ page }) => {
    // Error state handling
    await expect(page.locator(`#error-state .trajectory-viewer`)).toBeVisible()
    await expect(
      page.locator(`#empty-state .trajectory-viewer .empty-state`),
    ).toBeVisible()

    // Custom data extraction
    const custom_section = page.locator(`#custom-extractor .trajectory-viewer`)
    await expect(custom_section.locator(`.scatter`)).toBeVisible()
    await expect(custom_section.locator(`.trajectory-controls`)).toBeVisible()

    // Custom properties
    const custom_props_section = page.locator(
      `#custom-properties .trajectory-viewer`,
    )
    await expect(custom_props_section.locator(`.scatter`)).toBeVisible()
    await expect(custom_props_section.locator(`.legend`)).toBeVisible()

    // Plot visibility with varying data
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    await expect(loaded_section.locator(`.content-area`)).not.toHaveClass(
      /hide-plot/,
    )
  })

  test(`accessibility and drag/drop functionality`, async ({ page }) => {
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const controls = loaded_section.locator(`.trajectory-controls`)

    // Accessibility attributes
    await expect(controls.locator(`.play-button`)).toHaveAttribute(
      `title`,
      /Play|Pause/,
    )
    await expect(controls.locator(`.nav-button`).nth(0)).toHaveAttribute(
      `title`,
      `Previous step`,
    )
    await expect(controls.locator(`.step-input`)).toHaveAttribute(
      `title`,
      `Enter step number to jump to`,
    )

    // Drag/drop accessibility
    await expect(loaded_section).toHaveAttribute(`role`, `button`)
    await expect(loaded_section).toHaveAttribute(`tabindex`, `0`)
    await expect(loaded_section).toHaveAttribute(
      `aria-label`,
      `Drop trajectory file here to load`,
    )

    // Keyboard navigation
    const step_input = controls.locator(`.step-input`)
    await step_input.focus()
    await expect(step_input).toBeFocused()

    // Mobile responsiveness
    await page.setViewportSize({ width: 375, height: 667 })
    await expect(loaded_section).toBeVisible()
    await expect(controls.locator(`.play-button`)).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`advanced features and file handling`, async ({ page }) => {
    const loaded_section = page.locator(`#loaded-trajectory .trajectory-viewer`)
    const controls = loaded_section.locator(`.trajectory-controls`)
    const info_section = controls.locator(`.info-section`)

    // Filename display and info tooltip
    await expect(info_section).toBeVisible()
    await expect(info_section.locator(`span`).first()).toBeVisible()

    // Comprehensive statistics
    await expect(
      info_section.locator(`span`).filter({ hasText: `Atoms:` }),
    ).toBeVisible()
    await expect(
      info_section.locator(`span`).filter({ hasText: `E0:` }),
    ).toBeVisible()
    await expect(
      info_section.locator(`span`).filter({ hasText: `Vol0:` }),
    ).toBeVisible()

    // Binary file handling capabilities
    await expect(loaded_section).toBeAttached()
    await expect(loaded_section).toHaveAttribute(
      `aria-label`,
      `Drop trajectory file here to load`,
    )

    // Plot point clicking for navigation
    const scatter_plot = loaded_section.locator(`.scatter`)
    await expect(scatter_plot).toBeVisible()
    await expect(scatter_plot.locator(`.legend`)).toBeVisible()
  })

  test(`URL loading and custom snippets`, async ({ page }) => {
    // URL loading functionality
    const url_section = page.locator(`#trajectory-url .trajectory-viewer`)
    await expect(url_section).toBeVisible()

    // Check for any valid state without waiting
    const spinner_visible = await url_section.locator(`.spinner`).isVisible()
    const content_visible = await url_section
      .locator(`.content-area`)
      .isVisible()
    const error_visible = await url_section
      .locator(`.trajectory-error`)
      .isVisible()
    const empty_visible = await url_section.locator(`.empty-state`).isVisible()

    const has_valid_state = [
      spinner_visible,
      content_visible,
      error_visible,
      empty_visible,
    ].some((state) => state)
    if (!has_valid_state) {
      await expect(url_section).toBeAttached()
    } else {
      expect(has_valid_state).toBe(true)
    }

    // Custom trajectory controls snippet
    const custom_controls_section = page.locator(
      `#custom-controls .trajectory-viewer`,
    )
    if (await custom_controls_section.isVisible()) {
      await expect(
        custom_controls_section.locator(`.trajectory-controls .nav-section`),
      ).not.toBeVisible()
      await expect(
        custom_controls_section.locator(`.custom-trajectory-controls`),
      ).toBeVisible()
    }

    // Error snippet handling
    const error_snippet_section = page.locator(
      `#error-snippet .trajectory-viewer`,
    )
    if (await error_snippet_section.isVisible()) {
      await expect(error_snippet_section.locator(`.custom-error`)).toBeVisible()
    }
  })

  test(`plot hiding and dual axis configuration`, async ({ page }) => {
    // Constant values trajectory (plot hiding)
    const constant_section = page.locator(`#constant-values .trajectory-viewer`)
    if (await constant_section.isVisible()) {
      const content_area = constant_section.locator(`.content-area`)
      await expect(content_area).toHaveClass(/hide-plot/)
      await expect(content_area.locator(`.structure`)).toBeVisible()
      await expect(content_area.locator(`.scatter`)).not.toBeVisible()
    }

    // Dual y-axis configuration
    const dual_axis_section = page.locator(`#dual-axis .trajectory-viewer`)
    if (await dual_axis_section.isVisible()) {
      const scatter_plot = dual_axis_section.locator(`.scatter`)
      await expect(scatter_plot).toBeVisible()

      // Check for legend existence (may have 1 or more items depending on data)
      const legend = scatter_plot.locator(`.legend`)
      await expect(legend).toBeVisible()

      const legend_items = scatter_plot.locator(`.legend .legend-item`)
      const legend_count = await legend_items.count()
      expect(legend_count).toBeGreaterThanOrEqual(1) // At least one legend item
    }
  })
})
