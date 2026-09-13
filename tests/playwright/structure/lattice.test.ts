import { expect, type Locator, test } from '@playwright/test'
import {
  expect_canvas_changed_by,
  goto_structure_test,
  open_structure_control_pane,
  set_scene_props,
  structure_canvas,
} from '../helpers'

const opacity_input = (pane: Locator, surface: `edge` | `surface`, type: `range` | `number`) =>
  pane.locator(`[data-key="cell_${surface}_opacity"] input[type="${type}"]`)

test.describe(`Lattice Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
  })

  test(`lattice vectors checkbox toggles visibility`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)
    const canvas = structure_canvas(page)
    const checkbox = pane_div.locator(
      `label:has-text("lattice vectors") input[type="checkbox"]`,
    )

    // leave only the lattice vectors drawn so toggling them is the sole pixel change
    await expect_canvas_changed_by(canvas, () =>
      set_scene_props(page, {
        gizmo: false,
        show_atoms: false,
        show_bonds: `never`,
        show_site_indices: false,
        show_site_labels: false,
        cell_edge_opacity: 0,
        cell_surface_opacity: 0,
        show_cell_vectors: true,
      }),
    )

    await expect(checkbox).toBeChecked()
    await expect_canvas_changed_by(canvas, () => checkbox.uncheck())
    await expect_canvas_changed_by(canvas, () => checkbox.check())
  })

  test(`edge color and edge/surface opacity controls repaint the cell`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)
    const canvas = structure_canvas(page)
    const edge_color = pane_div.getByRole(`textbox`, { name: `Edge color hex`, exact: true })

    await expect_canvas_changed_by(canvas, async () => {
      await opacity_input(pane_div, `edge`, `range`).fill(`1`)
      await opacity_input(pane_div, `surface`, `range`).fill(`0.8`)
    })
    // number and range inputs stay in sync
    await expect(opacity_input(pane_div, `edge`, `number`)).toHaveValue(`1`)
    await expect(opacity_input(pane_div, `surface`, `number`)).toHaveValue(`0.8`)

    await expect_canvas_changed_by(canvas, () => edge_color.fill(`#ff0000`))
  })
})
