import { tile_plot_marks } from '#lib/periodic-table/tile-plots'
import { describe, expect, test } from 'vite-plus/test'

type Args = Parameters<typeof tile_plot_marks>
const bar = (x0: string, top: string, width: string) => `M${x0} 100V${top}h${width}V100Z`

describe(`tile_plot_marks`, () => {
  // Histograms share bin edges across tiles and scale to each tile's tallest bin; x/y plots
  // share both axes. Non-finite and out-of-range values are dropped, empty tiles get no marks.
  test.each<[string, Args, ReturnType<typeof tile_plot_marks>[`marks`]]>([
    [
      `histograms on shared bins, ±Inf ignored for the range`,
      [{ H: { values: [0, 1, 1, NaN] }, He: { values: [3, Infinity] } }, { bins: 3 }],
      {
        H: [
          { kind: `bars`, d: bar(`0.00`, `50.00`, `33.33`) + bar(`33.33`, `0.00`, `33.33`) },
        ],
        He: [{ kind: `bars`, d: bar(`66.67`, `0.00`, `33.33`) }],
      },
    ],
    [
      `x_range drops outside values and empty tiles; null and undefined entries skip`,
      [
        { H: { values: [-5, 0.5] }, He: { values: [9] }, Li: null, Be: undefined },
        { bins: 1, x_range: [0, 1] },
      ],
      { H: [{ kind: `bars`, d: bar(`0.00`, `0.00`, `100.00`) }] },
    ],
    [
      // numpy bins 0.3 in [0, 1] / 10 into bin 3 although 0.3 / 0.1 = 2.9999999999999996
      `values on inner edges go to the bin above, like numpy`,
      [{ H: { values: [0.3, 0.6, 0.7, 1] } }, { bins: 10, x_range: [0, 1] }],
      {
        H: [
          {
            kind: `bars`,
            d: [`30.00`, `60.00`, `70.00`, `90.00`]
              .map((x0) => bar(x0, `0.00`, `10.00`))
              .join(``),
          },
        ],
      },
    ],
    [
      `log_y heights`,
      [{ H: { values: [0, 1, 1, 1] } }, { bins: 2, log_y: true }],
      {
        H: [
          { kind: `bars`, d: bar(`0.00`, `50.00`, `50.00`) + bar(`50.00`, `0.00`, `50.00`) },
        ],
      },
    ],
    [
      // Python None arrives as null, which compares like 0: dropped, not binned or drawn at 0
      `null values on ranges spanning 0`,
      [{ H: { values: [null, null, -1, 1] as never }, He: { values: [-1] } }, { bins: 2 }],
      {
        H: [{ kind: `bars`, d: bar(`0.00`, `0.00`, `50.00`) + bar(`50.00`, `0.00`, `50.00`) }],
        He: [{ kind: `bars`, d: bar(`0.00`, `0.00`, `50.00`) }],
      },
    ],
    [
      `null x/y points dropped`,
      [{ Li: { x: [null, -1, 1] as never, y: [0.5, -1, 1] } }, {}],
      { Li: [{ kind: `markers`, d: `M0.00 100.00h0M100.00 0.00h0` }] },
    ],
    [
      `markers on shared axes`,
      [{ Li: { x: [0, 1], y: [0, NaN] }, Na: { x: [2], y: [4] } }, {}],
      {
        Li: [{ kind: `markers`, d: `M0.00 100.00h0` }],
        Na: [{ kind: `markers`, d: `M100.00 0.00h0` }],
      },
    ],
    [
      `line broken at a non-finite gap and at a point outside y_range`,
      [
        { Li: { x: [0, 1, 2, 3, 4], y: [0, NaN, 1, 9, 2] } },
        { mode: `line`, y_range: [null, 2] },
      ],
      { Li: [{ kind: `line`, d: `M0.00 100.00M50.00 50.00M100.00 0.00` }] },
    ],
    [
      `line+markers with a series color; single-value ranges padded`,
      [{ Li: [{ x: [1, 1], y: [2, 2], color: `red` }] }, { mode: `line+markers` }],
      {
        Li: [
          { kind: `line`, d: `M50.00 50.00L50.00 50.00`, color: `red` },
          { kind: `markers`, d: `M50.00 50.00h0M50.00 50.00h0`, color: `red` },
        ],
      },
    ],
  ])(`%s`, (_name, args, expected) => {
    expect(tile_plot_marks(...args).marks).toEqual(expected)
  })

  test(`axes: shared x, per-tile histogram max shared by its overlaid series`, () => {
    const { marks, axes } = tile_plot_marks(
      {
        H: [{ values: [0, 0, 1] }, { values: [1], color: `red` }],
        He: { values: [1] },
        Li: { values: [NaN] }, // nothing to draw: no marks, no axes
      },
      { bins: 2, log_y: true },
    )
    expect(axes).toEqual({
      H: { x: [0, 1], y: [0, 2], log_y: true },
      He: { x: [0, 1], y: [0, 1], log_y: true },
    })
    // the red series' single count sits at log1p(1) / log1p(2) of H's tallest bin
    const top = (100 - (100 * Math.log1p(1)) / Math.log1p(2)).toFixed(2)
    expect(marks.H?.[1]).toEqual({ kind: `bars`, d: bar(`50.00`, top, `50.00`), color: `red` })
    const xy = tile_plot_marks({ Na: { x: [0, 2], y: [1, 3] } }, { y_range: [0, null] })
    expect(xy.axes).toEqual({ Na: { x: [0, 2], y: [0, 3], log_y: false } })
  })

  test(`histogram bars take the scale color of their bin center, none without a scale`, () => {
    const plain = tile_plot_marks({ H: { values: [1, 5] } })
    expect(plain.ramp).toBeNull()
    expect(plain.marks.H).toEqual([{ kind: `bars`, d: expect.any(String) }])
    const { marks, ramp } = tile_plot_marks(
      { H: { values: [1, 5] } },
      { color_scale: `interpolateViridis` },
    )
    expect(ramp?.color_scale.value_range).toEqual([1, 5])
    // 20 bins over [1, 5]: the two filled bins are centered at 1.1 and 4.9
    expect(marks.H?.map(({ color }) => color)).toEqual(
      [1.1, 4.9].map(ramp?.color_fn ?? String),
    )
  })

  test(`markers group by scale color; a series color wins; all-NaN color data has no ramp`, () => {
    const config = { color_scale: `interpolateViridis` as const }
    const { marks, ramp } = tile_plot_marks(
      {
        Li: { x: [0, 1, 2], y: [0, 1, 2], color_values: [0, 0, 10] },
        Na: { x: [0], y: [0], color_values: [5], color: `red` },
      },
      config,
    )
    expect(ramp?.color_scale.value_range).toEqual([0, 10])
    expect(marks.Li).toEqual([
      { kind: `markers`, d: `M0.00 100.00h0M50.00 50.00h0`, color: ramp?.color_fn(0) },
      { kind: `markers`, d: `M100.00 0.00h0`, color: ramp?.color_fn(10) },
    ])
    expect(marks.Na).toEqual([{ kind: `markers`, d: `M0.00 100.00h0`, color: `red` }])
    // line segments blend their endpoint colors and break at dropped points; a lone point
    // after a break draws no segment; a series color wins over color_values
    const lines = tile_plot_marks(
      {
        Li: { x: [0, 1, 2, 3, 4], y: [0, 1, 2, NaN, 4], color_values: [0, 4, 8, 9, 10] },
        Na: { x: [0, 4], y: [0, 4], color_values: [0, 10], color: `red` },
      },
      { ...config, mode: `line` },
    )
    const blend = (val_a: number, val_b: number) =>
      `color-mix(in srgb, ${lines.ramp?.color_fn(val_a)}, ${lines.ramp?.color_fn(val_b)})`
    expect(lines.marks.Li).toEqual([
      { kind: `line`, d: `M0.00 100.00L25.00 75.00`, color: blend(0, 4) },
      { kind: `line`, d: `M25.00 75.00L50.00 50.00`, color: blend(4, 8) },
    ])
    expect(lines.marks.Na).toEqual([
      { kind: `line`, d: `M0.00 100.00L100.00 0.00`, color: `red` },
    ])
    const no_data = tile_plot_marks({ Li: { x: [0], y: [0], color_values: [NaN] } }, config)
    expect(no_data.ramp).toBeNull()
    expect(no_data.marks.Li).toEqual([{ kind: `markers`, d: `M50.00 50.00h0` }])
  })

  test.each<[string, Args, string]>([
    [`neither shape`, [{ Fe: { y: [1] } as never }], `tile_plots.Fe: each series needs`],
    [
      `both shapes`,
      [{ Fe: { values: [1], x: [1], y: [1] } }],
      `got {"values":[1],"x":[1],"y":[1]}`,
    ],
    [`a non-symbol key`, [{ fe: { values: [1] } }], `keys must be element symbols, got fe`],
    [`fractional bins`, [{ Fe: { values: [1] } }, { bins: 0.4 }], `integer >= 1, got 0.4`],
    [
      `null bins`,
      [{ Fe: { values: [1] } }, { bins: null as never }],
      `integer >= 1, got null`,
    ],
    [
      `histograms and x/y plots in one table`,
      [{ H: { values: [1] }, Li: [{ x: [0], y: [0] }] }],
      `use one kind per table`,
    ],
    [`null series in a list`, [{ Fe: [null] as never }], `got null`],
    [`x/y length mismatch`, [{ Fe: { x: [1, 2], y: [1] } }], `lengths differ (2,1,0)`],
    [`collapsed range`, [{ Fe: { values: [1] } }, { x_range: [2, 2] }], `lo < hi, got [2, 2]`],
    [
      `a non-numeric range end`,
      [{ Fe: { values: [1] } }, { x_range: [`0` as never, 3] }],
      `finite numbers`,
    ],
    [
      `partial range past the data`,
      [{ Fe: { values: [1] } }, { x_range: [5, null] }],
      `[5, 1.5]`,
    ],
  ])(`throws on %s`, (_name, args, message) => {
    expect(() => tile_plot_marks(...args)).toThrow(message)
  })
})
