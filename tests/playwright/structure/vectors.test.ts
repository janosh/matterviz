import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed_by,
  goto_structure_test,
  IS_CI,
  open_structure_control_pane,
  set_structure,
  structure_canvas,
} from '../helpers'

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
const VECTOR_KEYS = { multi: [`force_DFT`, `force_MLFF`, `magmom`], single: [`force`] }

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

test.describe(`Site Vectors`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `3D vector tests require WebGL, skip in CI`)
  })

  test(`multi-vector structure gets per-key layer toggles and scale sliders`, async ({
    page,
  }) => {
    await goto_structure_test(page)
    await inject_vectors(page, `multi`)
    const { pane_div } = await open_structure_control_pane(page)
    const section = pane_div.getByRole(`region`, { name: `Site Vectors`, exact: true })
    await expect(labels_with(pane_div, `Global Scale`)).toBeVisible()
    await expect(labels_with(pane_div, `Origin Gap`)).toBeVisible()
    // per-key rows replace the single-key Color picker
    await expect(section.locator(`label`).filter({ hasText: /^Color$/ })).toHaveCount(0)

    for (const key of VECTOR_KEYS.multi) {
      const toggle = labels_with(pane_div, key).first()
      await expect(toggle.locator(`input[type="checkbox"]`)).toBeVisible()
      await expect(toggle.locator(`input[type="color"]`)).toBeVisible()
      await expect(labels_with(pane_div, `${key} scale`)).toBeVisible()
    }

    // toggling a layer off hides its scale slider and changes the canvas
    const magmom_toggle = labels_with(pane_div, `magmom`).filter({
      has: page.locator(`input[type="color"]`),
    })
    await expect_canvas_changed_by(structure_canvas(page), async () => {
      await magmom_toggle.locator(`input[type="checkbox"]`).click()
      await expect(labels_with(pane_div, `magmom scale`)).toBeHidden()
    })
  })

  test(`single-vector structure draws arrows and has no origin gap or per-key scale`, async ({
    page,
  }) => {
    await goto_structure_test(page)
    await expect_canvas_changed_by(structure_canvas(page), () =>
      inject_vectors(page, `single`),
    )

    const { pane_div } = await open_structure_control_pane(page)
    await expect(pane_div.locator(`text=Site Vectors`)).toBeVisible()
    await expect(labels_with(pane_div, `force`).first()).toBeVisible()
    await expect(labels_with(pane_div, `Origin Gap`)).toHaveCount(0)
    await expect(labels_with(pane_div, `force scale`)).toHaveCount(0)
  })
})
