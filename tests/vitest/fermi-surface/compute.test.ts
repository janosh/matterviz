// Tests for Fermi surface computation, analysis and symmetry-tiling functions
import { compute_brillouin_zone } from '$lib/brillouin/compute'
import {
  compute_fermi_slice,
  compute_surface_area,
  detect_irreducible_bz,
  extract_fermi_surface,
  upsample_grid,
} from '$lib/fermi-surface/compute'
import { IDENTITY_4x4, lattice_point_group_matrices } from '$lib/fermi-surface/symmetry'
import type {
  BandEnergyGrid,
  BandGridData,
  FermiIsosurface,
  FermiSurfaceData,
} from '$lib/fermi-surface/types'
import * as math from '$lib/math'
import type { Matrix3x3, Matrix4Tuple, Vec3 } from '$lib/math'
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

// Flat z-fastest band grid from a per-index function
const make_band_grid = (
  dims: Vec3,
  fn: (ix: number, iy: number, iz: number) => number,
): BandEnergyGrid => {
  const [nx, ny, nz] = dims
  const values = new Float64Array(nx * ny * nz)
  let idx = 0
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) values[idx++] = fn(ix, iy, iz)
    }
  }
  return { values, dims, order: `z_fastest` }
}

// n³ grid of fn(frac coords); denom n−1 = endpoint-inclusive BXSF (point i ↔ i/(n−1)),
// denom n = periodic FRMSF (i ↔ i/n, no duplicated endpoint)
const build_nested = <Val>(
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
  const dims: Vec3 = [grid_n, grid_n, grid_n]
  return {
    energies: [
      [make_band_grid(dims, (ix, iy, iz) => energy_fn(ix / denom, iy / denom, iz / denom))],
    ],
    ...(velocity_fn && { velocities: [[build_nested(grid_n, denom, velocity_fn)]] }),
    ...(periodic && { periodic }),
    k_grid: dims,
    k_lattice,
    fermi_energy: 0,
    n_bands: 1,
    n_spins: 1,
  }
}

const sphere = (fx: number, fy: number, fz: number) => Math.hypot(fx - 0.5, fy - 0.5, fz - 0.5)

describe(`extract_fermi_surface`, () => {
  // Band data with a spherical isosurface: energy = distance² from grid center (in index units)
  function create_spherical_band_data(grid_size: number, fermi_energy: number): BandGridData {
    const center = (grid_size - 1) / 2
    const dims: Vec3 = [grid_size, grid_size, grid_size]
    const band = make_band_grid(
      dims,
      (ix, iy, iz) => (ix - center) ** 2 + (iy - center) ** 2 + (iz - center) ** 2,
    )
    return {
      energies: [[band]],
      k_grid: dims,
      k_lattice: IDENTITY,
      fermi_energy,
      n_bands: 1,
      n_spins: 1,
    }
  }

  test(`extracts Fermi surface from band data`, () => {
    const band_data = create_spherical_band_data(10, 9) // Fermi level at radius^2 = 9
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces).toHaveLength(1)
    expect(result.fermi_energy).toBe(9)
    expect(result.reciprocal_cell).toBe(`wigner_seitz`)
    // Radius 3 index units = 3/9 of the unit cell; MC area slightly under 4π(1/3)² = 1.396
    expect(result.metadata.total_area).toBeGreaterThan(1.3)
    expect(result.metadata.total_area).toBeLessThan(1.4)
  })

  test(`respects mu offset`, () => {
    const band_data = create_spherical_band_data(10, 9)
    // mu=0 gives surface at E_F=9 (radius 3); mu=7 at E_F=16 (radius 4): area ratio (4/3)²
    const area_0 = extract_fermi_surface(band_data, { mu: 0 }).metadata.total_area
    const area_7 = extract_fermi_surface(band_data, { mu: 7 }).metadata.total_area
    expect(area_7 / area_0).toBeCloseTo(16 / 9, 1)
  })

  test(`returns empty isosurfaces when no intersection`, () => {
    const band_data = create_spherical_band_data(10, 100) // Fermi level too high
    const result = extract_fermi_surface(band_data)

    expect(result.isosurfaces).toHaveLength(0)
    expect(result.metadata.total_area).toBe(0)
  })

  test(`filters by selected_bands`, () => {
    const band_data = create_spherical_band_data(10, 9)
    band_data.energies[0].push(band_data.energies[0][0]) // duplicate band
    band_data.n_bands = 2

    const all = extract_fermi_surface(band_data)
    expect(all.isosurfaces.map((iso) => iso.band_index)).toEqual([0, 1])
    const only_0 = extract_fermi_surface(band_data, { selected_bands: [0] })
    expect(only_0.isosurfaces.map((iso) => iso.band_index)).toEqual([0])
  })

  test(`handles multiple spin channels`, () => {
    const band_data = create_spherical_band_data(8, 4)
    band_data.energies.push([...band_data.energies[0]])
    band_data.n_spins = 2

    const result = extract_fermi_surface(band_data)
    expect(result.isosurfaces.map((iso) => iso.spin)).toEqual([`up`, `down`])
    expect(result.metadata.has_spin).toBe(true)
    expect(
      extract_fermi_surface(band_data, { selected_spins: [`down`] }).isosurfaces,
    ).toHaveLength(1)
  })
})

describe(`free-electron sphere (numerical verification)`, () => {
  // E(k) = ħ²k²/2m on a simple-cubic reciprocal lattice with |b| = 2π/a; the Fermi sphere
  // k_F = 0.6·π/a sits well inside the zone (|k_i| ≤ π/a). Exact area 4πk_F².
  const HBAR2_OVER_2M = 3.80998 // eV·Å²
  const A_LATT = 4 // Å
  const B_LEN = (2 * Math.PI) / A_LATT
  const K_F = 0.6 * (Math.PI / A_LATT)
  const E_F = HBAR2_OVER_2M * K_F * K_F
  const SPHERE_AREA = 4 * Math.PI * K_F * K_F
  const CUBIC = scaled(B_LEN)

  // Endpoint-inclusive grids place point i at frac i/(n−1) (BXSF), periodic ones at i/n
  // (FRMSF); marching_cubes `centered` shifts frac by −0.5 so k = (frac − 0.5)·b. `center_x`
  // moves the sphere centre along k_x using the minimum-image distance, so a sphere at the
  // zone-boundary X point wraps across the ±k_x faces.
  const free_electron = (n: number, periodic: boolean, center_x = 0): BandGridData => {
    const denom = periodic ? n : n - 1
    const k_of = (idx: number) => (idx / denom - 0.5) * B_LEN
    const min_image = (dk: number) => dk - B_LEN * Math.round(dk / B_LEN)
    const dims: Vec3 = [n, n, n]
    return {
      energies: [
        [
          make_band_grid(dims, (ix, iy, iz) => {
            const dx = min_image(k_of(ix) - center_x)
            return HBAR2_OVER_2M * (dx * dx + k_of(iy) ** 2 + k_of(iz) ** 2)
          }),
        ],
      ],
      k_grid: dims,
      k_lattice: CUBIC,
      fermi_energy: E_F,
      n_bands: 1,
      n_spins: 1,
      periodic,
    }
  }

  const extract_sphere = (n: number, periodic: boolean, interpolation_factor = 1) => {
    const { isosurfaces } = extract_fermi_surface(free_electron(n, periodic), {
      interpolation_factor,
    })
    expect(isosurfaces).toHaveLength(1)
    return isosurfaces[0]
  }
  const rel_area_error = (iso: FermiIsosurface) =>
    (compute_surface_area(iso) - SPHERE_AREA) / SPHERE_AREA

  // Measured relative area errors (inscribed-polyhedron deficit, O(h²)): N=24 → −8.7e-3,
  // N=48 → −2.1e-3 endpoint-inclusive; −7.9e-3 / −2.0e-3 periodic
  test.each([
    { n: 24, periodic: false, max_rel_err: 1e-2 },
    { n: 48, periodic: false, max_rel_err: 3e-3 },
    { n: 24, periodic: true, max_rel_err: 1e-2 },
    { n: 48, periodic: true, max_rel_err: 3e-3 },
  ])(
    `area ≈ 4πk_F² within $max_rel_err at N=$n (periodic=$periodic)`,
    ({ n, periodic, max_rel_err }) => {
      const iso = extract_sphere(n, periodic)
      const rel_err = rel_area_error(iso)
      expect(rel_err).toBeLessThan(0) // marching cubes inscribes the sphere
      expect(Math.abs(rel_err)).toBeLessThan(max_rel_err)
      expect(iso.area).toBeCloseTo(compute_surface_area(iso), 12)
    },
  )

  test.each([false, true])(
    `area error shrinks ~4x from N=24 to N=48 (periodic=%s)`,
    (periodic) => {
      const err_24 = Math.abs(rel_area_error(extract_sphere(24, periodic)))
      const err_48 = Math.abs(rel_area_error(extract_sphere(48, periodic)))
      expect(err_48).toBeLessThan(err_24 / 3)
    },
  )

  // Measured max |‖v‖ − k_F| is 0.018 grid spacings at N=24 (linear edge interpolation of a
  // quadratic is second-order accurate), far below the one-spacing bound a wrong grid
  // convention would blow through
  test.each([
    { n: 24, periodic: false },
    { n: 48, periodic: false },
    { n: 24, periodic: true },
  ])(`every vertex lies on the sphere (N=$n, periodic=$periodic)`, ({ n, periodic }) => {
    const iso = extract_sphere(n, periodic)
    const spacing = B_LEN / (periodic ? n : n - 1)
    let max_dr = 0
    for (const vertex of iso.vertices) {
      max_dr = Math.max(max_dr, Math.abs(Math.hypot(...vertex) - K_F))
    }
    expect(max_dr).toBeLessThan(0.05 * spacing)
  })

  test(`2x tricubic upsampling of N=24 matches the N=48 area error (−2.2e-3 vs −8.7e-3 raw)`, () => {
    const err_raw = Math.abs(rel_area_error(extract_sphere(24, false)))
    const err_up = Math.abs(rel_area_error(extract_sphere(24, false, 2)))
    const err_48 = Math.abs(rel_area_error(extract_sphere(48, false)))
    expect(err_up).toBeLessThan(err_raw / 3)
    expect(err_up).toBeLessThan(1.1 * err_48)
    // Periodic upsampling reproduces the exact periodic quadratic, so it equals N=48 exactly
    expect(compute_surface_area(extract_sphere(24, true, 2))).toBeCloseTo(
      compute_surface_area(extract_sphere(48, true)),
      10,
    )
  })

  // marching-cubes.ts flips the gradient sign so normals point toward decreasing values:
  // inward (toward Γ) for an E < E_F electron pocket. Measured dot(n, v̂) = −1.0000 everywhere.
  test(`normals point inward (toward decreasing E) for an electron pocket`, () => {
    const iso = extract_sphere(24, false)
    expect(iso.normals).toHaveLength(iso.vertices.length)
    let max_dot = -Infinity
    for (let idx = 0; idx < iso.vertices.length; idx++) {
      const vertex = iso.vertices[idx]
      max_dot = Math.max(max_dot, math.dot(iso.normals[idx], vertex) / Math.hypot(...vertex))
    }
    expect(max_dot).toBeLessThan(-0.999)
  })

  test(`periodic and endpoint-inclusive grids agree on the area`, () => {
    const area_bxsf = compute_surface_area(extract_sphere(48, false))
    const area_frmsf = compute_surface_area(extract_sphere(48, true))
    expect(Math.abs(area_bxsf - area_frmsf) / SPHERE_AREA).toBeLessThan(2e-4)
  })

  // A sphere centred on the zone-boundary X point wraps onto both ±k_x faces. Every vertex
  // must stay inside the centred parallelepiped, the two half-spheres must meet each face,
  // and the summed area must still be the full sphere (measured −2.1e-3 / −2.0e-3).
  test.each([false, true])(`BZ folding of a sphere at X (periodic=%s)`, (periodic) => {
    const { isosurfaces } = extract_fermi_surface(free_electron(48, periodic, B_LEN / 2))
    expect(isosurfaces).toHaveLength(1)
    const iso = isosurfaces[0]
    expect(Math.abs(rel_area_error(iso))).toBeLessThan(3e-3)
    let max_coord = 0
    let n_on_pos_face = 0
    let n_on_neg_face = 0
    for (const vertex of iso.vertices) {
      max_coord = Math.max(max_coord, ...vertex.map(Math.abs))
      if (Math.abs(vertex[0] - B_LEN / 2) < 1e-9) n_on_pos_face++
      if (Math.abs(vertex[0] + B_LEN / 2) < 1e-9) n_on_neg_face++
    }
    expect(max_coord).toBeLessThanOrEqual(B_LEN / 2 + 1e-12)
    expect(n_on_pos_face).toBeGreaterThan(50)
    expect(n_on_neg_face).toBe(n_on_pos_face)
  })
})

describe(`grid/lattice conventions`, () => {
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
      expect(result.isosurfaces[0].avg_velocity).toBeCloseTo(iso, 2)
      expect(result.metadata.has_velocities).toBe(true)
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

  test.each([
    { periodic: false, dims: [10, 4, 6] as Vec3, factor: 2, expected: [19, 7, 11] as Vec3 },
    { periodic: true, dims: [10, 4, 6] as Vec3, factor: 2, expected: [20, 8, 12] as Vec3 },
    { periodic: false, dims: [9, 5, 5] as Vec3, factor: 1.5, expected: [13, 7, 7] as Vec3 },
  ])(
    `upsample_grid keeps the grid convention (periodic=$periodic): $dims x$factor → $expected`,
    ({ periodic, dims, factor, expected }) => {
      // Catmull-Rom reproduces linear fields exactly, so an x-linear grid must resample to
      // ix·period/span wherever the 4-point stencil does not reach the periodic seam
      const grid = make_band_grid(dims, (ix) => ix)
      const up = upsample_grid(grid, factor, periodic)
      expect(up.dims).toEqual(expected)
      expect(up.order).toBe(`z_fastest`)
      expect(up.values).toHaveLength(expected[0] * expected[1] * expected[2])
      const [new_nx, ny, nz] = expected
      const period = periodic ? dims[0] : dims[0] - 1
      const span = periodic ? new_nx : new_nx - 1
      let n_checked = 0
      for (let ix = 0; ix < new_nx; ix++) {
        const src_x = (ix * period) / span
        const base = Math.floor(src_x)
        if (base < 1 || base + 2 > period - 1) continue // stencil touches the wrap seam
        for (let iy = 0; iy < ny; iy++) {
          for (let iz = 0; iz < nz; iz++) {
            expect(up.values[(ix * ny + iy) * nz + iz]).toBeCloseTo(src_x, 12)
          }
        }
        n_checked++
      }
      expect(n_checked).toBeGreaterThan(5)
    },
  )

  test(`upsample_grid with factor ≤ 1 returns the input grid untouched`, () => {
    const grid = make_band_grid([3, 3, 3], (ix, iy, iz) => ix + iy + iz)
    expect(upsample_grid(grid, 1)).toBe(grid)
  })

  test(`single-point endpoint-inclusive axis upsamples without NaN/crash`, () => {
    // [1][n][n] grid: px = 0, so unguarded resampling computes 0/0 = NaN and the
    // tricubic wrap (v % 0) indexes garbage. A single x-plane has no cubes
    // to march, so the expected output is simply no surfaces.
    const grid_n = 6
    const band_data: BandGridData = {
      energies: [
        [
          make_band_grid([1, grid_n, grid_n], (_ix, iy, iz) =>
            Math.hypot(iy / (grid_n - 1) - 0.5, iz / (grid_n - 1) - 0.5),
          ),
        ],
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

  test(`closed pocket is 3D with no orientation`, () => {
    const band_data = make_band_data(21, sphere)
    const result = extract_fermi_surface(band_data, { mu: 0.3, compute_dimensionality: true })
    expect(result.isosurfaces[0].dimensionality).toBe(`3D`)
    expect(result.isosurfaces[0].orientation).toBeNull()
  })
})

describe(`compute_surface_area`, () => {
  test.each([
    {
      label: `single triangle`,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ] as Vec3[],
      faces: [[0, 1, 2]],
      area: 0.5, // 0.5 * base * height
    },
    {
      label: `unit square (2 triangles)`,
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ] as Vec3[],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      area: 1.0,
    },
    { label: `empty surface`, vertices: [] as Vec3[], faces: [] as number[][], area: 0 },
  ])(`computes area of $label`, ({ vertices, faces, area }) => {
    const surface: FermiIsosurface = {
      vertices,
      faces,
      normals: [],
      band_index: 0,
      spin: null,
    }
    expect(compute_surface_area(surface)).toBeCloseTo(area, 5)
  })
})

describe(`compute_fermi_slice`, () => {
  // Thin box: a square sheet at z=0 extruded to z=0.1
  const box_vertices: Vec3[] = [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, 0.5, 0],
    [-0.5, -0.5, 0.1],
    [0.5, -0.5, 0.1],
    [0.5, 0.5, 0.1],
    [-0.5, 0.5, 0.1],
  ]
  // oxfmt-ignore
  const tri_faces = [
    [0, 1, 2], [0, 2, 3], // bottom
    [4, 6, 5], [4, 7, 6], // top
    [0, 4, 5], [0, 5, 1], // front
    [2, 6, 7], [2, 7, 3], // back
    [0, 3, 7], [0, 7, 4], // left
    [1, 5, 6], [1, 6, 2], // right
  ]
  // oxfmt-ignore
  const quad_faces = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2],
  ]

  const make_box_fermi_data = (faces: number[][] = tri_faces): FermiSurfaceData => ({
    isosurfaces: [
      {
        vertices: box_vertices,
        faces,
        normals: box_vertices.map(() => [0, 0, 1]),
        band_index: 0,
        spin: null,
      },
    ],
    k_lattice: IDENTITY,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: 1, total_area: 1 },
  })

  // Slicing the box at z=0.05 cuts its four side walls: one closed unit-square contour
  test.each([
    [`triangles`, tri_faces],
    [`quads`, quad_faces], // regression: the 4th edge of a quad used to be skipped
  ])(`slices the box walls into one closed unit-square contour (%s)`, (_label, faces) => {
    const slice = compute_fermi_slice(make_box_fermi_data(faces), {
      miller_indices: [0, 0, 1],
      distance: 0.05,
    })

    expect(slice.plane_normal).toEqual([0, 0, 1])
    expect(slice.plane_distance).toBe(0.05)
    expect(slice.metadata).toEqual({ n_lines: 1, has_properties: false })
    const [isoline] = slice.isolines
    expect(isoline.is_closed).toBe(true)
    expect(isoline.band_index).toBe(0)
    // Every contour point lies on the z=0.05 plane on the box perimeter (|x| or |y| = 0.5)
    for (const [px, py, pz] of isoline.points) {
      expect(pz).toBeCloseTo(0.05, 12)
      expect(Math.max(Math.abs(px), Math.abs(py))).toBeCloseTo(0.5, 12)
    }
    // Consecutive points must be close: contours are traced, not random scribbles
    for (let idx = 0; idx < isoline.points_2d.length - 1; idx++) {
      const [x1, y1] = isoline.points_2d[idx]
      const [x2, y2] = isoline.points_2d[idx + 1]
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(1.0 + 1e-12)
    }
  })

  test(`throws error for zero miller indices [0, 0, 0]`, () => {
    expect(() =>
      compute_fermi_slice(make_box_fermi_data(), { miller_indices: [0, 0, 0] }),
    ).toThrow(/Invalid miller indices.*at least one index must be non-zero/)
  })

  test(`throws error for degenerate k_lattice producing zero plane normal`, () => {
    const fermi_data = make_box_fermi_data()
    fermi_data.k_lattice = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]

    expect(() => compute_fermi_slice(fermi_data, { miller_indices: [1, 0, 0] })).toThrow(
      /Degenerate plane normal.*zero-length normal/,
    )
  })
})

describe(`detect_irreducible_bz`, () => {
  const make_data = (...vertex_lists: Vec3[][]): FermiSurfaceData => ({
    isosurfaces: vertex_lists.map((vertices) => ({
      vertices,
      faces: [],
      normals: [],
      band_index: 0,
      spin: null,
    })),
    k_lattice: IDENTITY,
    fermi_energy: 0,
    reciprocal_cell: `wigner_seitz`,
    metadata: { n_bands: 1, n_surfaces: vertex_lists.length, total_area: 0 },
  })

  // 11 vertices (> IRREDUCIBLE_BZ_MIN_VERTICES), all in the positive octant
  const positive_verts: Vec3[] = Array.from({ length: 11 }, (_, idx) => [
    0.1 + idx * 0.05,
    0.2,
    0.3,
  ])
  // 11 vertices spanning positive and negative octants
  const spanning_verts: Vec3[] = positive_verts.map((vert, idx) =>
    idx % 2 ? vert : [-vert[0], vert[1], vert[2]],
  )

  test.each([
    {
      label: `vertices in positive octant only`,
      data: make_data(positive_verts),
      expected: true,
    },
    { label: `vertices spanning full BZ`, data: make_data(spanning_verts), expected: false },
    { label: `empty isosurfaces`, data: make_data(), expected: false },
    {
      // needs > 10 vertices to be considered valid irreducible data
      label: `too few vertices`,
      data: make_data(positive_verts.slice(0, 2)),
      expected: false,
    },
  ])(`returns $expected for $label`, ({ data, expected }) => {
    expect(detect_irreducible_bz(data)).toBe(expected)
  })
})

describe(`lattice_point_group_matrices`, () => {
  // Real-space lattices (rows) → reciprocal k_lattice via reciprocal_lattice(two_pi)
  const real_lattices = {
    cubic: scaled(4),
    hexagonal: [
      [3, 0, 0],
      [-1.5, (3 * Math.sqrt(3)) / 2, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    tetragonal: [
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    orthorhombic: [
      [3, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ] as Matrix3x3,
    monoclinic: [
      [3, 0, 0],
      [0, 4, 0],
      [1, 0, 5],
    ] as Matrix3x3,
    triclinic: [
      [3, 0, 0],
      [0.5, 4, 0],
      [0.7, 1.1, 5],
    ] as Matrix3x3,
  }
  const k_lattice_of = (name: keyof typeof real_lattices) =>
    math.reciprocal_lattice(real_lattices[name], { two_pi: true })

  // Column-major 4x4 applied to a column vector
  const apply = (mat: Matrix4Tuple, [vx, vy, vz]: Vec3): Vec3 => [
    mat[0] * vx + mat[4] * vy + mat[8] * vz,
    mat[1] * vx + mat[5] * vy + mat[9] * vz,
    mat[2] * vx + mat[6] * vy + mat[10] * vz,
  ]
  // Largest distance from any transformed BZ vertex to the nearest original BZ vertex
  const max_vertex_mismatch = (ops: Matrix4Tuple[], vertices: Vec3[]): number => {
    let worst = 0
    for (const op of ops) {
      for (const vertex of vertices) {
        const image = apply(op, vertex)
        const nearest = Math.min(...vertices.map((other) => math.euclidean_dist(other, image)))
        worst = Math.max(worst, nearest)
      }
    }
    return worst
  }
  const det_4x4_rotation = (mat: Matrix4Tuple) =>
    mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) -
    mat[4] * (mat[1] * mat[10] - mat[2] * mat[9]) +
    mat[8] * (mat[1] * mat[6] - mat[2] * mat[5])

  // Holohedry orders: Oh 48, D6h 24, D4h 16, D2h 8, C2h 4, Ci 2
  test.each([
    [`cubic`, 48],
    [`hexagonal`, 24],
    [`tetragonal`, 16],
    [`orthorhombic`, 8],
    [`monoclinic`, 4],
    [`triclinic`, 2],
  ] as const)(`%s lattice has %i operations that map the BZ onto itself`, (name, n_ops) => {
    const k_lattice = k_lattice_of(name)
    const ops = lattice_point_group_matrices(k_lattice)
    expect(ops).toHaveLength(n_ops)
    expect(new Set(ops.map((op) => op.map((val) => val.toFixed(9)).join(`,`))).size).toBe(
      n_ops,
    )
    for (const [idx, val] of ops[0].entries()) expect(val).toBeCloseTo(IDENTITY_4x4[idx], 12)
    for (const op of ops) expect(Math.abs(det_4x4_rotation(op))).toBeCloseTo(1, 10)

    // Every operation must permute the Brillouin-zone vertices (measured ≤ 1.2e-15)
    const { vertices } = compute_brillouin_zone(k_lattice)
    expect(max_vertex_mismatch(ops, vertices)).toBeLessThan(1e-8)
    // Cached: the same lattice returns the same array
    expect(lattice_point_group_matrices(k_lattice)).toBe(ops)
  })

  // The cubic ops are exactly the 48 axis permutations × sign flips (Oh in Cartesian space)
  test(`cubic operations are the 48 signed axis permutations`, () => {
    const ops = lattice_point_group_matrices(k_lattice_of(`cubic`))
    for (const op of ops) {
      const rotation = [0, 1, 2].map((row) => [0, 1, 2].map((col) => op[col * 4 + row]))
      for (const line of rotation) {
        expect(line.filter((val) => Math.abs(Math.abs(val) - 1) < 1e-12)).toHaveLength(1)
        expect(line.filter((val) => Math.abs(val) < 1e-12)).toHaveLength(2)
      }
    }
  })

  // Applying the cubic Oh operations in Cartesian space (what tiling used to do for every
  // lattice) does NOT map a non-cubic zone onto itself: measured mismatches 1.19 (hexagonal),
  // 0.59 (tetragonal), 0.59 (orthorhombic) Å⁻¹ — whole spurious copies of the surface
  test.each([`hexagonal`, `tetragonal`, `orthorhombic`] as const)(
    `cubic Oh operations do not preserve the %s Brillouin zone`,
    (name) => {
      const cubic_ops = lattice_point_group_matrices(k_lattice_of(`cubic`))
      const { vertices } = compute_brillouin_zone(k_lattice_of(name))
      expect(max_vertex_mismatch(cubic_ops, vertices)).toBeGreaterThan(0.5)
    },
  )
})
