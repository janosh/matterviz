// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  auto_volume_layer,
  DEFAULT_ISOSURFACE_SETTINGS,
  grid_data_range,
  label_file_volumes,
  lattices_match,
  LAYER_COLORS,
  merge_imported_volumes,
  normalize_active_volume_idx,
  pin_layers,
  remove_volume,
  SHELL_STEPS,
  volume_from_json,
} from '$lib/isosurface/types'
import type { IsosurfaceLayer, VolumetricData } from '$lib/isosurface/types'
import { flatten_grid } from '$lib/isosurface/grid'
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

const vol_with_range = (min: number, max: number): VolumetricData =>
  make_volume_fixture(make_grid(2, 2, 2, 1), {
    data_range: { min, max, abs_max: Math.max(Math.abs(min), Math.abs(max)), mean: 0 },
  })

describe(`auto_isosurface_settings`, () => {
  // Layer contents (isovalue, show_negative, zero fallback) are auto_volume_layer's, below
  test(`wraps one auto layer on volume 0 in the default settings`, () => {
    const vol = vol_with_range(-5, 10)
    const settings = auto_isosurface_settings(vol)
    expect(settings).toEqual({
      ...DEFAULT_ISOSURFACE_SETTINGS,
      layers: [auto_volume_layer(vol, 0)],
    })
    // a fresh layers array, not the defaults' own
    settings.layers.push(settings.layers[0])
    expect(DEFAULT_ISOSURFACE_SETTINGS.layers).toEqual([])
  })
})

describe(`auto_volume_layer`, () => {
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
    { min: -0.005, max: 1, show_negative: false, label: `negatives below the 1% threshold` },
  ])(`$label sets show_negative=$show_negative`, ({ min, max, show_negative }) => {
    expect(auto_volume_layer(vol_with_range(min, max), 0).show_negative).toBe(show_negative)
  })

  test(`color_offset picks successive palette colors`, () => {
    const vol = vol_with_range(0, 10)
    expect(auto_volume_layer(vol, 0, 0).color).toBe(LAYER_COLORS[0])
    expect(auto_volume_layer(vol, 1, 1).color).toBe(LAYER_COLORS[1])
    expect(auto_volume_layer(vol, 2, LAYER_COLORS.length).color).toBe(LAYER_COLORS[0])
  })

  test(`falls back to a small positive isovalue for all-zero data`, () => {
    expect(auto_volume_layer(vol_with_range(0, 0), 0).isovalue).toBe(0.05)
  })

  // Repeated "+" clicks on one volume used to stack coincident 20%/0.6 surfaces. Shells
  // step the 0.8 → 0.1 ladder like the old generate_layers: distinct isovalues, inner
  // (high-isovalue) shells more opaque than outer ones.
  test.each([
    { shell_idx: 0, fraction: 0.2, opacity: 0.6 },
    { shell_idx: 1, fraction: 0.8, opacity: 0.8 },
    { shell_idx: 2, fraction: 0.5, opacity: 0.7 },
    { shell_idx: 3, fraction: 0.1, opacity: 0.3 },
    { shell_idx: SHELL_STEPS.length, fraction: 0.2, opacity: 0.6 }, // wraps around
  ])(
    `shell $shell_idx sits at $fraction·abs_max with opacity $opacity`,
    ({ shell_idx, fraction, opacity }) => {
      const layer = auto_volume_layer(vol_with_range(-5, 10), 3, 1, shell_idx)
      expect(layer.isovalue).toBeCloseTo(10 * fraction)
      expect(layer.opacity).toBe(opacity)
      expect(layer).toMatchObject({
        volume_idx: 3,
        color: LAYER_COLORS[1],
        show_negative: true,
      })
    },
  )

  test(`successive shells of one volume never coincide and inner shells are more opaque`, () => {
    const vol = vol_with_range(0, 10)
    const shells = SHELL_STEPS.map((_step, idx) => auto_volume_layer(vol, 0, idx, idx))
    const isovalues = shells.map((layer) => layer.isovalue)
    expect(new Set(isovalues).size).toBe(shells.length)
    expect(new Set(shells.map((layer) => layer.color)).size).toBe(shells.length)
    const by_isovalue = shells.toSorted((left, right) => right.isovalue - left.isovalue)
    for (let idx = 1; idx < by_isovalue.length; idx++) {
      expect(by_isovalue[idx - 1].opacity).toBeGreaterThan(by_isovalue[idx].opacity)
    }
    expect(Math.max(...isovalues)).toBeCloseTo(8)
    expect(Math.min(...isovalues)).toBeCloseTo(1)
  })
})

describe(`pin_layers`, () => {
  test(`pins layers without volume_idx to the active volume and keeps explicit ones`, () => {
    const base: IsosurfaceLayer = {
      isovalue: 0.2,
      color: LAYER_COLORS[0],
      opacity: 0.6,
      visible: true,
      show_negative: false,
      negative_color: LAYER_COLORS[1],
    }
    const layers: IsosurfaceLayer[] = [base, { ...base, isovalue: 0.8, volume_idx: 5 }]
    const result = pin_layers(layers, 1)
    expect(result[0].volume_idx).toBe(1) // implicit → active volume
    expect(result[1].volume_idx).toBe(5) // explicit stays
    expect(pin_layers([], 0)).toEqual([])
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

  // The hand-rolled suffix list carried a dead `.zst` (nothing here inflates it) and omitted
  // `.zip`, `.z` and `.deflate`, which it does; the shared regex covers exactly what
  // COMPRESSION_FORMATS declares, and case is preserved because this is a display label.
  test.each([
    [`CHGCAR.zip`, `CHGCAR`],
    [`CHGCAR.z`, `CHGCAR`],
    [`CHGCAR.deflate`, `CHGCAR`],
    [`esp.cube.gz`, `esp.cube`],
    [`esp.cube.GZ`, `esp.cube`],
    [`esp.cube.gz.zip`, `esp.cube`],
    [`density.zst`, `density.zst`], // not a format this repo can inflate
  ])(`strips compression extensions: %s -> %s`, (filename, expected) => {
    expect(label_file_volumes([vol()], filename)[0].source).toBe(expected)
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
