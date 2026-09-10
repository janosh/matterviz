import FermiSurfaceControls from '$lib/fermi-surface/FermiSurfaceControls.svelte'
import type { BandGridData, ColorProperty, FermiSurfaceData } from '$lib/fermi-surface/types'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, doc_query, make_fermi_isosurface, make_fermi_surface } from '../setup'

// One single-vertex sheet per band, optionally carrying a per-vertex property
const make_fermi_data = (band_indices = [0, 1], with_properties = false): FermiSurfaceData =>
  make_fermi_surface(
    band_indices.map((band_index) =>
      make_fermi_isosurface([[0, 0, 0]], [], {
        band_index,
        ...(with_properties && { properties: new Float32Array(1) }),
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
        k_lattice: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
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
      expect(document.body.textContent).toContain(`E_F =`)
      expect(Boolean(offset)).toBe(has_grid)
      if (offset) {
        offset.value = `0.25`
        offset.dispatchEvent(new Event(`input`, { bubbles: true }))
        expect(state.mu).toBe(0.25)
      }
    },
  )

  test.each([false, true])(`export controls require a handler: %s`, async (has_handler) => {
    const on_export = vi.fn()
    await render_controls({ on_export: has_handler ? on_export : undefined })
    const buttons = document.querySelectorAll<HTMLButtonElement>(`.export-buttons button`)
    expect(buttons).toHaveLength(has_handler ? 3 : 0)
    for (const button of buttons) button.click()
    expect(on_export.mock.calls).toEqual(has_handler ? [[`stl`], [`obj`], [`glb`]] : [])
  })

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
  })
})
