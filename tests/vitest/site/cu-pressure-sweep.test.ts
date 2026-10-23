// The demo's approximate fcc Cu pressure sweep: Birch–Murnaghan pressures, cells and band
// energies scaled consistently, a model phonon dispersion stiffening with them, spectra built
// per frame on demand
import type { BandGridData } from '#lib/fermi-surface/types.js'
import { descriptor_value, validate_sweep, volume_per_atom } from '#lib/spectral/sweep.js'
import type { Matrix3x3 } from '#lib/math.js'
import type { BaseBandStructure, PhononDos } from '#lib/spectral/types.js'
import {
  birch_murnaghan_pressure,
  CU_GRUNEISEN,
  CU_LAMBDA,
  CU_MAX_PHONON_THZ,
  CU_SWEEP_DESCRIPTORS,
  CU_VOLUME_RATIOS,
  cu_frame_phonons,
  cu_phonons,
  cu_pressure_sweep,
  eliashberg_function,
  eliashberg_moments,
  scale_band_grid,
  scale_band_structure,
  scale_crystal,
  symmetric_eigenvalues,
} from '#site/electronic/cu-pressure-sweep.js'
import { expect, test } from 'vitest'
import { IDENTITY_MATRIX3, make_crystal } from '../test-fixtures'

const structure = make_crystal(3.6, [[`Cu`, [0, 0, 0]]])
// fcc Cu's primitive cell (a = 3.6 Å), the phonon model's lattice
const fcc = make_crystal(
  [
    [0, 1.8, 1.8],
    [1.8, 0, 1.8],
    [1.8, 1.8, 0],
  ],
  [[`Cu`, [0, 0, 0]]],
)
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
  const bands = scale_band_structure(band_struct, scale, (energy) => 7 + (energy - 7) * 4)
  expect(bands.bands).toEqual([[-1, 15]])
  expect(bands.distance).toEqual([0, 2])
  expect(bands.qpoints.map(({ distance }) => distance)).toEqual([0, 2])
  expect(bands.recip_lattice?.[0][0]).toBe(2)
})

test(`the sweep ascends in pressure and its loader builds each frame's spectra`, async () => {
  const { sweep, load_frame } = cu_pressure_sweep({ structure: fcc, band_data, band_struct })
  expect(() => validate_sweep(sweep)).not.toThrow()
  const [series] = sweep.series
  expect(series.frames).toHaveLength(CU_VOLUME_RATIOS.length)
  expect(series.frames[0]).toMatchObject({ value: 0, label: `0 GPa (V/V₀ = 1.00)` })
  // frames bring only their structures up front
  expect(series.frames.every((frame) => frame.structure && !frame.band_data)).toBe(true)
  const loaded = await load_frame(series.id, 2)
  expect(Object.keys(loaded).toSorted()).toEqual([
    `band_data`,
    `band_structs`,
    `doses`,
    `phonon`,
    `scalars`,
  ])
  const frame = { ...series.frames[2], ...loaded }
  const values = Object.fromEntries(
    CU_SWEEP_DESCRIPTORS.map((spec) => [spec.key, descriptor_value(frame, spec)]),
  )
  expect(values.volume_per_atom).toBeCloseTo(volume_per_atom(fcc) * 0.9, 12)
  expect(values.cu_cu_distance).toBeCloseTo((3.6 / Math.SQRT2) * Math.cbrt(0.9), 12)
  expect(values.fermi_band_count).toBe(1)
  expect(values.fermi_dos).toBeGreaterThan(0)
})

// R·diag·Rᵀ for a rotation R about (1, 1, 1): eigenvalues = diag. Distinct ones come out to
// f64 round-off (~1e-15); a degenerate pair puts acos at ±1, where its slope diverges, so the
// pair is only good to ~√eps ≈ 1.5e-8 (measured 8.1e-9)
test.each([
  [[1, 2, 3], 1e-12],
  [[-2, 0, 5], 1e-12],
  [[1, 1, 3], 3e-8],
])(`symmetric_eigenvalues of a rotated diag(%j)`, (diag, tol) => {
  const [cos, sin] = [Math.cos(0.7), Math.sin(0.7)]
  const axis = [1, 1, 1].map((coord) => coord / Math.sqrt(3))
  const rot = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => {
      const cross = [
        [0, -axis[2], axis[1]],
        [axis[2], 0, -axis[0]],
        [-axis[1], axis[0], 0],
      ][row][col]
      return (row === col ? cos : 0) + (1 - cos) * axis[row] * axis[col] + sin * cross
    }),
  )
  const matrix = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) =>
      [0, 1, 2].reduce((sum, idx) => sum + rot[row][idx] * diag[idx] * rot[col][idx], 0),
    ),
  ) as Matrix3x3
  const eigs = symmetric_eigenvalues(matrix)
  const expected = diag.toSorted((lhs, rhs) => lhs - rhs)
  for (const [idx, val] of eigs.entries())
    expect(Math.abs(val - expected[idx])).toBeLessThan(tol)
})

test(`the phonon model: acoustic at Γ, scaled to Cu's maximum, three modes per cell`, () => {
  const { bands, dos } = cu_phonons(fcc, band_struct)
  expect(bands.type).toBe(`phonon`)
  expect(bands.bands.map((branch) => branch[0])).toEqual([0, 0, 0]) // Γ: acoustic only
  expect(Math.max(...bands.bands.flat())).toBeLessThanOrEqual(CU_MAX_PHONON_THZ + 1e-12)
  const bin = dos.frequencies[1] - dos.frequencies[0]
  const modes = dos.densities.reduce((sum, density) => sum + density * bin, 0)
  // 4σ Gaussian windows drop ~6e-5 of each mode's weight, bins below 0 the low tail
  expect(Math.abs(modes - 3)).toBeLessThan(1e-2)
  expect(() => cu_phonons(structure, band_struct)).toThrow(`needs an fcc primitive cell`)
})

test(`α²F moments: λ round-trips, a narrow peak at ω₀ gives ω_log = ω₂ = ω₀`, () => {
  const frequencies = Array.from({ length: 101 }, (_, idx) => 0.05 + idx * 0.1)
  const peak: PhononDos = {
    type: `phonon`,
    frequencies,
    densities: frequencies.map((freq) => (Math.abs(freq - 5.05) < 1e-9 ? 1 : 0)),
  }
  const a2f = eliashberg_function(peak, 0.8)
  const { lambda, omega_log, omega_2 } = eliashberg_moments(a2f)
  expect(Math.abs(lambda - 0.8)).toBeLessThan(1e-12)
  const kelvin = 5.05 * 47.9924
  expect(Math.abs(omega_log - kelvin) / kelvin).toBeLessThan(1e-12)
  expect(Math.abs(omega_2 - kelvin) / kelvin).toBeLessThan(1e-12)
})

test(`compressed frames stiffen as (V/V₀)^−γ, coupling falling as 1/ω²`, () => {
  const ambient = cu_phonons(fcc, band_struct)
  const ratio = 0.8
  const { phonon, scalars } = cu_frame_phonons(ambient, ratio, Math.cbrt(ratio))
  const stiffening = ratio ** -CU_GRUNEISEN
  const scaled = phonon.doses?.[`phonon DOS`]
  if (scaled?.type !== `phonon`) throw new Error(`no phonon DOS`)
  expect(scaled.frequencies[3]).toBeCloseTo(ambient.dos.frequencies[3] * stiffening, 12)
  expect(phonon.band_structs?.Cu.bands[2][1]).toBeCloseTo(
    ambient.bands.bands[2][1] * stiffening,
    12,
  )
  expect(Math.abs(scalars.lambda - CU_LAMBDA / stiffening ** 2)).toBeLessThan(1e-12)
  const ambient_scalars = cu_frame_phonons(ambient, 1, 1).scalars
  expect(scalars.omega_log / ambient_scalars.omega_log).toBeCloseTo(stiffening, 10)
  expect(ambient_scalars.omega_2).toBeGreaterThan(ambient_scalars.omega_log)
})
