import type { AnyStructure } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import { StructureControls } from '$lib/structure'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { cubic_matrix, doc_query, make_crystal, simple_structure } from '../setup'

describe(`StructureControls`, () => {
  test.each([
    {
      scaling: `2x2x2`,
      aria: `false`,
      has_error: false,
      border_includes: ``,
      title_includes: `Valid supercell scaling: 2x2x2`,
    },
    { scaling: `1`, aria: `false`, has_error: false, border_includes: `` },
    {
      scaling: `invalid`,
      aria: `true`,
      has_error: true,
      border_includes: `dashed red`,
      title_includes: `Invalid format. Use "2x2x2", "3x1x2", or "2"`,
    },
    { scaling: `2x2`, aria: `true`, has_error: true, border_includes: `dashed red` },
  ])(
    `supercell input state: $scaling`,
    ({ scaling, aria, has_error, border_includes, title_includes }) => {
      mount(StructureControls, {
        target: document.body,
        props: {
          structure: simple_structure,
          controls_open: true,
          supercell_scaling: scaling,
        },
      })
      const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
      expect(input.getAttribute(`aria-invalid`)).toBe(aria)
      const error_message = document.querySelector(`[data-testid="supercell-input-error"]`)
      expect(error_message !== null).toBe(has_error)
      if (border_includes) expect(input.style.border).toContain(border_includes)
      else expect(input.style.border).toBe(``)
      if (title_includes) expect(input.title).toContain(title_includes)
    },
  )

  // The supercell input needs a lattice, so neither a lattice-less structure nor no
  // structure at all may render one - and neither may crash the controls
  test.each<[string, AnyStructure | undefined]>([
    [`structure without lattice`, { id: `test_no_lattice`, sites: simple_structure.sites }],
    [`undefined structure`, undefined],
  ])(`renders no supercell input for %s`, (_name, structure) => {
    mount(StructureControls, {
      target: document.body,
      props: { structure, controls_open: true },
    })
    expect(document.querySelectorAll(`input[placeholder="1x1x1"]`)).toHaveLength(0)
  })

  const mount_zone_axis = async (matrix: Matrix3x3 = cubic_matrix(10)) => {
    mount(StructureControls, {
      target: document.body,
      props: { structure: make_crystal(matrix, [[`H`, [0, 0, 0]]]), controls_open: true },
    })
    await tick()
    const miller_input = doc_query<HTMLInputElement>(`.zone-axis .miller-input input`)
    return async (typed: string) => {
      miller_input.value = typed
      miller_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
    }
  }
  const zone_axis_error = () => document.querySelector(`.zone-axis .control-error`)
  const view_button = () =>
    [...document.querySelectorAll(`button`)].find((btn) => btn.textContent?.trim() === `View`)

  // zone_axis_direction throws on a cell it cannot resolve a direction in, and
  // MillerIndexInput accepts indices it cannot use. Resolving both in a $derived means the
  // button is disabled and the reason shown BEFORE any click, so the throw can never escape
  // the handler. The hkl/singular variant is covered directly in
  // scene/camera-orientation.test.ts — the mode is just an argument to the identical
  // guarded call, and happy-dom cannot drive a Svelte <select> binding.
  // oxfmt-ignore
  test.each([
    [`a well-formed cell`, cubic_matrix(10), `001`, null],
    [`a cell with a zero c vector`, [[10, 0, 0], [0, 10, 0], [0, 0, 0]], `001`, /Degenerate uvw direction/],
    [`all-zero indices`, cubic_matrix(10), `000`, /uvw indices must be finite and not all zero/],
    [`a non-finite index`, cubic_matrix(10), `Infinity 0 0`, /must be finite and not all zero/],
  ] as [string, Matrix3x3, string, RegExp | null][])(
    `zone axis View button on %s`,
    async (_name, matrix, typed, expected_error) => {
      const type_indices = await mount_zone_axis(matrix)
      await type_indices(typed)
      expect(view_button()?.disabled).toBe(expected_error !== null)
      if (expected_error) expect(zone_axis_error()?.textContent).toMatch(expected_error)
      else expect(zone_axis_error()).toBeNull()
    },
  )

  // ...and typing a usable direction clears it again, since the message is derived
  test(`zone axis error clears when the indices become valid`, async () => {
    const type_indices = await mount_zone_axis()
    await type_indices(`000`)
    expect(zone_axis_error()).not.toBeNull()
    await type_indices(`110`)
    expect(zone_axis_error()).toBeNull()
  })

  test.each([
    {
      site_label_bg_color: `color-mix(in srgb, #ff0000 60%, transparent)`,
      expected_hex_color: `#ff0000`,
      expected_opacity: 0.6,
    },
    {
      site_label_bg_color: `color-mix(in srgb, #00ff00 150%, transparent)`,
      expected_hex_color: `#00ff00`,
      expected_opacity: 1,
    },
  ])(
    `parses and resets site label background from $site_label_bg_color`,
    async ({ site_label_bg_color, expected_hex_color, expected_opacity }) => {
      mount(StructureControls, {
        target: document.body,
        props: {
          structure: simple_structure,
          controls_open: true,
          scene_props: {
            show_site_labels: true,
            site_label_bg_color,
          },
        },
      })

      const bg_color_input = doc_query<HTMLInputElement>(
        `input[aria-label="Site label background color"]`,
      )
      const opacity_input = doc_query<HTMLInputElement>(
        `[data-key="site_label_bg_opacity"] input[type="number"]`,
      )
      expect(bg_color_input.value).toBe(expected_hex_color)
      expect(opacity_input.valueAsNumber).toBe(expected_opacity)

      bg_color_input.value = `#123456`
      bg_color_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      opacity_input.value = `0.5`
      opacity_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      doc_query<HTMLButtonElement>(`button[aria-label="Reset labels to defaults"]`).click()
      await tick()

      // reset restores what the pane mounted with, so the two halves of the one bg string come
      // back together even though a separate row drives each
      expect(bg_color_input.value).toBe(expected_hex_color)
      expect(opacity_input.valueAsNumber).toBe(expected_opacity)
    },
  )
})
