// Tests for HKL plane slicing and trilinear interpolation
import { sample_hkl_slice, trilinear_interpolate } from '$lib/isosurface/slice'
import type { VolumetricData } from '$lib/isosurface/types'
import type { Matrix3x3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

// Helper: create a 3D grid filled with a function f(ix, iy, iz)
const make_grid = (
  nx: number,
  ny: number,
  nz: number,
  fill_fn: (ix: number, iy: number, iz: number) => number,
): number[][][] =>
  Array.from(
    { length: nx },
    (_, ix) =>
      Array.from({ length: ny }, (_, iy) =>
        Array.from({ length: nz }, (_, iz) => fill_fn(ix, iy, iz))),
  )

// Helper: create a minimal VolumetricData for testing
function make_volume(
  grid: number[][][],
  lattice: Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
  periodic = true,
): VolumetricData {
  const nx = grid.length
  const ny = grid[0]?.length ?? 0
  const nz = grid[0]?.[0]?.length ?? 0
  return {
    grid,
    grid_dims: [nx, ny, nz],
    lattice,
    origin: [0, 0, 0],
    data_range: { min: 0, max: 1, abs_max: 1, mean: 0.5 },
    periodic,
  }
}

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
    expect(result.data.length).toBe(result.width * result.height)
  })

  test(`(001) slice at d=0.2 has lower values than d=0.8 for z-gradient`, () => {
    const low = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.2))
    const high = expect_slice(sample_hkl_slice(z_gradient, [0, 0, 1], 0.8))
    // Mean of low slice should be less than mean of high slice (z-gradient increases with z)
    const mean = (data: Float64Array) =>
      data.reduce((sum, val) => sum + val, 0) / data.length
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
    let actual_min = Infinity
    let actual_max = -Infinity
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
    const hex_lattice: Matrix3x3 = [[2.5, 0, 0], [1.25, 2.165, 0], [0, 0, 6.66]]
    const vol = make_volume(make_grid(4, 4, 4, (ix) => ix), hex_lattice)
    const result = expect_slice(sample_hkl_slice(vol, [0, 0, 1], 0.5))
    expect(result.data.length).toBe(result.width * result.height)
  })

  test(`non-periodic volume with out-of-bounds plane returns zeros at edges`, () => {
    const vol = make_volume(make_grid(4, 4, 4, () => 5), [[5, 0, 0], [0, 5, 0], [
      0,
      0,
      5,
    ]], false)
    const result = expect_slice(sample_hkl_slice(vol, [0, 0, 1], 0.5))
    // Interior should have value 5, edges may have 0 if they extend beyond [0,1]
    const nonzero = result.data.filter((val) => val > 0).length
    expect(nonzero).toBeGreaterThan(0)
  })
})
