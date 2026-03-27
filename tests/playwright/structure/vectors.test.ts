import { expect, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed,
  get_canvas_timeout,
  IS_CI,
  open_structure_control_pane,
  wait_for_3d_canvas,
} from '../helpers'

const VECTOR_PREFIXES = [`force`, `forces`, `magmom`, `magmoms`, `spin`, `spins`]

function is_vector_key(key: string): boolean {
  return VECTOR_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}_`))
}

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

// Inject a test structure with vector site properties via custom event
async function inject_vectors(page: Page, mode: `multi` | `single`) {
  const props = mode === `multi` ? SITE_PROPS.multi : SITE_PROPS.single
  // Let the component auto-populate vector_configs from the structure's vector data
  // instead of bypassing auto-population with pre-computed configs
  await page.evaluate(
    (site_props) => {
      const structure = {
        '@module': `pymatgen.core.structure`,
        '@class': `Structure`,
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
        sites: site_props.map((props, idx) => ({
          species: [{ element: `Cs`, occu: 1 }],
          abc: [idx * 0.5, idx * 0.5, idx * 0.5],
          xyz: [idx * 1.564, idx * 1.564, idx * 1.564],
          label: `Cs`,
          properties: props,
        })),
      }
      globalThis.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    },
    [...props],
  )
  // Derive expected keys from ALL sites (union) to catch union-of-all-sites regressions
  const all_keys = new Set<string>()
  for (const site of props) {
    for (const key of Object.keys(site)) {
      if (is_vector_key(key)) all_keys.add(key)
    }
  }
  const expected_keys = [...all_keys]
  await page.waitForFunction(
    (keys) => {
      const el = document.querySelector(`[data-testid="vector-configs-status"]`)
      return keys.every((key) => el?.textContent?.includes(key))
    },
    expected_keys,
    { timeout: get_canvas_timeout() },
  )
}

async function goto_with_vectors(page: Page, mode: `multi` | `single`) {
  await page.goto(`/test/structure`, { waitUntil: `networkidle` })
  await wait_for_3d_canvas(page, `#test-structure`)
  await inject_vectors(page, mode)
}

async function goto_vectors_and_open_controls(page: Page, mode: `multi` | `single`) {
  await goto_with_vectors(page, mode)
  return open_structure_control_pane(page)
}

test.describe(`Multi-Vector Site Vectors`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `3D vector tests require WebGL, skip in CI`)
  })

  test(`vector layer toggles appear for multi-vector structure`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `multi`)

    for (const key of [`force_DFT`, `force_MLFF`, `magmom`]) {
      const labels = pane_div.locator(`label`).filter({ hasText: key })
      await expect(labels.first()).toBeVisible()
      await expect(labels.first().locator(`input[type="checkbox"]`)).toBeVisible()
      await expect(labels.first().locator(`input[type="color"]`)).toBeVisible()
    }
  })

  test(`vector_configs populated after injection`, async ({ page }) => {
    await goto_with_vectors(page, `multi`)

    const status = page.locator(`[data-testid="vector-configs-status"]`)
    await expect(status).toContainText(`force_DFT`, { timeout: get_canvas_timeout() })
    await expect(status).toContainText(`force_MLFF`)
    await expect(status).toContainText(`magmom`)
  })

  test(`toggling vector layer off changes canvas`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `multi`)
    const canvas = page.locator(`#test-structure canvas`)
    const initial = await canvas.screenshot()

    const force_dft_toggle = pane_div.locator(`label`).filter({ hasText: `force_DFT` }).first()
    await force_dft_toggle.locator(`input[type="checkbox"]`).click()

    await expect_canvas_changed(canvas, initial)
  })

  test(`Site Vectors section with scale and origin gap controls`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `multi`)

    await expect(pane_div.locator(`text=Site Vectors`)).toBeVisible()
    await expect(pane_div.locator(`label`).filter({ hasText: `Global Scale` })).toBeVisible()
    await expect(pane_div.locator(`label`).filter({ hasText: `Origin Gap` })).toBeVisible()

    for (const key of [`force_DFT`, `force_MLFF`, `magmom`]) {
      await expect(pane_div.locator(`label`).filter({ hasText: `${key} scale` })).toBeVisible()
    }
  })

  test(`per-key scale slider hidden when layer toggled off`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `multi`)

    const magmom_scale = pane_div.locator(`label`).filter({ hasText: `magmom scale` })
    await expect(magmom_scale).toBeVisible()

    // The magmom toggle label in Visibility has a color picker; the scale label doesn't
    const magmom_toggle = pane_div
      .locator(`label`)
      .filter({ hasText: `magmom` })
      .filter({ has: page.locator(`input[type="color"]`) })
    await magmom_toggle.locator(`input[type="checkbox"]`).click()

    await expect(magmom_scale).toBeHidden()
  })

  test(`origin gap via set-scene-props event`, async ({ page }) => {
    await goto_with_vectors(page, `multi`)
    await page.evaluate(() => {
      globalThis.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: { vector_origin_gap: 0.3 },
        }),
      )
    })
    const status = page.locator(`[data-testid="vector-origin-gap-status"]`)
    await expect(status).toContainText(`0.3`)
  })

  test(`per-key color persists in vector_configs after update`, async ({ page }) => {
    await goto_with_vectors(page, `multi`)

    await page.evaluate(() => {
      globalThis.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            vector_configs: {
              force_DFT: { visible: true, color: `#00ff00`, scale: null },
              force_MLFF: { visible: true, color: null, scale: null },
              magmom: { visible: true, color: null, scale: null },
            },
          },
        }),
      )
    })

    const status = page.locator(`[data-testid="vector-configs-status"]`)
    await expect(status).toContainText(`#00ff00`)
    const configs = JSON.parse((await status.getAttribute(`data-configs`)) ?? `{}`)
    expect(configs.force_DFT.color).toBe(`#00ff00`)
    expect(configs.force_MLFF.color).toBeNull()
    expect(configs.magmom.color).toBeNull()
  })

  test(`no single-key Color picker for multi-vector`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `multi`)

    const site_vectors_heading = pane_div.locator(`h4:has-text("Site Vectors")`)
    await expect(site_vectors_heading).toBeVisible()

    // Multi-vector should show per-key scale sliders but NOT a standalone "Color" label
    // in the Site Vectors section (single-key Color only appears for 1-key structures).
    // The global scale and origin gap should be present, but no "Color" label.
    await expect(pane_div.locator(`label`).filter({ hasText: `Global Scale` })).toBeVisible()
    await expect(pane_div.locator(`label`).filter({ hasText: `Origin Gap` })).toBeVisible()
    // No standalone "Color" label in multi-vector mode
    const site_vectors_section = site_vectors_heading.locator(`xpath=following-sibling::*[1]`)
    await expect(
      site_vectors_section.locator(`label`).filter({ hasText: /^Color$/ }),
    ).toHaveCount(0)
  })
})

test.describe(`Single-Vector Site Vectors`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `3D vector tests require WebGL, skip in CI`)
  })

  test(`single vector key populated`, async ({ page }) => {
    await goto_with_vectors(page, `single`)

    const status = page.locator(`[data-testid="vector-configs-status"]`)
    await expect(status).toContainText(`force`, { timeout: get_canvas_timeout() })
    const text = await status.textContent()
    expect(text).not.toContain(`force_DFT`)
  })

  test(`single-key has no Origin Gap or per-key scale`, async ({ page }) => {
    const { pane_div } = await goto_vectors_and_open_controls(page, `single`)

    await expect(pane_div.locator(`text=Site Vectors`)).toBeVisible()

    // No Origin Gap for single vector
    await expect(pane_div.locator(`label`).filter({ hasText: `Origin Gap` })).toHaveCount(0)

    // No per-key scale sliders
    await expect(pane_div.locator(`label`).filter({ hasText: `force scale` })).toHaveCount(0)
  })

  test(`canvas renders with single-vector arrows`, async ({ page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, `#test-structure`)
    const canvas = page.locator(`#test-structure canvas`)
    const before = await canvas.screenshot()
    await inject_vectors(page, `single`)
    await expect_canvas_changed(canvas, before)
  })

  test(`per-key color override persists in vector_configs for single-vector`, async ({
    page,
  }) => {
    await goto_with_vectors(page, `single`)

    await page.evaluate(() => {
      globalThis.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            vector_configs: { force: { visible: true, color: `#ff00ff`, scale: null } },
          },
        }),
      )
    })

    const status = page.locator(`[data-testid="vector-configs-status"]`)
    await expect(status).toContainText(`#ff00ff`)
    const configs = JSON.parse((await status.getAttribute(`data-configs`)) ?? `{}`)
    expect(configs.force.color).toBe(`#ff00ff`)
    expect(configs.force.visible).toBe(true)
  })
})
