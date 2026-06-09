// Regression tests for grid/lattice convention bugs in fermi-surface extraction:
// velocity cart→frac must invert the marching-cubes transform (transpose + de-center),
// resampling/extraction must respect endpoint-inclusive (BXSF) vs periodic (FRMSF)
// grids, and the BZ extent must derive from k_lattice (not a hardcoded [-1,1]³ box).
import { extract_fermi_surface } from '$lib/fermi-surface/compute'
import { parse_fermi_file } from '$lib/fermi-surface/parse'
import type { BandGridData } from '$lib/fermi-surface/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

const scaled = (scale: number): Matrix3x3 => [
  [scale, 0, 0],
  [0, scale, 0],
  [0, 0, scale],
]
const IDENTITY = scaled(1)
// k_latticeᵀ ≠ k_lattice exposes a missing transpose in cart→frac conversion
const HEXAGONAL: Matrix3x3 = [
  [1, 0, 0],
  [-0.5, Math.sqrt(3) / 2, 0],
  [0, 0, 1],
]

// n³ grid of fn(frac coords); denom n−1 = endpoint-inclusive BXSF (point i ↔ i/(n−1)),
// denom n = periodic FRMSF (i ↔ i/n, no duplicated endpoint)
const build_grid = <Val>(
  grid_n: number,
  denom: number,
  fn: (fx: number, fy: number, fz: number) => Val,
) =>
  Array.from({ length: grid_n }, (_x, ix) =>
    Array.from({ length: grid_n }, (_y, iy) =>
      Array.from({ length: grid_n }, (_z, iz) => fn(ix / denom, iy / denom, iz / denom)),
    ),
  )

const make_band_data = (
  grid_n: number,
  energy_fn: (fx: number, fy: number, fz: number) => number,
  opts: {
    k_lattice?: Matrix3x3
    periodic?: boolean
    velocity_fn?: (fx: number, fy: number, fz: number) => Vec3
  } = {},
): BandGridData => {
  const { k_lattice = IDENTITY, periodic, velocity_fn } = opts
  const denom = periodic ? grid_n : grid_n - 1
  return {
    energies: [[build_grid(grid_n, denom, energy_fn)]],
    ...(velocity_fn && { velocities: [[build_grid(grid_n, denom, velocity_fn)]] }),
    ...(periodic && { periodic }),
    k_grid: [grid_n, grid_n, grid_n],
    k_lattice,
    fermi_energy: 0,
    n_bands: 1,
    n_spins: 1,
  }
}

const sphere = (fx: number, fy: number, fz: number) => Math.hypot(fx - 0.5, fy - 0.5, fz - 0.5)

describe(`fermi-surface grid/lattice conventions`, () => {
  // Planar isosurface at fx=iso: every vertex sits at grid frac_x=iso, so a velocity
  // field v=[fx,0,0] must sample to exactly iso everywhere. Hexagonal catches a missing
  // transpose; off-center iso catches wrap/centering errors.
  test.each([
    { name: `identity`, k_lattice: IDENTITY, iso: 0.5 },
    { name: `identity`, k_lattice: IDENTITY, iso: 0.25 },
    { name: `hexagonal`, k_lattice: HEXAGONAL, iso: 0.5 },
    { name: `hexagonal`, k_lattice: HEXAGONAL, iso: 0.25 },
  ])(
    `velocities sample the true k-point ($name lattice, plane at fx=$iso)`,
    ({ k_lattice, iso }) => {
      const band_data = make_band_data(21, (fx) => fx, {
        k_lattice,
        velocity_fn: (fx) => [fx, 0, 0],
      })
      const result = extract_fermi_surface(band_data, { mu: iso, compute_velocities: true })
      const props = result.isosurfaces[0]?.properties ?? []
      expect(props.length).toBeGreaterThan(0)
      for (const vel of props) expect(vel).toBeCloseTo(iso, 2)
    },
  )

  // Sphere of radius 0.3 around frac (0.5,0.5,0.5) must keep its radius through
  // extraction and upsampling — a mixed-up grid convention rescales it by ~n/(n−1)
  test.each([
    [`endpoint-inclusive (BXSF)`, false, 1],
    [`endpoint-inclusive (BXSF), 2x upsampled`, false, 2],
    [`periodic (FRMSF)`, true, 1],
    [`periodic (FRMSF), 2x upsampled`, true, 2],
  ])(`sphere keeps its radius: %s`, (_label, periodic, interpolation_factor) => {
    const band_data = make_band_data(20, sphere, { periodic })
    const { isosurfaces } = extract_fermi_surface(band_data, { mu: 0.3, interpolation_factor })
    const verts = isosurfaces[0].vertices
    const mean_radius = verts.reduce((sum, vec) => sum + Math.hypot(...vec), 0) / verts.length
    expect(mean_radius).toBeCloseTo(0.3, 2)
  })

  test(`single-point endpoint-inclusive axis upsamples without NaN/crash`, () => {
    // [1][n][n] grid: px = 0, so unguarded resampling computes 0/0 = NaN and the
    // tricubic wrap (v % 0) indexes grid[NaN] → crash. A single x-plane has no cubes
    // to march, so the expected output is simply no surfaces.
    const grid_n = 6
    const band_data: BandGridData = {
      energies: [
        [[build_grid(grid_n, grid_n - 1, (_fx, fy, fz) => Math.hypot(fy - 0.5, fz - 0.5))[0]]],
      ],
      k_grid: [1, grid_n, grid_n],
      k_lattice: IDENTITY,
      fermi_energy: 0.3,
      n_bands: 1,
      n_spins: 1,
    }
    expect(extract_fermi_surface(band_data, { interpolation_factor: 2 }).isosurfaces).toEqual(
      [],
    )
  })

  // Full-BZ cylinder along z (open surface spanning one axis ⇒ 2D sheet); classification
  // must be invariant under pure rescaling of k_lattice
  test.each([1, 2, 0.8])(`full-BZ cylinder is 2D at lattice scale %d`, (scale) => {
    const band_data = make_band_data(21, (fx, fy) => Math.hypot(fx - 0.5, fy - 0.5), {
      k_lattice: scaled(scale),
    })
    const result = extract_fermi_surface(band_data, { mu: 0.3, compute_dimensionality: true })
    expect(result.isosurfaces[0].dimensionality).toBe(`2D`)
    expect(result.isosurfaces[0].orientation).toEqual([0, 0, 1])
  })

  test(`parse_frmsf marks the grid as periodic`, () => {
    const energies = Array.from({ length: 64 }, (_, idx) => (idx % 2 ? 1 : -1))
    const frmsf = [`4 4 4`, `1`, `1`, `1 0 0`, `0 1 0`, `0 0 1`, ...energies].join(`\n`)
    expect((parse_fermi_file(frmsf, `bands.frmsf`) as BandGridData).periodic).toBe(true)
  })
})
