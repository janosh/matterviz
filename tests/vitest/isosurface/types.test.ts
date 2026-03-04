// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  DEFAULT_ISOSURFACE_SETTINGS,
  downsample_grid,
  generate_layers,
  grid_data_range,
  LAYER_COLORS,
} from '$lib/isosurface/types'
import type { Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

describe(`grid_data_range`, () => {
  test.each([
    {
      grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
      min: 1,
      max: 8,
      abs_max: 8,
      mean: 4.5,
      label: `all-positive`,
    },
    {
      grid: [[[-5, 2], [3, -1]], [[0, 6], [-7, 4]]],
      min: -7,
      max: 6,
      abs_max: 7,
      mean: 0.25,
      label: `mixed pos/neg`,
    },
    {
      grid: [[[-10, 1]]],
      min: -10,
      max: 1,
      abs_max: 10,
      mean: -4.5,
      label: `abs_max driven by min`,
    },
    {
      grid: [[[0, 0], [0, 0]]],
      min: 0,
      max: 0,
      abs_max: 0,
      mean: 0,
      label: `uniform zero`,
    },
    { grid: [[[42]]], min: 42, max: 42, abs_max: 42, mean: 42, label: `single element` },
    {
      grid: [[[-3.5]]],
      min: -3.5,
      max: -3.5,
      abs_max: 3.5,
      mean: -3.5,
      label: `single negative`,
    },
    { grid: [], min: 0, max: 0, abs_max: 0, mean: 0, label: `empty grid` },
    { grid: [[]], min: 0, max: 0, abs_max: 0, mean: 0, label: `empty planes` },
  ])(
    `$label: min=$min max=$max abs_max=$abs_max mean=$mean`,
    ({ grid, min, max, abs_max, mean }) => {
      const range = grid_data_range(grid)
      expect(range.min).toBe(min)
      expect(range.max).toBe(max)
      expect(range.abs_max).toBe(abs_max)
      expect(range.mean).toBeCloseTo(mean)
    },
  )
})

describe(`DEFAULT_ISOSURFACE_SETTINGS`, () => {
  test(`has expected default values and no removed fields`, () => {
    expect(DEFAULT_ISOSURFACE_SETTINGS.isovalue).toBe(0.05)
    expect(DEFAULT_ISOSURFACE_SETTINGS.opacity).toBe(0.6)
    expect(DEFAULT_ISOSURFACE_SETTINGS.show_negative).toBe(false)
    expect(DEFAULT_ISOSURFACE_SETTINGS.wireframe).toBe(false)
    expect(DEFAULT_ISOSURFACE_SETTINGS.positive_color).toBe(`#3b82f6`)
    expect(DEFAULT_ISOSURFACE_SETTINGS.negative_color).toBe(`#ef4444`)
  })
})

describe(`auto_isosurface_settings`, () => {
  test.each([
    { min: 0, abs_max: 10, show_neg: false, label: `positive-only` },
    { min: -5, abs_max: 10, show_neg: true, label: `significant negatives` },
    { min: -5, abs_max: 5, show_neg: true, label: `symmetric ±` },
    {
      min: -0.005,
      abs_max: 1,
      show_neg: false,
      label: `tiny negatives below 1% threshold`,
    },
  ])(
    `$label: isovalue=20% of abs_max, show_negative=$show_neg`,
    ({ min, abs_max, show_neg }) => {
      const settings = auto_isosurface_settings({ min, max: abs_max, abs_max, mean: 0 })
      expect(settings.isovalue).toBeCloseTo(abs_max * 0.2)
      expect(settings.show_negative).toBe(show_neg)
    },
  )

  test(`falls back to default isovalue for all-zero grid`, () => {
    const settings = auto_isosurface_settings({ min: 0, max: 0, abs_max: 0, mean: 0 })
    expect(settings.isovalue).toBe(DEFAULT_ISOSURFACE_SETTINGS.isovalue)
    expect(settings.show_negative).toBe(false)
  })

  test(`preserves default opacity, colors, and wireframe`, () => {
    const settings = auto_isosurface_settings({ min: 1, max: 3, abs_max: 3, mean: 2 })
    expect(settings.opacity).toBe(DEFAULT_ISOSURFACE_SETTINGS.opacity)
    expect(settings.positive_color).toBe(DEFAULT_ISOSURFACE_SETTINGS.positive_color)
    expect(settings.negative_color).toBe(DEFAULT_ISOSURFACE_SETTINGS.negative_color)
    expect(settings.wireframe).toBe(DEFAULT_ISOSURFACE_SETTINGS.wireframe)
  })

  test(`returns a fresh object (not a reference to DEFAULT_ISOSURFACE_SETTINGS)`, () => {
    const settings = auto_isosurface_settings({ min: 0, max: 10, abs_max: 10, mean: 5 })
    expect(settings).not.toBe(DEFAULT_ISOSURFACE_SETTINGS)
    // Mutating the result should not affect defaults
    settings.isovalue = 999
    expect(DEFAULT_ISOSURFACE_SETTINGS.isovalue).toBe(0.05)
  })
})

describe(`generate_layers`, () => {
  const range = { min: 0, max: 10, abs_max: 10, mean: 5 }

  test.each([1, 2, 3, 5])(
    `generates %i layers with correct count and palette colors`,
    (count) => {
      const layers = generate_layers(range, count)
      expect(layers).toHaveLength(count)
      for (let idx = 0; idx < count; idx++) {
        expect(layers[idx].color).toBe(LAYER_COLORS[idx % LAYER_COLORS.length])
        expect(layers[idx].visible).toBe(true)
        expect(layers[idx].isovalue).toBeGreaterThan(0)
        expect(layers[idx].isovalue).toBeLessThanOrEqual(range.abs_max)
        expect(layers[idx].opacity).toBeGreaterThan(0)
        expect(layers[idx].opacity).toBeLessThanOrEqual(1)
      }
    },
  )

  test(`single layer uses 20% of abs_max`, () => {
    const [layer] = generate_layers(range, 1)
    expect(layer.isovalue).toBeCloseTo(10 * 0.2)
  })

  test(`layers are ordered from inner (highest isovalue) to outer (lowest)`, () => {
    const layers = generate_layers(range, 4)
    for (let idx = 1; idx < layers.length; idx++) {
      expect(layers[idx].isovalue).toBeLessThan(layers[idx - 1].isovalue)
    }
  })

  test(`outer layers have lower opacity than inner layers`, () => {
    const layers = generate_layers(range, 3)
    for (let idx = 1; idx < layers.length; idx++) {
      expect(layers[idx].opacity).toBeLessThan(layers[idx - 1].opacity)
    }
  })

  test(`returns empty array for zero abs_max`, () => {
    expect(generate_layers({ min: 0, max: 0, abs_max: 0, mean: 0 }, 3)).toEqual([])
  })

  test(`returns empty array for n_layers <= 0`, () => {
    expect(generate_layers(range, 0)).toEqual([])
    expect(generate_layers(range, -1)).toEqual([])
  })

  test(`enables show_negative for data with significant negatives`, () => {
    const neg_range = { min: -5, max: 10, abs_max: 10, mean: 2 }
    const layers = generate_layers(neg_range, 2)
    expect(layers.every((layer) => layer.show_negative)).toBe(true)
  })
})

describe(`LAYER_COLORS`, () => {
  test(`has at least 8 distinct colors`, () => {
    expect(LAYER_COLORS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(LAYER_COLORS).size).toBe(LAYER_COLORS.length)
  })
})

// Helper to build a 3D grid filled with a constant or computed value
function make_grid(
  nx: number,
  ny: number,
  nz: number,
  fill: number | ((ix: number, iy: number, iz: number) => number) = 1,
): number[][][] {
  return Array.from(
    { length: nx },
    (_, ix) =>
      Array.from(
        { length: ny },
        (_, iy) =>
          Array.from({ length: nz }, (_, iz) =>
            typeof fill === `function` ? fill(ix, iy, iz) : fill),
      ),
  )
}

describe(`downsample_grid`, () => {
  test(`returns original grid unchanged when under budget`, () => {
    const grid = make_grid(10, 10, 10)
    const dims: Vec3 = [10, 10, 10]
    const result = downsample_grid(grid, dims)
    expect(result.factor).toBe(1)
    expect(result.grid).toBe(grid) // same reference, no copy
    expect(result.dims).toBe(dims)
  })

  test(`downsamples a large uniform grid`, () => {
    const grid = make_grid(100, 100, 100, 5)
    const result = downsample_grid(grid, [100, 100, 100])
    expect(result.factor).toBeGreaterThan(1)
    const [rnx, rny, rnz] = result.dims
    expect(rnx * rny * rnz).toBeLessThanOrEqual(500_000)
    // Uniform value should be preserved after averaging
    expect(result.grid[0][0][0]).toBeCloseTo(5)
    expect(result.grid[rnx - 1][rny - 1][rnz - 1]).toBeCloseTo(5)
  })

  test(`preserves average of non-uniform data`, () => {
    // 4x4x4 grid won't be downsampled (64 points), but 100x100x100 will
    const grid = make_grid(100, 100, 100, (ix, iy, iz) => ix + iy + iz)
    const result = downsample_grid(grid, [100, 100, 100])
    expect(result.factor).toBeGreaterThan(1)
    // The global mean of ix+iy+iz on 0..99 = 3 * 49.5 = 148.5
    // Downsampled grid should approximately preserve this
    let sum = 0
    let count = 0
    for (const plane of result.grid) {
      for (const row of plane) {
        for (const val of row) {
          sum += val
          count++
        }
      }
    }
    expect(sum / count).toBeCloseTo(148.5, 0)
  })

  test(`output dims are at least 2 in each direction`, () => {
    // Very large grid in one axis only
    const grid = make_grid(1000, 3, 3)
    const result = downsample_grid(grid, [1000, 3, 3])
    expect(result.dims[0]).toBeGreaterThanOrEqual(2)
    expect(result.dims[1]).toBeGreaterThanOrEqual(2)
    expect(result.dims[2]).toBeGreaterThanOrEqual(2)
  })

  test.each([
    { dims: [80, 80, 96] as Vec3, label: `80x80x96 (614K)` },
    { dims: [120, 48, 144] as Vec3, label: `120x48x144 (829K)` },
    { dims: [200, 200, 200] as Vec3, label: `200x200x200 (8M)` },
  ])(`$label: result stays within 500K budget`, ({ dims }) => {
    const grid = make_grid(dims[0], dims[1], dims[2], 1)
    const result = downsample_grid(grid, dims)
    const [rnx, rny, rnz] = result.dims
    const total = rnx * rny * rnz
    if (dims[0] * dims[1] * dims[2] > 500_000) {
      expect(result.factor).toBeGreaterThan(1)
      expect(total).toBeLessThanOrEqual(500_000)
    }
    expect(result.grid.length).toBe(rnx)
    expect(result.grid[0].length).toBe(rny)
    expect(result.grid[0][0].length).toBe(rnz)
  })
})
