// FermiBandsLink: the state a Fermi surface and its band structure share, driven directly
import type { FermiBandsLinkInputs } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
import { FermiBandsLink } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
import type { BandEnergyGrid, BandGridData } from '#lib/fermi-surface/types.js'
import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
import type { BandsSpinMode } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test } from 'vitest'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

const grid_band = (values: number[]): BandEnergyGrid => ({
  values: Float64Array.from(values),
  dims: [2, 2, 2],
  order: `z_fastest`,
})
const flat = grid_band(Array(8).fill(0))
// E_F = 1. Spin up: band 0 flat at 0 (no sheet above it), band 1 spans 0 to 2.1 (a sheet at
// every energy between). Spin down: both flat at 0.
const band_data: BandGridData = {
  energies: [
    [flat, grid_band([0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1])],
    [flat, flat],
  ],
  k_grid: [2, 2, 2],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 1,
  n_bands: 2,
  n_spins: 2,
}
// a Bands hover or click on `band_idx` (in `spin`) at energy `y`
const band_event = (band_idx: number, y: number, spin: `up` | `down` = `up`) =>
  ({
    point: { x: 0, y, metadata: { band_idx, qpoint_idx: 0, spin } },
  }) as unknown as ScatterHandlerEvent

type Host = { mu: number; selected_bands?: number[]; band_data: BandGridData } & {
  [key in `bands_props` | `fermi_props`]: ReturnType<FermiBandsLinkInputs[key]>
}
const make_link = (band_spin_mode?: BandsSpinMode) => {
  const host = $state<Host>({
    mu: 0,
    band_data,
    bands_props: { band_spin_mode },
    fermi_props: {},
  })
  let link: FermiBandsLink | undefined
  onTestFinished(
    $effect.root(() => {
      link = new FermiBandsLink({
        band_data: () => host.band_data,
        band_struct: () => undefined,
        k_lattice: () => IDENTITY_MATRIX3,
        mu: { get: () => host.mu, set: (mu) => (host.mu = mu) },
        selected_bands: () => host.selected_bands,
        bands_props: () => host.bands_props,
        fermi_props: () => host.fermi_props,
      })
    }),
  )
  if (!link) throw new Error(`no link`)
  return { link, host }
}

test.each<[BandsSpinMode | undefined, string[] | undefined]>([
  [undefined, undefined],
  [`up_only`, [`up`]],
  [`down_only`, [`down`]],
])(`spin mode %s shows spin channels %j of a spin-polarized grid`, (mode, spins) => {
  expect(make_link(mode).link.selected_spins).toEqual(spins)
})

// a new inline props literal whose other keys changed must not reset a control's choice
test(`spin mode and colouring chosen in the controls survive unrelated prop changes`, () => {
  const { link, host } = make_link()
  link.band_spin_mode = `up_only`
  link.color_property = `spin`
  host.bands_props = { line_kwargs: { stroke: `red` } }
  host.fermi_props = {}
  flushSync()
  expect([link.band_spin_mode, link.color_property]).toEqual([`up_only`, `spin`])
  // the caller's own value still wins once it changes
  host.bands_props = { band_spin_mode: `down_only` }
  host.fermi_props = { color_property: `property` }
  flushSync()
  expect([link.band_spin_mode, link.color_property]).toEqual([`down_only`, `property`])
})

// isolation reads the grid (FermiSurface may still be extracting the clicked energy's sheets)
test(`a band click pins its energy and isolates its sheet, a second click ends it`, () => {
  const { link, host } = make_link()
  const shown = () => [host.mu, link.isolated_band, link.highlighted_band]
  link.band_click(band_event(1, 1.25))
  flushSync()
  expect(shown()).toEqual([0.25, 1, 1])
  // the next sweep frame (same bands, new energies) keeps it, a new band layout ends it
  host.band_data = { ...band_data }
  flushSync()
  expect(link.isolated_band).toBe(1)
  host.band_data = { ...band_data, band_indices: [4, 5] }
  flushSync()
  expect(link.isolated_band).toBeNull()
  host.band_data = band_data
  link.band_click(band_event(1, 1.25))
  link.band_click(band_event(1, 1.5))
  flushSync()
  expect(shown()).toEqual([0.5, null, null])
  // no sheet at the clicked energy (band 0, or band 1's flat down channel) pins it without
  // isolating anything
  for (const [band_idx, spin] of [
    [0, `up`],
    [1, `down`],
  ] as const) {
    link.band_click(band_event(band_idx, 0.75, spin))
    flushSync()
    expect(shown()).toEqual([-0.25, null, null])
  }
})

test(`hovering a grid band previews its energy, another band only highlights`, () => {
  const { link, host } = make_link()
  // wide hover radius for thin band lines, unless the caller sets one
  expect(link.bands_hover_config).toEqual({ threshold_px: 50, click_threshold_px: 50 })
  host.bands_props = { ...host.bands_props, hover_config: { click_threshold_px: 10 } }
  host.mu = 0.25
  const shown = () => [
    link.mu,
    link.previewing,
    link.reference_frequency,
    link.highlighted_band,
  ]
  link.band_hover(band_event(1, 1.5))
  flushSync()
  expect(shown()).toEqual([0.5, true, 1.5, 1])
  link.band_hover(band_event(5, 2)) // band 5 lies outside the grid: no surface to preview
  flushSync()
  expect(shown()).toEqual([0.25, false, 1.25, 5])
  link.band_hover(null)
  flushSync()
  expect(shown()).toEqual([0.25, false, 1.25, null])
  expect(link.bands_hover_config).toEqual({ threshold_px: 50, click_threshold_px: 10 })
})
