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
  isovalue_histogram,
  remove_volume,
  SHELL_STEPS,
  snap_isovalue,
  surface_isovalue_band,
  volume_from_json,
} from '#lib/isosurface/types.js'
import type { VolumetricData } from '#lib/isosurface/types.js'
import { flatten_grid } from '#lib/isosurface/grid.js'
import { describe, expect, test } from 'vitest'
import { grid_value, make_grid, make_volume as make_volume_fixture } from '../test-fixtures'

test.each([
  { active: undefined, ids: [`a`, `b`], expected: `a` },
  { active: `gone`, ids: [`a`, `b`], expected: `a` },
  { active: `b`, ids: [`b`, `a`], expected: `b` },
  { active: `b`, ids: [], expected: undefined },
])(`volume selection follows IDs: $active in $ids`, ({ active, ids, expected }) => {
  const volumes = ids.map((identifier) => make_volume_fixture([[[1]]], { id: identifier }))
  expect(normalize_active_volume_id(active, volumes)).toBe(expected)
})

describe(`grid_data_range`, () => {
  // oxfmt-ignore
  test.each([
    [`all-positive`, [[[1, 2], [3, 4]], [[5, 6], [7, 8]]], [1, 8, 8, 4.5]],
    [`mixed pos/neg`, [[[-5, 2], [3, -1]], [[0, 6], [-7, 4]]], [-7, 6, 7, 0.25]],
    [`abs_max driven by min`, [[[-10, 1]]], [-10, 1, 10, -4.5]],
    [`uniform zero`, [[[0, 0], [0, 0]]], [0, 0, 0, 0]],
    [`single element`, [[[42]]], [42, 42, 42, 42]],
    [`single negative`, [[[-3.5]]], [-3.5, -3.5, 3.5, -3.5]],
    [`empty grid`, [], [0, 0, 0, 0]],
  ] as [string, number[][][], number[]][])(`%s: [min, max, abs_max, mean] = %j`, (_label, grid, [min, max, abs_max, mean]) => {
    const range = grid_data_range(grid.length ? flatten_grid(grid).values : [])
    expect(range).toEqual({ min, max, abs_max, mean: expect.closeTo(mean) })
  })
})

const vol_with_range = (min: number, max: number, signed?: boolean): VolumetricData =>
  make_volume_fixture(make_grid(2, 2, 2, 1), {
    data_range: { min, max, abs_max: Math.max(Math.abs(min), Math.abs(max)), mean: 0 },
    ...(signed === undefined ? {} : { signed }),
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
  test(`defaults to a visible 20%-of-abs_max layer bound to the volume, palette color by offset`, () => {
    const vol = vol_with_range(0, 10)
    const layer = auto_volume_layer(vol)
    expect(layer.isovalue).toBeCloseTo(2)
    expect(layer).toMatchObject({ volume_id: `0`, visible: true, color: LAYER_COLORS[0] })
    expect(layer.color_volume_id).toBeUndefined()
    expect(auto_volume_layer(vol, 1).color).toBe(LAYER_COLORS[1])
    expect(auto_volume_layer(vol, LAYER_COLORS.length).color).toBe(LAYER_COLORS[0])
    // all-zero data falls back to a small positive isovalue
    expect(auto_volume_layer(vol_with_range(0, 0)).isovalue).toBe(0.05)
  })

  test.each([
    { min: -5, max: 10, show_negative: true, label: `signed data` },
    { min: 0, max: 10, show_negative: false, label: `non-negative data` },
    { min: -0.005, max: 1, show_negative: false, label: `negatives below the 1% threshold` },
    // A charge density's negative values are artifacts: the host's hint overrides the data.
    { min: -0.5, max: 10, signed: false, show_negative: false, label: `signed=false` },
    { min: 0, max: 10, signed: true, show_negative: true, label: `signed=true` },
  ])(`$label sets show_negative=$show_negative`, ({ min, max, signed, show_negative }) => {
    expect(auto_volume_layer(vol_with_range(min, max, signed)).show_negative).toBe(
      show_negative,
    )
  })

  // Repeated "+" clicks on one volume used to stack coincident 20%/0.6 surfaces. Shells
  // step the 0.8 → 0.1 ladder like the old generate_layers: distinct isovalues, inner
  // (high-isovalue) shells more opaque than outer ones.
  test.each([
    [0, 0.2, 0.6],
    [1, 0.8, 0.8],
    [2, 0.5, 0.7],
    [3, 0.1, 0.3],
    [SHELL_STEPS.length, 0.2, 0.6], // wraps around
  ])(`shell %i sits at %s·abs_max with opacity %s`, (shell_idx, fraction, opacity) => {
    const layer = auto_volume_layer(vol_with_range(-5, 10), 1, shell_idx)
    expect(layer.isovalue).toBeCloseTo(10 * fraction)
    expect(layer.opacity).toBe(opacity)
    expect(layer).toMatchObject({
      volume_id: `0`,
      color: LAYER_COLORS[1],
      show_negative: true,
    })
  })

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
  expect(() =>
    index_volumes(ids.map((identifier) => ({ ...volume, id: identifier }))),
  ).toThrow(error)
})

describe(`remove_volume`, () => {
  test.each([`geometry`, `color`, `unrelated`] as const)(
    `removing a %s source preserves surviving identities`,
    (removed) => {
      const volumes = [`geometry`, `color`, `unrelated`].map((identifier) =>
        make_volume_fixture([[[1]]], { id: identifier }),
      )
      const layer = { ...auto_volume_layer(volumes[0]), color_volume_id: `color` }
      const result = remove_volume(volumes, [layer], removed)
      expect(result.volumes.map(({ id: identifier }) => identifier)).toEqual(
        volumes
          .filter(({ id: identifier }) => identifier !== removed)
          .map(({ id: identifier }) => identifier),
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
    expect(labeled).toMatchObject({
      label: `esp.cube`,
      source: `esp.cube`,
      source_filename: `esp.cube.gz`,
    })
    // an explicit source filename stays separate from the logical parse filename
    const [renamed] = label_file_volumes([vol()], `esp.cube`, `esp.cube.gz`)
    expect([renamed.source, renamed.source_filename]).toEqual([`esp.cube`, `esp.cube.gz`])
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

  // block labels when present, else 1-based positions
  test.each([
    [
      [`charge`, `magnetization`],
      `Fe-CHGCAR.bz2`,
      [`Fe-CHGCAR: charge`, `Fe-CHGCAR: magnetization`],
    ],
    [[undefined, undefined], `density.cube`, [`density.cube: 1`, `density.cube: 2`]],
  ])(
    `multi-block %j in %s share one source with "file: block" labels`,
    (block_labels, filename, expected) => {
      const labeled = label_file_volumes(block_labels.map(vol), filename)
      expect(labeled.map((entry) => entry.label)).toEqual(expected)
      expect(new Set(labeled.map((entry) => entry.source))).toEqual(
        new Set([expected[0].split(`:`)[0]]),
      )
    },
  )
})

describe(`merge_imported_volumes`, () => {
  const source_volume = (identifier: string, source = `CHGCAR`, fill = 1) =>
    make_volume_fixture([[[fill]]], { id: identifier, source, label: identifier })

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
      const incoming = [source_volume(`charge`, `CHGCAR`, 9)]
      if (action !== `remove`) incoming.unshift(source_volume(`spin`))
      if (action === `append`) incoming.push(source_volume(`extra`))
      const result = merge_imported_volumes(original.toReversed(), [tuned, retained], incoming)
      expect(
        result.volumes.find(({ id: identifier }) => identifier === `charge`)?.values[0],
      ).toBe(9)
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
      expect(result.volumes.map(({ id: identifier }) => identifier)).toEqual([
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
    const grid = make_grid(2, 3, 4, (idx_x, idx_y, idx_z) => 100 * idx_x + 10 * idx_y + idx_z)
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

  test.each([true, false, undefined])(`keeps the signed hint %s`, (signed) => {
    const vol = volume_from_json({ ...base, grid: [[[1]]], signed })
    expect(vol.signed).toBe(signed)
    expect(`signed` in vol).toBe(signed !== undefined)
  })

  test.each([
    [{ ...base, grid: [[[1, 2]], [[3]]] }, /Ragged grid/],
    [{ ...base, values: [1, 2, 3], dims: [2, 2, 2] }, /does not match dims/],
    [{ ...base, values: [1], dims: [1, 1] }, /needs dims/],
    [{ ...base }, /nested grid or flat values/],
    [{ ...base, grid: [[[1]]], lattice: [[1, 0, 0]] }, /3x3 lattice/],
    [{ ...base, grid: [[[1]]], periodic: `yes` }, /boolean periodic/],
    [{ ...base, grid: [[[1]]], signed: `no` }, /signed flag must be a boolean/],
    [{ ...base, grid: [[[1]]], id: undefined }, /nonempty string/],
    [42, /must be an object/],
  ])(`rejects malformed payload %#`, (payload, expected) => {
    expect(() => volume_from_json(payload)).toThrow(expected)
  })
})

// The isovalue slider spans (0, abs_max], but surfaces only exist for part of it: below a
// density's minimum every corner is inside, above its maximum none is
describe(`isovalue slider aids`, () => {
  test.each([
    { min: 0.05, max: 0.91, show_negative: false, band: [0.05, 0.91] },
    { min: 0.05, max: 0.91, show_negative: true, band: [0.05, 0.91] }, // no negative values
    { min: -0.5, max: 0.2, show_negative: false, band: [0, 0.2] },
    { min: -0.5, max: 0.2, show_negative: true, band: [0, 0.5] }, // mirror lobe to |min|
    { min: -3, max: -1, show_negative: true, band: [1, 3] }, // only the mirror draws
    { min: -3, max: -1, show_negative: false, band: null },
  ])(`surface band of [$min, $max] (neg. lobe $show_negative)`, ({ band, ...rest }) => {
    expect(surface_isovalue_band(rest, rest.show_negative)).toEqual(band)
  })

  // slider: min = step = 0.01 (steps at 0.01 k), band (0.0501, 0.913], reach 0.03
  const slider = { min: 0.01, step: 0.01, reach: 0.03 }
  const band: [number, number] = [0.0501, 0.913]
  test.each([
    [0.04, true, 0.2, 0.06, `just below: up to the first step drawing a surface`],
    [0.04, false, 0.06, 0.04, `a keyboard step from the edge passes through`],
    [0.04, true, 0.06, 0.06, `a drag stays at the edge`],
    [0.01, true, 0.06, 0.01, `beyond reach: free`],
    [0.92, true, 0.5, 0.91, `just above: down to the last step`],
    [0.5, true, 0.4, 0.5, `inside: untouched`],
    [0.913, true, 0.5, 0.913, `the band's top still draws`],
  ] as [number, boolean, number, number, string][])(
    `snap %s (sticky=%s, previous %s) → %s: %s`,
    (value, sticky, previous, expected) => {
      const snapped = snap_isovalue(value, band, { ...slider, sticky, previous })
      expect(snapped).toBeCloseTo(expected, 12)
    },
  )

  test(`snap leaves values alone without a band or when it is narrower than a step`, () => {
    const options = { ...slider, sticky: true, previous: 0 }
    expect(snap_isovalue(0.04, null, options)).toBe(0.04)
    expect(snap_isovalue(0.04, [0.0501, 0.0502], options)).toBe(0.04)
  })

  test(`histogram counts values (or |values| when mirrored) over the slider span`, () => {
    const vol = make_volume_fixture([[[-0.9, -0.1, 0.1, 0.35, 0.6, 0.95, 1, Number.NaN]]])
    expect([...isovalue_histogram(vol, [0, 1], false, 4)]).toEqual([1, 1, 1, 2])
    expect([...isovalue_histogram(vol, [0, 1], true, 4)]).toEqual([2, 1, 1, 3])
    // cached per volume and arguments
    expect(isovalue_histogram(vol, [0, 1], true, 4)).toBe(
      isovalue_histogram(vol, [0, 1], true, 4),
    )
  })
})
