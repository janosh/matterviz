// Tests for Fermi surface type guards
import { is_band_grid_data, is_fermi_surface_data } from '$lib/fermi-surface/types'
import type { BandGridData, FermiSurfaceData } from '$lib/fermi-surface/types'
import type { Matrix3x3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

const identity_lattice: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

const mock_fermi_surface: FermiSurfaceData = {
  isosurfaces: [],
  k_lattice: identity_lattice,
  fermi_energy: 0,
  reciprocal_cell: `wigner_seitz`,
  metadata: { n_bands: 1, n_surfaces: 0, total_area: 0 },
}

const mock_band_grid: BandGridData = {
  energies: [[[[[0]]]]],
  k_grid: [1, 1, 1],
  k_lattice: identity_lattice,
  fermi_energy: 0,
  n_bands: 1,
  n_spins: 1,
}

describe(`type guards`, () => {
  test.each([
    { fn: is_fermi_surface_data, data: mock_fermi_surface, expected: true },
    { fn: is_fermi_surface_data, data: mock_band_grid, expected: false },
    { fn: is_fermi_surface_data, data: null, expected: false },
    { fn: is_band_grid_data, data: mock_band_grid, expected: true },
    { fn: is_band_grid_data, data: mock_fermi_surface, expected: false },
    { fn: is_band_grid_data, data: null, expected: false },
  ])(`$fn.name($data) = $expected`, ({ fn, data, expected }) => {
    expect(fn(data as FermiSurfaceData | BandGridData | null)).toBe(expected)
  })
})
