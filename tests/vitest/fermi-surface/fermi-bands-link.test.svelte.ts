// FermiBandsLink: the state a Fermi surface and its band structure share, driven directly
import { FermiBandsLink } from '#lib/fermi-surface/fermi-bands-link.svelte.js'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiSurfaceData,
} from '#lib/fermi-surface/types.js'
import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
import type { BandsSpinMode } from '#lib/spectral/types.js'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test } from 'vitest'
import { IDENTITY_MATRIX3, make_fermi_isosurface } from '../test-fixtures'

const grid_band: BandEnergyGrid = {
  values: new Float64Array(8),
  dims: [2, 2, 2],
  order: `z_fastest`,
}
// bands 0 and 1 in both spin channels around E_F = 1
const band_data: BandGridData = {
  energies: [
    [grid_band, grid_band],
    [grid_band, grid_band],
  ],
  k_grid: [2, 2, 2],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 1,
  n_bands: 2,
  n_spins: 2,
}
// band 1 has a sheet, band 0 none
const surface: FermiSurfaceData = {
  isosurfaces: [
    make_fermi_isosurface(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [[0, 1, 2]],
      { band_index: 1 },
    ),
  ],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 1,
  reciprocal_cell: `wigner_seitz`,
  metadata: { n_bands: 2, n_surfaces: 1 },
}
// a Bands click on `band_idx` at energy `y`
const click = (band_idx: number, y: number) =>
  ({
    point: { x: 0, y, metadata: { band_idx, qpoint_idx: 0 } },
  }) as unknown as ScatterHandlerEvent

const make_link = (band_spin_mode?: BandsSpinMode) => {
  const host = $state({ mu: 0, selected_bands: undefined as number[] | undefined })
  let link: FermiBandsLink | undefined
  onTestFinished(
    $effect.root(() => {
      link = new FermiBandsLink({
        band_data: () => band_data,
        surface: () => surface,
        band_struct: () => undefined,
        k_lattice: () => IDENTITY_MATRIX3,
        mu: { get: () => host.mu, set: (mu) => (host.mu = mu) },
        selected_bands: {
          get: () => host.selected_bands,
          set: (bands) => (host.selected_bands = bands),
        },
        bands_props: () => ({ band_spin_mode }),
        fermi_props: () => ({}),
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

test(`a band click pins its energy and isolates its sheet, a second click ends it`, () => {
  const { link, host } = make_link()
  host.selected_bands = [0, 1]
  link.band_click(click(1, 1.25))
  flushSync()
  expect([host.mu, link.selected_bands, link.highlighted_band]).toEqual([0.25, [1], 1])
  link.selected_bands = [0] // FermiSurface's band sync can't end the isolation
  expect([host.selected_bands, link.selected_bands]).toEqual([[0, 1], [1]])
  link.band_click(click(1, 1.5))
  flushSync()
  expect([host.mu, link.selected_bands]).toEqual([0.5, [0, 1]])
  // a band without a sheet pins its energy without isolating anything
  link.band_click(click(0, 0.75))
  flushSync()
  expect([host.mu, link.selected_bands]).toEqual([-0.25, [0, 1]])
})
