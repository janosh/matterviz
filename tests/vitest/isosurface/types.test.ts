// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  auto_volume_layer,
  DEFAULT_ISOSURFACE_SETTINGS,
  downsample_grid,
  generate_layers,
  grid_data_range,
  label_file_volumes,
  lattices_match,
  LAYER_COLORS,
  materialize_layers,
  merge_imported_volumes,
  normalize_active_volume_idx,
  remove_volume,
  volume_from_json,
} from '$lib/isosurface/types'
import type { IsosurfaceLayer, VolumetricData } from '$lib/isosurface/types'
import { flatten_grid } from '$lib/isosurface/grid'
import type { Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { grid_value, make_grid, make_volume as make_volume_fixture } from '../setup'

test.each([
  { active_volume_idx: -1, volume_count: 3, expected: 0 },
  { active_volume_idx: 3, volume_count: 3, expected: 0 },
  { active_volume_idx: 2, volume_count: 3, expected: 2 },
  { active_volume_idx: 4, volume_count: 0, expected: 4 },
])(
  `normalize_active_volume_idx($active_volume_idx, $volume_count) returns $expected`,
  ({ active_volume_idx, volume_count, expected }) => {
    expect(normalize_active_volume_idx(active_volume_idx, volume_count)).toBe(expected)
  },
)

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
  ])(
    `$label: min=$min max=$max abs_max=$abs_max mean=$mean`,
    ({ grid, min, max, abs_max, mean }) => {
      const range = grid_data_range(grid.length ? flatten_grid(grid).values : [])
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
    expect(labeled.source_filename).toBe(`esp.cube.gz`)
  })

  test(`keeps source filename separate from the logical parse filename`, () => {
    const [labeled] = label_file_volumes([vol()], `esp.cube`, `esp.cube.gz`)
    expect([labeled.source, labeled.source_filename]).toEqual([`esp.cube`, `esp.cube.gz`])
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

const flat_grid = (
  nx: number,
  ny: number,
  nz: number,
  fill: number | ((ix: number, iy: number, iz: number) => number) = 1,
) => flatten_grid(make_grid(nx, ny, nz, fill))

describe(`downsample_grid`, () => {
  test.each([
    { dims: [10, 10, 10] as Vec3, label: `under budget (1K)` },
    { dims: [100, 100, 50] as Vec3, label: `at exactly 500K` },
    { dims: [10, 10, 10] as Vec3, label: `under custom budget`, max_points: 2000 },
  ])(`$label: returns original grid reference`, ({ dims, max_points }) => {
    const grid = flat_grid(...dims)
    const result = downsample_grid(grid, max_points)
    expect(result.factor).toBe(1)
    expect(result.grid).toBe(grid)
  })

  test.each([
    { dims: [100, 100, 100] as Vec3, fill: 5, label: `positive uniform` },
    { dims: [80, 80, 80] as Vec3, fill: -3, label: `negative uniform` },
    { dims: [3, 500, 500] as Vec3, fill: 42, label: `small axis uniform` },
  ])(`$label: preserves constant $fill after downsampling`, ({ dims, fill }) => {
    const { grid } = downsample_grid(flat_grid(...dims, fill))
    for (const val of grid.values) expect(val).toBeCloseTo(fill, 10)
  })

  test(`preserves global mean of non-uniform data`, () => {
    const { grid } = downsample_grid(flat_grid(100, 100, 100, (ix, iy, iz) => ix + iy + iz))
    expect(grid_data_range(grid.values).mean).toBeCloseTo(148.5, 0)
  })

  test(`no source cells lost or double-counted`, () => {
    const [nx, ny, nz] = [100, 80, 90]
    const grid = flat_grid(nx, ny, nz, (ix, iy, iz) => ix + iy + iz)
    const src_total = grid.values.reduce((acc, val) => acc + val, 0)
    const { grid: out } = downsample_grid(grid)
    const [out_nx, out_ny, out_nz] = out.dims
    // Weighted reconstruction: sum(block_mean * block_size) must equal source total
    const block = (idx: number, n_out: number, n_src: number) =>
      Math.round(((idx + 1) * n_src) / n_out) - Math.round((idx * n_src) / n_out)
    let reconstructed = 0
    for (let ix = 0; ix < out_nx; ix++) {
      for (let iy = 0; iy < out_ny; iy++) {
        for (let iz = 0; iz < out_nz; iz++) {
          reconstructed +=
            grid_value(out, ix, iy, iz) *
            block(ix, out_nx, nx) *
            block(iy, out_ny, ny) *
            block(iz, out_nz, nz)
        }
      }
    }
    expect(reconstructed).toBeCloseTo(src_total, 5)
  })

  test(`dims >= 2 and all values finite for extreme aspect ratios`, () => {
    const result = downsample_grid(flat_grid(500, 500, 3, 1))
    expect(result.factor).toBeGreaterThan(1)
    for (const dim of result.grid.dims) expect(dim).toBeGreaterThanOrEqual(2)
    expect(result.grid.values.every(Number.isFinite)).toBe(true)
  })

  test(`output dims never exceed source dims`, () => {
    const { grid } = downsample_grid(flat_grid(1, 1000, 1000, 7))
    expect(grid.dims[0]).toBe(1)
    expect(grid.values[0]).toBeCloseTo(7)
  })

  test.each([
    { dims: [80, 80, 96] as Vec3, label: `80x80x96 (614K)` },
    { dims: [120, 48, 144] as Vec3, label: `120x48x144 (829K)` },
    { dims: [1100, 1100, 2] as Vec3, label: `1100x1100x2 (anisotropic)` },
    { dims: [50, 50, 50] as Vec3, label: `custom 10K budget`, max_points: 10_000 },
  ])(`$label: stays within budget with correct shape`, ({ dims, max_points = 500_000 }) => {
    const result = downsample_grid(flat_grid(...dims, 1), max_points)
    const [rnx, rny, rnz] = result.grid.dims
    expect(rnx * rny * rnz).toBeLessThanOrEqual(max_points)
    expect(result.factor).toBeGreaterThan(1)
    expect(result.grid.values).toHaveLength(rnx * rny * rnz)
  })

  test.each([0, 1, 7])(
    `max_points=%d below minimum output terminates without hanging`,
    (max_points) => {
      const result = downsample_grid(flat_grid(4, 4, 4), max_points)
      expect(result.grid.dims.every((dim) => dim >= 2)).toBe(true)
      expect(result.factor).toBeGreaterThan(1)
      expect(Number.isFinite(result.factor)).toBe(true)
    },
  )

  test(`rejects x_fastest input instead of silently averaging the wrong neighbours`, () => {
    const grid = { ...flat_grid(100, 100, 100), order: `x_fastest` as const }
    expect(() => downsample_grid(grid)).toThrow(/z_fastest/)
  })
})

describe(`volume_from_json`, () => {
  const base = {
    lattice: [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ],
    origin: [0, 0, 0],
    periodic: true,
  }

  test(`nested grid JSON becomes a flat z-fastest volume with computed data_range`, () => {
    const grid = make_grid(2, 3, 4, (ix, iy, iz) => 100 * ix + 10 * iy + iz)
    const vol = volume_from_json({ ...base, grid, label: `rho` })
    expect(vol.dims).toEqual([2, 3, 4])
    expect(vol.order).toBe(`z_fastest`)
    expect(vol.values).toBeInstanceOf(Float64Array)
    expect(grid_value(vol, 1, 2, 3)).toBe(123)
    expect(vol.data_range).toEqual({
      min: 0,
      max: 123,
      abs_max: 123,
      mean: expect.closeTo(61.5),
    })
    expect(vol.label).toBe(`rho`)
  })

  test(`flat values + dims JSON (plain number[]) is accepted`, () => {
    const vol = volume_from_json({
      ...base,
      values: [1, 2, 3, 4, 5, 6, 7, 8],
      dims: [2, 2, 2],
    })
    expect(grid_value(vol, 1, 1, 1)).toBe(8)
    expect(vol.data_range.mean).toBe(4.5)
  })

  test.each([
    [{ ...base, grid: [[[1, 2]], [[3]]] }, /Ragged grid/],
    [{ ...base, values: [1, 2, 3], dims: [2, 2, 2] }, /does not match dims/],
    [{ ...base, values: [1], dims: [1, 1] }, /needs dims/],
    [{ ...base }, /nested grid or flat values/],
    [{ ...base, grid: [[[1]]], lattice: [[1, 0, 0]] }, /3x3 lattice/],
    [{ ...base, grid: [[[1]]], periodic: `yes` }, /boolean periodic/],
    [42, /must be an object/],
  ])(`rejects malformed payload %#`, (payload, expected) => {
    expect(() => volume_from_json(payload)).toThrow(expected)
  })
})
