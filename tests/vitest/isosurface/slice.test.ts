// Tests for HKL plane slicing and trilinear interpolation
import { trilinear_interpolate } from '$lib/isosurface/sampling'
import {
  resolve_slice_cartesian_point,
  sample_hkl_slice,
  sample_plane_slice,
  volume_center,
} from '$lib/isosurface/slice'
import type { CartesianPlane, PlaneSliceOptions } from '$lib/isosurface/slice'
import { create_volume_slice_settings } from '$lib/isosurface/slice-settings'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { flatten_grid } from '$lib/isosurface/grid'
import { cubic_matrix, make_grid, make_linear_volume, make_volume } from '../setup'

// Nested test grids flattened to the z-fastest storage the sampler reads
const flat = (...args: Parameters<typeof make_grid>) => flatten_grid(make_grid(...args))

// Helper: assert result is non-null and return narrowed type
function expect_slice(result: ReturnType<typeof sample_hkl_slice>) {
  expect(result).not.toBeNull()
  if (!result) throw new Error(`expected non-null slice result`)
  return result
}

describe(`trilinear_interpolate`, () => {
  // Periodic: gx = fx * nx, so grid point ix sits at fx = ix / nx and fx wraps modulo 1.
  // Non-periodic: gx = fx * (nx - 1) and anything outside [0, 1] reads 0.
  const x_ramp = flat(4, 4, 4, (ix) => ix)
  test.each([
    [
      `grid point (1, 2, 3) of an ix*100 + iy*10 + iz field`,
      flat(4, 4, 4, (ix, iy, iz) => ix * 100 + iy * 10 + iz),
      [0.25, 0.5, 0.75],
      true,
      123,
    ],
    [`midpoint of an x ramp`, x_ramp, [0.375, 0, 0], true, 1.5],
    [`a negative coordinate wrapping to 0.75`, x_ramp, [-0.25, 0, 0], true, 3],
    [`the non-periodic midpoint between ix=1 and ix=2`, x_ramp, [0.5, 0, 0], false, 1.5],
    [
      `a non-periodic point below the grid`,
      flat(4, 4, 4, () => 10),
      [-0.1, 0.5, 0.5],
      false,
      0,
    ],
    [
      `a non-periodic point above the grid`,
      flat(4, 4, 4, () => 10),
      [0.5, 1.1, 0.5],
      false,
      0,
    ],
  ] as [string, ReturnType<typeof flat>, Vec3, boolean, number][])(
    `%s`,
    (_label, grid, [fx, fy, fz], periodic, expected) => {
      expect(trilinear_interpolate(grid, fx, fy, fz, periodic)).toBeCloseTo(expected)
    },
  )

  test(`non-periodic grid is exact and continuous at the upper boundary`, () => {
    const grid = flat(4, 4, 4, (ix) => ix)
    // fx=1 must hit grid[3]=3 (floor-based xd gave grid[nx-2]=2, vs f(0.999)≈2.997)
    expect(trilinear_interpolate(grid, 1, 0, 0, false)).toBe(3)
    expect(trilinear_interpolate(grid, 0.999, 0, 0, false)).toBeCloseTo(2.997)
    const grid_y = flat(4, 4, 4, (_ix, iy) => iy)
    const grid_z = flat(4, 4, 4, (_ix, _iy, iz) => iz)
    expect(trilinear_interpolate(grid_y, 0, 1, 0, false)).toBe(3)
    expect(trilinear_interpolate(grid_z, 0, 0, 1, false)).toBe(3)
  })

  test(`returns 0 for empty grid`, () => {
    expect(trilinear_interpolate(flatten_grid([]), 0.5, 0.5, 0.5, true)).toBe(0)
  })
})

describe(`sample_hkl_slice`, () => {
  // Cubic 5A cell with a 4x4x4 grid where value = iz (gradient along z)
  const z_gradient = make_volume(make_grid(4, 4, 4, (_ix, _iy, iz) => iz))

  test(`returns null for h=k=l=0`, () => {
    expect(sample_hkl_slice(z_gradient, [0, 0, 0], 0.5)).toBeNull()
  })

  // A (001) plane at fractional distance d reads the periodic z ramp at z = 4d, so d=0.8
  // (z=3.2) interpolates between iz=3 and the wrapped iz=0
  test.each([
    [0.2, 0.8],
    [0.5, 2],
    [0.8, 2.4],
  ])(`(001) slice at d=%s is constant at %s`, (distance, value) => {
    const result = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], distance))
    expect([result.width, result.height]).toEqual([4, 4])
    expect([...result.data].map((val) => Number(val.toFixed(10)))).toEqual(
      Array(16).fill(value),
    )
    expect([result.min, result.max]).toEqual([
      expect.closeTo(value, 10),
      expect.closeTo(value, 10),
    ])
  })

  // Planes containing the z axis sample the ramp at z = 0, 1/3, 2/3, 1 (wrapping to 0) at
  // the max(nx, ny, nz) = 4 resolution
  test.each([[[1, 0, 0]], [[1, 1, 0]]] as [Vec3][])(`%j slice sees the full z ramp`, (hkl) => {
    const result = expect_slice(sample_hkl_slice(z_gradient, hkl, 0.5))
    expect([result.width, result.height]).toEqual([4, 4])
    const rounded = [...result.data].map((val) => Number(val.toFixed(10)))
    const distinct = [...new Set(rounded)].toSorted((val_a, val_b) => val_a - val_b)
    expect(distinct).toEqual([0, expect.closeTo(4 / 3, 10), expect.closeTo(8 / 3, 10)])
    expect([result.min, result.max]).toEqual([0, expect.closeTo(8 / 3, 10)])
  })

  test(`non-cubic lattice: samples outside the cell cross-section are masked as NaN and skipped by min/max`, () => {
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
    // the sheared cell only fills part of its rectangular u/v bounding box
    expect([...result.mask]).toContain(0)
    expect([...result.data].map(Number.isFinite)).toEqual([...result.mask].map(Boolean))
    expect([result.min, result.max]).toEqual([0, expect.closeTo(8 / 3, 10)])
  })

  test(`an in-cell plane through a non-periodic constant volume reads the constant everywhere`, () => {
    const vol = make_volume(
      make_grid(4, 4, 4, () => 5),
      { periodic: false },
    )
    const { data } = expect_slice(sample_hkl_slice(vol, [0, 0, 1], 0.5))
    expect(new Set(data)).toEqual(new Set([5]))
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
  expect(create_volume_slice_settings({ resolution: undefined }).resolution).toBe(1024)
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
