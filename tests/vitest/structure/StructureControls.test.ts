import type { AnyStructure } from '$lib'
import { StructureControls } from '$lib/structure'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, simple_structure } from '../setup'

vi.mock(`$lib/io/export`, () => ({
  export_canvas_as_png: vi.fn(),
}))

describe(`StructureControls`, () => {
  let wrapper_div: HTMLDivElement

  beforeEach(() => {
    wrapper_div = document.createElement(`div`)
    const canvas = document.createElement(`canvas`)
    wrapper_div.appendChild(canvas)
  })

  // PNG export functionality moved to StructureExportPane

  test(`supercell input accessibility attributes (valid)`, () => {
    mount(StructureControls, {
      target: document.body,
      props: {
        structure: simple_structure,
        controls_open: true,
        supercell_scaling: `2x2x2`,
      },
    })
    const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
    expect(input.getAttribute(`inputmode`)).toBe(`text`)
    expect(input.getAttribute(`autocomplete`)).toBe(`off`)
    expect(input.getAttribute(`spellcheck`)).toBe(`false`)
    expect(input.getAttribute(`pattern`)).toBe(`^(\\d+|\\d+x\\d+x\\d+)$`)
    expect(input.getAttribute(`aria-invalid`)).toBe(`false`)
  })

  test.each([
    { scaling: `2x2x2`, aria: `false` },
    { scaling: `1`, aria: `false` },
    { scaling: `invalid`, aria: `true` },
    { scaling: `2x2`, aria: `true` },
  ])(`supercell aria-invalid: $scaling -> $aria`, ({ scaling, aria }) => {
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
  })

  // Covered by the parameterized aria-invalid test

  // Covered by the parameterized aria-invalid test

  test.each([
    { scaling: `invalid`, has_error: true },
    { scaling: `2x2x2`, has_error: false },
  ])(
    `supercell error message visibility: $scaling -> $has_error`,
    ({ scaling, has_error }) => {
      mount(StructureControls, {
        target: document.body,
        props: {
          structure: simple_structure,
          controls_open: true,
          supercell_scaling: scaling,
        },
      })
      const errors = document.querySelectorAll(`div[style*="color: red"]`)
      expect(errors.length > 0).toBe(has_error)
    },
  )

  // Covered by the parameterized error message test

  test.each([
    { scaling: `invalid`, border_includes: `dashed red` },
    { scaling: `2x2x2`, border_includes: `` },
  ])(`supercell border styling: $scaling`, ({ scaling, border_includes }) => {
    mount(StructureControls, {
      target: document.body,
      props: {
        structure: simple_structure,
        controls_open: true,
        supercell_scaling: scaling,
      },
    })
    const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
    if (border_includes) expect(input.style.border).toContain(border_includes)
    else expect(input.style.border).toBe(``)
  })

  test.each([
    { scaling: `2x2x2`, includes: `Valid supercell scaling: 2x2x2` },
    { scaling: `invalid`, includes: `Invalid format. Use "2x2x2", "3x1x2", or "2"` },
  ])(`supercell title message: $scaling`, ({ scaling, includes }) => {
    mount(StructureControls, {
      target: document.body,
      props: {
        structure: simple_structure,
        controls_open: true,
        supercell_scaling: scaling,
      },
    })
    const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
    expect(input.title).toContain(includes)
  })

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
})
