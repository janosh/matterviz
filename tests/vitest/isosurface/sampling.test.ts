// Tests for world-coordinate volume sampling, grid compatibility checks, and
// fractional display-range extraction
import {
  compare_volume_grids,
  create_volume_sampler,
  extract_volume_range,
  resolve_volume_display_range,
  sample_volume_at_positions,
  sanitize_display_range,
} from '$lib/isosurface/sampling'
import type { VolumetricData } from '$lib/isosurface/types'
import { marching_cubes } from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { make_grid, make_volume } from '../setup'

// Grid whose value is a linear function of fractional coordinates — trilinear
// interpolation reproduces linear fields exactly, so samples have closed forms.
// Non-periodic grids place point i at frac i/(n-1); periodic at i/n.
const linear_volume = (
  n_pts: number,
  lattice: Matrix3x3,
  periodic: boolean,
  origin: Vec3 = [0, 0, 0],
): VolumetricData => {
  const divisor = periodic ? n_pts : n_pts - 1
  const grid = make_grid(
    n_pts,
    n_pts,
    n_pts,
    (ix, iy, iz) => ix / divisor + 2 * (iy / divisor) + 4 * (iz / divisor),
  )
  return make_volume(grid, { lattice, origin, periodic })
}

const cubic: Matrix3x3 = [
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
]
// Hexagonal-like non-orthogonal lattice (60° between a and b)
const hexagonal: Matrix3x3 = [
  [4, 0, 0],
  [2, 2 * Math.sqrt(3), 0],
  [0, 0, 6],
]

describe(`create_volume_sampler`, () => {
  test.each([
    { frac: [0, 0, 0] as Vec3, expected: 0 },
    { frac: [0.5, 0, 0] as Vec3, expected: 0.5 },
    { frac: [0, 0.5, 0] as Vec3, expected: 1 },
    { frac: [0, 0, 0.5] as Vec3, expected: 2 },
    { frac: [0.25, 0.5, 0.75] as Vec3, expected: 0.25 + 1 + 3 },
    { frac: [1, 1, 1] as Vec3, expected: 7 },
  ])(
    `samples linear field exactly on orthogonal lattice at frac $frac`,
    ({ frac, expected }) => {
      const vol = linear_volume(11, cubic, false)
      const sample = create_volume_sampler(vol)
      const cart: Vec3 = [frac[0] * 10, frac[1] * 10, frac[2] * 10]
      expect(sample(cart)).toBeCloseTo(expected, 10)
    },
  )

  test.each([
    { frac: [0.25, 0.5, 0.75] as Vec3 },
    { frac: [0.1, 0.9, 0.3] as Vec3 },
    { frac: [0.6, 0.2, 0.5] as Vec3 },
  ])(`samples linear field exactly on non-orthogonal lattice at $frac`, ({ frac }) => {
    const vol = linear_volume(13, hexagonal, false)
    const sample = create_volume_sampler(vol)
    // Cartesian position from fractional coords: frac · lattice (row convention)
    const cart: Vec3 = [
      frac[0] * hexagonal[0][0] + frac[1] * hexagonal[1][0] + frac[2] * hexagonal[2][0],
      frac[0] * hexagonal[0][1] + frac[1] * hexagonal[1][1] + frac[2] * hexagonal[2][1],
      frac[0] * hexagonal[0][2] + frac[1] * hexagonal[1][2] + frac[2] * hexagonal[2][2],
    ]
    const expected = frac[0] + 2 * frac[1] + 4 * frac[2]
    expect(sample(cart)).toBeCloseTo(expected, 10)
  })

  test(`accounts for volume origin offset`, () => {
    const origin: Vec3 = [3, -2, 5]
    const vol = linear_volume(11, cubic, false, origin)
    const sample = create_volume_sampler(vol)
    // Absolute Cartesian = origin + frac·lattice; frac (0.5, 0.5, 0.5) → 3.5
    expect(sample([3 + 5, -2 + 5, 5 + 5])).toBeCloseTo(3.5, 10)
    // Sampling at the raw fractional position (ignoring origin) gives a different value
    expect(sample([5, 5, 5])).not.toBeCloseTo(3.5, 3)
  })

  test(`wraps periodically outside the cell`, () => {
    const vol = linear_volume(10, cubic, true)
    const sample = create_volume_sampler(vol)
    const inside = sample([2.5, 5, 7.5])
    // One lattice vector away in each direction must give identical values
    expect(sample([12.5, 5, 7.5])).toBeCloseTo(inside, 10)
    expect(sample([2.5, -5, 7.5])).toBeCloseTo(inside, 10)
    expect(sample([2.5, 5, 27.5])).toBeCloseTo(inside, 10)
  })

  test(`periodic colors are continuous across the cell boundary`, () => {
    // Smooth periodic field: cos(2π fx)
    const n_pts = 32
    const grid = make_grid(n_pts, n_pts, n_pts, (ix) => Math.cos((2 * Math.PI * ix) / n_pts))
    const vol = make_volume(grid, { lattice: cubic, periodic: true })
    const sample = create_volume_sampler(vol)
    const just_below = sample([9.999, 5, 5])
    const just_above = sample([0.001, 5, 5])
    expect(Math.abs(just_below - just_above)).toBeLessThan(0.01)
  })

  test.each([
    { policy: `clamp` as const, position: [15, 5, 5] as Vec3 },
    { policy: `clamp` as const, position: [-3, 5, 5] as Vec3 },
  ])(`clamp policy samples nearest edge at $position`, ({ policy, position }) => {
    const vol = linear_volume(11, cubic, false)
    const sample = create_volume_sampler(vol, { out_of_bounds: policy })
    // x clamps to 0 or 1; y=z=0.5 contribute 1 + 2 = 3
    const expected = (position[0] > 10 ? 1 : 0) + 3
    expect(sample(position)).toBeCloseTo(expected, 10)
  })

  test(`fallback policy returns NaN out of bounds and values inside`, () => {
    const vol = linear_volume(11, cubic, false)
    const sample = create_volume_sampler(vol, { out_of_bounds: `fallback` })
    expect(sample([15, 5, 5])).toBeNaN()
    expect(sample([5, -1, 5])).toBeNaN()
    expect(sample([5, 5, 5])).toBeCloseTo(3.5, 10)
  })

  test(`tolerates tiny numerical overshoot at finite boundaries`, () => {
    const vol = linear_volume(11, cubic, false)
    const sample = create_volume_sampler(vol, { out_of_bounds: `fallback` })
    expect(sample([10 + 1e-7, 10, 10])).toBeCloseTo(7, 6)
    expect(sample([-1e-7, 0, 0])).toBeCloseTo(0, 6)
    // Just outside the boundary tolerance (frac overshoot > 1e-6) falls back
    expect(sample([10 + 1e-4, 10, 10])).toBeNaN()
    expect(sample([-1e-4, 0, 0])).toBeNaN()
  })
})

describe(`sample_volume_at_positions`, () => {
  test(`samples flat position triplets and preserves NaN markers`, () => {
    const vol = linear_volume(11, cubic, false)
    const positions = new Float32Array([5, 5, 5, 0, 0, 0, 50, 5, 5])
    const scalars = sample_volume_at_positions(vol, positions, {
      out_of_bounds: `fallback`,
    })
    expect(scalars).toHaveLength(3)
    expect(scalars[0]).toBeCloseTo(3.5, 5)
    expect(scalars[1]).toBeCloseTo(0, 5)
    expect(scalars[2]).toBeNaN()
  })
})

describe(`compare_volume_grids`, () => {
  const base = () => linear_volume(11, cubic, false)

  test(`identical grids are compatible`, () => {
    expect(compare_volume_grids(base(), base())).toEqual({ ok: true })
  })

  test(`matching periodic grids are compatible`, () => {
    const vol_a = linear_volume(10, cubic, true)
    const vol_b = linear_volume(10, cubic, true)
    expect(compare_volume_grids(vol_a, vol_b).ok).toBe(true)
  })

  test.each([
    {
      label: `dimensions`,
      make_b: () => linear_volume(12, cubic, false),
      reason_match: /grid dimensions differ/,
    },
    {
      label: `origin`,
      make_b: () => linear_volume(11, cubic, false, [0.5, 0, 0]),
      reason_match: /origins differ/,
    },
    {
      label: `voxel vectors`,
      make_b: () =>
        linear_volume(
          11,
          [
            [12, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
          ],
          false,
        ),
      reason_match: /voxel vectors differ/,
    },
    {
      label: `boundary modes`,
      make_b: () => linear_volume(11, cubic, true),
      reason_match: /boundary modes differ/,
    },
  ])(`rejects mismatched $label with diagnostic`, ({ make_b, reason_match }) => {
    const result = compare_volume_grids(base(), make_b())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(reason_match)
  })

  test(`origin differences within tolerance are accepted`, () => {
    const vol_b = linear_volume(11, cubic, false, [1e-6, 0, 0])
    expect(compare_volume_grids(base(), vol_b).ok).toBe(true)
    expect(compare_volume_grids(base(), vol_b, { tolerance: 1e-8 }).ok).toBe(false)
  })

  test(`voxel comparison uses per-voxel (not per-lattice) tolerance`, () => {
    // 11 finite points → divisor 10: a 5e-4 lattice delta is a 5e-5 voxel delta
    // (within the 1e-4 tolerance), while 2e-3 → 2e-4 exceeds it
    const near = linear_volume(
      11,
      [
        [10.0005, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      false,
    )
    const far = linear_volume(
      11,
      [
        [10.002, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      false,
    )
    expect(compare_volume_grids(base(), near).ok).toBe(true)
    expect(compare_volume_grids(base(), far).ok).toBe(false)
  })
})

describe(`sanitize_display_range`, () => {
  test(`replaces invalid axes with [0, 1] and keeps valid ones`, () => {
    const sanitized = sanitize_display_range(
      [
        [NaN, 2],
        [0.5, 0.5],
        [-0.15, 2.15],
      ],
      true,
    )
    expect(sanitized).toEqual([
      [0, 1],
      [0, 1],
      [-0.15, 2.15],
    ])
  })

  test(`clamps non-periodic volumes to [0, 1] (no implicit repetition)`, () => {
    const sanitized = sanitize_display_range(
      [
        [-0.5, 1.5],
        [0.2, 0.8],
        [0, 1],
      ],
      false,
    )
    expect(sanitized).toEqual([
      [0, 1],
      [0.2, 0.8],
      [0, 1],
    ])
  })

  test(`replaces finite ranges entirely outside the volume`, () => {
    const sanitized = sanitize_display_range(
      [
        [2, 3],
        [-3, -2],
        [0.2, 0.8],
      ],
      false,
    )
    expect(sanitized).toEqual([
      [0, 1],
      [0, 1],
      [0.2, 0.8],
    ])
  })
})

describe(`resolve_volume_display_range`, () => {
  test(`periodic integer tiling becomes an endpoint-inclusive extraction range`, () => {
    const volume = linear_volume(10, cubic, true)
    expect(resolve_volume_display_range(volume, { tiling: [2, 3, 1] })).toEqual([
      [0, 2],
      [0, 3],
      [0, 1],
    ])
  })

  test(`explicit periodic range overrides atom tiling and includes halo`, () => {
    const volume = linear_volume(10, cubic, true)
    expect(
      resolve_volume_display_range(volume, {
        display_range: [
          [-0.15, 2.15],
          [0, 1],
          [0.25, 0.75],
        ],
        tiling: [4, 4, 4],
        halo: 0.1,
      }),
    ).toEqual([
      [-0.25, 2.25],
      [-0.1, 1.1],
      [0.15, 0.85],
    ])
  })

  test(`finite volume ignores atom tiling but supports explicit cropping`, () => {
    const volume = linear_volume(11, cubic, false)
    expect(resolve_volume_display_range(volume, { tiling: [3, 2, 1] })).toBeNull()
    expect(
      resolve_volume_display_range(volume, {
        display_range: [
          [-1, 0.8],
          [0.2, 2],
          [0, 1],
        ],
        tiling: [3, 2, 1],
      }),
    ).toEqual([
      [0, 0.8],
      [0.2, 1],
      [0, 1],
    ])
  })
})

describe(`extract_volume_range`, () => {
  // Periodic 10-point grid: value at grid index ix (iy=iz=0) is ix/10
  const periodic_vol = () => linear_volume(10, cubic, true)

  test(`integer range reproduces tiled values on aligned sample points`, () => {
    const extracted = extract_volume_range(periodic_vol(), [
      [0, 2],
      [0, 1],
      [0, 1],
    ])
    // width 2 at density 10 → 21 inclusive points at exactly the grid positions
    expect(extracted.grid_dims).toEqual([21, 11, 11])
    // Sample 13 sits at fx = 1.3 → wraps to grid index 3 → exact value 0.3
    expect(extracted.grid[13][0][0]).toBeCloseTo(0.3, 10)
    // Lattice spans the range; origin unchanged for a range starting at 0
    expect(extracted.lattice[0][0]).toBeCloseTo(20)
    expect(extracted.origin).toEqual([0, 0, 0])
    expect(extracted.periodic).toBe(false)
  })

  test(`self-sampling an integer-supercell surface recovers its isovalue`, () => {
    const n_pts = 8
    const grid = make_grid(n_pts, n_pts, n_pts, (ix, iy, iz) => {
      const phase = (2 * Math.PI) / n_pts
      return Math.sin(ix * phase) + 0.35 * Math.cos(iy * phase) + 0.2 * Math.sin(iz * phase)
    })
    const volume = make_volume(grid, { lattice: cubic, periodic: true })
    const extracted = extract_volume_range(volume, [
      [0, 2],
      [0, 1],
      [0, 1],
    ])
    const isovalue = 0.15
    const surface = marching_cubes(extracted.grid, isovalue, extracted.lattice, {
      periodic: false,
      centered: false,
      interpolate: true,
      normals: false,
    })
    const sample = create_volume_sampler(volume)

    expect(surface.vertices.length).toBeGreaterThan(0)
    for (const vertex of surface.vertices) {
      expect(sample(vertex)).toBeCloseTo(isovalue, 5)
    }
  })

  test(`fractional bounds clip exactly at the requested coordinates`, () => {
    const extracted = extract_volume_range(periodic_vol(), [
      [-0.15, 2.15],
      [0, 1],
      [0, 1],
    ])
    expect(extracted.grid_dims[0]).toBe(24) // round(2.3 * 10) + 1
    // First plane sits at fx = -0.15 → wraps to 0.85 → interpolated value 0.85
    expect(extracted.grid[0][0][0]).toBeCloseTo(0.85, 10)
    // Last plane sits at fx = 2.15 → wraps to 0.15
    expect(extracted.grid[23][0][0]).toBeCloseTo(0.15, 10)
    // Origin shifts by range_min·lattice; lattice row spans the width
    expect(extracted.origin[0]).toBeCloseTo(-1.5)
    expect(extracted.lattice[0][0]).toBeCloseTo(23)
    // data_range recomputed over the extracted block
    expect(extracted.data_range.min).toBeGreaterThanOrEqual(0)
    expect(extracted.data_range.max).toBeLessThanOrEqual(7)
  })

  test(`caps output resolution at the point budget`, () => {
    const extracted = extract_volume_range(
      periodic_vol(),
      [
        [0, 5],
        [0, 5],
        [0, 5],
      ],
      1000,
    )
    const [nx, ny, nz] = extracted.grid_dims
    expect(nx * ny * nz).toBeLessThanOrEqual(1000)
    expect(Math.min(nx, ny, nz)).toBeGreaterThanOrEqual(2)
    // Lattice still spans the full requested range despite reduced resolution
    expect(extracted.lattice[0][0]).toBeCloseTo(50)
  })

  test(`non-zero origin shifts by range_min·lattice on top of the source origin`, () => {
    const vol = { ...periodic_vol(), origin: [3, -2, 5] as Vec3 }
    const extracted = extract_volume_range(vol, [
      [-0.5, 1.5],
      [0, 1],
      [0, 1],
    ])
    expect(extracted.origin).toEqual([3 - 5, -2, 5]) // -0.5 * 10 along x
    // Values still wrap correctly: first plane at fx = -0.5 → grid value 0.5
    expect(extracted.grid[0][0][0]).toBeCloseTo(0.5, 10)
  })

  test(`non-periodic volumes are cropped, never repeated`, () => {
    const finite = linear_volume(11, cubic, false)
    const extracted = extract_volume_range(finite, [
      [-1, 3],
      [0, 0.5],
      [0, 1],
    ])
    // x clamps to [0, 1]; y crops to half the cell
    expect(extracted.lattice[0][0]).toBeCloseTo(10)
    expect(extracted.lattice[1][1]).toBeCloseTo(5)
    expect(extracted.grid[0][0][0]).toBeCloseTo(0, 10)
    const [nx, ny] = extracted.grid_dims
    expect(extracted.grid_dims).toEqual([11, 6, 11])
    // Endpoint values match the source field at the crop bounds
    expect(extracted.grid[nx - 1][0][0]).toBeCloseTo(1, 10)
    expect(extracted.grid[0][ny - 1][0]).toBeCloseTo(1, 10) // 2 * 0.5
  })
})
