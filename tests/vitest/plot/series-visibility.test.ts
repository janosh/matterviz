import type { DataSeries } from '$lib/plot'
import {
  create_legend_visibility,
  LEGEND_VISIBILITY_MODES,
  legend_mode_to_prop,
  resolve_legend_visibility,
} from '$lib/plot/core/utils/series-visibility'
import { describe, expect, test } from 'vitest'

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

describe(`legend toggles`, () => {
  test.each<[string, Partial<DataSeries>[], boolean[]]>([
    [`toggles a single series`, [{ visible: true }, { visible: true }], [false, true]],
    [
      `toggles matching labels`,
      [{ label: `A` }, { label: `B` }, { label: `A` }],
      [false, true, false],
    ],
    [
      `treats missing and empty legend groups alike`,
      [{ label: `A` }, { label: `A`, legend_group: `` }, { label: `A`, legend_group: `B` }],
      [false, false, true],
    ],
    [`shares an axis without units`, [{ visible: false }, {}], [true, true]],
    [
      `shares an axis when only one series has units`,
      [{ visible: false, unit: `eV` }, {}],
      [true, true],
    ],
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
    const raw = series.map((srs) =>
      Object.freeze({ x: [], y: [], y_axis: `y` as const, ...srs }),
    )
    const { vis, visible, store } = make_store(raw)
    vis.on_toggle(0)
    expect(visible()).toEqual(expected)
    expect(store.raw).toBe(raw)
  })
})

describe(`legend group toggles`, () => {
  test.each([
    [`hides all when all visible`, [true, true, true], [0, 1], [false, false, true]],
    [`shows all when some hidden`, [false, true, true], [0, 1], [true, true, true]],
    [`shows all when all in group hidden`, [false, false, true], [0, 1], [true, true, true]],
    [`handles single index`, [true, true], [0], [false, true]],
    [
      `handles non-contiguous indices`,
      [true, true, true, true],
      [0, 2],
      [false, true, false, true],
    ],
    [
      `defaults undefined visibility to true`,
      [undefined, undefined, undefined],
      [0, 1],
      [false, false, true],
    ],
  ] as const)(`%s`, (_desc, visibilities, indices, expected) => {
    const series: DataSeries[] = visibilities.map((vis, idx) => ({
      x: [idx],
      y: [idx],
      visible: vis,
    }))
    series.forEach(Object.freeze)
    const { vis, visible, store } = make_store(series)
    vis.on_group_toggle(`Group`, [...indices])
    expect(visible()).toEqual(expected)
    expect(store.raw).toBe(series)
  })

  test.each([{ indices: [] }, { indices: [-1, 10] }, { indices: [0, 0, -1, 5] }])(
    `ignores invalid group indices $indices`,
    ({ indices }) => {
      const raw = [{ id: `a`, x: [1], y: [2], label: `A`, unit: `eV` }]
      raw.forEach(Object.freeze)
      const { vis, visible, store } = make_store(raw)
      vis.on_group_toggle(`Group`, indices)
      expect(visible()).toEqual([!indices.includes(0)])
      expect(store.raw).toBe(raw)
    },
  )
})

describe(`create_legend_visibility`, () => {
  test.each([-1, 10])(`ignores invalid series index %s`, (idx) => {
    const { vis, visible } = make_store([{ x: [], y: [] }])
    vis.on_toggle(idx)
    expect(visible()).toEqual([true])
  })

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
    (identifier) => {
      const initial = [{ id: identifier, x: [1], y: [2], visible: false }]
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
      const drawing = (identifier: string, legend_id: string): DataSeries => ({
        id: identifier,
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
