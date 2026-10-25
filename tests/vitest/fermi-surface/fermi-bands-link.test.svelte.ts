// FermiBandsLink: the state a Fermi surface and its band structure share, driven directly
import { sheet_color } from '#lib/fermi-surface/constants.js'
import type { FermiBandsLinkInputs } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
import { FermiBandsLink } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
import type { BandEnergyGrid, BandGridData } from '#lib/fermi-surface/types.js'
import type { Vec2 } from '#lib/math.js'
import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
import { band_crossings, band_k_path, BANDS_CSS_COLORS } from '#lib/spectral/helpers.js'
import type { BandsSpinMode, BaseBandStructure, LineKwargs } from '#lib/spectral/types.js'
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
const make_link = (band_spin_mode?: BandsSpinMode, band_struct?: BaseBandStructure) => {
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
        band_struct: () => band_struct,
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

// with bands beside the grid their spin channels decide, as in Bands: unpolarized bands draw
// spin up whatever the mode, so `down_only` must not hide the up sheets and crossings
test.each([
  [`unpolarized`, undefined, undefined],
  [`spin-polarized`, [[0, 0]], [`down`]],
])(`down_only beside %s bands shows spin channels %j`, (_label, spin_down_bands, spins) => {
  const band_struct: BaseBandStructure = {
    type: `electronic`,
    qpoints: [
      { label: null, frac_coords: [0, 0, 0] },
      { label: null, frac_coords: [0.5, 0, 0] },
    ],
    branches: [{ start_index: 0, end_index: 1, name: `` }],
    labels_dict: {},
    distance: [0, 1],
    nb_bands: 1,
    bands: [[0, 2]],
    ...(spin_down_bands && { spin_down_bands }),
  }
  expect(make_link(`down_only`, band_struct).link.selected_spins).toEqual(spins)
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
  link.band_click(band_event(5, 1.25)) // band 5 lies outside the grid: nothing pinned
  flushSync()
  expect(shown()).toEqual([0, null, null])
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

// Band lines take their sheet's colour over the caller's style (one for all, or per band and
// spin), bands without a sheet keep the caller's colour or are muted; with vertex properties
// to colour sheets by, lines keep the caller's style
test(`band lines take their sheet's colour unless sheets are coloured by vertex`, () => {
  const { link, host } = make_link()
  const style = (band_idx: number, spin: `up` | `down` = `up`) =>
    typeof link.line_kwargs === `function` ? link.line_kwargs(band_idx, spin, `Cu`) : undefined
  expect([style(1, `down`), style(5)]).toEqual([
    { stroke: sheet_color(1, `down`, `band`) },
    { stroke: BANDS_CSS_COLORS.muted },
  ])
  for (const line_kwargs of [
    { stroke: `#123456`, stroke_width: 2.5 },
    (band: number) => ({ stroke: `#123456`, stroke_width: band === 1 ? 2.5 : 1 }),
  ] satisfies LineKwargs[]) {
    host.bands_props = { line_kwargs }
    flushSync()
    expect([style(1), style(5)?.stroke]).toEqual([
      { stroke: sheet_color(1, `up`, `band`), stroke_width: 2.5 },
      `#123456`,
    ])
  }
  // property colouring without grid properties keeps flat sheets, and so the band lines
  host.fermi_props = { color_property: `property` }
  flushSync()
  expect(style(1)?.stroke).toBe(sheet_color(1, `up`, `property`))
  const { line_kwargs } = host.bands_props
  host.band_data = { ...band_data, properties: { v_F: band_data.energies } }
  flushSync()
  expect(link.line_kwargs).toBe(line_kwargs)
  // without a choice a grid with properties colours its sheets by them too, unlike a pick
  host.fermi_props = {}
  flushSync()
  expect(link.color_property).toBeUndefined()
  expect(link.line_kwargs).toBe(line_kwargs)
  link.color_property = `band`
  flushSync()
  expect(style(1)?.stroke).toBe(sheet_color(1, `up`, `band`))
})

// Ten electronic bands along Γ → X (each case sets band 8); bands 8 and 9 have a sheet. Band 9
// runs 0 → 1 eV.
const ten_bands: BaseBandStructure = {
  type: `electronic`,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: null, frac_coords: [0.25, 0, 0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 0.5, 1],
  nb_bands: 10,
  bands: Array.from({ length: 10 }, (_, band_idx) => [
    band_idx - 9,
    band_idx - 8.5,
    band_idx - 8,
  ]),
}
// Crossings interpolate linearly between q-points in plot x (here Γ→X spans x 2 → 4) and in k
// (identity lattice: k = frac coords). A band meeting the energy at a q-point is one crossing
// there whichever side it comes from or turns back to (each q-point of a flat run too), and so
// is a q-point two branches share (Γ→X split at q-point 1 gives the same crossings).
// oxfmt-ignore
test.each<[string, number[], number, [number, number, number][]]>([
  [`rising through q-point 1`, [0.1, 0.3, 0.5], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`rising, between q-points`, [0.1, 0.3, 0.5], 0.45, [[8, 3.75, 0.4375], [9, 2.9, 0.225]]],
  [`branch start`, [0.1, 0.3, 0.5], 0.1, [[8, 2, 0], [9, 2.2, 0.05]]],
  [`touching from below`, [0, 0.3, 0], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`touching from above`, [0.5, 0.3, 0.5], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`flat at the energy`, [0.3, 0.3, 0.3], 0.3, [[8, 2, 0], [8, 3, 0.25], [8, 4, 0.5], [9, 2.6, 0.15]]],
  [`flat, then leaving`, [0.3, 0.3, 0.5], 0.3, [[8, 2, 0], [8, 3, 0.25], [9, 2.6, 0.15]]],
  [`band 1 without a sheet`, [0.1, 0.3, 0.5], -7.5, []], // its [-8, -7.5, -7] crosses
])(`band_crossings: %s`, (_desc, band_8, energy, expected) => {
  const bands = ten_bands.bands.map((energies, band) => (band === 8 ? band_8 : energies))
  const { points } = band_k_path(ten_bands, IDENTITY_MATRIX3)
  const split = {
    ...ten_bands,
    bands,
    branches: [
      { start_index: 0, end_index: 1, name: `GAMMA-q` },
      { start_index: 1, end_index: 2, name: `q-X` },
    ],
  }
  for (const [struct, x_positions] of [
    [{ ...ten_bands, bands }, { GAMMA_X: [2, 4] }],
    [split, { GAMMA_null: [2, 3], null_X: [3, 4] }],
  ] satisfies [BaseBandStructure, Record<string, Vec2>][]) {
    const crossings = band_crossings(struct, energy, points, x_positions, (band) =>
      [8, 9].includes(band),
    ).toSorted(
      (cross_a, cross_b) => cross_a.band_idx - cross_b.band_idx || cross_a.x - cross_b.x,
    )
    expect(crossings.map(({ band_idx, spin }) => [band_idx, spin])).toEqual(
      expected.map(([band]) => [band, `up`]),
    )
    for (const [idx, [, x_val, k_x]] of expected.entries()) {
      expect(crossings[idx].x).toBeCloseTo(x_val, 12)
      for (const [axis, coord] of [k_x, 0, 0].entries()) {
        expect(crossings[idx].k[axis]).toBeCloseTo(coord, 12)
      }
    }
  }
})
