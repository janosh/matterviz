// Tests for isosurface type utilities
import {
  auto_isosurface_settings,
  auto_volume_layer,
  DEFAULT_ISOSURFACE_SETTINGS,
  grid_data_range,
  label_file_volumes,
  LAYER_COLORS,
  merge_imported_volumes,
  normalize_active_volume_id,
  index_volumes,
  remove_volume,
  SHELL_STEPS,
  volume_from_json,
} from '$lib/isosurface/types'
import type { VolumetricData } from '$lib/isosurface/types'
import { flatten_grid } from '$lib/isosurface/grid'
import { describe, expect, test } from 'vitest'
import { grid_value, make_grid, make_volume as make_volume_fixture } from '../setup'

test.each([
  { active: undefined, ids: [`a`, `b`], expected: `a` },
  { active: `gone`, ids: [`a`, `b`], expected: `a` },
  { active: `b`, ids: [`b`, `a`], expected: `b` },
  { active: `b`, ids: [], expected: undefined },
])(`volume selection follows IDs: $active in $ids`, ({ active, ids, expected }) => {
  const volumes = ids.map((id) => make_volume_fixture([[[1]]], { id }))
  expect(normalize_active_volume_id(active, volumes)).toBe(expected)
})

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
  test(`wraps one auto layer on the supplied volume in the default settings`, () => {
    const vol = vol_with_range(-5, 10)
    const settings = auto_isosurface_settings(vol)
    expect(settings).toEqual({
      ...DEFAULT_ISOSURFACE_SETTINGS,
      layers: [auto_volume_layer(vol)],
    })
    // a fresh layers array, not the defaults' own
    settings.layers.push(settings.layers[0])
    expect(DEFAULT_ISOSURFACE_SETTINGS.layers).toEqual([])
  })
})

describe(`auto_volume_layer`, () => {
  test(`sets isovalue to 20% of abs_max and binds volume_id`, () => {
    const layer = auto_volume_layer(vol_with_range(0, 10))
    expect(layer.isovalue).toBeCloseTo(2)
    expect(layer.volume_id).toBe(`0`)
    expect(layer.visible).toBe(true)
    expect(layer.color_volume_id).toBeUndefined()
  })

  test.each([
    { min: -5, max: 10, show_negative: true, label: `signed data` },
    { min: 0, max: 10, show_negative: false, label: `non-negative data` },
    { min: -0.005, max: 1, show_negative: false, label: `negatives below the 1% threshold` },
  ])(`$label sets show_negative=$show_negative`, ({ min, max, show_negative }) => {
    expect(auto_volume_layer(vol_with_range(min, max)).show_negative).toBe(show_negative)
  })

  test(`color_offset picks successive palette colors`, () => {
    const vol = vol_with_range(0, 10)
    expect(auto_volume_layer(vol, 0).color).toBe(LAYER_COLORS[0])
    expect(auto_volume_layer(vol, 1).color).toBe(LAYER_COLORS[1])
    expect(auto_volume_layer(vol, LAYER_COLORS.length).color).toBe(LAYER_COLORS[0])
  })

  test(`falls back to a small positive isovalue for all-zero data`, () => {
    expect(auto_volume_layer(vol_with_range(0, 0)).isovalue).toBe(0.05)
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
      const layer = auto_volume_layer(vol_with_range(-5, 10), 1, shell_idx)
      expect(layer.isovalue).toBeCloseTo(10 * fraction)
      expect(layer.opacity).toBe(opacity)
      expect(layer).toMatchObject({
        volume_id: `0`,
        color: LAYER_COLORS[1],
        show_negative: true,
      })
    },
  )

  test(`successive shells of one volume never coincide and inner shells are more opaque`, () => {
    const vol = vol_with_range(0, 10)
    const shells = SHELL_STEPS.map((_step, idx) => auto_volume_layer(vol, idx, idx))
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

test.each([
  { ids: [`a`, `a`], error: /Duplicate volume id: a/ },
  { ids: [` `], error: /nonempty string/ },
])(`rejects ambiguous volume IDs $ids`, ({ ids, error }) => {
  const volume = make_volume_fixture([[[1]]])
  expect(() => index_volumes(ids.map((id) => ({ ...volume, id })))).toThrow(error)
})

describe(`remove_volume`, () => {
  test.each([`geometry`, `color`, `unrelated`] as const)(
    `removing a %s source preserves surviving identities`,
    (removed) => {
      const volumes = [`geometry`, `color`, `unrelated`].map((id) =>
        make_volume_fixture([[[1]]], { id }),
      )
      const layer = { ...auto_volume_layer(volumes[0]), color_volume_id: `color` }
      const result = remove_volume(volumes, [layer], removed)
      expect(result.volumes.map(({ id }) => id)).toEqual(
        volumes.filter(({ id }) => id !== removed).map(({ id }) => id),
      )
      expect(result.layers).toEqual(
        removed === `geometry`
          ? []
          : [{ ...layer, color_volume_id: removed === `color` ? undefined : `color` }],
      )
    },
  )
})

describe(`label_file_volumes`, () => {
  const vol = (label?: string): VolumetricData =>
    make_volume_fixture(make_grid(2, 2, 2, 1), { id: label ?? `scalar`, label })

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

describe(`merge_imported_volumes`, () => {
  const source_volume = (id: string, source = `CHGCAR`, fill = 1) =>
    make_volume_fixture([[[fill]]], { id, source, label: id })

  test.each([`reorder`, `remove`, `append`] as const)(
    `source %s preserves retained geometry/color settings and selection`,
    (action) => {
      const original = [
        source_volume(`charge`),
        source_volume(`spin`),
        source_volume(`esp`, `esp.cube`),
      ]
      const tuned = {
        ...auto_volume_layer(original[0]),
        isovalue: 0.42,
        color_volume_id: `esp`,
      }
      const retained = { ...auto_volume_layer(original[2]), color_volume_id: `spin` }
      const incoming =
        action === `remove`
          ? [source_volume(`charge`, `CHGCAR`, 9)]
          : [
              source_volume(`spin`),
              source_volume(`charge`, `CHGCAR`, 9),
              ...(action === `append` ? [source_volume(`extra`)] : []),
            ]
      const result = merge_imported_volumes(original.toReversed(), [tuned, retained], incoming)
      expect(result.volumes.find(({ id }) => id === `charge`)?.values[0]).toBe(9)
      expect(result.layers[0]).toBe(tuned)
      expect(result.layers[1]).toEqual({
        ...retained,
        color_volume_id: action === `remove` ? undefined : `spin`,
      })
      expect(result.layers.map(({ volume_id }) => volume_id)).toEqual([
        `charge`,
        `esp`,
        ...(action === `append` ? [`extra`] : []),
      ])
      expect(normalize_active_volume_id(`esp`, result.volumes)).toBe(`esp`)
      expect(result.n_added).toBe(action === `append` ? 1 : 0)
      expect(result.volumes.map(({ id }) => id)).toEqual([
        `esp`,
        ...(action !== `remove` ? [`spin`] : []),
        `charge`,
        ...(action === `append` ? [`extra`] : []),
      ])
    },
  )
  test(`replacement preserves an intentionally empty layer set`, () => {
    const volume = source_volume(`charge`)
    expect(merge_imported_volumes([volume], [], [{ ...volume }]).layers).toEqual([])
  })
})

describe(`volume_from_json`, () => {
  const base = {
    id: `density`,
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
    [{ ...base, grid: [[[1]]], id: undefined }, /nonempty string/],
    [42, /must be an object/],
  ])(`rejects malformed payload %#`, (payload, expected) => {
    expect(() => volume_from_json(payload)).toThrow(expected)
  })
})
