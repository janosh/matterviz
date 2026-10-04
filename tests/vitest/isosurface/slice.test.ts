// Tests for HKL plane slicing and trilinear interpolation
import { create_volume_sampler, trilinear_interpolate } from '#lib/isosurface/sampling.js'
import {
  resolve_slice_cartesian_point,
  sample_hkl_slice,
  sample_plane_slice,
  upsample_volume,
  volume_center,
} from '#lib/isosurface/slice.js'
import type { CartesianPlane, PlaneSliceOptions } from '#lib/isosurface/slice.js'
import { create_volume_slice_settings } from '#lib/isosurface/slice-settings.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { describe, expect, test } from 'vitest'
import { flatten_grid } from '#lib/isosurface/grid.js'
import * as math from '#lib/math.js'
import { cubic_matrix, make_grid, make_linear_volume, make_volume } from '../test-fixtures'

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
  const x_ramp = flat(4, 4, 4, (idx_x) => idx_x)
  const y_ramp = flat(4, 4, 4, (_ix, idx_y) => idx_y)
  const z_ramp = flat(4, 4, 4, (_ix, _iy, idx_z) => idx_z)
  const constant = flat(4, 4, 4, () => 10)
  test.each([
    [
      `grid point (1, 2, 3) of an ix*100 + iy*10 + iz field`,
      flat(4, 4, 4, (idx_x, idx_y, idx_z) => idx_x * 100 + idx_y * 10 + idx_z),
      [0.25, 0.5, 0.75],
      true,
      123,
    ],
    [`midpoint of an x ramp`, x_ramp, [0.375, 0, 0], true, 1.5],
    [`a negative coordinate wrapping to 0.75`, x_ramp, [-0.25, 0, 0], true, 3],
    [`negative multi-cell seam`, x_ramp, [-1.125, 0, 0], true, 1.5],
    [`positive multi-cell seam`, x_ramp, [2.875, 0, 0], true, 1.5],
    [`exact periodic boundary`, x_ramp, [1, 0, 0], true, 0],
    [
      `wrapping all three upper corners`,
      flat(2, 4, 4, (idx_x, idx_y, idx_z) => idx_x * 100 + idx_y * 10 + idx_z),
      [0.75, 0.875, 0.875],
      true,
      66.5,
    ],
    [
      `singleton axes alongside a wrapped axis`,
      flat(1, 2, 1, (_idx_x, idx_y) => idx_y * 10),
      [100.5, 0.75, -123.25],
      true,
      5,
    ],
    [`periodic singleton cell`, flat(1, 1, 1, () => 42), [-3, 2.5, 7.25], true, 42],
    [`the non-periodic midpoint between ix=1 and ix=2`, x_ramp, [0.5, 0, 0], false, 1.5],
    // fx=1 must hit the last point (a floor-based fraction read grid[nx-2] = 2 there)
    [`the non-periodic upper x boundary`, x_ramp, [1, 0, 0], false, 3],
    [
      `the non-periodic last cell just below the boundary`,
      x_ramp,
      [0.875, 0, 0],
      false,
      2.625,
    ],
    [`the non-periodic upper y boundary`, y_ramp, [0, 1, 0], false, 3],
    [`the non-periodic upper z boundary`, z_ramp, [0, 0, 1], false, 3],
    [`a non-periodic point below the grid`, constant, [-0.1, 0.5, 0.5], false, 0],
    [`a non-periodic point above the grid`, constant, [0.5, 1.1, 0.5], false, 0],
    [`an empty grid`, flatten_grid([]), [0.5, 0.5, 0.5], true, 0],
  ] as [string, ReturnType<typeof flat>, Vec3, boolean, number][])(
    `%s`,
    (_label, grid, [frac_x, frac_y, frac_z], periodic, expected) => {
      // Every in-bounds test value is an integer or an exactly representable half-step.
      expect(trilinear_interpolate(grid, frac_x, frac_y, frac_z, periodic)).toBe(expected)
    },
  )
})

describe(`sample_hkl_slice`, () => {
  // Cubic 5A cell with a 4x4x4 grid where value = iz (gradient along z)
  const z_gradient = make_volume(make_grid(4, 4, 4, (_ix, _iy, idx_z) => idx_z))

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
      make_grid(4, 4, 4, (idx_x) => idx_x),
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

// B-spline refinement must keep every grid sample, track a smooth field far better than
// trilinear interpolation between samples, and never leave the data range
test.each([true, false])(`upsample_volume refines smoothly (periodic=%s)`, (periodic) => {
  const dims: Vec3 = [12, 10, 16]
  const divisors = dims.map((size) => (periodic ? size : size - 1))
  const field = (frac_x: number, frac_y: number, frac_z: number) =>
    Math.exp(Math.cos(2 * Math.PI * frac_x) + Math.sin(2 * Math.PI * (frac_y + frac_z)))
  const volume = make_volume(
    make_grid(...dims, (idx_x, idx_y, idx_z) =>
      field(idx_x / divisors[0], idx_y / divisors[1], idx_z / divisors[2]),
    ),
    { lattice: cubic_matrix(1), periodic },
  )
  const fine = upsample_volume(volume, { min_axis_points: 48 })
  const fine_divisors = fine.dims.map((size) => (periodic ? size : size - 1))
  const factors = fine_divisors.map((divisor, axis) => divisor / divisors[axis])
  expect(factors.every((factor) => Number.isInteger(factor) && factor > 1)).toBe(true)
  let [spline_err, trilinear_err] = [0, 0]
  for (const [flat_idx, value] of fine.values.entries()) {
    const fine_idx = [
      Math.floor(flat_idx / (fine.dims[1] * fine.dims[2])),
      Math.floor(flat_idx / fine.dims[2]) % fine.dims[1],
      flat_idx % fine.dims[2],
    ]
    expect(value).toBeGreaterThanOrEqual(volume.data_range.min)
    expect(value).toBeLessThanOrEqual(volume.data_range.max)
    if (fine_idx.every((idx, axis) => idx % factors[axis] === 0)) {
      const [idx_x, idx_y, idx_z] = fine_idx.map((idx, axis) => idx / factors[axis])
      // the prefilter's recursion and exponential tail round to ~1e-15 of values up to e^2
      expect(
        Math.abs(value - volume.values[(idx_x * dims[1] + idx_y) * dims[2] + idx_z]),
      ).toBeLessThan(1e-12)
    }
    const [frac_x, frac_y, frac_z] = fine_idx.map((idx, axis) => idx / fine_divisors[axis])
    // finite grids mirror at their faces, which only fits this field away from them
    if (
      !periodic &&
      [frac_x, frac_y, frac_z].some(
        (frac, axis) => frac < 1 / divisors[axis] || frac > 1 - 1 / divisors[axis],
      )
    )
      continue
    const exact = field(frac_x, frac_y, frac_z)
    spline_err = Math.max(spline_err, Math.abs(value - exact))
    trilinear_err = Math.max(
      trilinear_err,
      Math.abs(trilinear_interpolate(volume, frac_x, frac_y, frac_z, periodic) - exact),
    )
  }
  // measured 3.0e-2 vs 6.3e-1 (periodic) and 1.4e-1 vs 4.5e-1 (finite interior)
  expect(spline_err).toBeLessThan(trilinear_err / (periodic ? 10 : 2.5))
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

  test(`resolves an explicit point, else the volume center, else the Cartesian origin`, () => {
    const point: Vec3 = [7, 8, 9]
    expect(resolve_slice_cartesian_point(point, volume)).toBe(point)
    // the fractional center (0.5, 0.5, 0.5) in absolute Cartesian coordinates
    expect(volume_center(volume)).toEqual([11.75, 0.5, 8])
    expect(resolve_slice_cartesian_point(undefined, volume)).toEqual([11.75, 0.5, 8])
    expect(resolve_slice_cartesian_point(undefined, undefined)).toEqual([0, 0, 0])
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

  // Rows are sampled as per-cell cubics: they must match point-wise trilinear sampling on rough
  // data and a skewed lattice, for wrapped, finite and singleton-axis grids
  test.each([
    [true, [7, 6, 11]],
    [false, [7, 6, 11]],
    [true, [1, 5, 4]],
  ] as [boolean, Vec3][])(
    `matches point-wise sampling (periodic=%s, dims=%j)`,
    (periodic, dims) => {
      const volume = make_volume(
        make_grid(...dims, (idx_x, idx_y, idx_z) =>
          Math.sin(idx_x * 12.9 + idx_y * 78.2 + idx_z * 37.7),
        ),
        {
          lattice: [
            [4, 0, 0],
            [-1.5, 3.5, 0],
            [0.4, 0.3, 6],
          ],
          origin: [0.2, -0.3, 0.5],
          periodic,
        },
      )
      const sample = create_volume_sampler(volume, { out_of_bounds: `fallback` })
      const plane = { point: [1, 1.5, 3] as Vec3, normal: [0.3, 0.5, 1] as Vec3 }
      const { data, mask, width, height, u_range, v_range, u_axis, v_axis } = plane_slice(
        plane,
        { resolution: 97 },
        volume,
      )
      expect(mask.filter(Boolean).length).toBeGreaterThan(1000)
      for (const [data_idx, inside] of mask.entries()) {
        if (!inside) continue
        const u_coord =
          u_range[0] + ((data_idx % width) * (u_range[1] - u_range[0])) / (width - 1)
        const v_coord =
          v_range[0] +
          (Math.floor(data_idx / width) * (v_range[1] - v_range[0])) / (height - 1)
        const position = math.add(
          plane.point,
          math.scale(u_axis, u_coord),
          math.scale(v_axis, v_coord),
        )
        // values span [-1, 1]; the cubic form and nested lerps differ by ~1e-15 in rounding, so
        // 1e-12 leaves headroom without hiding a wrong cell or fraction
        expect(Math.abs(data[data_idx] - sample(position))).toBeLessThan(1e-12)
      }
    },
  )

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
