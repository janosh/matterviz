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
import type { DisplayRange } from '$lib/isosurface/sampling'
import type { VolumetricData } from '$lib/isosurface/types'
import { marching_cubes } from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { create_frac_to_cart } from '$lib/math'
import { describe, expect, test } from 'vitest'
import {
  cubic_matrix,
  grid_value,
  make_grid,
  make_linear_volume as linear_volume,
  make_volume,
} from '../setup'

// Grid whose value is a linear function of fractional coordinates — trilinear
// interpolation reproduces linear fields exactly, so samples have closed forms.
// Non-periodic grids place point i at frac i/(n-1); periodic at i/n.
const cubic = cubic_matrix(10)
// Hexagonal-like non-orthogonal lattice (60° between a and b)
const hexagonal: Matrix3x3 = [
  [4, 0, 0],
  [2, 2 * Math.sqrt(3), 0],
  [0, 0, 6],
]
const hexagonal_frac_to_cart = create_frac_to_cart(hexagonal)

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
      const sample = create_volume_sampler(linear_volume(11, cubic, false))
      expect(sample([frac[0] * 10, frac[1] * 10, frac[2] * 10])).toBeCloseTo(expected, 10)
    },
  )

  test.each([
    [0.25, 0.5, 0.75],
    [0.1, 0.9, 0.3],
    [0.6, 0.2, 0.5],
  ] as const)(`samples linear field exactly on non-orthogonal lattice at %j`, (...frac) => {
    const sample = create_volume_sampler(linear_volume(13, hexagonal, false))
    const expected = frac[0] + 2 * frac[1] + 4 * frac[2]
    expect(sample(hexagonal_frac_to_cart([...frac]))).toBeCloseTo(expected, 10)
  })

  test(`accounts for volume origin offset`, () => {
    const origin: Vec3 = [3, -2, 5]
    const sample = create_volume_sampler(linear_volume(11, cubic, false, origin))
    // Absolute Cartesian = origin + frac·lattice; frac (0.5, 0.5, 0.5) → 3.5
    expect(sample([3 + 5, -2 + 5, 5 + 5])).toBeCloseTo(3.5, 10)
    // Sampling at the raw fractional position (ignoring origin) gives a different value
    expect(sample([5, 5, 5])).not.toBeCloseTo(3.5, 3)
  })

  test(`wraps periodically outside the cell and stays continuous across the boundary`, () => {
    const linear = create_volume_sampler(linear_volume(10, cubic, true))
    const inside = linear([2.5, 5, 7.5])
    // One lattice vector away in each direction must give identical values
    expect(linear([12.5, 5, 7.5])).toBeCloseTo(inside, 10)
    expect(linear([2.5, -5, 7.5])).toBeCloseTo(inside, 10)
    expect(linear([2.5, 5, 27.5])).toBeCloseTo(inside, 10)

    // Smooth periodic field: cos(2π fx)
    const n_pts = 32
    const grid = make_grid(n_pts, n_pts, n_pts, (ix) => Math.cos((2 * Math.PI * ix) / n_pts))
    const cos = create_volume_sampler(make_volume(grid, { lattice: cubic, periodic: true }))
    expect(Math.abs(cos([9.999, 5, 5]) - cos([0.001, 5, 5]))).toBeLessThan(0.01)
  })

  test.each([
    { position: [15, 5, 5] as Vec3, expected: 4 }, // x→1; y=z=0.5 → 1+2
    { position: [-3, 5, 5] as Vec3, expected: 3 }, // x→0; y=z=0.5 → 1+2
  ])(`clamp policy samples nearest edge at $position`, ({ position, expected }) => {
    const sample = create_volume_sampler(linear_volume(11, cubic, false), {
      out_of_bounds: `clamp`,
    })
    // x clamps to 0 or 1; y=z=0.5 contribute 1 + 2 = 3
    expect(sample(position)).toBeCloseTo(expected, 10)
  })

  test(`fallback policy returns NaN out of bounds, values inside, and tolerates tiny overshoot`, () => {
    const sample = create_volume_sampler(linear_volume(11, cubic, false), {
      out_of_bounds: `fallback`,
    })
    expect(sample([15, 5, 5])).toBeNaN()
    expect(sample([5, -1, 5])).toBeNaN()
    expect(sample([5, 5, 5])).toBeCloseTo(3.5, 10)
    // Within ~1e-6 frac overshoot still samples; beyond falls back
    expect(sample([10 + 1e-7, 10, 10])).toBeCloseTo(7, 6)
    expect(sample([-1e-7, 0, 0])).toBeCloseTo(0, 6)
    // Just outside the boundary tolerance (frac overshoot > 1e-6) falls back
    expect(sample([10 + 1e-4, 10, 10])).toBeNaN()
    expect(sample([-1e-4, 0, 0])).toBeNaN()
  })
})

describe(`sample_volume_at_positions`, () => {
  test(`samples flat position triplets and preserves NaN markers`, () => {
    const scalars = sample_volume_at_positions(
      linear_volume(11, cubic, false),
      new Float32Array([5, 5, 5, 0, 0, 0, 50, 5, 5]),
      { out_of_bounds: `fallback` },
    )
    expect(scalars).toHaveLength(3)
    expect(scalars[0]).toBeCloseTo(3.5, 5)
    expect(scalars[1]).toBeCloseTo(0, 5)
    expect(scalars[2]).toBeNaN()
  })

  test(`matches scalar sampling while applying an offset and reusing output`, () => {
    const origin: Vec3 = [2, 3, 4]
    const vol = linear_volume(11, hexagonal, false, origin)
    const positions = new Float64Array([2, 1, 3, 0, 0, 0, -10, 0, 0])
    const output = new Float32Array(3)
    const scalars = sample_volume_at_positions(vol, positions, {
      out_of_bounds: `fallback`,
      position_offset: origin,
      out: output,
    })
    const sample = create_volume_sampler(vol, { out_of_bounds: `fallback` })

    expect(scalars).toBe(output)
    for (let point_idx = 0; point_idx < positions.length / 3; point_idx++) {
      const position_idx = point_idx * 3
      const expected = sample([
        positions[position_idx] + origin[0],
        positions[position_idx + 1] + origin[1],
        positions[position_idx + 2] + origin[2],
      ])
      if (Number.isNaN(expected)) expect(scalars[point_idx]).toBeNaN()
      else expect(scalars[point_idx]).toBeCloseTo(expected, 5)
    }
  })

  test.each([
    {
      label: `empty dims`,
      vol: () => make_volume([], { lattice: cubic, periodic: false }),
      positions: [1, 2, 3, 4, 5, 6],
      expected: [0, 0],
    },
    {
      label: `singleton cell`,
      vol: () => make_volume([[[42]]], { lattice: cubic, periodic: false }),
      positions: [0, 0, 0, 5, 5, 5],
      expected: [42, 42],
    },
  ])(`handles $label grids`, ({ vol, positions, expected }) => {
    expect([...sample_volume_at_positions(vol(), new Float32Array(positions))]).toEqual(
      expected,
    )
  })
})

describe(`create_volume_sampler reads the current volume fields`, () => {
  // Pin lattice, origin, and periodic so a future cache keyed on volume identity
  // that misses one of them fails a test
  test.each([
    [
      `lattice`,
      () => linear_volume(11, cubic, false),
      [5, 5, 5],
      3.5, // frac (0.5, 0.5, 0.5)
      (vol: VolumetricData) =>
        (vol.lattice = [
          [20, 0, 0],
          [0, 20, 0],
          [0, 0, 20],
        ]),
      1.75, // frac (0.25, 0.25, 0.25)
    ],
    [
      `origin`,
      () => linear_volume(11, cubic, false),
      [5, 5, 5],
      3.5,
      (vol: VolumetricData): void => {
        vol.origin = [5, 5, 5]
      },
      0, // cart [5,5,5] - origin [5,5,5] -> frac (0, 0, 0)
    ],
    [
      `periodic`,
      () => linear_volume(10, cubic, true),
      [15, 5, 5],
      3.5, // frac (1.5, .5, .5) wraps to (.5, .5, .5) -> index (5, 5, 5)
      (vol: VolumetricData): void => {
        vol.periodic = false
      },
      3.6, // clamped frac (1, .5, .5) -> index (9, 4.5, 4.5)
    ],
  ] as const)(
    `follows a %s change on the same volume object`,
    (_field, make, at, before, mutate, after) => {
      const vol = make()
      const point = at as [number, number, number]
      expect(create_volume_sampler(vol)(point)).toBeCloseTo(before, 10)
      mutate(vol)
      expect(create_volume_sampler(vol)(point)).toBeCloseTo(after, 10)
    },
  )
})

describe(`compare_volume_grids`, () => {
  const base = () => linear_volume(11, cubic, false)

  test.each([
    [11, false],
    [10, true],
  ] as const)(`matching size=%i periodic=%s grids are compatible`, (size, periodic) => {
    expect(
      compare_volume_grids(
        linear_volume(size, cubic, periodic),
        linear_volume(size, cubic, periodic),
      ),
    ).toEqual({ ok: true })
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

  test(`origin and voxel tolerances use per-voxel distance`, () => {
    const near_origin = linear_volume(11, cubic, false, [1e-6, 0, 0])
    expect(compare_volume_grids(base(), near_origin).ok).toBe(true)
    expect(compare_volume_grids(base(), near_origin, { tolerance: 1e-8 }).ok).toBe(false)

    // 11 finite points → divisor 10: a 5e-4 lattice delta is a 5e-5 voxel delta
    // (within the 1e-4 tolerance), while 2e-3 → 2e-4 exceeds it
    const near_voxel = linear_volume(
      11,
      [
        [10.0005, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      false,
    )
    const far_voxel = linear_volume(
      11,
      [
        [10.002, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      false,
    )
    expect(compare_volume_grids(base(), near_voxel).ok).toBe(true)
    expect(compare_volume_grids(base(), far_voxel).ok).toBe(false)
  })
})

describe(`sanitize_display_range`, () => {
  test.each([
    {
      label: `invalid axes → [0,1], keep valid`,
      range: [
        [NaN, 2],
        [0.5, 0.5],
        [-0.15, 2.15],
      ] as DisplayRange,
      periodic: true,
      expected: [
        [0, 1],
        [0, 1],
        [-0.15, 2.15],
      ],
    },
    {
      label: `non-periodic clamps to [0,1]`,
      range: [
        [-0.5, 1.5],
        [0.2, 0.8],
        [0, 1],
      ] as DisplayRange,
      periodic: false,
      expected: [
        [0, 1],
        [0.2, 0.8],
        [0, 1],
      ],
    },
    {
      label: `finite ranges entirely outside → [0,1]`,
      range: [
        [2, 3],
        [-3, -2],
        [0.2, 0.8],
      ] as DisplayRange,
      periodic: false,
      expected: [
        [0, 1],
        [0, 1],
        [0.2, 0.8],
      ],
    },
  ])(`$label`, ({ range, periodic, expected }) => {
    expect(sanitize_display_range(range, periodic)).toEqual(expected)
  })
})

describe(`resolve_volume_display_range`, () => {
  test(`periodic integer tiling becomes an endpoint-inclusive extraction range`, () => {
    expect(
      resolve_volume_display_range(linear_volume(10, cubic, true), { tiling: [2, 3, 1] }),
    ).toEqual([
      [0, 2],
      [0, 3],
      [0, 1],
    ])
  })

  test(`explicit periodic range overrides atom tiling and includes halo`, () => {
    expect(
      resolve_volume_display_range(linear_volume(10, cubic, true), {
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
    expect(extracted.dims).toEqual([21, 11, 11])
    // Sample 13 sits at fx = 1.3 → wraps to grid index 3 → exact value 0.3
    expect(grid_value(extracted, 13, 0, 0)).toBeCloseTo(0.3, 10)
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
    const { positions } = marching_cubes(extracted, isovalue, extracted.lattice, {
      periodic: false,
      normals: false,
    })
    const sample = create_volume_sampler(volume)

    expect(positions.length).toBeGreaterThan(0)
    for (let idx = 0; idx < positions.length; idx += 3) {
      const vertex: Vec3 = [positions[idx], positions[idx + 1], positions[idx + 2]]
      // Float32 vertex rounding (~1e-7) times the field gradient (≤ ~0.8/Å) stays under 1e-5
      expect(sample(vertex)).toBeCloseTo(isovalue, 4)
    }
  })

  test(`fractional bounds clip exactly at the requested coordinates`, () => {
    const extracted = extract_volume_range(periodic_vol(), [
      [-0.15, 2.15],
      [0, 1],
      [0, 1],
    ])
    expect(extracted.dims[0]).toBe(24) // round(2.3 * 10) + 1
    // First/last planes wrap: fx=-0.15→0.85, fx=2.15→0.15
    // First plane sits at fx = -0.15 → wraps to 0.85 → interpolated value 0.85
    expect(grid_value(extracted, 0, 0, 0)).toBeCloseTo(0.85, 10)
    // Last plane sits at fx = 2.15 → wraps to 0.15
    expect(grid_value(extracted, 23, 0, 0)).toBeCloseTo(0.15, 10)
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
    const [nx, ny, nz] = extracted.dims
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
    // Values still wrap correctly: first plane at fx = -0.5 → grid value 0.5
    expect(extracted.origin).toEqual([3 - 5, -2, 5]) // -0.5 * 10 along x
    expect(grid_value(extracted, 0, 0, 0)).toBeCloseTo(0.5, 10) // fx=-0.5 → 0.5
  })

  test(`non-periodic volumes are cropped, never repeated`, () => {
    const extracted = extract_volume_range(linear_volume(11, cubic, false), [
      [-1, 3],
      [0, 0.5],
      [0, 1],
    ])
    // x clamps to [0, 1]; y crops to half the cell
    expect(extracted.lattice[0][0]).toBeCloseTo(10)
    expect(extracted.lattice[1][1]).toBeCloseTo(5)
    expect(grid_value(extracted, 0, 0, 0)).toBeCloseTo(0, 10)
    const [nx, ny] = extracted.dims
    expect(extracted.dims).toEqual([11, 6, 11])
    // Endpoint values match the source field at the crop bounds
    expect(grid_value(extracted, nx - 1, 0, 0)).toBeCloseTo(1, 10)
    expect(grid_value(extracted, 0, ny - 1, 0)).toBeCloseTo(1, 10) // 2 * 0.5
  })
})
