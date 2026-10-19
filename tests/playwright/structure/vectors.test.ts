import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  goto_structure_test,
  open_structure_control_pane,
  set_structure,
  structure_canvas,
  expect_canvas_changed_by,
  webgl_on_ci_for_tagged,
} from '../helpers'

webgl_on_ci_for_tagged()

const SITE_PROPS = {
  multi: [
    {
      force_DFT: [0.1, -0.2, 0.15],
      force_MLFF: [0.12, -0.18, 0.14],
      magmom: [0, 0, 2.5],
    },
    {
      force_DFT: [0.2, -0.4, 0.3],
      force_MLFF: [0.24, -0.36, 0.28],
      magmom: [0, 0, -2.5],
    },
  ],
  single: [{ force: [0.3, -0.1, 0.2] }, { force: [0.6, -0.2, 0.4] }],
} as const

// Inject a test structure with vector site properties; the component auto-populates one
// vector layer per key (union over all sites) and surfaces them in its pane
const inject_vectors = (page: Page, mode: `multi` | `single`) =>
  set_structure(page, {
    charge: 0,
    lattice: {
      matrix: [
        [3.128, 0, 0],
        [0, 3.128, 0],
        [0, 0, 3.128],
      ],
      pbc: [true, true, true],
      a: 3.128,
      b: 3.128,
      c: 3.128,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 30.62,
    },
    sites: SITE_PROPS[mode].map((props, idx) => ({
      species: [{ element: `Cs`, occu: 1 }],
      abc: [idx * 0.5, idx * 0.5, idx * 0.5],
      xyz: [idx * 1.564, idx * 1.564, idx * 1.564],
      label: `Cs`,
      properties: props,
    })),
  })

const labels_with = (pane: Locator, text: string) =>
  pane.locator(`label`).filter({ hasText: text })

test.describe(`Site Vectors`, { tag: `@webgl` }, () => {
  test(`single- and multi-vector structures get matching layer controls`, async ({ page }) => {
    await goto_structure_test(page)
    const canvas = structure_canvas(page)

    await test.step(`single vector key: arrows, no origin gap or per-key scale`, async () => {
      await expect_canvas_changed_by(canvas, () => inject_vectors(page, `single`))

      const { pane_div } = await open_structure_control_pane(page)
      await expect(pane_div.getByRole(`region`, { name: /site vectors/i })).toBeVisible()
      await expect(pane_div.locator(`[data-key="vector_config:force"]`)).toBeVisible()
      await expect(pane_div.locator(`[data-key="vector_origin_gap"]`)).toHaveCount(0)
      await expect(labels_with(pane_div, `force scale`)).toHaveCount(0)
    })

    await test.step(`multi vector keys: per-key layer toggles and scale sliders`, async () => {
      // the pane derives its vector rows from the structure, so the single-key rows go away
      await inject_vectors(page, `multi`)
      const { pane_div } = await open_structure_control_pane(page)
      const section = pane_div.getByRole(`region`, { name: `Site Vectors`, exact: true })
      await expect(labels_with(pane_div, `Global Scale`)).toBeVisible()
      await expect(labels_with(pane_div, `Origin Gap`)).toBeVisible()
      // per-key rows replace the single-key Color picker
      await expect(section.locator(`label`).filter({ hasText: /^Color$/ })).toHaveCount(0)

      for (const key of [`force_DFT`, `force_MLFF`, `magmom`]) {
        const toggle = pane_div.locator(`[data-key="vector_config:${key}"]`)
        await expect(toggle.locator(`input[type="checkbox"]`)).toBeVisible()
        await expect(toggle.locator(`input[type="color"]`)).toBeVisible()
        await expect(labels_with(pane_div, `${key} scale`)).toBeVisible()
      }

      // Recoloring and hiding a layer each repaint its arrows.
      const magmom_toggle = pane_div.locator(`[data-key="vector_config:magmom"]`)
      await expect_canvas_changed_by(canvas, () =>
        magmom_toggle.locator(`input[type="color"]`).fill(`#00ff00`),
      )
      await expect_canvas_changed_by(canvas, async () => {
        await magmom_toggle.locator(`input[type="checkbox"]`).click()
        await expect(labels_with(pane_div, `magmom scale`)).toBeHidden()
      })
    })
  })
})
