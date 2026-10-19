import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  canvas_box,
  canvas_screenshot,
  collect_console_errors,
  drag_canvas,
  EXPECT_TIMEOUT,
  goto_structure_test,
  enter_edit_atoms_mode,
  rendered_instance_counts,
  primary_modifier_key,
  set_scene_props,
  set_structure,
  structure_canvas,
  expect_canvas_changed,
  expect_canvas_changed_by,
  webgl_on_ci_for_tagged,
} from '../helpers'

webgl_on_ci_for_tagged()

// Screenshot the canvas and assert it rendered non-trivial pixel data.
const expect_canvas_renders = async (canvas: Locator): Promise<Buffer> => {
  const screenshot = await canvas_screenshot(canvas)
  expect(screenshot.length).toBeGreaterThan(1000)
  return screenshot
}

const wait_frames = (page: Page, count: number) =>
  page.evaluate(async (frames) => {
    for (let frame_idx = 0; frame_idx < frames; frame_idx++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)

// Load a centered scene from species (element + occupancy) placed at one
// position. Multiple species at the same spot model a disordered site (stored as
// separate split sites). Optional rotation tips the wedge axis toward the camera.
async function load_centered_scene(
  page: Page,
  species: { element: string; occu: number }[],
  rotation?: [number, number, number],
): Promise<void> {
  await set_structure(
    page,
    {
      sites: species.map(({ element, occu }) => ({
        species: [{ element, occu, oxidation_state: 0 }],
        abc: [0.25, 0.25, 0.5],
        xyz: [0, 0, 0],
        label: element,
        properties: {},
      })),
      properties: {},
    },
    {
      atom_radius: 2.5,
      camera_position: [0, 0, 8],
      camera_target: [0, 0, 0],
      ...(rotation ? { rotation } : {}),
      show_bonds: `never`,
      show_site_indices: false,
      show_site_labels: false,
    },
  )
  await wait_frames(page, 5)
}

// Disordered tsumcorite M2 site: Zn+Fe+Pb at a single position.
const load_disordered_site_scene = (
  page: Page,
  rotation?: [number, number, number],
): Promise<void> =>
  load_centered_scene(
    page,
    [
      { element: `Zn`, occu: 0.645 },
      { element: `Fe`, occu: 0.345 },
      { element: `Pb`, occu: 0.01 },
    ],
    rotation,
  )

const hover_canvas_center = async (canvas: Locator): Promise<void> => {
  const box = await canvas_box(canvas)
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 }, force: true })
}
const hover_canvas_corner = (canvas: Locator) =>
  canvas.hover({ position: { x: 4, y: 4 }, force: true })

const site_tooltip = (page: Page) => page.locator(`[role="tooltip"]:has(.coordinates)`)

test(
  `large atom mesh keeps drawing across zoom detail transitions @source`,
  { tag: `@webgl` },
  async ({ page }) => {
    const console_errors = collect_console_errors(page)
    await goto_structure_test(page)
    await set_structure(
      page,
      {
        sites: Array.from({ length: 2197 }, (_unused, idx) => ({
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [(idx % 13) * 3, (Math.floor(idx / 13) % 13) * 3, Math.floor(idx / 169) * 3],
          abc: [0, 0, 0],
          properties: {},
        })),
      },
      { show_bonds: `never`, show_image_atoms: false, sphere_segments: 20, auto_rotate: 0 },
    )
    const canvas = structure_canvas(page)
    const vertex_counts = () =>
      canvas.evaluate(async (element) => {
        const module_path = `/src/lib/io/export.ts`
        const { scene_registry } = await import(/* @vite-ignore */ module_path)
        const scene = scene_registry.get(element)?.scene
        const levels: number[] = []
        scene?.traverse(
          (node: {
            count?: number
            geometry?: { getAttribute: (name: string) => { count: number } | undefined }
          }) => {
            const vertices = node.geometry?.getAttribute(`position`)?.count
            if (
              node.count === 2197 &&
              node.geometry?.getAttribute(`atomPositionRadius`) &&
              vertices
            )
              levels.push(vertices)
          },
        )
        return levels
      })
    await expect.poll(vertex_counts).toEqual([81]) // (8 + 1)^2 vertices per sphere
    await hover_canvas_center(canvas)
    await expect_canvas_changed_by(canvas, () => page.mouse.wheel(0, -2200))
    await expect
      .poll(async () => {
        const levels = await vertex_counts()
        return levels.length === 1 && levels[0] > 81
      })
      .toBe(true)
    // Camera changes after the first detail switch must still produce pixels. A live rAF
    // loop alone misses WebGPU refusing draws against a destroyed instance buffer. Tagged
    // @webgl, CI checks the pixels on WebGL2, so that WebGPU failure is caught by local runs.
    await expect_canvas_changed_by(canvas, () => page.mouse.wheel(0, -500))
    await expect_canvas_changed_by(canvas, () => page.mouse.wheel(0, 2700))
    await expect.poll(vertex_counts).toEqual([81])
    // Do not apply the general software-GPU noise filter to resource-lifetime errors.
    expect(console_errors).toEqual([])
  },
)

test.describe(`StructureScene Component Tests`, { tag: `@webgl` }, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
  })

  test(`supercell transition keeps atom spheres visible @source`, async ({ page }) => {
    const supercell_input = page.locator(`[data-testid="supercell-input"]`)
    const legend = page.locator(`#test-structure .atom-legend`)
    const atom_count = async () => (await rendered_instance_counts(page)).atoms
    const initial_atoms = await atom_count()
    expect(initial_atoms).toBeGreaterThan(0)

    await supercell_input.fill(`2x2x2`)
    await supercell_input.press(`Enter`)
    await expect(legend).toContainText(/Cs\s*16/)
    // the count also includes fixed-size instanced meshes (highlights etc.), so only the
    // direction is pinned, not the 8x factor
    await expect.poll(atom_count).toBeGreaterThan(initial_atoms)

    // Grow-only capacity: shrinking must lower mesh.count or extras stay drawn.
    await supercell_input.fill(`1x1x1`)
    await supercell_input.press(`Enter`)
    await expect(legend).toContainText(/Cs\s*2/)
    await expect.poll(atom_count).toBe(initial_atoms)
  })

  test(`atom tooltip shows species and coordinates and stays while hovered`, async ({
    page,
  }) => {
    await load_centered_scene(page, [{ element: `C`, occu: 1 }])
    const canvas = structure_canvas(page)
    await hover_canvas_center(canvas)
    const tooltip = site_tooltip(page)
    await expect(tooltip).toBeVisible()
    const elements = tooltip.locator(`.elements`)
    await expect(elements.locator(`strong`)).toHaveText(/^\s*C\s*$/)
    await expect(elements.locator(`.elem-name`)).toHaveText(`Carbon`)
    const coordinates = tooltip.locator(`.coordinates`)
    await expect(coordinates.filter({ hasText: `abc:` })).toHaveText(
      /abc:\s*\([\d.-]+,\s*[\d.-]+,\s*[\d.-]+\)/,
    )
    await expect(coordinates.filter({ hasText: `xyz:` })).toHaveText(
      /xyz:\s*\([\d.-]+,\s*[\d.-]+,\s*[\d.-]+\)\s*Å/,
    )
    // The hover highlight can become the raycast target after it mounts.
    // Check visibility immediately after each frame so a short disappearance fails.
    // 20 frames covers roughly 1/3 s at 60fps, enough to catch transient hover loss.
    for (let frame_idx = 0; frame_idx < 20; frame_idx++) {
      await wait_frames(page, 1)
      expect(await tooltip.isVisible()).toBe(true)
    }

    // The dense chip's typography stays compact when the viewer fills the screen.
    await expect(tooltip).toHaveCSS(`font-size`, `12px`)
    await page.setViewportSize({ width: 1920, height: 1080 })
    const viewer = page.locator(`#test-structure`)
    const fullscreen_button = viewer.locator(`> section.control-buttons > .fullscreen-btn`)
    await fullscreen_button.click()
    await expect(viewer).toHaveCSS(`height`, `1080px`)
    await hover_canvas_center(canvas)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveCSS(`font-size`, `12px`)
    // The public CSS override remains available for intentional custom sizing.
    await viewer.evaluate((element) =>
      element.style.setProperty(`--plot-tooltip-font-size`, `18px`),
    )
    await expect(tooltip).toHaveCSS(`font-size`, `18px`)
    await viewer.evaluate((element) =>
      element.style.removeProperty(`--plot-tooltip-font-size`),
    )
    await fullscreen_button.click()
    await hover_canvas_corner(canvas)
    await expect(tooltip).toBeHidden()

    // Topology changes invalidate the cached neighbor lookup used by subsequent tooltips.
    for (const symbols of [
      [`C`, `O`, `H`],
      [`C`, `O`],
    ]) {
      await set_structure(
        page,
        {
          sites: symbols.map((element, idx) => ({
            species: [{ element, occu: 1, oxidation_state: 0 }],
            xyz: [
              [0, 0, 0],
              [1.2, 0, 0],
              [-1, 0, 0],
            ][idx],
            abc: [0, 0, 0],
            label: element,
            properties: {},
          })),
        },
        { show_bonds: `always`, atom_radius: 0.4 },
      )
      await hover_canvas_corner(canvas)
      await hover_canvas_center(canvas)
      await expect(tooltip).toContainText(
        symbols.length === 3 ? `Bonds: 2 (H: 1, O: 1)` : `Bonds: 1 (O: 1)`,
      )
    }
  })

  // Disordered sites (e.g. tsumcorite M2: Zn+Fe+Pb) are stored as separate single-species
  // sites at the same position and render as wedge (lune) meshes, one per species
  test(`disordered sites: tooltip lists every species, whole ball hoverable, segments colored per element`, async ({
    page,
  }) => {
    test.slow() // three formerly separate tests on one page load
    const canvas = structure_canvas(page)
    const tooltip = site_tooltip(page)

    await test.step(`tooltip lists all elements on disordered split sites`, async () => {
      // The tooltip must show every element, not just the majority one (regression guard).
      await load_disordered_site_scene(page)
      await hover_canvas_center(canvas)
      const elements = tooltip.locator(`.elements`)
      await expect(elements).toBeVisible()
      for (const element of [`Zn`, `Fe`, `Pb`]) {
        await expect(elements.locator(`strong`).filter({ hasText: element })).toBeVisible()
      }
      // partial occupancies render next to each species
      await expect(elements.locator(`.occupancy`)).toHaveText([`0.645`, `0.345`, `0.01`])
      // tooltip must respect its max-width (wrap) rather than grow unbounded: a 10rem cap is
      // narrower than the three long species, which fit on one line under the default 16rem
      const { width, max_width, line_count } = await elements.evaluate((element) => {
        const tip = element.closest(`[role="tooltip"]`) as HTMLElement
        tip.style.setProperty(`--plot-tooltip-max-width`, `10rem`)
        const species = element.querySelector(`.species`) as HTMLElement
        return {
          width: tip.getBoundingClientRect().width,
          max_width: Number(getComputedStyle(tip).maxWidth.replace(`px`, ``)),
          // rows = total height / single species (one-line) height
          line_count: Math.round(element.clientHeight / species.clientHeight),
        }
      })
      expect(max_width).toBeGreaterThan(0)
      expect(width).toBeLessThanOrEqual(max_width + 1)
      // three long species exceed the cap, so the line wraps to >= 2 rows
      expect(line_count).toBeGreaterThanOrEqual(2)
    })

    await test.step(`disordered atom is hoverable across its whole area`, async () => {
      // Wedges converge to a point at the sphere poles. Viewed pole-on, the ball center had
      // a non-hoverable band. The invisible full-sphere hit target must make the whole ball
      // hoverable. Rotation tips the wedge (Y) axis toward the camera so the weak pole faces us.
      await load_disordered_site_scene(page, [-Math.PI / 2, 0, 0])
      const box = await canvas_box(canvas)
      // Points along the formerly-dead equatorial band through the ball center.
      for (const delta_x of [0, -24, 24, -12, 12]) {
        await hover_canvas_corner(canvas)
        await expect(tooltip).toBeHidden()
        await canvas.hover({
          position: { x: box.width / 2 + delta_x, y: box.height / 2 },
          force: true,
        })
        await expect(tooltip, `point (${delta_x}, 0) should be hoverable`).toBeVisible()
      }
      await hover_canvas_corner(canvas) // keep the tooltip off the pixel comparison below
    })

    // Regression guard for commit 16dbcf0b (disordered sites wrongly used only the first
    // species' color). Geometry is pinned identical via same_size_atoms + fixed occupancies,
    // so the only difference between the two renders is the second species' color.
    await test.step(`disordered sites color each species segment by its own element`, async () => {
      const console_errors = collect_console_errors(page)

      // Pole-on rotation shows all species wedges as pie slices. auto_rotate must be off
      // so the canvas can settle for the pixel comparison below.
      const dispatch_disordered_site = async (elements: [string, string]) => {
        await load_centered_scene(
          page,
          elements.map((element, species_idx) => ({
            element,
            occu: 0.49 + species_idx * 0.02,
          })),
          [-Math.PI / 2, 0, 0],
        )
        await set_scene_props(page, { same_size_atoms: true, auto_rotate: 0 })
      }

      // Screenshot once the canvas stops changing (framing/damping settled)
      const settled_screenshot = async (): Promise<Buffer> => {
        let prev = await canvas_screenshot(canvas)
        await expect(async () => {
          const next = await canvas_screenshot(canvas)
          const stable = next.equals(prev)
          prev = next
          expect(stable).toBe(true)
        }).toPass({ timeout: EXPECT_TIMEOUT })
        return prev
      }

      await dispatch_disordered_site([`Bi`, `Bi`])
      const uniform_color_render = await settled_screenshot()
      expect(uniform_color_render.length).toBeGreaterThan(1000)

      await dispatch_disordered_site([`Bi`, `Zr`])
      const two_color_render = await settled_screenshot()

      // If the Zr half wrongly reused the Bi color, both renders would be pixel-identical
      expect(two_color_render.equals(uniform_color_render)).toBe(false)
      expect(console_errors).toHaveLength(0)
    })
  })

  // orbit and wheel zoom are covered in structure.test.ts, including on CI
  test(`right-drag pans the view`, async ({ page }) => {
    const canvas = structure_canvas(page)
    await expect_canvas_changed_by(canvas, () =>
      drag_canvas(canvas, { dx: 50, dy: 30, button: `right` }),
    )
  })

  // Edge/surface opacities are independent, colors repaint the cell, and extreme widths /
  // out-of-range opacities clamp instead of crashing. same_size_atoms swaps per-element radii
  // for a uniform one, so the rendered atom sizes must visibly change.
  test(`cell edge/surface props and same_size_atoms render distinct visuals without errors`, async ({
    page,
  }) => {
    const console_errors = collect_console_errors(page)
    const canvas = structure_canvas(page)
    const white = { cell_edge_color: `#ffffff`, cell_surface_color: `#ffffff` }

    // same_size_atoms visibly changes atom scaling (first: the opaque white cell the clamping
    // checks below leave behind would hide the atoms)
    await set_scene_props(page, { same_size_atoms: false, atom_radius: 1, show_atoms: true })
    const per_element_radii = await expect_canvas_renders(canvas)
    await set_scene_props(page, { same_size_atoms: true })
    await expect_canvas_changed(canvas, per_element_radii)

    const opacity_cases = {
      edges_only: { cell_edge_opacity: 0.8, cell_surface_opacity: 0 },
      surfaces_only: { cell_edge_opacity: 0, cell_surface_opacity: 0.4 },
      both: { cell_edge_opacity: 0.6, cell_surface_opacity: 0.3 },
      neither: { cell_edge_opacity: 0, cell_surface_opacity: 0 },
    }
    // each step must repaint relative to the previous one, and every pair must differ
    const renders: Record<string, Buffer> = {}
    let previous = await expect_canvas_renders(canvas)
    for (const [name, opacities] of Object.entries(opacity_cases)) {
      await set_scene_props(page, { ...white, ...opacities })
      await expect_canvas_changed(canvas, previous)
      previous = await expect_canvas_renders(canvas)
      renders[name] = previous
    }
    const names = Object.keys(opacity_cases)
    for (const [idx, name] of names.entries()) {
      for (const other of names.slice(idx + 1)) {
        expect(renders[name].equals(renders[other]), `${name} vs ${other}`).toBe(false)
      }
    }

    // colors repaint the (visible) cell
    for (const color of [`#ff0000`, `#00ff00`, `#0000ff`]) {
      await set_scene_props(page, {
        ...opacity_cases.both,
        cell_edge_color: color,
        cell_surface_color: color,
        cell_edge_width: 2,
      })
      await expect_canvas_changed(canvas, previous)
      previous = await expect_canvas_renders(canvas)
    }

    // extreme line widths and out-of-range opacities are clamped, not fatal
    for (const cell_edge_width of [1, 5, 10]) {
      await set_scene_props(page, { ...white, cell_edge_opacity: 1, cell_edge_width })
      await expect_canvas_renders(canvas)
    }
    for (const opacity of [-0.5, 1.5]) {
      await set_scene_props(page, {
        ...white,
        cell_edge_opacity: opacity,
        cell_surface_opacity: opacity,
      })
      await expect_canvas_renders(canvas)
    }

    expect(console_errors).toHaveLength(0)
  })
})

// Outside the describe above: one URL-seeded load, then scene props switch label modes
test(
  `site labels and indices display correctly alone and combined`,
  { tag: `@webgl` },
  async ({ page }) => {
    const labels = page.locator(`.atom-label`)
    const label_texts = () => labels.allTextContents()

    await goto_structure_test(page, `/test/structure?show_site_labels=true`)
    await expect(labels.first()).toBeVisible()

    // indices are 1-based
    await set_scene_props(page, { show_site_labels: false, show_site_indices: true })
    await expect
      .poll(async () => (await label_texts()).some((text) => /^\s*1\s*$/.test(text)))
      .toBe(true)
    expect((await label_texts()).some((text) => /^\s*0\s*$/.test(text))).toBe(false)

    await set_scene_props(page, { show_site_labels: true, show_site_indices: true })
    await expect
      .poll(async () =>
        (await label_texts()).some((text) => /[A-Z][a-z]?\s*-\s*\d+/.test(text)),
      )
      .toBe(true)
  },
)

test.describe(`Edit Atoms Scene`, { tag: `@webgl` }, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
    await enter_edit_atoms_mode(page)
  })

  test(`click toggles selection, shift+click extends it, shortcuts don't error`, async ({
    page,
  }) => {
    const canvas = structure_canvas(page)
    const console_errors = collect_console_errors(page)
    // the two base atoms of the default structure sit at the canvas centre and just below it;
    // edit-atoms mode fades the image atoms around them, and clicks on those select nothing
    const { width, height } = await canvas_box(canvas)
    const first_atom = { x: width / 2, y: height / 2 }
    const second_atom = { x: width / 2 + 10, y: height / 2 + 48 }
    const click_atom = (position: { x: number; y: number }, modifiers?: `Shift`[]) =>
      expect_canvas_changed_by(canvas, () =>
        canvas.click({ position, modifiers, force: true }),
      )

    // Click selects, clicking again deselects
    await click_atom(first_atom)
    await click_atom(first_atom)

    // Plain click on another atom replaces the selection; shift+click adds to it
    await click_atom(first_atom)
    const replaced = await click_atom(second_atom)
    await click_atom(first_atom)
    await click_atom(second_atom, [`Shift`])
    expect(replaced.equals(await canvas_screenshot(canvas))).toBe(false)

    // Keyboard shortcuts should not cause errors
    await page.keyboard.press(`Delete`)
    await page.keyboard.press(`${primary_modifier_key}+z`)
    await page.keyboard.press(`${primary_modifier_key}+y`)
    await expect_canvas_renders(canvas)
    expect(console_errors).toHaveLength(0)
  })
})
