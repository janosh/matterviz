// band_grid_dos: Gaussian-broadened DOS of a band grid's bands over its unique k-points
import { band_grid_dos } from '#lib/fermi-surface/dos.js'
import type { BandEnergyGrid, BandGridData } from '#lib/fermi-surface/types.js'
import type { Vec3 } from '#lib/math.js'
import { describe, expect, test } from 'vitest'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

// energy of grid point (ix, iy, iz), stored in `order`
const band = (
  dims: Vec3,
  energy: (ix: number, iy: number, iz: number) => number,
  order: BandEnergyGrid[`order`] = `z_fastest`,
): BandEnergyGrid => {
  const [nx, ny, nz] = dims
  const values = new Float64Array(nx * ny * nz)
  for (let ix = 0; ix < nx; ix++)
    for (let iy = 0; iy < ny; iy++)
      for (let iz = 0; iz < nz; iz++)
        values[order === `x_fastest` ? (iz * ny + iy) * nx + ix : (ix * ny + iy) * nz + iz] =
          energy(ix, iy, iz)
  return { values, dims, order }
}
const make_grid = (bands: BandEnergyGrid[][], periodic: boolean): BandGridData => ({
  energies: bands,
  k_grid: bands[0][0].dims,
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0.5,
  n_bands: bands[0].length,
  n_spins: bands.length,
  periodic,
})
// trapezoid integral of the density over energy
const integral = (energies: number[], densities: number[]): number =>
  densities
    .slice(1)
    .reduce(
      (sum, density, idx) =>
        sum + 0.5 * (density + densities[idx]) * (energies[idx + 1] - energies[idx]),
      0,
    )
// Truncating the Gaussians at 5 sigma drops 5.7e-7 of their weight; the trapezoid rule on a
// Gaussian sampled at <= sigma/4 is exact to far below that, so 2e-6 bounds both
const WEIGHT_TOL = 2e-6

describe(`band_grid_dos`, () => {
  test(`a flat band is one unit-area Gaussian per spin-degenerate band at its energy`, () => {
    const sigma = 0.2
    const dos = band_grid_dos(make_grid([[band([2, 2, 2], () => 1)]], true), { sigma })
    expect(Math.abs(integral(dos.energies, dos.densities) - 2)).toBeLessThan(WEIGHT_TOL)
    const peak_idx = dos.densities.indexOf(Math.max(...dos.densities))
    const step = dos.energies[1] - dos.energies[0]
    expect(Math.abs(dos.energies[peak_idx] - 1)).toBeLessThanOrEqual(step / 2)
    expect(dos.energies[0]).toBeCloseTo(1 - 5 * sigma, 12)
    expect(dos.energies.at(-1)).toBeCloseTo(1 + 5 * sigma, 12)
    expect(dos).toMatchObject({ type: `electronic`, efermi: 0.5 })
    expect(dos.spin_polarized).toBeUndefined()
  })

  // the k = 1 planes of an endpoint-inclusive grid repeat k = 0, so a value only they hold
  // (50 eV here) must not count, whichever axis runs fastest in storage
  test.each([`z_fastest`, `x_fastest`] as const)(
    `an endpoint-inclusive %s grid skips its duplicated planes`,
    (order) => {
      const dims: Vec3 = [3, 4, 2]
      const energy = (ix: number, iy: number, iz: number) =>
        ix === 2 || iy === 3 || iz === 1 ? 50 : ix + 0.1 * iy
      const dos = band_grid_dos(make_grid([[band(dims, energy, order)]], false), {
        sigma: 0.05,
        n_points: 2000,
      })
      expect(Math.max(...dos.energies)).toBeLessThan(2.3) // highest unique energy: 1 + 0.2
      expect(Math.abs(integral(dos.energies, dos.densities) - 2)).toBeLessThan(WEIGHT_TOL)
      // 2 x-planes x 3 y-rows x 1 z-layer = 6 unique points, energies 0, 0.1, 0.2, 1, 1.1, 1.2
      const below_half = dos.energies.findIndex((value) => value > 0.5)
      const lower = integral(
        dos.energies.slice(0, below_half),
        dos.densities.slice(0, below_half),
      )
      expect(Math.abs(lower - 1)).toBeLessThan(1e-3)
    },
  )

  test(`each spin channel of a polarized grid holds one electron per band`, () => {
    const grid = make_grid([[band([2, 2, 2], () => 0)], [band([2, 2, 2], () => 1)]], true)
    const dos = band_grid_dos(grid, { sigma: 0.1 })
    expect(dos.spin_polarized).toBe(true)
    expect(Math.abs(integral(dos.energies, dos.densities) - 1)).toBeLessThan(WEIGHT_TOL)
    expect(Math.abs(integral(dos.energies, dos.spin_down_densities ?? []) - 1)).toBeLessThan(
      WEIGHT_TOL,
    )
  })

  // the binned-and-convolved DOS against one Gaussian summed per k-point at every output
  // energy, on a dispersive two-band grid in both spin channels
  test(`matches the direct Gaussian sum`, () => {
    const sigma = 0.1
    const energy = (ix: number, iy: number, iz: number) =>
      Math.cos(ix) + 0.7 * Math.sin(2 * iy) - 0.3 * iz ** 1.5
    const bands = [band([7, 6, 5], energy), band([7, 6, 5], (...idx) => 2 + energy(...idx))]
    const grid = make_grid([bands, bands.toReversed()], true)
    const dos = band_grid_dos(grid, { sigma })
    const norm = 1 / (sigma * Math.sqrt(2 * Math.PI))
    const direct = dos.energies.map((at) =>
      bands.reduce(
        (sum, { values }) =>
          sum +
          values.reduce(
            (band_sum, value) =>
              band_sum + norm * Math.exp(-0.5 * ((at - value) / sigma) ** 2),
            0,
          ) /
            values.length,
        0,
      ),
    )
    const peak = Math.max(...direct)
    // linear binning at step h smooths a Gaussian by at most ~(h/σ)²/8 of its peak (2e-3 at
    // this grid's h ≈ σ/7.7; measured 4.7e-4), the grid-normalized kernel adds far less
    const step = dos.energies[1] - dos.energies[0]
    for (const densities of [dos.densities, dos.spin_down_densities ?? []]) {
      const max_err = Math.max(...densities.map((value, idx) => Math.abs(value - direct[idx])))
      expect(max_err / peak).toBeLessThan((step / sigma) ** 2 / 8)
    }
  })

  test.each([
    [{ sigma: 0 }, `sigma > 0, got 0`],
    [{ sigma: Number.NaN }, `sigma > 0, got NaN`],
    [{ n_points: 1 }, `n_points >= 2, got 1`],
    [{ n_points: 2.5 }, `n_points >= 2, got 2.5`],
    [{}, `band 0 (spin 0) has 8 of 8 energies missing`, () => Number.NaN],
    // one missing k-point would otherwise leave the band short of its two electrons
    [{}, `band 0 (spin 0) has 1 of 8 energies missing`, (ix: number) => (ix ? 1 : Infinity)],
  ])(`rejects %j: %s`, (options, message, energy = () => 0) => {
    expect(() =>
      band_grid_dos(
        make_grid([[band([2, 2, 2], (ix, iy, iz) => energy(ix + iy + iz))]], true),
        options,
      ),
    ).toThrow(message)
  })
})
