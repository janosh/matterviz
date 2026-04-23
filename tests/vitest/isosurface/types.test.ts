// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  DEFAULT_ISOSURFACE_SETTINGS,
  downsample_grid,
  generate_layers,
  grid_data_range,
  LAYER_COLORS,
  pad_periodic_grid,
  tile_volumetric_data,
  type VolumetricData,
} from '$lib/isosurface/types'
import type { Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

describe(`grid_data_range`, () => {
  test.each([
    {
      grid: [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ],
      min: 1,
      max: 8,
      abs_max: 8,
      mean: 4.5,
      label: `all-positive`,
    },
    {
      grid: [
        [
          [-5, 2],
          [3, -1],
        ],
        [
          [0, 6],
          [-7, 4],
        ],
      ],
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
      grid: [
        [
          [0, 0],
          [0, 0],
        ],
      ],
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
    expect(DEFAULT_ISOSURFACE_SETTINGS.halo).toBe(0)
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
    expect(settings.halo).toBe(DEFAULT_ISOSURFACE_SETTINGS.halo)
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
  return Array.from({ length: nx }, (_, ix) =>
    Array.from({ length: ny }, (_, iy) =>
      Array.from({ length: nz }, (_, iz) =>
        typeof fill === `function` ? fill(ix, iy, iz) : fill,
      ),
    ),
  )
}

// Assert every cell in a 3D grid satisfies a predicate
function assert_all_cells(grid: number[][][], check: (val: number) => void) {
  for (const plane of grid) {
    for (const row of plane) {
      for (const val of row) check(val)
    }
  }
}

describe(`downsample_grid`, () => {
  test.each([
    { dims: [10, 10, 10] as Vec3, label: `under budget (1K)` },
    { dims: [100, 100, 50] as Vec3, label: `at exactly 500K` },
  ])(`$label: returns original grid reference`, ({ dims }) => {
    const grid = make_grid(dims[0], dims[1], dims[2])
    const result = downsample_grid(grid, dims)
    expect(result.factor).toBe(1)
    expect(result.grid).toBe(grid)
    expect(result.dims).toBe(dims)
  })

  test.each([
    { dims: [100, 100, 100] as Vec3, fill: 5, label: `positive uniform` },
    { dims: [80, 80, 80] as Vec3, fill: -3, label: `negative uniform` },
    { dims: [3, 500, 500] as Vec3, fill: 42, label: `small axis uniform` },
  ])(`$label: preserves constant $fill after downsampling`, ({ dims, fill }) => {
    const grid = make_grid(dims[0], dims[1], dims[2], fill)
    const result = downsample_grid(grid, dims)
    assert_all_cells(result.grid, (val) => expect(val).toBeCloseTo(fill))
  })

  test(`preserves global mean of non-uniform data`, () => {
    const grid = make_grid(100, 100, 100, (ix, iy, iz) => ix + iy + iz)
    const result = downsample_grid(grid, [100, 100, 100])
    const flat = result.grid.flat(2)
    const mean = flat.reduce((acc, val) => acc + val, 0) / flat.length
    expect(mean).toBeCloseTo(148.5, 0)
  })

  test(`no source cells lost or double-counted`, () => {
    const nx = 100
    const ny = 80
    const nz = 90
    const grid = make_grid(nx, ny, nz, (ix, iy, iz) => ix + iy + iz)
    const src_total = grid.flat(2).reduce((acc, val) => acc + val, 0)
    const { grid: out, dims } = downsample_grid(grid, [nx, ny, nz])
    // Weighted reconstruction: sum(block_mean * block_size) must equal source total
    let reconstructed = 0
    for (let ix = 0; ix < dims[0]; ix++) {
      const bx = Math.round(((ix + 1) * nx) / dims[0]) - Math.round((ix * nx) / dims[0])
      for (let iy = 0; iy < dims[1]; iy++) {
        const by = Math.round(((iy + 1) * ny) / dims[1]) - Math.round((iy * ny) / dims[1])
        for (let iz = 0; iz < dims[2]; iz++) {
          const bz = Math.round(((iz + 1) * nz) / dims[2]) - Math.round((iz * nz) / dims[2])
          reconstructed += out[ix][iy][iz] * bx * by * bz
        }
      }
    }
    expect(reconstructed).toBeCloseTo(src_total, 5)
  })

  test(`dims >= 2 and all values finite for extreme aspect ratios`, () => {
    const grid = make_grid(500, 500, 3, 1)
    const result = downsample_grid(grid, [500, 500, 3])
    expect(result.factor).toBeGreaterThan(1)
    for (const dim of result.dims) expect(dim).toBeGreaterThanOrEqual(2)
    assert_all_cells(result.grid, (val) => expect(Number.isFinite(val)).toBe(true))
  })

  test(`output dims never exceed source dims`, () => {
    const grid = make_grid(1, 1000, 1000, 7)
    const result = downsample_grid(grid, [1, 1000, 1000])
    expect(result.dims[0]).toBe(1)
    expect(result.grid[0][0][0]).toBeCloseTo(7)
  })

  test.each([
    { dims: [80, 80, 96] as Vec3, label: `80x80x96 (614K)` },
    { dims: [120, 48, 144] as Vec3, label: `120x48x144 (829K)` },
    { dims: [1100, 1100, 2] as Vec3, label: `1100x1100x2 (anisotropic)` },
  ])(`$label: stays within budget with correct shape`, ({ dims }) => {
    const grid = make_grid(dims[0], dims[1], dims[2], 1)
    const result = downsample_grid(grid, dims)
    const [rnx, rny, rnz] = result.dims
    expect(rnx * rny * rnz).toBeLessThanOrEqual(500_000)
    expect(result.grid.length).toBe(rnx)
    expect(result.grid[0].length).toBe(rny)
    expect(result.grid[0][0].length).toBe(rnz)
  })

  test(`respects custom max_points budget`, () => {
    const grid = make_grid(50, 50, 50)
    const result = downsample_grid(grid, [50, 50, 50], 10_000)
    const [rnx, rny, rnz] = result.dims
    expect(rnx * rny * rnz).toBeLessThanOrEqual(10_000)
    expect(result.factor).toBeGreaterThan(1)
  })

  test(`returns original when total is under custom budget`, () => {
    const dims: Vec3 = [10, 10, 10]
    const grid = make_grid(10, 10, 10)
    const result = downsample_grid(grid, dims, 2000)
    expect(result.grid).toBe(grid)
    expect(result.factor).toBe(1)
  })

  test.each([0, 1, 7])(
    `max_points=%d below minimum output terminates without hanging`,
    (max_points) => {
      const grid = make_grid(4, 4, 4)
      const result = downsample_grid(grid, [4, 4, 4], max_points)
      // Minimum output is 2x2x2 = 8 (clamp_dim floors at 2)
      expect(result.dims.every((dim) => dim >= 1)).toBe(true)
      expect(result.factor).toBeGreaterThan(1)
      expect(Number.isFinite(result.factor)).toBe(true)
    },
  )
})

describe(`pad_periodic_grid`, () => {
  test(`dims, grid shape, and offset correct for 0.3 padding on 10^3 grid`, () => {
    const grid = make_grid(10, 10, 10)
    const result = pad_periodic_grid(grid, [10, 10, 10], 0.3)
    // pad = ceil(10 * 0.3) = 3 per axis → dims 10+6=16
    expect(result.dims).toEqual([16, 16, 16])
    expect(result.grid.length).toBe(16)
    expect(result.grid[0].length).toBe(16)
    expect(result.grid[0][0].length).toBe(16)
    // offset = -3/10 = -0.3
    expect(result.offset[0]).toBeCloseTo(-0.3)
    expect(result.offset[1]).toBeCloseTo(-0.3)
    expect(result.offset[2]).toBeCloseTo(-0.3)
  })

  test(`original data is preserved in the center of padded grid`, () => {
    const grid = make_grid(10, 10, 10, (ix, iy, iz) => ix * 100 + iy * 10 + iz)
    const result = pad_periodic_grid(grid, [10, 10, 10], 0.3)
    // pad = 3, so original data starts at index 3
    for (let ix = 0; ix < 10; ix++) {
      for (let iy = 0; iy < 10; iy++) {
        for (let iz = 0; iz < 10; iz++) {
          expect(result.grid[ix + 3][iy + 3][iz + 3]).toBe(grid[ix][iy][iz])
        }
      }
    }
  })

  test(`halo cells wrap from opposite face`, () => {
    const grid = make_grid(10, 10, 10, (ix) => ix)
    const result = pad_periodic_grid(grid, [10, 10, 10], 0.3)
    // pad = 3. Left halo (ix=0,1,2) should be grid[7,8,9] (opposite face)
    expect(result.grid[0][3][3]).toBe(7)
    expect(result.grid[1][3][3]).toBe(8)
    expect(result.grid[2][3][3]).toBe(9)
    // Right halo (ix=13,14,15) should be grid[0,1,2]
    expect(result.grid[13][3][3]).toBe(0)
    expect(result.grid[14][3][3]).toBe(1)
    expect(result.grid[15][3][3]).toBe(2)
  })

  test(`uniform grid stays uniform after padding`, () => {
    const grid = make_grid(20, 20, 20, 5)
    const result = pad_periodic_grid(grid, [20, 20, 20], 0.3)
    assert_all_cells(result.grid, (val) => expect(val).toBe(5))
  })

  test.each([0, -0.5, -1])(`pad_fraction=%d returns original grid unchanged`, (frac) => {
    const grid = make_grid(10, 10, 10, 3)
    const dims: Vec3 = [10, 10, 10]
    const result = pad_periodic_grid(grid, dims, frac)
    expect(result.grid).toBe(grid)
    expect(result.dims).toBe(dims)
    expect(result.offset).toEqual([0, 0, 0])
  })

  test(`padding capped at floor(n/2) per axis`, () => {
    const grid = make_grid(6, 6, 6, 1)
    // pad_fraction=0.5 → ceil(6*0.5)=3, floor(6/2)=3, so pad=3
    const result = pad_periodic_grid(grid, [6, 6, 6], 0.5)
    expect(result.dims).toEqual([12, 12, 12])
    // pad_fraction=0.9 → ceil(6*0.9)=6, but floor(6/2)=3 caps it
    const result_large = pad_periodic_grid(grid, [6, 6, 6], 0.9)
    expect(result_large.dims).toEqual([12, 12, 12])
  })

  test(`anisotropic dims get independent padding`, () => {
    const grid = make_grid(20, 4, 10, 2)
    const result = pad_periodic_grid(grid, [20, 4, 10], 0.3)
    // px=ceil(20*0.3)=6, py=ceil(4*0.3)=2(capped by floor(4/2)=2), pz=ceil(10*0.3)=3
    expect(result.dims).toEqual([32, 8, 16])
    expect(result.offset[0]).toBeCloseTo(-6 / 20)
    expect(result.offset[1]).toBeCloseTo(-2 / 4)
    expect(result.offset[2]).toBeCloseTo(-3 / 10)
    assert_all_cells(result.grid, (val) => expect(val).toBe(2))
  })
})

// Helper to build a minimal VolumetricData from a grid for tile tests
function make_volume(
  nx: number,
  ny: number,
  nz: number,
  fill: number | ((ix: number, iy: number, iz: number) => number) = 1,
  periodic: boolean = true,
): VolumetricData {
  const grid = make_grid(nx, ny, nz, fill)
  return {
    grid,
    grid_dims: [nx, ny, nz],
    lattice: [
      [3, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ],
    origin: [0, 0, 0],
    data_range: { min: 0, max: 1, abs_max: 1, mean: 0.5 },
    periodic,
    label: `test`,
  }
}

describe(`tile_volumetric_data`, () => {
  test(`[1,1,1] returns the same object reference`, () => {
    const vol = make_volume(4, 4, 4)
    expect(tile_volumetric_data(vol, [1, 1, 1])).toBe(vol)
  })

  test(`non-periodic volume is tiled, not skipped`, () => {
    const vol = make_volume(4, 4, 4, 1, false)
    const tiled = tile_volumetric_data(vol, [2, 2, 2])
    expect(tiled).not.toBe(vol)
    expect(tiled.grid_dims).toEqual([8, 8, 8])
  })

  test.each([
    { scaling: [2, 1, 1] as Vec3, label: `2x1x1` },
    { scaling: [1, 3, 1] as Vec3, label: `1x3x1` },
    { scaling: [1, 1, 4] as Vec3, label: `1x1x4` },
    { scaling: [2, 2, 2] as Vec3, label: `2x2x2` },
    { scaling: [3, 1, 2] as Vec3, label: `3x1x2` },
  ])(`$label: produces correct dims`, ({ scaling }) => {
    const vol = make_volume(4, 5, 6)
    const tiled = tile_volumetric_data(vol, scaling)
    expect(tiled.grid_dims).toEqual([4 * scaling[0], 5 * scaling[1], 6 * scaling[2]])
    expect(tiled.grid.length).toBe(tiled.grid_dims[0])
    expect(tiled.grid[0].length).toBe(tiled.grid_dims[1])
    expect(tiled.grid[0][0].length).toBe(tiled.grid_dims[2])
  })

  test(`grid values repeat via modulo at boundary wrap points`, () => {
    const vol = make_volume(3, 4, 5, (ix, iy, iz) => ix * 100 + iy * 10 + iz)
    const tiled = tile_volumetric_data(vol, [2, 2, 2])
    const [nx, ny, nz] = vol.grid_dims
    for (let ix = 0; ix < tiled.grid_dims[0]; ix++) {
      for (let iy = 0; iy < tiled.grid_dims[1]; iy++) {
        for (let iz = 0; iz < tiled.grid_dims[2]; iz++) {
          expect(tiled.grid[ix][iy][iz]).toBe(vol.grid[ix % nx][iy % ny][iz % nz])
        }
      }
    }
  })

  test.each([
    {
      scaling: [2, 3, 4] as Vec3,
      lattice: [
        [3, 0, 0],
        [0, 4, 0],
        [0, 0, 5],
      ] as VolumetricData[`lattice`],
      expected: [
        [6, 0, 0],
        [0, 12, 0],
        [0, 0, 20],
      ],
      label: `orthogonal`,
    },
    {
      scaling: [2, 3, 1] as Vec3,
      lattice: [
        [3, 1, 0],
        [0, 4, 2],
        [1, 0, 5],
      ] as VolumetricData[`lattice`],
      expected: [
        [6, 2, 0],
        [0, 12, 6],
        [1, 0, 5],
      ],
      label: `non-orthogonal`,
    },
  ])(
    `$label: lattice vectors scaled by supercell factors`,
    ({ scaling, lattice, expected }) => {
      const vol = make_volume(4, 4, 4)
      vol.lattice = lattice
      const tiled = tile_volumetric_data(vol, scaling)
      expect(tiled.lattice).toEqual(expected)
    },
  )

  test(`data_range, origin, periodic, label, and data_order are preserved`, () => {
    const vol = make_volume(4, 4, 4)
    vol.data_order = `x_fastest`
    const tiled = tile_volumetric_data(vol, [2, 2, 2])
    expect(tiled.data_range).toBe(vol.data_range)
    expect(tiled.origin).toBe(vol.origin)
    expect(tiled.periodic).toBe(vol.periodic)
    expect(tiled.label).toBe(vol.label)
    expect(tiled.data_order).toBe(`x_fastest`)
  })

  test(`returns a new object that does not alias source arrays`, () => {
    const vol = make_volume(3, 3, 3, 5)
    const tiled = tile_volumetric_data(vol, [2, 2, 2])
    expect(tiled).not.toBe(vol)
    expect(tiled.grid).not.toBe(vol.grid)
    expect(tiled.lattice).not.toBe(vol.lattice)
    // Mutating tiled grid must not affect source
    tiled.grid[0][0][0] = -999
    expect(vol.grid[0][0][0]).toBe(5)
  })

  test.each([
    {
      dims: [100, 100, 100] as Vec3,
      scaling: [2, 2, 2] as Vec3,
      fill: 7,
      label: `large grid`,
    },
    {
      dims: [4, 4, 4] as Vec3,
      scaling: [80, 80, 80] as Vec3,
      fill: 3,
      label: `extreme supercell (budget clamp)`,
    },
  ])(`$label: pre-downsamples and scales lattice correctly`, ({ dims, scaling, fill }) => {
    const vol = make_volume(dims[0], dims[1], dims[2], fill)
    const tiled = tile_volumetric_data(vol, scaling)
    const [tnx, tny, tnz] = tiled.grid_dims
    // Grid shape matches dims
    expect(tiled.grid.length).toBe(tnx)
    expect(tiled.grid[0].length).toBe(tny)
    expect(tiled.grid[0][0].length).toBe(tnz)
    // Lattice diagonal scaled by supercell factors
    for (let idx = 0; idx < 3; idx++) {
      expect(tiled.lattice[idx][idx]).toBe(vol.lattice[idx][idx] * scaling[idx])
    }
  })
})
