// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  auto_volume_layer,
  DEFAULT_ISOSURFACE_SETTINGS,
  downsample_grid,
  generate_layers,
  grid_data_range,
  type IsosurfaceLayer,
  label_file_volumes,
  lattices_match,
  LAYER_COLORS,
  materialize_layers,
  merge_imported_volumes,
  pad_periodic_grid,
  remove_volume,
  tile_volumetric_data,
  type VolumetricData,
} from '$lib/isosurface/types'
import type { Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { make_grid, make_volume as make_volume_fixture } from '../setup'

describe(`grid_data_range`, () => {
  test.each([
    {
      // oxfmt-ignore
      grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
      min: 1,
      max: 8,
      abs_max: 8,
      mean: 4.5,
      label: `all-positive`,
    },
    {
      // oxfmt-ignore
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
      // oxfmt-ignore
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

describe(`auto_isosurface_settings`, () => {
  test.each([
    { min: 0, abs_max: 10, show_neg: false, label: `positive-only` },
    { min: -5, abs_max: 10, show_neg: true, label: `significant negatives` },
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

  test(`preserves defaults in a fresh object (not a reference to defaults)`, () => {
    const settings = auto_isosurface_settings({ min: 0, max: 10, abs_max: 10, mean: 5 })
    expect(settings).toEqual({ ...DEFAULT_ISOSURFACE_SETTINGS, isovalue: 2 })
    // Mutating the result should not affect defaults
    settings.isovalue = 999
    expect(DEFAULT_ISOSURFACE_SETTINGS.isovalue).toBe(0.05)
  })
})

describe(`generate_layers`, () => {
  const range = { min: 0, max: 10, abs_max: 10, mean: 5 }

  test(`generates ordered layers with palette colors and decreasing opacity`, () => {
    const layers = generate_layers(range, 3)
    expect(layers).toHaveLength(3)
    expect(layers[0].isovalue).toBeGreaterThan(layers[1].isovalue)
    expect(layers[1].isovalue).toBeGreaterThan(layers[2].isovalue)
    expect(layers[0].opacity).toBeGreaterThan(layers[2].opacity)
    expect(layers[0].color).toBe(LAYER_COLORS[0])
  })

  test(`single layer uses 20% of abs_max`, () => {
    const [layer] = generate_layers(range, 1)
    expect(layer.isovalue).toBeCloseTo(10 * 0.2)
  })

  test(`returns empty array for zero abs_max or non-positive layer count`, () => {
    expect(generate_layers({ min: 0, max: 0, abs_max: 0, mean: 0 }, 3)).toEqual([])
    expect(generate_layers(range, 0)).toEqual([])
  })

  test(`enables show_negative for data with significant negatives`, () => {
    const layers = generate_layers({ min: -5, max: 10, abs_max: 10, mean: 2 }, 2)
    expect(layers.every((layer) => layer.show_negative)).toBe(true)
  })
})

describe(`auto_volume_layer`, () => {
  const vol_with_range = (min: number, max: number): VolumetricData =>
    make_volume_fixture(make_grid(2, 2, 2, 1), {
      data_range: { min, max, abs_max: Math.max(Math.abs(min), Math.abs(max)), mean: 0 },
    })

  test(`sets isovalue to 20% of abs_max and binds volume_idx`, () => {
    const layer = auto_volume_layer(vol_with_range(0, 10), 3)
    expect(layer.isovalue).toBeCloseTo(2)
    expect(layer.volume_idx).toBe(3)
    expect(layer.visible).toBe(true)
    expect(layer.color_volume_idx).toBeUndefined()
  })

  test.each([
    { min: -5, max: 10, show_negative: true, label: `signed data` },
    { min: 0, max: 10, show_negative: false, label: `non-negative data` },
  ])(`$label sets show_negative=$show_negative`, ({ min, max, show_negative }) => {
    expect(auto_volume_layer(vol_with_range(min, max), 0).show_negative).toBe(show_negative)
  })

  test(`color_offset picks successive palette colors`, () => {
    const vol = vol_with_range(0, 10)
    expect(auto_volume_layer(vol, 0, 0).color).toBe(LAYER_COLORS[0])
    expect(auto_volume_layer(vol, 1, 1).color).toBe(LAYER_COLORS[1])
    expect(auto_volume_layer(vol, 2, LAYER_COLORS.length).color).toBe(LAYER_COLORS[0])
  })

  test(`falls back to default isovalue for all-zero data`, () => {
    const layer = auto_volume_layer(vol_with_range(0, 0), 0)
    expect(layer.isovalue).toBe(DEFAULT_ISOSURFACE_SETTINGS.isovalue)
  })
})

describe(`materialize_layers`, () => {
  test(`converts implicit single-isovalue settings into one explicit layer`, () => {
    const settings = {
      ...DEFAULT_ISOSURFACE_SETTINGS,
      isovalue: 0.42,
      opacity: 0.7,
      positive_color: `#123456`,
      show_negative: true,
      negative_color: `#654321`,
    }
    const layers = materialize_layers(settings, 2)
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({
      isovalue: 0.42,
      opacity: 0.7,
      color: `#123456`,
      show_negative: true,
      negative_color: `#654321`,
      volume_idx: 2,
      visible: true,
    })
  })

  test(`pins existing layers without volume_idx to the active volume`, () => {
    const layers: IsosurfaceLayer[] = [
      { ...generate_layers({ min: 0, max: 1, abs_max: 1, mean: 0.5 }, 2)[0] },
      { ...generate_layers({ min: 0, max: 1, abs_max: 1, mean: 0.5 }, 2)[1], volume_idx: 5 },
    ]
    const result = materialize_layers({ ...DEFAULT_ISOSURFACE_SETTINGS, layers }, 1)
    expect(result[0].volume_idx).toBe(1) // implicit → active volume
    expect(result[1].volume_idx).toBe(5) // explicit stays
  })

  test(`preserves explicit empty layers array (zero surfaces, no resurrection)`, () => {
    expect(materialize_layers({ ...DEFAULT_ISOSURFACE_SETTINGS, layers: [] }, 0)).toEqual([])
  })
})

describe(`remove_volume`, () => {
  const volumes = () => [
    make_volume_fixture(make_grid(2, 2, 2, 1), { label: `a` }),
    make_volume_fixture(make_grid(2, 2, 2, 2), { label: `b` }),
    make_volume_fixture(make_grid(2, 2, 2, 3), { label: `c` }),
  ]
  const layer = (volume_idx: number, color_volume_idx?: number): IsosurfaceLayer => ({
    isovalue: 1,
    color: `#fff`,
    opacity: 1,
    visible: true,
    show_negative: false,
    negative_color: `#000`,
    volume_idx,
    color_volume_idx,
  })

  test(`drops the volume, its layers, and remaps higher indices`, () => {
    const result = remove_volume(volumes(), [layer(0), layer(1, 0), layer(2, 1)], 1)
    expect(result.volumes.map((vol) => vol.label)).toEqual([`a`, `c`])
    expect(result.layers).toHaveLength(2)
    // layer(0) unchanged; layer(2, 1) → volume 1, color source dropped (pointed at removed)
    expect(result.layers[0]).toMatchObject({ volume_idx: 0, color_volume_idx: undefined })
    expect(result.layers[1].volume_idx).toBe(1)
    expect(result.layers[1].color_volume_idx).toBeUndefined()
  })

  test(`keeps color sources pointing past the removed index (shifted down)`, () => {
    const result = remove_volume(volumes(), [layer(1, 2)], 0)
    expect(result.layers[0]).toMatchObject({ volume_idx: 0, color_volume_idx: 1 })
  })

  test(`clears color source that referenced the removed volume`, () => {
    const result = remove_volume(volumes(), [layer(0, 1)], 1)
    expect(result.layers[0].color_volume_idx).toBeUndefined()
  })

  test(`implicit layers resolve against active_volume_idx, not volume 0`, () => {
    const implicit: IsosurfaceLayer = { ...layer(0), volume_idx: undefined }
    // Implicit layer follows active volume 1, which is being removed → dropped
    const removed_active = remove_volume(volumes(), [implicit], 1, 1)
    expect(removed_active.layers).toHaveLength(0)
    // Implicit layer follows active volume 2; removing volume 0 shifts it to 1
    const removed_other = remove_volume(volumes(), [implicit], 0, 2)
    expect(removed_other.layers[0].volume_idx).toBe(1)
  })
})

describe(`label_file_volumes`, () => {
  const vol = (label?: string): VolumetricData =>
    make_volume_fixture(make_grid(2, 2, 2, 1), { label })

  test(`single volume gets the compression-stripped filename as label + source`, () => {
    const [labeled] = label_file_volumes([vol(`charge density`)], `esp.cube.gz`)
    expect(labeled.label).toBe(`esp.cube`)
    expect(labeled.source).toBe(`esp.cube`)
  })

  test(`multi-block files get "file: block" labels sharing one source`, () => {
    const labeled = label_file_volumes(
      [vol(`charge density`), vol(`magnetization density`)],
      `Fe-CHGCAR.bz2`,
    )
    expect(labeled.map((entry) => entry.label)).toEqual([
      `Fe-CHGCAR: charge density`,
      `Fe-CHGCAR: magnetization density`,
    ])
    expect(labeled.every((entry) => entry.source === `Fe-CHGCAR`)).toBe(true)
  })

  test(`multi-block files use positional labels when block labels are absent`, () => {
    const labeled = label_file_volumes([vol(), vol()], `density.cube`)
    expect(labeled.map((entry) => entry.label)).toEqual([`density.cube: 1`, `density.cube: 2`])
  })
})

describe(`lattices_match`, () => {
  const cubic = [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ]

  test.each([
    {
      other: [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      match: true,
      label: `identical`,
    },
    {
      other: [
        [10.01, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      match: true,
      label: `within tolerance`,
    },
    {
      other: [
        [10.1, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      match: false,
      label: `outside tolerance`,
    },
  ])(`$label`, ({ other, match }) => {
    expect(lattices_match(cubic, other)).toBe(match)
  })

  test(`undefined lattices never match`, () => {
    expect(lattices_match(undefined, cubic)).toBe(false)
    expect(lattices_match(cubic, undefined)).toBe(false)
  })
})

describe(`merge_imported_volumes`, () => {
  const src_vol = (source: string, label: string, fill = 1): VolumetricData =>
    make_volume_fixture(make_grid(2, 2, 2, fill), { source, label })
  const layer_for = (volume_idx: number): IsosurfaceLayer => ({
    isovalue: 0.42, // user-tuned value that reimports must preserve
    color: `#123456`,
    opacity: 1,
    visible: true,
    show_negative: false,
    negative_color: `#000`,
    volume_idx,
  })

  test(`appends volumes from a new source with auto layers`, () => {
    const existing = [src_vol(`density.cube`, `density.cube`)]
    const result = merge_imported_volumes(
      existing,
      [layer_for(0)],
      [src_vol(`esp.cube`, `esp.cube`, 2)],
    )
    expect(result.volumes.map((vol) => vol.label)).toEqual([`density.cube`, `esp.cube`])
    expect(result.layers).toHaveLength(2)
    expect(result.layers[1].volume_idx).toBe(1)
    expect(result).toMatchObject({ first_touched_idx: 1, n_added: 1 })
  })

  test(`reimport with same block count replaces in place and keeps tuned layers`, () => {
    const existing = [src_vol(`density.cube`, `density.cube`)]
    const fresh = src_vol(`density.cube`, `density.cube`, 9)
    const result = merge_imported_volumes(existing, [layer_for(0)], [fresh])
    expect(result.volumes).toHaveLength(1)
    expect(result.volumes[0]).toBe(fresh) // new data object
    expect(result.layers[0].isovalue).toBe(0.42) // user tuning preserved
    expect(result).toMatchObject({ first_touched_idx: 0, n_added: 0 })
  })

  test(`reimport with changed block count drops the stale group and remaps`, () => {
    // CHGCAR was spin-polarized (2 blocks at idx 0,1); reimport has 1 block
    const existing = [
      src_vol(`CHGCAR`, `CHGCAR: charge density`),
      src_vol(`CHGCAR`, `CHGCAR: magnetization density`),
      src_vol(`esp.cube`, `esp.cube`),
    ]
    const layers = [layer_for(0), layer_for(1), layer_for(2)]
    const result = merge_imported_volumes(existing, layers, [src_vol(`CHGCAR`, `CHGCAR`, 9)])
    expect(result.volumes.map((vol) => vol.label)).toEqual([`esp.cube`, `CHGCAR`])
    // Stale CHGCAR layers dropped; esp layer remapped 2 → 0; new auto layer at 1
    expect(result.layers).toHaveLength(2)
    expect(result.layers[0].volume_idx).toBe(0)
    expect(result.layers[1].volume_idx).toBe(1)
    expect(result).toMatchObject({ first_touched_idx: 1, n_added: 1 })
  })

  test(`implicit layers follow active_volume_idx through block-count remapping`, () => {
    // Implicit layer references active volume 1 (esp.cube); CHGCAR at 0 shrinks
    // from 2 blocks to 1, so the implicit layer must survive pinned to esp.cube
    const existing = [
      src_vol(`CHGCAR`, `CHGCAR: charge`),
      src_vol(`esp.cube`, `esp.cube`),
      src_vol(`CHGCAR`, `CHGCAR: magnetization`),
    ]
    const implicit = { ...layer_for(0), volume_idx: undefined }
    const result = merge_imported_volumes(
      existing,
      [implicit],
      [src_vol(`CHGCAR`, `CHGCAR`, 9)],
      1,
    )
    expect(result.volumes.map((vol) => vol.label)).toEqual([`esp.cube`, `CHGCAR`])
    // Implicit layer pinned to esp.cube (was idx 1, now 0) + new auto CHGCAR layer
    expect(result.layers.map((layer) => layer.volume_idx)).toEqual([0, 1])
    expect(result.layers[0].isovalue).toBe(0.42) // user tuning preserved
  })
})

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
    { dims: [10, 10, 10] as Vec3, label: `under custom budget`, max_points: 2000 },
  ])(`$label: returns original grid reference`, ({ dims, max_points }) => {
    const grid = make_grid(dims[0], dims[1], dims[2])
    const result = downsample_grid(grid, dims, max_points)
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
    { dims: [50, 50, 50] as Vec3, label: `custom 10K budget`, max_points: 10_000 },
  ])(`$label: stays within budget with correct shape`, ({ dims, max_points = 500_000 }) => {
    const grid = make_grid(dims[0], dims[1], dims[2], 1)
    const result = downsample_grid(grid, dims, max_points)
    const [rnx, rny, rnz] = result.dims
    expect(rnx * rny * rnz).toBeLessThanOrEqual(max_points)
    expect(result.factor).toBeGreaterThan(1)
    expect(result.grid).toHaveLength(rnx)
    expect(result.grid[0]).toHaveLength(rny)
    expect(result.grid[0][0]).toHaveLength(rnz)
  })

  test.each([0, 1, 7])(
    `max_points=%d below minimum output terminates without hanging`,
    (max_points) => {
      const grid = make_grid(4, 4, 4)
      const result = downsample_grid(grid, [4, 4, 4], max_points)
      expect(result.dims.every((dim) => dim >= 2)).toBe(true)
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
    expect(result.grid).toHaveLength(16)
    expect(result.grid[0]).toHaveLength(16)
    expect(result.grid[0][0]).toHaveLength(16)
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
const make_volume = (
  nx: number,
  ny: number,
  nz: number,
  fill: number | ((ix: number, iy: number, iz: number) => number) = 1,
  periodic: boolean = true,
): VolumetricData =>
  make_volume_fixture(make_grid(nx, ny, nz, fill), {
    lattice: [
      [3, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ],
    periodic,
    label: `test`,
  })

describe(`tile_volumetric_data`, () => {
  test(`[1,1,1] returns the same object reference`, () => {
    const vol = make_volume(4, 4, 4)
    expect(tile_volumetric_data(vol, [1, 1, 1])).toBe(vol)
  })

  test(`non-periodic volume is not implicitly repeated`, () => {
    const vol = make_volume(4, 4, 4, 1, false)
    const tiled = tile_volumetric_data(vol, [2, 2, 2])
    expect(tiled).toBe(vol)
    expect(tiled.grid_dims).toEqual([4, 4, 4])
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
    expect(tiled.grid).toHaveLength(tiled.grid_dims[0])
    expect(tiled.grid[0]).toHaveLength(tiled.grid_dims[1])
    expect(tiled.grid[0][0]).toHaveLength(tiled.grid_dims[2])
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
    expect(tiled.grid).toHaveLength(tnx)
    expect(tiled.grid[0]).toHaveLength(tny)
    expect(tiled.grid[0][0]).toHaveLength(tnz)
    // Lattice diagonal scaled by supercell factors
    for (let idx = 0; idx < 3; idx++) {
      expect(tiled.lattice[idx][idx]).toBe(vol.lattice[idx][idx] * scaling[idx])
    }
  })
})
