import type { AnyStructure } from '$lib'
import { StructureControls } from '$lib/structure'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, simple_structure } from '../setup'

vi.mock(`$lib/io/export`, () => ({
  export_canvas_as_png: vi.fn(),
}))

describe(`StructureControls`, () => {
  test.each([
    {
      scaling: `2x2x2`,
      aria: `false`,
      has_error: false,
      border_includes: ``,
      title_includes: `Valid supercell scaling: 2x2x2`,
      check_attrs: true,
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
    ({ scaling, aria, has_error, border_includes, title_includes, check_attrs }) => {
      mount(StructureControls, {
        target: document.body,
        props: {
          structure: simple_structure,
          controls_open: true,
          supercell_scaling: scaling,
        },
      })
      const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
      if (check_attrs) {
        expect(input.getAttribute(`inputmode`)).toBe(`text`)
        expect(input.getAttribute(`autocomplete`)).toBe(`off`)
        expect(input.getAttribute(`spellcheck`)).toBe(`false`)
        expect(input.getAttribute(`pattern`)).toBe(`^(\\d+|\\d+x\\d+x\\d+)$`)
      }
      expect(input.getAttribute(`aria-invalid`)).toBe(aria)
      expect(document.querySelectorAll(`div[style*="color: red"]`).length > 0).toBe(has_error)
      if (border_includes) expect(input.style.border).toContain(border_includes)
      else expect(input.style.border).toBe(``)
      if (title_includes) expect(input.title).toContain(title_includes)
    },
  )

  test(`handles structure without lattice`, () => {
    const structure_without_lattice: AnyStructure = {
      id: `test_no_lattice`,
      sites: simple_structure.sites,
      // No lattice property
    }
    mount(StructureControls, {
      target: document.body,
      props: { structure: structure_without_lattice, controls_open: true },
    })
    // Should not crash and supercell input should not be visible
    const supercell_inputs = document.querySelectorAll(`input[placeholder="1x1x1"]`)
    expect(supercell_inputs.length).toBe(0)
  })

  test(`handles undefined structure`, () => {
    const cmp = mount(StructureControls, {
      target: document.body,
      props: { structure: undefined, controls_open: true },
    })
    expect(cmp).toBeDefined()
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
        `input[aria-label="Site label background opacity"]`,
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

      expect(bg_color_input.value).toBe(`#000000`)
      expect(opacity_input.valueAsNumber).toBe(0)
    },
  )
})
