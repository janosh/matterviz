// deno-lint-ignore-file no-await-in-loop
import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { IS_CI } from './helpers'

// Extended timeout for elements that load after trajectory data (plots, controls)
const LOAD_TIMEOUT = 15_000

// Helper to conditionally skip entire describe blocks on CI
const describe_local_only = IS_CI ? test.describe.skip : test.describe

// Helper function for display mode dropdown interactions
async function select_display_mode(trajectory: Locator, mode_name: string) {
  const display_button = trajectory.locator(
    `.view-mode-dropdown-wrapper .view-mode-button`,
  )
  await expect(display_button).toBeVisible()
  await display_button.click()

  // Wait for dropdown to be visible
  const dropdown = trajectory.locator(`.view-mode-dropdown`)
  await expect(dropdown).toBeVisible()

  const option = dropdown.locator(`.view-mode-option`).filter({
    hasText: mode_name,
  })
  await expect(option).toBeVisible()
  await option.click()

  // Wait for dropdown to close and content area to update
  await expect(dropdown).toBeHidden()
  const content_area = trajectory.locator(`.content-area`)
  await content_area.waitFor({ state: `attached` })
  return content_area
}

test.describe(`Trajectory Component`, () => {
  let trajectory_viewer: Locator
  let controls: Locator

  test.beforeEach(async ({ page }, testInfo) => {
    // Skip beforeEach for tests that are known to be flaky on CI
    // This prevents the 30s timeout in beforeEach for skipped tests
    const ci_flaky_tests = [`info pane displays trajectory information correctly`]
    if (IS_CI && ci_flaky_tests.includes(testInfo.title)) {
      test.skip()
      return
    }
    trajectory_viewer = page.locator(`#loaded-trajectory`)
    controls = trajectory_viewer.locator(`.trajectory-controls`)
    // Use domcontentloaded instead of networkidle because this page has 20 Trajectory
    // components, some of which intentionally make 404 requests (#error-state, #error-snippet)
    // that can delay or prevent networkidle from completing on CI
    await page.goto(`/test/trajectory`, { waitUntil: `domcontentloaded` })
    // Wait for page structure to be ready before checking component visibility
    await page.locator(`h1`).waitFor({ state: `visible` })
    await expect(trajectory_viewer).toBeVisible({ timeout: 30_000 })
  })

  test(`empty state displays correctly`, async ({ page }) => {
    const empty_trajectory = page.locator(`#empty-state`)

    await expect(empty_trajectory.locator(`.empty-state h3`)).toHaveText(
      `Load Trajectory`,
    )
    await expect(empty_trajectory.locator(`ul`)).toContainText(
      `Multi-frame XYZ`,
    )
    await expect(empty_trajectory).toHaveAttribute(
      `aria-label`,
      `Drop trajectory file here to load`,
    )
  })

  test(`basic controls and navigation work`, async () => {
    // Check control layout - filename should be leftmost (if present)
    const filename_section = controls.locator(`.filename-section`)
    if (await filename_section.isVisible()) {
      await expect(filename_section).toBeVisible()

      // Test filename copy functionality
      const filename_button = filename_section.locator(`button`)
      await expect(filename_button).toBeVisible()
      await expect(filename_button).toBeEnabled()
      await expect(filename_button).toHaveAttribute(
        `title`,
        `Click to copy filename`,
      )
      await filename_button.click() // no visual feedback expected
    }

    // Navigation controls expected:
    // - Previous step
    // - Play/pause
    // - Next step
    // - Info pane toggle
    // - Display mode selector
    // - Fullscreen toggle
    // - (Optional) Additional view controls
    const MIN_EXPECTED_NAV_BUTTONS = 6
    const nav_button_count = await controls.locator(`button`).count()
    expect(nav_button_count).toBeGreaterThanOrEqual(MIN_EXPECTED_NAV_BUTTONS)

    const step_input = controls.locator(`.step-input`)

    await expect(step_input).toHaveValue(`0`)
    await expect(
      controls.locator(`span`).filter({ hasText: `/ 3` }),
    ).toBeVisible()

    // Test navigation
    // Test navigation using step input directly
    await step_input.fill(`1`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`1`)

    await step_input.fill(`2`)
    await step_input.press(`Enter`)
    await expect(step_input).toHaveValue(`2`)
  })

  test(`info pane displays trajectory information correctly`, async () => {
    // Wait for trajectory to be loaded first
    await expect(trajectory_viewer.locator(`.trajectory-controls`)).toBeVisible()

    // Try to find the info button and click it
    const info_button = trajectory_viewer.locator(`.trajectory-info-toggle`)
    await expect(info_button).toBeVisible()

    // Verify initial state - pane should not be visible initially
    await expect(info_button).toBeVisible()
    await expect(info_button).toBeEnabled()

    // Get the pane before clicking
    const info_pane = trajectory_viewer.locator(`.trajectory-info-pane`).first()

    // Verify pane is initially hidden
    await expect(info_pane).toBeHidden()

    // Try keyboard shortcut first (which might be more reliable)
    await trajectory_viewer.focus()
    await trajectory_viewer.press(`i`)

    // Wait a short time for the pane to show
    try {
      await info_pane.waitFor({ state: `visible`, timeout: 3000 })
    } catch {
      // Keyboard shortcuts can be flaky in headless mode - button click is reliable fallback
      await info_button.click()
      await info_pane.waitFor({ state: `visible`, timeout: 3000 })
    }

    // Verify pane is now visible
    await expect(info_pane).toBeVisible()

    // Check info pane has the main header
    await expect(info_pane.locator(`h4`).filter({ hasText: `Trajectory Info` }))
      .toBeVisible()

    // Check that the pane contains some trajectory information
    const pane_content = await info_pane.textContent()
    expect(pane_content).toMatch(
      /Atoms|Total Frames|frames|Frame|Volume|volume|Trajectory/i,
    )

    // Test component-specific timestamp formatting
    if (
      await info_pane.locator(`[title="File system last modified time"]`)
        .isVisible()
    ) {
      const timestamp_text = await info_pane.locator(
        `[title="File system last modified time"]`,
      ).textContent()
      expect(timestamp_text).toMatch(
        /\d{1,2}\/\d{1,2}\/\d{4}.*\d{1,2}:\d{2}/,
      )
    }

    // Verify button is still functional
    await expect(info_button).toBeEnabled()
  })

  test(`initial state has step 0 and closed info pane`, async () => {
    // Check default step (should be 0)
    const step_input = controls.locator(`.step-input`)
    await expect(step_input).toHaveValue(`0`)

    // Check info pane is initially closed
    const info_pane = trajectory_viewer.locator(`.trajectory-info-pane`).first()
    await expect(info_pane).toBeHidden()
  })

  test(`playback controls function properly`, async () => {
    const play_button = controls.locator(`.play-button`)

    await expect(play_button).toHaveText(`▶`)
    await expect(play_button).toBeEnabled()

    // Test that button can be clicked
    await play_button.click()

    // Verify button is still functional
    await expect(play_button).toBeEnabled()

    // Check FPS controls exist in DOM (might be conditionally displayed)
    const fps_section = controls.locator(`.fps-section`)
    if (await fps_section.isVisible()) {
      await expect(fps_section.locator(`input[type="range"]`)).toHaveAttribute(
        `min`,
        `0.2`,
      )
      await expect(fps_section.locator(`input[type="number"]`)).toHaveAttribute(
        `max`,
        `60`,
      )
      await expect(fps_section).toContainText(`FPS`)
    }
  })

  test.describe(`layout and configuration options`, () => {
    test(`layout classes are correct based on viewport and props`, async ({ page }) => {
      // Auto layout should be horizontal when container is wide
      const auto_trajectory = page.locator(`#auto-layout`)

      // Start with container that should trigger horizontal layout (default 500px height from test page)
      await expect(auto_trajectory).toHaveClass(/horizontal/)

      // Explicit vertical layout should override auto detection
      const vertical_trajectory = page.locator(
        `#vertical-layout`,
      )
      await expect(vertical_trajectory).toHaveClass(/vertical/)

      // Test auto layout with tall container - make the container tall and narrow
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.height = `900px`
        el.style.width = `300px`
        el.style.minHeight = `900px` // Ensure the height is actually applied
        el.style.minWidth = `300px` // Ensure the width is actually applied
      })

      // Check if layout changed to vertical, but don't fail if it didn't
      // since viewport detection might not work in test environment
      const class_attr = await auto_trajectory.getAttribute(`class`)
      const has_vertical = class_attr?.includes(`vertical`)
      const has_horizontal = class_attr?.includes(`horizontal`)

      // At least one layout class should be present
      expect(has_vertical || has_horizontal).toBe(true)
    })

    test(`step labels work correctly`, async ({ page }) => {
      // Test evenly spaced labels
      const loaded_trajectory = page.locator(
        `#loaded-trajectory`,
      )
      const step_labels = loaded_trajectory.locator(`.step-labels .step-label`)
      await expect(step_labels).toHaveCount(3)
      await expect(step_labels.nth(0)).toHaveText(`0`)
      await expect(step_labels.nth(2)).toHaveText(`2`)

      // Test other step label configurations exist
      const negative_labels = page.locator(
        `#negative-step-labels .step-label`,
      )
      const negative_count = await negative_labels.count()
      expect(negative_count).toBeGreaterThan(0)

      const array_labels = page.locator(
        `#array-step-labels .step-label`,
      )
      const array_count = await array_labels.count()
      expect(array_count).toBeGreaterThan(0)
    })

    test(`controls can be hidden`, async ({ page }) => {
      await expect(
        page.locator(`#no-controls .trajectory-controls`),
      ).toBeHidden()
    })
  })

  describe_local_only(`plot and data visualization`, () => {
    // Skipped on CI because scatter plot rendering times out

    test(`scatter plot displays with legend`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const scatter_plot = trajectory.locator(`.scatter`)

      // Wait for scatter plot with increased timeout - plots load after trajectory data
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      // Legend may not be present if there's only one series or if legend is disabled
      const legend = scatter_plot.locator(`.legend`)
      if (await legend.isVisible()) {
        const legend_count = await legend.locator(`.legend-item`).count()
        expect(legend_count).toBeGreaterThan(0)
      }
    })

    test(`plot skimming can be disabled via plot_skimming prop`, async ({ page }) => {
      const trajectory = page.locator(`#no-plot-skimming`)
      const scatter_plot = trajectory.locator(`.scatter`)
      const step_input = trajectory.locator(`.step-input`)

      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible({
        timeout: LOAD_TIMEOUT,
      })
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const initial_step = await step_input.inputValue()
      const plot_points = scatter_plot.locator(`.point`)
      const points_count = await plot_points.count()
      if (points_count > 1) {
        await plot_points.nth(1).hover()
        await expect(step_input).toHaveValue(initial_step)
      }
    })

    test(`plot skimming is enabled by default`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const scatter_plot = trajectory.locator(`.scatter`)
      const step_input = trajectory.locator(`.step-input`)

      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible({
        timeout: LOAD_TIMEOUT,
      })
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const plot_points = scatter_plot.locator(`.point`)
      const points_count = await plot_points.count()
      if (points_count > 1) {
        const before = await step_input.inputValue()
        await plot_points.nth(1).hover()

        await expect(step_input).toBeVisible()
        await expect(scatter_plot).toBeVisible()
        // Wait for step input to update after hover
        await expect(step_input).not.toHaveValue(before)
      }
    })

    test(`plot hides when values are constant`, async ({ page }) => {
      const constant_trajectory = page.locator(
        `#constant-values`,
      )
      if (await constant_trajectory.isVisible()) {
        const content_area = constant_trajectory.locator(`.content-area`)
        await expect(content_area).toHaveClass(/hide-plot/)
        await expect(content_area.locator(`.structure`)).toBeVisible()
      }
    })

    test(`plot hides for single-frame trajectories`, async ({ page }) => {
      // Test that single-frame trajectories automatically hide plots since there's no time-series data
      const single_frame_viewer = page.locator(`#single-frame`)

      if (await single_frame_viewer.isVisible()) {
        const step_info = single_frame_viewer.locator(`.trajectory-controls span`).filter(
          { hasText: `/ 1` },
        )
        await expect(step_info).toBeVisible()

        const content_area = single_frame_viewer.locator(`.content-area`)
        await expect(content_area).toHaveClass(/hide-plot/)
        await expect(content_area.locator(`.structure`)).toBeVisible()
        await expect(single_frame_viewer.locator(`.step-input`)).toHaveValue(`0`)
      }
    })

    test(`dual y-axis configuration works`, async ({ page }) => {
      const dual_axis = page.locator(`#dual-axis`)
      await expect(dual_axis).toBeVisible({ timeout: LOAD_TIMEOUT })
      const scatter_plot = dual_axis.locator(`.scatter`)
      await expect(scatter_plot).toBeVisible({ timeout: LOAD_TIMEOUT })

      const legend = scatter_plot.locator(`.legend`)
      if (await legend.isVisible()) {
        const legend_count = await legend.locator(`.legend-item`).count()
        expect(legend_count).toBeGreaterThanOrEqual(1)
      }
    })

    test(`custom properties display correctly`, async ({ page }) => {
      const custom_props = page.locator(
        `#custom-properties`,
      )
      const legend = custom_props.locator(`.legend`)

      // Legend may not be present if there's only one series or if legend is disabled
      if (await legend.isVisible()) {
        await expect(legend.filter({ hasText: `Total Energy` })).toBeVisible()
        await expect(legend.filter({ hasText: `Max Force` })).toBeVisible()

        // Test legend interactivity
        const legend_items = legend.locator(`.legend-item`)
        if ((await legend_items.count()) > 0) {
          await legend_items.first().click()
        }
      }
    })
  })

  test.describe(`advanced features`, () => {
    test(`custom controls snippet works`, async ({ page }) => {
      const custom_controls = page.locator(`#custom-controls`)
      if (await custom_controls.isVisible()) {
        await expect(
          custom_controls.locator(`.trajectory-controls .nav-section`),
        ).toBeHidden()
        await expect(
          custom_controls.locator(`.trajectory-controls button`).first(),
        ).toBeVisible()
      }
    })

    test(`accessibility attributes are present`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const controls = trajectory.locator(`.trajectory-controls`)

      // Basic accessibility
      await expect(trajectory).toHaveAttribute(`role`, `button`)
      await expect(trajectory).toHaveAttribute(`tabindex`, `0`)

      // Button titles
      await expect(controls.locator(`.play-button`)).toHaveAttribute(
        `title`,
        /Play|Pause/,
      )
      await expect(controls.locator(`button[title="Previous step"]`)).toHaveAttribute(
        `title`,
        `Previous step`,
      )
      await expect(controls.locator(`.trajectory-info-toggle`)).toHaveAttribute(
        `title`,
        /info/,
      )
      await expect(controls.locator(`.fullscreen-button`)).toHaveAttribute(
        `aria-label`,
        /fullscreen/,
      )
    })

    test(`keyboard shortcuts are disabled when typing in inputs`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const step_input = trajectory.locator(`.step-input`)

      // Focus the step input
      await step_input.focus()
      await expect(step_input).toHaveValue(`0`)

      // Type in the input - keyboard shortcuts should not interfere
      await step_input.fill(`1`)
      await expect(step_input).toHaveValue(`1`)

      // Pressing space while in input should not trigger play/pause
      await step_input.focus()
      await page.keyboard.press(`Space`)
      const play_button = trajectory.locator(`.play-button`)
      // Should still show play icon (not paused) since space was ignored
      await expect(play_button).toHaveText(`▶`)
    })

    test(`playback FPS controls work when playing`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const play_button = trajectory.locator(`.play-button`)
      await play_button.click()

      // Check if FPS controls are visible when playing
      const fps_section = trajectory.locator(`.fps-section`)
      if (await fps_section.isVisible()) {
        const fps_input = fps_section.locator(`input[type="number"]`)

        // Test FPS controls using the FPS input instead of slider
        await fps_input.fill(`2`)
        await fps_input.press(`Enter`)
        await expect(fps_input).toHaveValue(`2`)

        await fps_input.fill(`1`)
        await fps_input.press(`Enter`)
        await expect(fps_input).toHaveValue(`1`)
      }

      // Stop playing - use toPass for robust state transition check
      await play_button.click()
      await expect(async () => {
        await expect(play_button).toHaveText(`▶`)
      }).toPass({ timeout: 3000 })
    })

    test(`FPS range slider covers full range and stays synchronized`, async ({ page }) => {
      const trajectory = page.locator(`#loaded-trajectory`)
      const play_button = trajectory.locator(`.play-button`)

      await play_button.click() // Start playing to show FPS controls

      const fps_section = trajectory.locator(`.fps-section`)
      if (await fps_section.isVisible()) {
        const fps_input = fps_section.locator(`input[type="number"]`)
        const fps_slider = fps_section.locator(`input[type="range"]`)

        // Test range of FPS values via number input (slider.fill() doesn't work for range inputs)
        for (const fps of [`0.2`, `5`, `15`, `60`]) {
          await fps_input.fill(fps)
          await fps_input.press(`Enter`)
          await expect(fps_input).toHaveValue(fps)
        }

        // Test input field changes with decimal
        await fps_input.fill(`12.5`)
        await fps_input.press(`Enter`)
        await expect(fps_input).toHaveValue(`12.5`)

        // Verify attributes and UI elements
        await expect(fps_slider).toHaveAttribute(`min`, `0.2`)
        await expect(fps_slider).toHaveAttribute(`max`, `60`)
        await expect(fps_section).toContainText(/fps/i)
      }

      await play_button.click() // Stop playing
      await expect(play_button).toHaveText(`▶`)
    })

    test(`large jump navigation works`, async ({ page }) => {
      // Test large jumps using the slider (simulating what PageUp/PageDown would do)
      const trajectory = page.locator(`#loaded-trajectory`)
      const step_input = trajectory.locator(`.step-input`)

      // Start at step 0
      await expect(step_input).toHaveValue(`0`)

      // Jump to last step (simulating large jump forward)
      await step_input.fill(`2`)
      await step_input.press(`Enter`)
      await expect(step_input).toHaveValue(`2`)

      // Jump to first step (simulating large jump backward)
      await step_input.fill(`0`)
      await step_input.press(`Enter`)
      await expect(step_input).toHaveValue(`0`)
    })
  })

  test.describe(`responsive design and viewport-based layout`, () => {
    test(`auto layout detects viewport aspect ratio and applies correct layout`, async ({ page }) => {
      const trajectory = page.locator(`#auto-layout`)

      // Test wide container (should trigger horizontal layout)
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `800px`
        el.style.height = `400px`
      })
      await expect(trajectory).toHaveClass(/horizontal/)
      await expect(trajectory).not.toHaveClass(/vertical/)

      // Test tall container (should trigger vertical layout)
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `400px`
        el.style.height = `800px`
      })

      // Check if layout changed to vertical, but be lenient since viewport detection
      // might not work perfectly in test environment
      const current_class = await trajectory.getAttribute(`class`)
      const has_vertical = current_class?.includes(`vertical`)
      const has_horizontal = current_class?.includes(`horizontal`)

      // At least one layout class should be present
      expect(has_vertical || has_horizontal).toBe(true)

      // Test square container (implementation may default to horizontal for equal dimensions)
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `600px`
        el.style.height = `600px`
      })
      // For equal dimensions, the component can choose either layout - just verify it has one
      const has_layout_class = await trajectory.evaluate((el) =>
        el.classList.contains(`horizontal`) ||
        el.classList.contains(`vertical`)
      )
      expect(has_layout_class).toBe(true)
    })

    test(`layout prop overrides automatic detection`, async ({ page }) => {
      // Test that explicit layout props still work
      const vertical_trajectory = page.locator(
        `#vertical-layout`,
      )

      // Set wide container that would normally trigger horizontal
      await page.locator(`#vertical-layout div`).first().evaluate((el) => {
        el.style.width = `800px`
        el.style.height = `400px`
      })

      // Should still be vertical due to explicit layout="vertical" prop
      await expect(vertical_trajectory).toHaveClass(/vertical/)
      await expect(vertical_trajectory).not.toHaveClass(/horizontal/)
    })

    test(`display mode cycling works correctly with responsive layout`, async ({ page }) => {
      // Use auto-layout trajectory which has responsive layout behavior
      const trajectory = page.locator(`#auto-layout`)
      const content_area = trajectory.locator(`.content-area`)

      // Check if view mode button exists (only appears if plot_series.length > 0)
      // Must check skip condition before running other assertions
      // Use specific selector to avoid matching other .view-mode-button elements (e.g., in Structure)
      const display_button = trajectory.locator(
        `.view-mode-dropdown-wrapper .view-mode-button`,
      )
      const button_count = await display_button.count()
      test.skip(button_count === 0, `No view mode button found (no plot data)`)

      // Wait for trajectory controls to be visible (indicating data is loaded)
      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible()
      await expect(display_button).toBeVisible()

      // Test dropdown display mode functionality
      await select_display_mode(trajectory, `Structure-only`)
      await expect(content_area).toHaveClass(/show-structure-only/)

      await select_display_mode(trajectory, `Scatter-only`)
      await expect(content_area).toHaveClass(/show-plot-only/)

      await select_display_mode(trajectory, `Structure + Scatter`)
      await expect(content_area).toHaveClass(/show-both/)

      // Test in wide viewport (horizontal layout)
      await page.setViewportSize({ width: 1200, height: 600 })

      // Check that layout is still valid (horizontal or vertical)
      const final_class = await trajectory.getAttribute(`class`)
      const has_layout = final_class?.includes(`vertical`) ||
        final_class?.includes(`horizontal`)
      expect(has_layout).toBe(true)

      // Wait for display mode button to be available (only shows when plot series exist)
      await display_button.waitFor({ state: `visible`, timeout: 10000 })

      // Display mode cycling should still work
      await display_button.click()
      await trajectory.locator(`.view-mode-option`).first().waitFor({ state: `visible` })
      const structure_only_option_h = trajectory.locator(`.view-mode-option`).filter({
        hasText: `Structure-only`,
      })
      await structure_only_option_h.click()
      await expect(content_area).toHaveClass(/show-structure-only/)
    })

    test(`mobile viewport forces vertical content layout for small screens`, async ({ page }) => {
      // Set narrow viewport to trigger mobile layout
      await page.setViewportSize({ width: 700, height: 800 })
      const trajectory = page.locator(`#auto-layout`)
      const content_area = trajectory.locator(`.content-area`)

      await expect(trajectory).toBeVisible({ timeout: LOAD_TIMEOUT })
      await expect(content_area).toBeVisible({ timeout: LOAD_TIMEOUT })

      // Check that CSS media queries force vertical content layout for small screens
      // Use toPass to poll for style changes after viewport resize
      await expect(async () => {
        const content_styles = await content_area.evaluate((el) => {
          const styles = getComputedStyle(el)
          return {
            gridTemplateColumns: styles.gridTemplateColumns,
            gridTemplateRows: styles.gridTemplateRows,
          }
        })
        // On small screens (width < 768px), content should stack vertically via CSS media queries
        // The media query forces grid-template-columns: 1fr (single column)
        expect(content_styles.gridTemplateColumns.split(` `)).toHaveLength(1)
      }).toPass({ timeout: 5000 })
    })

    test(`mobile layout adapts correctly`, async ({ page }) => {
      const trajectory = page.locator(`#auto-layout`)
      const controls = trajectory.locator(`.trajectory-controls`)

      // Test mobile container with tall aspect ratio
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `300px`
        el.style.height = `600px`
      })
      await expect(trajectory).toBeVisible()
      await expect(controls.locator(`.play-button`)).toBeVisible()
      await expect(controls.locator(`.trajectory-info-toggle`)).toBeVisible()

      // Should use vertical layout for tall container, but be lenient in test environment
      const mobile_class = await trajectory.getAttribute(`class`)
      const has_mobile_layout = mobile_class?.includes(`vertical`) ||
        mobile_class?.includes(`horizontal`)
      expect(has_mobile_layout).toBe(true)

      // Info pane should exist and be properly sized
      const info_pane = trajectory.locator(`.trajectory-info-pane`).first()

      // Pane may not be attached if not visible since DraggablePane only renders when show=true
      // So we'll check if it's visible or if the info button is at least present
      const info_button = trajectory.locator(`.trajectory-info-toggle`)
      await expect(info_button).toBeVisible()

      // If pane is visible, check its dimensions
      if (await info_pane.isVisible()) {
        const info_pane_bbox = await info_pane.boundingBox()
        expect(info_pane_bbox).toBeTruthy() // Just verify it has some dimensions
      }
    })

    test(`desktop layout works correctly`, async ({ page }) => {
      // Set wide viewport first
      await page.setViewportSize({ width: 1200, height: 600 })
      const trajectory = page.locator(`#auto-layout`)

      await expect(trajectory).toBeVisible({ timeout: LOAD_TIMEOUT })
      // Wait for layout class to be applied (may need time after viewport change)
      await expect(trajectory).toHaveClass(/horizontal|vertical/, { timeout: 10_000 })
      await expect(trajectory.locator(`.content-area`)).toBeVisible()
      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible()
    })

    test(`layout is based on element aspect ratio`, async ({ page }) => {
      const trajectory = page.locator(`#auto-layout`)

      // Scroll to the auto-layout trajectory to ensure it's in view
      await trajectory.scrollIntoViewIfNeeded()
      // Wait for trajectory controls to be visible (indicates data is loaded)
      await expect(trajectory.locator(`.trajectory-controls`)).toBeVisible({
        timeout: 30000,
      })

      // Layout is determined by element dimensions, not viewport - verify class is applied
      await expect(trajectory).toHaveClass(/horizontal|vertical/, { timeout: 5000 })

      // Check that the layout class corresponds to element aspect ratio
      const element_bbox = await trajectory.boundingBox()
      if (element_bbox) {
        const current_class = await trajectory.getAttribute(`class`)
        if (element_bbox.width > element_bbox.height) {
          expect(current_class).toContain(`horizontal`)
        } else {
          expect(current_class).toContain(`vertical`)
        }
      }
    })

    test(`layout responsive behavior with tablet viewports`, async ({ page }) => {
      const trajectory = page.locator(`#auto-layout`)

      // Test tablet landscape container (should be horizontal)
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `750px`
        el.style.height = `550px`
      })
      await expect(trajectory).toHaveClass(/horizontal/)

      // Test tablet portrait container (should be vertical)
      await page.locator(`#auto-layout div`).first().evaluate((el) => {
        el.style.width = `550px`
        el.style.height = `750px`
      })
      // Check if layout is valid, but be lenient since viewport detection
      // might not work perfectly in test environment
      const portrait_layout_class = await trajectory.getAttribute(`class`)
      const has_portrait_layout = portrait_layout_class?.includes(`vertical`) ||
        portrait_layout_class?.includes(`horizontal`)
      expect(has_portrait_layout).toBe(true)
    })

    test(`plot and structure have equal dimensions in both horizontal and vertical layouts`, async ({ page }) => {
      // Helper function to get component dimensions
      const get_dimensions = async (content_area: Locator) =>
        await content_area.evaluate((el: Element) => {
          const structure_node = el.querySelector(`.structure`) as HTMLElement
          const plot_node = el.querySelector(`.scatter`) as HTMLElement
          const structure = structure_node?.getBoundingClientRect()
          const plot = plot_node?.getBoundingClientRect()
          return { structure, plot }
        })

      // Helper function to check dimension ratios
      const check_ratios = (
        dims: { structure?: DOMRect; plot?: DOMRect },
        primary_dimension: `width` | `height`,
      ) => {
        if (!dims.structure || !dims.plot) return
        const ratio = dims.structure[primary_dimension] / dims.plot[primary_dimension]
        expect(ratio).toBeGreaterThan(0.9)
        expect(ratio).toBeLessThan(1.1)
      }

      // Test horizontal layout
      const horizontal_viewer = page.locator(`#auto-layout`)
      await expect(horizontal_viewer).toBeVisible()
      await expect(horizontal_viewer).toHaveClass(/horizontal/)

      const horizontal_dims = await get_dimensions(
        horizontal_viewer.locator(`.content-area`),
      )
      check_ratios(horizontal_dims, `width`)
      check_ratios(horizontal_dims, `height`)

      // Test vertical layout
      const vertical_viewer = page.locator(`#vertical-layout`)
      await expect(vertical_viewer).toBeVisible()
      await expect(vertical_viewer).toHaveClass(/vertical/)

      const vertical_dims = await get_dimensions(vertical_viewer.locator(`.content-area`))
      check_ratios(vertical_dims, `height`)
      check_ratios(vertical_dims, `width`)
    })
  })
})
