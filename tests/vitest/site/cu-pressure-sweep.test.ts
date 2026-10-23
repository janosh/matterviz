// The demo's approximate fcc Cu pressure sweep: Birch–Murnaghan pressures, cells and band
// energies scaled consistently, spectra built per frame on demand
import type { BandGridData } from '#lib/fermi-surface/types.js'
import { descriptor_value, validate_sweep, volume_per_atom } from '#lib/spectral/sweep.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import {
  birch_murnaghan_pressure,
  CU_SWEEP_DESCRIPTORS,
  CU_VOLUME_RATIOS,
  cu_pressure_sweep,
  scale_band_grid,
  scale_band_structure,
  scale_crystal,
} from '#site/electronic/cu-pressure-sweep.js'
import { expect, test } from 'vitest'
import { IDENTITY_MATRIX3, make_crystal } from '../test-fixtures'

const structure = make_crystal(3.6, [[`Cu`, [0, 0, 0]]])
const band_data: BandGridData = {
  energies: [
    [{ values: Float64Array.from([5, 7, 9, 11]), dims: [1, 2, 2], order: `z_fastest` }],
  ],
  k_grid: [1, 2, 2],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 7,
  n_bands: 1,
  n_spins: 1,
  periodic: true,
}
const band_struct: BaseBandStructure = {
  type: `electronic`,
  efermi: 7,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 1, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 1],
  nb_bands: 1,
  bands: [[5, 9]],
  recip_lattice: IDENTITY_MATRIX3,
}

// The pressure is −dE/dV of the third-order Birch–Murnaghan energy (V₀ = 1), checked by a
// central difference independent of the closed form: step 1e-5 leaves a truncation error
// ~1e-10 relative and round-off ~eps·E/h ~1e-11, far inside the 1e-7 tolerance
const birch_murnaghan_energy = (volume: number, bulk_modulus: number, prime: number) => {
  const strain = volume ** (-2 / 3) - 1 // η² − 1
  return (9 / 16) * bulk_modulus * (strain ** 3 * prime + strain ** 2 * (6 - 4 * (strain + 1)))
}
test.each([1, 0.95, 0.8, 0.75])(`Birch–Murnaghan pressure at V/V₀ = %s is −dE/dV`, (ratio) => {
  const step = 1e-5
  const slope =
    (birch_murnaghan_energy(ratio + step, 140, 5) -
      birch_murnaghan_energy(ratio - step, 140, 5)) /
    (2 * step)
  const pressure = birch_murnaghan_pressure(ratio, 140, 5)
  expect(Math.abs(pressure + slope)).toBeLessThan(1e-7 * Math.max(1, Math.abs(pressure)))
})

test(`a scaled crystal keeps fractional positions, its volume scaling as s³`, () => {
  const scaled = scale_crystal(structure, 0.9)
  expect(volume_per_atom(scaled) / volume_per_atom(structure)).toBeCloseTo(0.9 ** 3, 12)
  expect(scaled.lattice.a).toBeCloseTo(3.6 * 0.9, 12)
  expect(scaled.sites[0].abc).toEqual(structure.sites[0].abc)
})

test(`band energies scale about E_F by 1/s², k-space lengths by 1/s`, () => {
  const scale = 0.5
  const grid = scale_band_grid(band_data, scale)
  expect([...grid.energies[0][0].values]).toEqual([-1, 7, 15, 23]) // 7 + (ε − 7)·4
  expect(grid.k_lattice[0][0]).toBe(2)
  expect(band_data.energies[0][0].values[0]).toBe(5) // the input is untouched
  const bands = scale_band_structure(band_struct, scale, band_data.fermi_energy)
  expect(bands.bands).toEqual([[-1, 15]])
  expect(bands.distance).toEqual([0, 2])
  expect(bands.qpoints.map(({ distance }) => distance)).toEqual([0, 2])
  expect(bands.recip_lattice?.[0][0]).toBe(2)
})

test(`the sweep ascends in pressure and its loader builds each frame's spectra`, async () => {
  const { sweep, load_frame } = cu_pressure_sweep({ structure, band_data, band_struct })
  expect(() => validate_sweep(sweep)).not.toThrow()
  const [series] = sweep.series
  expect(series.frames).toHaveLength(CU_VOLUME_RATIOS.length)
  expect(series.frames[0]).toMatchObject({ value: 0, label: `0 GPa (V/V₀ = 1.00)` })
  // frames bring only their structures up front
  expect(series.frames.every((frame) => frame.structure && !frame.band_data)).toBe(true)
  const loaded = await load_frame(series.id, 2)
  expect(Object.keys(loaded).toSorted()).toEqual([`band_data`, `band_structs`, `doses`])
  const frame = { ...series.frames[2], ...loaded }
  const values = Object.fromEntries(
    CU_SWEEP_DESCRIPTORS.map((spec) => [spec.key, descriptor_value(frame, spec)]),
  )
  expect(values.volume_per_atom).toBeCloseTo(volume_per_atom(structure) * 0.9, 12)
  expect(values.cu_cu_distance).toBeCloseTo(3.6 * Math.cbrt(0.9), 12) // its own image
  expect(values.fermi_band_count).toBe(1)
  expect(values.fermi_dos).toBeGreaterThan(0)
})
