import { expect, type Locator, test } from '@playwright/test'
import {
  expect_canvas_changed,
  goto_structure_test,
  open_structure_control_pane,
  set_lattice_props,
  set_scene_props,
} from '../helpers'

// opacity inputs sit in the label following the matching color label
const opacity_input = (pane: Locator, color_label: string, type: `range` | `number`) =>
  pane.locator(`label:has-text("${color_label}") + label input[type="${type}"]`)

test.describe(`Lattice Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
  })

  test(`lattice vectors checkbox toggles visibility`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)
    const canvas = page.locator(`#test-structure canvas`)
    const checkbox = pane_div.locator(
      `label:has-text("lattice vectors") input[type="checkbox"]`,
    )

    // leave only the lattice vectors drawn so toggling them is the sole pixel change
    const initial = await canvas.screenshot()
    await set_scene_props(page, {
      gizmo: false,
      show_atoms: false,
      show_bonds: `never`,
      show_site_indices: false,
      show_site_labels: false,
    })
    await set_lattice_props(page, {
      cell_edge_opacity: 0,
      cell_surface_opacity: 0,
      show_cell_vectors: true,
    })
    await expect_canvas_changed(canvas, initial)
    const visible = await canvas.screenshot()

    await expect(checkbox).toBeChecked()
    await checkbox.uncheck()
    await expect_canvas_changed(canvas, visible)
    const hidden = await canvas.screenshot()

    await checkbox.check()
    await expect_canvas_changed(canvas, hidden)
  })

  test(`edge color and edge/surface opacity controls repaint the cell`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)
    const canvas = page.locator(`#test-structure canvas`)
    const edge_color = pane_div.locator(`label:has-text("Edge color") input[type="color"]`)
    const edge_opacity = opacity_input(pane_div, `Edge color`, `range`)
    const surface_opacity = opacity_input(pane_div, `Surface color`, `range`)

    const before_opacity = await canvas.screenshot()
    await edge_opacity.fill(`1`)
    await surface_opacity.fill(`0.8`)
    await expect_canvas_changed(canvas, before_opacity)
    // number and range inputs stay in sync
    await expect(opacity_input(pane_div, `Edge color`, `number`)).toHaveValue(`1`)
    await expect(opacity_input(pane_div, `Surface color`, `number`)).toHaveValue(`0.8`)

    const before_color = await canvas.screenshot()
    await edge_color.fill(`#ff0000`)
    await expect_canvas_changed(canvas, before_color)
  })
})
