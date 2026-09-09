import type { DataSeries } from '$lib/plot'
import {
  create_legend_visibility,
  can_share_axis,
  LEGEND_VISIBILITY_MODES,
  legend_mode_to_prop,
  resolve_legend_visibility,
  toggle_group_visibility,
  toggle_series_visibility,
} from '$lib/plot/core/utils/series-visibility'
import { describe, expect, test } from 'vitest'

describe(`resolve_legend_visibility`, () => {
  // oxfmt-ignore
  test.each([
    [true, null, 5, undefined, false], // legend=null always wins
    [true, undefined, 5, undefined, false],
    [true, {}, 0, undefined, false], // nothing to label
    [true, {}, 1, undefined, true],
    [false, {}, 5, undefined, false],
    [true, {}, 3, false, true], // explicit overrides opt-in families
    [undefined, {}, 2, undefined, true], // cartesian auto
    [undefined, {}, 1, undefined, false],
    [undefined, {}, 9, false, false], // hierarchy/Sankey opt-in
    [false, {}, 3, true, false], // explicit false beats an opted-in auto too
    [true, {}, 0, false, false], // no entries beats everything
  ] as [boolean | undefined, unknown, number, boolean | undefined, boolean][])(
    `show=%s legend=%s entries=%s auto=%s → %s`,
    (show_legend, legend, entry_count, auto_default, expected) => {
      expect(resolve_legend_visibility(show_legend, legend, entry_count, auto_default)).toBe(
        expected,
      )
    },
  )
})

describe(`legend_mode_to_prop`, () => {
  test(`only auto defers to the entry-count rule`, () => {
    expect(LEGEND_VISIBILITY_MODES).toEqual([`auto`, `always`, `never`])
    expect(LEGEND_VISIBILITY_MODES.map(legend_mode_to_prop)).toEqual([undefined, true, false])
    const resolved = (entry_count: number) =>
      LEGEND_VISIBILITY_MODES.map((mode) =>
        resolve_legend_visibility(legend_mode_to_prop(mode), {}, entry_count),
      )
    expect(resolved(1)).toEqual([false, true, false])
    expect(resolved(3)).toEqual([true, true, false])
    expect(() => legend_mode_to_prop(`sometimes` as never)).toThrow(
      `Invalid legend visibility mode: sometimes`,
    )
  })
})

describe(`can_share_axis`, () => {
  test.each([
    { unit1: undefined, unit2: undefined, expected: true, desc: `both have no units` },
    { unit1: `eV`, unit2: undefined, expected: true, desc: `only one has a unit` },
    { unit1: `eV`, unit2: `eV`, expected: true, desc: `both have same unit` },
    { unit1: `eV`, unit2: `GPa`, expected: false, desc: `different units` },
  ])(`returns $expected when $desc`, ({ unit1, unit2, expected }) => {
    expect(can_share_axis({ unit: unit1 }, { unit: unit2 })).toBe(expected)
  })
})

describe(`toggle_series_visibility`, () => {
  test(`toggles visibility of a single series`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], visible: true },
      { x: [3], y: [4], visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result[0].visible).toBe(false)
    expect(result[1].visible).toBe(true)
  })

  test.each([
    { idx: -1, desc: `negative index` },
    { idx: 10, desc: `out of bounds index` },
  ])(`returns original series for $desc`, ({ idx }) => {
    const series: DataSeries[] = [{ x: [1], y: [2] }]
    expect(toggle_series_visibility(series, idx)).toBe(series)
  })

  test(`toggles all series with the same label`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: true },
      { x: [5], y: [6], label: `A`, visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result.map((srs) => srs.visible)).toEqual([false, true, false])
  })

  test.each<[string, Partial<DataSeries>[], boolean[]]>([
    [
      `hides incompatible units`,
      [
        { unit: `eV`, visible: false },
        { unit: `GPa`, visible: true },
      ],
      [true, false],
    ],
    [
      `keeps compatible units visible`,
      [
        { unit: `eV`, visible: false },
        { unit: `eV`, visible: true },
        { unit: `GPa`, visible: true },
      ],
      [true, true, false],
    ],
    [
      `only affects series on the same y-axis`,
      [
        { unit: `eV`, y_axis: `y`, visible: false },
        { unit: `eV`, y_axis: `y2`, visible: true },
        { unit: `GPa`, y_axis: `y`, visible: true },
      ],
      [true, true, false],
    ],
    [
      `replaces distinct axis groups even with the same unit`,
      [
        { id: `scf`, unit: `eV`, axis_group: `scf`, y_axis: `y`, visible: false },
        { id: `energy`, unit: `eV`, y_axis: `y` },
        { id: `force`, unit: `eV/A`, y_axis: `y2` },
      ],
      [true, false, true],
    ],
  ])(`%s when showing a series`, (_name, series, expected) => {
    const result = toggle_series_visibility(
      series.map((srs) => ({ x: [], y: [], ...srs })),
      0,
    )
    expect(result.map((srs) => srs.visible ?? true)).toEqual(expected)
  })
})

describe(`toggle_group_visibility`, () => {
  test.each([
    {
      desc: `hides all when all visible`,
      visibilities: [true, true, true],
      indices: [0, 1],
      expected: [false, false, true],
    },
    {
      desc: `shows all when some hidden`,
      visibilities: [false, true, true],
      indices: [0, 1],
      expected: [true, true, true],
    },
    {
      desc: `shows all when all in group hidden`,
      visibilities: [false, false, true],
      indices: [0, 1],
      expected: [true, true, true],
    },
    {
      desc: `handles single index`,
      visibilities: [true, true],
      indices: [0],
      expected: [false, true],
    },
    {
      desc: `handles non-contiguous indices`,
      visibilities: [true, true, true, true],
      indices: [0, 2],
      expected: [false, true, false, true],
    },
    {
      desc: `handles undefined visibility (defaults to true)`,
      visibilities: [undefined, undefined, undefined],
      indices: [0, 1],
      expected: [false, false, undefined],
    },
  ])(`$desc`, ({ visibilities, indices, expected }) => {
    const series: DataSeries[] = visibilities.map((vis, idx) => ({
      x: [idx],
      y: [idx],
      visible: vis,
    }))
    const result = toggle_group_visibility(series, indices)
    expect(result.map((srs) => srs.visible)).toEqual(expected)
  })

  test(`returns original series for empty indices array`, () => {
    const series: DataSeries[] = [{ x: [1], y: [2], visible: true }]
    expect(toggle_group_visibility(series, [])).toBe(series)
  })

  test(`preserves other series properties and handles out-of-bounds indices`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true, unit: `eV` },
      { x: [3], y: [4], label: `B`, visible: true, unit: `GPa` },
    ]
    const result = toggle_group_visibility(series, [0, 0, -1, 5]) // duplicates and out-of-bounds indices
    expect(result[0]).toMatchObject({ visible: false, unit: `eV`, label: `A` })
    expect(result[1]).toMatchObject({ visible: true, unit: `GPa`, label: `B` })
  })
})

describe(`create_legend_visibility`, () => {
  const make_store = (initial: DataSeries[]) => {
    const store: { raw: DataSeries[]; hidden?: readonly (string | number)[] } = {
      raw: initial,
    }
    const vis = create_legend_visibility(
      (): DataSeries[] => vis.resolve(store.raw),
      () => store.hidden,
      (next) => {
        store.hidden = next
      },
    )
    return {
      store,
      vis,
      visible: () => vis.resolve(store.raw).map((srs) => srs.visible ?? true),
    }
  }

  test(`legend state survives reordering and replacement without changing input data`, () => {
    const initial = [
      { id: `a`, x: [1], y: [2] },
      { id: `b`, x: [3], y: [4] },
    ]
    initial.forEach(Object.freeze)
    const { store, vis, visible } = make_store(initial)
    vis.on_toggle(0)
    expect(store.raw).toBe(initial)
    expect(store.hidden).toEqual([`a`])
    store.raw = initial.toReversed().map((srs) => ({ ...srs, label: `Renamed` }))
    expect(visible()).toEqual([true, false])
    store.hidden = []
    expect(visible()).toEqual([true, true])
  })

  test.each([undefined, `a`, 0])(
    `initially hidden series %s can be shown without rewriting it`,
    (id) => {
      const initial = [{ id, x: [1], y: [2], visible: false }]
      const { store, vis, visible } = make_store(initial)
      expect(visible()).toEqual([false])
      vis.on_toggle(0)
      expect(visible()).toEqual([true])
      expect(store.hidden).toEqual([])
      expect(initial[0].visible).toBe(false)
    },
  )

  test(`isolate/restore follows stable IDs across reorder and preserves hidden series`, () => {
    const { store, vis, visible } = make_store([
      { id: `a`, x: [1], y: [2] },
      { id: `b`, x: [3], y: [4] },
      { id: `c`, x: [5], y: [6], visible: false },
    ])
    vis.on_double_click(0)
    expect(visible()).toEqual([true, false, false])
    store.raw = store.raw.toReversed()
    vis.on_double_click(2)
    expect(visible()).toEqual([false, true, true])
    vis.on_group_toggle(`group`, [0, 1])
    expect(visible()).toEqual([true, true, true])
  })
  test(`explicit IDs with identical labels toggle and isolate independently`, () => {
    const { vis, visible } = make_store([
      { id: `a`, label: `Same`, x: [1], y: [2] },
      { id: `b`, label: `Same`, x: [3], y: [4] },
    ])
    vis.on_toggle(0)
    expect(visible()).toEqual([false, true])
    vis.on_double_click(0)
    expect(visible()).toEqual([true, false])
    vis.on_double_click(0)
    expect(visible()).toEqual([false, true])
  })

  test.each([`toggle`, `group`, `isolate`] as const)(
    `%s follows shared legend IDs through drawing replacement and reorder`,
    (action) => {
      const drawing = (id: string, legend_id: string): DataSeries => ({
        id,
        legend_id,
        label: `Same`,
        x: [],
        y: [],
      })
      const { store, vis, visible } = make_store([
        drawing(`a1`, `a`),
        drawing(`a2`, `a`),
        drawing(`b1`, `b`),
        drawing(`c1`, `c`),
      ])
      store.hidden = [`c`]
      if (action === `toggle`) vis.on_toggle(0)
      else if (action === `group`) vis.on_group_toggle(`Group`, [0])
      else vis.on_double_click(2)
      expect(store.hidden).toEqual([`a`, `c`])
      expect(visible()).toEqual([false, false, true, false])
      store.raw = [drawing(`c2`, `c`), drawing(`b2`, `b`), drawing(`a3`, `a`)]
      expect(visible()).toEqual([false, true, false])
      if (action === `toggle`) vis.on_toggle(2)
      else if (action === `group`) vis.on_group_toggle(`Group`, [2])
      else vis.on_double_click(1)
      expect(store.hidden).toEqual([`c`])
      expect(visible()).toEqual([false, true, true])
    },
  )

  test.each([false, true])(
    `rejects ambiguous legend/drawing keys (reversed=%s)`,
    (reverse) => {
      const series = [
        { id: `a`, legend_id: `shared`, x: [], y: [] },
        { id: `shared`, x: [], y: [] },
      ]
      expect(() => make_store(reverse ? series.toReversed() : series).visible()).toThrow(
        `Legend key "shared" conflicts with a drawing series ID`,
      )
    },
  )

  test(`rejects a shared identity spanning different legend headers`, () => {
    expect(() =>
      make_store([
        { id: `a`, legend_id: `shared`, legend_group: `First`, x: [], y: [] },
        { id: `b`, legend_id: `shared`, legend_group: `Second`, x: [], y: [] },
      ]).visible(),
    ).toThrow(`Legend key "shared" spans different legend groups`)
  })

  test.each([`toggle`, `group`, `external`, `replacement`] as const)(
    `%s invalidates an old isolation snapshot`,
    (action) => {
      const { store, vis, visible } = make_store([
        { id: `a`, x: [1], y: [2] },
        { id: `b`, x: [3], y: [4] },
        { id: `c`, x: [5], y: [6] },
      ])
      vis.on_double_click(0)
      if (action === `toggle`) vis.on_toggle(2)
      else if (action === `group`) vis.on_group_toggle(`Other`, [2])
      else if (action === `external`) store.hidden = [`b`]
      else
        store.raw = store.raw.map((srs) => ({
          ...srs,
          id: `new-${srs.id}`,
          visible: srs.id !== `b`,
        }))
      const expected = visible()
      vis.on_double_click(0)
      vis.on_double_click(0)
      expect(visible()).toEqual(expected)
    },
  )

  test(`rejects ambiguous explicit IDs and index-derived keys`, () => {
    expect(() =>
      make_store([
        { id: 1, x: [], y: [] },
        { x: [], y: [] },
      ]).visible(),
    ).toThrow(`Series keys must be unique`)
  })
  test.each([`toggle`, `group`, `isolate`] as const)(
    `%s preserves hidden IDs absent from a filtered series array`,
    (action) => {
      const { store, vis, visible } = make_store([
        { id: `b`, x: [], y: [] },
        { id: `c`, x: [], y: [] },
      ])
      store.hidden = [`a`, `a`]
      if (action === `toggle`) vis.on_toggle(0)
      else if (action === `group`) vis.on_group_toggle(`Group`, [0])
      else {
        vis.on_double_click(0)
        vis.on_double_click(0)
      }
      expect(store.hidden).toContain(`a`)
      expect(visible()).toEqual([action === `isolate`, true])
      store.raw = [{ id: `a`, x: [], y: [] }, ...store.raw]
      expect(visible()[0]).toBe(false)
    },
  )
})
