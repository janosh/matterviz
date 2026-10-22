import FermiSurfaceControls from '#lib/fermi-surface/FermiSurfaceControls.svelte'
import type {
  BandGridData,
  ColorProperty,
  FermiSurfaceData,
} from '#lib/fermi-surface/types.js'
import { to_color_scale_config } from '#lib/plot/core/scales.js'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test } from 'vitest'
import { bind_props, doc_query, set_input, set_select } from '../setup'
import { IDENTITY_MATRIX3, make_fermi_isosurface, make_fermi_surface } from '../test-fixtures'

// One single-vertex sheet per band, optionally carrying a per-vertex property
const make_fermi_data = (band_indices = [0, 1], with_properties = false): FermiSurfaceData =>
  make_fermi_surface(
    band_indices.map((band_index) =>
      make_fermi_isosurface([[0, 0, 0]], [], {
        band_index,
        ...(with_properties && { properties: { Property: new Float32Array(1) } }),
      }),
    ),
  )

const render_controls = async (state: ComponentProps<typeof FermiSurfaceControls>) => {
  const component = mount(FermiSurfaceControls, {
    target: document.body,
    props: bind_props({ controls_open: true }, state),
  })
  onTestFinished(() => unmount(component))
  await tick()
}
const reset_section = async (section: string) => {
  const selector = `button[aria-label="Reset ${section} to defaults"]`
  doc_query<HTMLButtonElement>(selector).click()
  await tick()
  expect(document.querySelector(selector)).toBeNull()
}

describe(`FermiSurfaceControls`, () => {
  test.each([false, true])(
    `chemical-potential controls require a band grid: %s`,
    async (has_grid) => {
      const band_data: BandGridData = {
        energies: [[{ values: new Float64Array(8), dims: [2, 2, 2], order: `z_fastest` }]],
        k_grid: [2, 2, 2],
        k_lattice: IDENTITY_MATRIX3,
        fermi_energy: 0,
        n_bands: 1,
        n_spins: 1,
      }
      const state = {
        mu: 0,
        fermi_data: make_fermi_data(),
        band_data: has_grid ? band_data : undefined,
      }
      await render_controls(state)
      const offset = [
        ...document.querySelectorAll<HTMLInputElement>(`input[type="number"]`),
      ].find((input) => input.closest(`label`)?.textContent?.includes(`μ offset`))
      expect(document.querySelector(`small`)?.innerHTML).toMatch(/^E<sub[^>]*>F<\/sub> = /)
      expect(Boolean(offset)).toBe(has_grid)
      if (offset) {
        set_input(offset, `0.25`)
        expect(state.mu).toBe(0.25)
      }
    },
  )

  test.each<{
    name: string
    band_indices?: number[]
    selected_bands?: number[]
    color_property: ColorProperty
    expected_bands?: number[]
  }>([
    {
      name: `initializes bands and clears unavailable property coloring`,
      color_property: `property`,
      expected_bands: [0, 1],
    },
    {
      name: `preserves selected bands and band coloring`,
      selected_bands: [1],
      color_property: `band`,
      expected_bands: [1],
    },
    { name: `does not select unavailable bands`, band_indices: [], color_property: `band` },
  ])(`$name`, async ({ band_indices, selected_bands, color_property, expected_bands }) => {
    const state = { selected_bands, color_property, fermi_data: make_fermi_data(band_indices) }
    await render_controls(state)
    expect(state.selected_bands).toEqual(expected_bands)
    expect(state.color_property).toBe(`band`)
    if (selected_bands === undefined && expected_bands?.length) {
      expect(document.querySelector(`button[aria-label="Reset bands to defaults"]`)).toBeNull()
    }
  })

  // Several named properties get a selector; switching property or data drops a fixed range
  test(`selects among named properties and resets the fixed colour range`, async () => {
    const named = (names: string[]) => {
      const properties = Object.fromEntries(names.map((name) => [name, new Float32Array(1)]))
      return make_fermi_surface([make_fermi_isosurface([[0, 0, 0]], [], { properties })])
    }
    const state = $state<ComponentProps<typeof FermiSurfaceControls>>({
      fermi_data: named([`λ`, `Δ`]),
      color_property: `property`,
      property_name: undefined,
      color_scale: { scheme: `interpolateMagma`, value_range: [0, 2] },
      fitted_value_range: [0.1, 0.9],
    })
    const fixed_range = () =>
      to_color_scale_config(state.color_scale ?? `interpolateViridis`).value_range
    await render_controls(state)
    // a range passed with no property survives init
    expect([state.property_name, fixed_range()]).toEqual([`λ`, [0, 2]])
    const select_css = `select[aria-label="Fermi surface colouring property"]`
    const select = doc_query<HTMLSelectElement>(select_css)
    expect(Array.from(select.options, (option) => option.value)).toEqual([`λ`, `Δ`])
    const [min_input, max_input] = document.querySelectorAll<HTMLInputElement>(
      `input[aria-label^="Colour range"]`,
    )
    expect([min_input.value, max_input.placeholder]).toEqual([`0`, `0.9`])
    set_input(max_input, `5`)
    // edits keep the scheme
    expect(state.color_scale).toEqual({ scheme: `interpolateMagma`, value_range: [0, 5] })
    // a partial entry (`-` on the way to `-3`) reads as `` with badInput: the range stays
    Object.defineProperty(min_input, `validity`, {
      value: { badInput: true },
      configurable: true,
    })
    set_input(min_input, ``)
    expect(fixed_range()).toEqual([0, 5])
    Reflect.deleteProperty(min_input, `validity`)
    set_input(max_input, ``) // emptied → back to fitting the data
    expect(fixed_range()).toBeUndefined()
    state.color_scale = { value_range: [0, 2] }
    set_select(select, `Δ`)
    await tick()
    expect([state.property_name, fixed_range()]).toEqual([`Δ`, undefined])
    state.color_scale = { value_range: [0, 2] }
    state.fermi_data = named([`v`]) // Δ gone: first property, fitted range, no selector
    await tick()
    expect([state.property_name, fixed_range()]).toEqual([`v`, undefined])
    expect(document.querySelector(select_css)).toBeNull()
  })

  // a property the data lacks drops its fixed range already at init, keeping the scheme
  test(`drops a stale property's fixed range on mount`, async () => {
    const properties = { λ: new Float32Array(1) }
    const state = $state<ComponentProps<typeof FermiSurfaceControls>>({
      fermi_data: make_fermi_surface([make_fermi_isosurface([[0, 0, 0]], [], { properties })]),
      color_property: `property`,
      property_name: `gone`,
      color_scale: { scheme: `interpolateMagma`, value_range: [0, 2] },
    })
    await render_controls(state)
    expect([state.property_name, state.color_scale]).toEqual([
      `λ`,
      { scheme: `interpolateMagma`, value_range: undefined },
    ])
  })

  test(`resets authored appearance and bands against the current dataset`, async () => {
    const state = $state<ComponentProps<typeof FermiSurfaceControls>>({
      fermi_data: make_fermi_data([0, 1], true),
      selected_bands: [1],
      color_property: `property`,
      color_scale: `interpolateViridis`,
    })
    await render_controls(state)
    expect(
      document.querySelector(`button[aria-label="Reset appearance to defaults"]`),
    ).not.toBeNull()
    state.color_scale = `interpolatePlasma`
    await tick()
    await reset_section(`appearance`)
    expect([state.color_property, state.color_scale]).toEqual([`band`, `interpolateViridis`])
    await reset_section(`bands`)
    expect(state.selected_bands).toEqual([0, 1])
    state.fermi_data = make_fermi_data([3, 4, 5])
    await tick()
    expect(state.selected_bands).toEqual([3, 4, 5])
    expect(document.querySelector(`button[aria-label="Reset bands to defaults"]`)).toBeNull()
    state.selected_bands = [4]
    await tick()
    await reset_section(`bands`)
    expect(state.selected_bands).toEqual([3, 4, 5])
    // a mu change that adds or drops crossing bands keeps the bands switched off hidden
    state.selected_bands = [3, 5]
    state.fermi_data = make_fermi_data([3, 4, 5, 6])
    await tick()
    expect(state.selected_bands).toEqual([3, 5, 6])
    state.fermi_data = make_fermi_data([4, 5, 6])
    await tick()
    expect(state.selected_bands).toEqual([5, 6])
    // band 4, switched off, stops crossing and crosses again: it stays off (a hover preview
    // sweeping mu does this on every pointer move)
    state.fermi_data = make_fermi_data([5, 6])
    await tick()
    state.fermi_data = make_fermi_data([4, 5, 6])
    await tick()
    expect(state.selected_bands).toEqual([5, 6])
    await reset_section(`bands`) // reset forgets the hidden bands
    expect(state.selected_bands).toEqual([4, 5, 6])
    // a parent re-showing band 4 while it does not cross (FermiSurfaceBands ending an
    // isolation) shows it once it crosses again
    // oxfmt-ignore
    for (const bands of [[5, 6], [4, 5, 6]]) {
      state.selected_bands = bands
      state.fermi_data = make_fermi_data(bands)
      await tick()
    }
    expect(state.selected_bands).toEqual([4, 5, 6])
  })
})
