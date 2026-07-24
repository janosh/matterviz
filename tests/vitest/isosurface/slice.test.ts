// Tests for HKL plane slicing and trilinear interpolation
import { trilinear_interpolate } from '$lib/isosurface/sampling'
import {
  type CartesianPlane,
  type PlaneSliceOptions,
  resolve_slice_cartesian_point,
  sample_hkl_slice,
  sample_plane_slice,
  volume_center,
} from '$lib/isosurface/slice'
import { create_volume_slice_settings } from '$lib/isosurface/slice-settings'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { cubic_matrix, make_grid, make_linear_volume, make_volume } from '../setup'

// Helper: assert result is non-null and return narrowed type
function expect_slice(result: ReturnType<typeof sample_hkl_slice>) {
  expect(result).not.toBeNull()
  if (!result) throw new Error(`expected non-null slice result`)
  return result
}

describe(`trilinear_interpolate`, () => {
  test(`returns exact value at grid points`, () => {
    const grid = make_grid(4, 4, 4, (ix, iy, iz) => ix * 100 + iy * 10 + iz)
    // Grid point (1, 2, 3) → value 123, at fractional (1/3, 2/3, 1) for periodic
    // For periodic: gx = fx * nx, so fx = ix/nx
    expect(trilinear_interpolate(grid, 0, 0, 0, true)).toBeCloseTo(0)
    expect(trilinear_interpolate(grid, 0.25, 0.5, 0.75, true)).toBeCloseTo(123)
  })

  test(`interpolates between grid points`, () => {
    // Linear gradient along x: value = ix
    const grid = make_grid(4, 4, 4, (ix) => ix)
    // Midpoint between ix=1 (val=1) and ix=2 (val=2) → 1.5
    // Periodic: fx = 1.5/4 = 0.375
    expect(trilinear_interpolate(grid, 0.375, 0, 0, true)).toBeCloseTo(1.5)
  })

  test(`returns uniform value for uniform grid`, () => {
    const grid = make_grid(3, 3, 3, () => 42)
    expect(trilinear_interpolate(grid, 0.3, 0.7, 0.1, true)).toBeCloseTo(42)
    expect(trilinear_interpolate(grid, 0.99, 0.01, 0.5, true)).toBeCloseTo(42)
  })

  test(`periodic grid wraps at boundaries`, () => {
    const grid = make_grid(4, 4, 4, (ix) => ix)
    // fx = -0.25 wraps to 0.75 (periodic), gx = 0.75*4 = 3 → value 3
    expect(trilinear_interpolate(grid, -0.25, 0, 0, true)).toBeCloseTo(3)
  })

  test(`non-periodic grid returns 0 for out-of-bounds`, () => {
    const grid = make_grid(4, 4, 4, () => 10)
    expect(trilinear_interpolate(grid, -0.1, 0.5, 0.5, false)).toBe(0)
    expect(trilinear_interpolate(grid, 0.5, 1.1, 0.5, false)).toBe(0)
  })

  test(`non-periodic grid interpolates within bounds`, () => {
    const grid = make_grid(4, 4, 4, (ix) => ix)
    // Non-periodic: gx = fx * (nx-1) = 0.5 * 3 = 1.5 → between ix=1 and ix=2 → 1.5
    expect(trilinear_interpolate(grid, 0.5, 0, 0, false)).toBeCloseTo(1.5)
  })

  test(`non-periodic grid is exact and continuous at the upper boundary`, () => {
    const grid = make_grid(4, 4, 4, (ix) => ix)
    // fx=1 must hit grid[3]=3 (floor-based xd gave grid[nx-2]=2, vs f(0.999)≈2.997)
    expect(trilinear_interpolate(grid, 1, 0, 0, false)).toBe(3)
    expect(trilinear_interpolate(grid, 0.999, 0, 0, false)).toBeCloseTo(2.997)
    const grid_y = make_grid(4, 4, 4, (_ix, iy) => iy)
    const grid_z = make_grid(4, 4, 4, (_ix, _iy, iz) => iz)
    expect(trilinear_interpolate(grid_y, 0, 1, 0, false)).toBe(3)
    expect(trilinear_interpolate(grid_z, 0, 0, 1, false)).toBe(3)
  })

  test(`returns 0 for empty grid`, () => {
    expect(trilinear_interpolate([], 0.5, 0.5, 0.5, true)).toBe(0)
  })
})

describe(`sample_hkl_slice`, () => {
  // Cubic 5A cell with a 4x4x4 grid where value = iz (gradient along z)
  const z_gradient = make_volume(make_grid(4, 4, 4, (_ix, _iy, iz) => iz))

  test(`returns null for h=k=l=0`, () => {
    expect(sample_hkl_slice(z_gradient, [0, 0, 0], 0.5)).toBeNull()
  })

  test(`(001) slice produces non-empty result with correct data length`, () => {
    const result = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.5))
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(result.data).toHaveLength(result.width * result.height)
  })

  test(`(001) slice at d=0.2 has lower values than d=0.8 for z-gradient`, () => {
    const low = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.2))
    const high = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.8))
    // Mean of low slice should be less than mean of high slice (z-gradient increases with z)
    const mean = (data: Float64Array) => data.reduce((sum, val) => sum + val, 0) / data.length
    expect(mean(low.data)).toBeLessThan(mean(high.data))
  })

  test(`(100) slice produces different values than (001) for z-gradient`, () => {
    const z_slice = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.5))
    const x_slice = expect_slice(sample_hkl_slice(z_gradient, [1, 0, 0], 0.5))
    // z-gradient sampled along z should be ~constant (same z for all points)
    // z-gradient sampled along x should show variation (different z values visible)
    const std_dev = (data: Float64Array) => {
      const avg = data.reduce((sum, val) => sum + val, 0) / data.length
      return Math.sqrt(data.reduce((sum, val) => sum + (val - avg) ** 2, 0) / data.length)
    }
    // x-slice should have more variation since it cuts across z values
    expect(std_dev(x_slice.data)).toBeGreaterThan(std_dev(z_slice.data))
  })

  test(`min and max are consistent with data`, () => {
    const result = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.5))
    let [actual_min, actual_max] = [Infinity, -Infinity]
    for (const val of result.data) {
      if (val < actual_min) actual_min = val
      if (val > actual_max) actual_max = val
    }
    expect(result.min).toBe(actual_min)
    expect(result.max).toBe(actual_max)
  })

  test(`(110) diagonal slice has correct dimensions`, () => {
    const result = expect_slice(sample_hkl_slice(z_gradient, [1, 1, 0], 0.5))
    // Resolution should be max(nx, ny, nz) = 4
    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
  })

  test(`works with non-cubic lattice`, () => {
    const hex_lattice: Matrix3x3 = [
      [2.5, 0, 0],
      [1.25, 2.165, 0],
      [0, 0, 6.66],
    ]
    const vol = make_volume(
      make_grid(4, 4, 4, (ix) => ix),
      { lattice: hex_lattice },
    )
    const result = expect_slice(sample_hkl_slice(vol, [0, 0, 1], 0.5))
    expect(result.data).toHaveLength(result.width * result.height)
  })

  test(`non-periodic volume with out-of-bounds plane returns zeros at edges`, () => {
    const vol = make_volume(
      make_grid(4, 4, 4, () => 5),
      { periodic: false },
    )
    const result = expect_slice(sample_hkl_slice(vol, [0, 0, 1], 0.5))
    // Interior should have value 5, edges may have 0 if they extend beyond [0,1]
    const nonzero = result.data.filter((val) => val > 0).length
    expect(nonzero).toBeGreaterThan(0)
  })
})

describe(`Cartesian slice point helpers`, () => {
  const volume = make_volume([[[0]]], {
    lattice: [
      [2, 0, 0],
      [1, 4, 0],
      [0.5, 1, 6],
    ],
    origin: [10, -2, 5],
  })
  const expected_center: Vec3 = [11.75, 0.5, 8]

  test(`converts the fractional volume center into absolute Cartesian coordinates`, () => {
    expect(volume_center(volume)).toEqual(expected_center)
  })

  test(`preserves a provided Cartesian point`, () => {
    const point: Vec3 = [7, 8, 9]
    expect(resolve_slice_cartesian_point(point, volume)).toBe(point)
  })

  test.each([
    [`volume center`, volume, expected_center],
    [`Cartesian origin`, undefined, [0, 0, 0] as Vec3],
  ])(`defaults an omitted point to the %s`, (_fallback, fallback_volume, expected) => {
    expect(resolve_slice_cartesian_point(undefined, fallback_volume)).toEqual(expected)
  })
})

test(`slice settings factory returns independent nested values`, () => {
  const first = create_volume_slice_settings()
  const second = create_volume_slice_settings({ miller_indices: [1, 1, 0] })

  first.miller_indices[0] = 9
  first.cartesian_normal[2] = 4

  expect(second.miller_indices).toEqual([1, 1, 0])
  expect(second.cartesian_normal).toEqual([0, 0, 1])
  expect(create_volume_slice_settings().miller_indices).toEqual([0, 0, 1])
  expect(create_volume_slice_settings({ resolution: undefined }).resolution).toBe(512)
})

describe(`sample_plane_slice`, () => {
  const linear_volume = (lattice: Matrix3x3, origin: Vec3 = [0, 0, 0], periodic = false) =>
    make_linear_volume(11, lattice, periodic, origin)

  const cubic = cubic_matrix(10)
  const plane_slice = (
    plane: CartesianPlane,
    options: PlaneSliceOptions = {},
    volume = linear_volume(cubic),
  ) => expect_slice(sample_plane_slice(volume, plane, options))

  test(`samples an absolute Cartesian plane with a non-zero volume origin`, () => {
    const result = plane_slice(
      { point: [8, 3, 10], normal: [0, 0, 1], up: [1, 0, 0] },
      { resolution: [5, 5] },
      linear_volume(cubic, [3, -2, 5]),
    )

    expect(result.mask.every((value) => value === 1)).toBe(true)
    expect(result.data[0]).toBeCloseTo(2, 10)
    expect(result.data.at(-1)).toBeCloseTo(5, 10)
    expect(result.min).toBeCloseTo(2, 10)
    expect(result.max).toBeCloseTo(5, 10)
  })

  test(`masks the exact cell cross-section instead of inventing zero values`, () => {
    const result = plane_slice(
      { point: [5, 5, 5], normal: [1, 1, 1] },
      { resolution: [31, 31] },
    )
    const inside_count = result.mask.filter(Boolean).length

    expect(inside_count).toBeGreaterThan(0)
    expect(inside_count).toBeLessThan(result.mask.length)
    for (let data_idx = 0; data_idx < result.data.length; data_idx++) {
      expect(Number.isNaN(result.data[data_idx])).toBe(result.mask[data_idx] === 0)
    }
  })

  test(`preserves aspect ratio and enforces the pixel budget`, () => {
    const volume = linear_volume([
      [10, 0, 0],
      [0, 2, 0],
      [0, 0, 1],
    ])
    const plane: CartesianPlane = {
      point: [5, 1, 0.5],
      normal: [0, 0, 1],
      up: [1, 0, 0],
    }
    const result = plane_slice(plane, { resolution: 100, max_pixels: Number.NaN }, volume)

    expect(result.width).toBe(100)
    expect(result.height).toBe(20)
    expect(result.u_range[1] - result.u_range[0]).toBeCloseTo(10)
    expect(result.v_range[1] - result.v_range[0]).toBeCloseTo(2)
    const capped = plane_slice(plane, { resolution: [1_000_000, 2], max_pixels: 100 }, volume)
    expect(capped.width * capped.height).toBeLessThanOrEqual(100)
  })

  test.each([
    { point: [20, 20, 20] as Vec3, normal: [1, 1, 1] as Vec3 },
    { point: [5, 5, 5] as Vec3, normal: [0, 0, 0] as Vec3 },
    { point: [NaN, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 },
  ])(`returns null for a non-intersecting or invalid plane`, ({ point, normal }) => {
    expect(sample_plane_slice(linear_volume(cubic), { point, normal })).toBeNull()
  })

  test(`supports repeated fractional bounds for periodic slices`, () => {
    const result = plane_slice(
      { point: [15, 5, 5], normal: [1, 0, 0], up: [0, 1, 0] },
      {
        resolution: [7, 7],
        fractional_bounds: [
          [1, 2],
          [0, 1],
          [0, 1],
        ],
      },
      linear_volume(cubic, [0, 0, 0], true),
    )

    expect(result.mask.every((value) => value === 1)).toBe(true)
    expect(result.data[Math.floor(result.data.length / 2)]).toBeCloseTo(3.5, 8)
  })

  test(`HKL adapter matches the corresponding Cartesian plane for shifted volumes`, () => {
    const volume = linear_volume(cubic, [3, -2, 5])
    const hkl_result = expect_slice(sample_hkl_slice(volume, [0, 0, 1], 0.5, 9))
    const cartesian_result = plane_slice(
      { point: [0, 0, 10], normal: [0, 0, 1] },
      { resolution: [9, 9] },
      volume,
    )

    expect(hkl_result.data).toEqual(cartesian_result.data)
    expect(hkl_result.mask).toEqual(cartesian_result.mask)
  })
})
