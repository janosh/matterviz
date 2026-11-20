import { tile_plot_marks } from '#lib/periodic-table/tile-plots'
import { describe, expect, test } from 'vite-plus/test'

type Args = Parameters<typeof tile_plot_marks>
type Ramp = NonNullable<ReturnType<typeof tile_plot_marks>[`ramp`]>
// marks live in a 1000x1000 integer grid (y down)
const bar = (x0: number, top: number, x1: number) => `M${x0} 1000V${top}H${x1}V1000Z`
// the palette step (of 64) a value's place on the scale rounds to
const step_color = (ramp: Ramp | null | undefined, position: number) =>
  ramp?.color_at(Math.round(position * 63) / 63)

describe(`tile_plot_marks`, () => {
  // Histograms share bin edges across tiles and scale to each tile's tallest bin; x/y plots
  // share both axes. Non-finite and out-of-range values are dropped, empty tiles get no marks.
  test.each<[string, Args, ReturnType<typeof tile_plot_marks>[`marks`]]>([
    [
      `histograms on shared bins, ±Inf ignored for the range`,
      [{ H: { values: [0, 1, 1, NaN] }, He: { values: [3, Infinity] } }, { bins: 3 }],
      {
        H: [{ kind: `bars`, d: bar(0, 500, 333) + bar(333, 0, 667) }],
        He: [{ kind: `bars`, d: bar(667, 0, 1000) }],
      },
    ],
    [
      `x_range drops outside values and empty tiles; null and undefined entries skip`,
      [
        { H: { values: [-5, 0.5] }, He: { values: [9] }, Li: null, Be: undefined },
        { bins: 1, x_range: [0, 1] },
      ],
      { H: [{ kind: `bars`, d: bar(0, 0, 1000) }] },
    ],
    [
      // numpy bins 0.3 in [0, 1] / 10 into bin 3 although 0.3 / 0.1 = 2.9999999999999996
      `values on inner edges go to the bin above, like numpy`,
      [{ H: { values: [0.3, 0.6, 0.7, 1] } }, { bins: 10, x_range: [0, 1] }],
      {
        H: [
          { kind: `bars`, d: [300, 600, 700, 900].map((x0) => bar(x0, 0, x0 + 100)).join(``) },
        ],
      },
    ],
    [
      `log_y heights`,
      [{ H: { values: [0, 1, 1, 1] } }, { bins: 2, log_y: true }],
      { H: [{ kind: `bars`, d: bar(0, 500, 500) + bar(500, 0, 1000) }] },
    ],
    [
      // Python None arrives as null, which compares like 0: dropped, not binned or drawn at 0
      `null values on ranges spanning 0`,
      [{ H: { values: [null, null, -1, 1] as never }, He: { values: [-1] } }, { bins: 2 }],
      {
        H: [{ kind: `bars`, d: bar(0, 0, 500) + bar(500, 0, 1000) }],
        He: [{ kind: `bars`, d: bar(0, 0, 500) }],
      },
    ],
    [
      `null x/y points dropped`,
      [{ Li: { x: [null, -1, 1] as never, y: [0.5, -1, 1] } }, {}],
      { Li: [{ kind: `markers`, d: `M0 1000h0M1000 0h0` }] },
    ],
    [
      `markers on shared axes`,
      [{ Li: { x: [0, 1], y: [0, NaN] }, Na: { x: [2], y: [4] } }, {}],
      { Li: [{ kind: `markers`, d: `M0 1000h0` }], Na: [{ kind: `markers`, d: `M1000 0h0` }] },
    ],
    [
      `markers in one cell drawn once`,
      [{ Li: { x: [0, 0.001, 1], y: [0, 0.001, 1] } }, {}],
      { Li: [{ kind: `markers`, d: `M0 1000h0M1000 0h0` }] },
    ],
    [
      `line broken at a non-finite gap and at a point outside y_range`,
      [
        { Li: { x: [0, 1, 2, 3, 4, 5], y: [0, 0.5, NaN, 1.5, 2, 9] } },
        { mode: `line`, y_range: [null, 2] },
      ],
      { Li: [{ kind: `line`, d: `M0 1000L200 750M600 250L800 0` }] },
    ],
    [
      // the 2nd point is within 2 grid units of the 1st and skipped; the 4th, as close to the
      // 3rd, ends the run so it is kept
      `line skips sub-pixel steps but keeps each run's end`,
      [{ Li: { x: [0, 0.001, 0.998, 1], y: [0, 0, 1, 1] } }, { mode: `line` }],
      { Li: [{ kind: `line`, d: `M0 1000L998 0l2 0` }] },
    ],
    [
      `line+markers with a series color; single-value ranges padded`,
      [{ Li: [{ x: [1, 1], y: [2, 2], color: `red` }] }, { mode: `line+markers` }],
      {
        Li: [
          { kind: `line`, d: `M500 500l0 0`, color: `red` },
          { kind: `markers`, d: `M500 500h0`, color: `red` },
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
    const top = Math.round(1000 * (1 - Math.log1p(1) / Math.log1p(2)))
    expect(marks.H?.[1]).toEqual({ kind: `bars`, d: bar(500, top, 1000), color: `red` })
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
      [1.1, 4.9].map((val) => step_color(ramp, (val - 1) / 4)),
    )
  })

  test(`markers group by palette step; a series color wins; all-NaN color data has no ramp`, () => {
    const config = { color_scale: `interpolateViridis` as const }
    const { marks, ramp } = tile_plot_marks(
      {
        Li: { x: [0, 1, 2], y: [0, 1, 2], color_values: [0, 0.01, 10] },
        Na: { x: [0], y: [0], color_values: [5], color: `red` },
      },
      config,
    )
    expect(ramp?.color_scale.value_range).toEqual([0, 10])
    // 0 and 0.01 round to the same of 64 palette steps, so share one path
    expect(marks.Li).toEqual([
      { kind: `markers`, d: `M0 1000h0M500 500h0`, color: step_color(ramp, 0) },
      { kind: `markers`, d: `M1000 0h0`, color: step_color(ramp, 1) },
    ])
    expect(marks.Na).toEqual([{ kind: `markers`, d: `M0 1000h0`, color: `red` }])
    // interleaved colors: each color's pen continues from that color's previous dot, and a
    // nearby dot moves relative to it when that is shorter (m10 -5 vs M10 995)
    const mixed = tile_plot_marks(
      { Li: { x: [0, 0.5, 0.005], y: [0, 1, 0.005], color_values: [0, 10, 0] } },
      config,
    )
    expect(mixed.marks.Li?.map(({ d }) => d)).toEqual([`M0 1000h0m10 -5h0`, `M1000 0h0`])
    // ±Inf color data counts as missing (a clamped scale would pin it to an end color):
    // its marker and both adjacent segments keep the series color
    const inf = tile_plot_marks(
      { Li: { x: [0, 1, 2], y: [0, 1, 2], color_values: [0, Infinity, 10] } },
      { ...config, mode: `line+markers` },
    )
    expect(inf.marks.Li?.map(({ kind, color }) => [kind, color])).toEqual([
      [`line`, undefined],
      [`markers`, step_color(inf.ramp, 0)],
      [`markers`, undefined],
      [`markers`, step_color(inf.ramp, 1)],
    ])
    // histograms with nothing to draw get no scale, so no color bar explaining nothing
    const empty_hists = tile_plot_marks({ H: { values: [] }, He: { values: [NaN] } }, config)
    expect([empty_hists.ramp, empty_hists.marks]).toEqual([null, {}])
    const no_data = tile_plot_marks({ Li: { x: [0], y: [0], color_values: [NaN] } }, config)
    expect(no_data.ramp).toBeNull()
    expect(no_data.marks.Li).toEqual([{ kind: `markers`, d: `M500 500h0` }])
  })

  test(`line segments take the palette step of their ends' mean scale position`, () => {
    // the 3rd point is followed by a gap; the lone 5th point has no segment, so it shows as a
    // dot in its own color rather than disappearing
    const lines = tile_plot_marks(
      {
        Li: { x: [0, 1, 2, 3, 4], y: [0, 1, 2, NaN, 4], color_values: [0, 4, 8, 9, 10] },
        Na: { x: [0, 2, 4], y: [0, 4, 0], color_values: [0, 5, 10], color: `red` },
      },
      { color_scale: `interpolateViridis`, mode: `line` },
    )
    expect(lines.marks.Li).toEqual([
      { kind: `line`, d: `M0 1000L250 750`, color: step_color(lines.ramp, 0.2) },
      { kind: `line`, d: `M250 750L500 500`, color: step_color(lines.ramp, 0.6) },
      { kind: `markers`, d: `M1000 0h0`, color: step_color(lines.ramp, 1) },
    ])
    // one color: consecutive segments continue one polyline
    expect(lines.marks.Na).toEqual([
      { kind: `line`, d: `M0 1000L500 0l500 1000`, color: `red` },
    ])
    // on a log scale 1 -> 100 meets midway at 10 (position 0.5), not at their mean 50.5
    const log = tile_plot_marks(
      { Li: { x: [0, 1], y: [0, 1], color_values: [1, 100] } },
      { color_scale: { type: `log`, scheme: `interpolateViridis` }, mode: `line` },
    )
    expect(log.marks.Li?.[0].color).toBe(step_color(log.ramp, 0.5))
    // a log scale can't map values <= 0: their markers and bars keep the series color
    const log_scale = { type: `log`, scheme: `interpolateViridis` } as const
    const log_markers = tile_plot_marks(
      { Li: { x: [0, 1], y: [0, 1], color_values: [-1, 100] } },
      { color_scale: log_scale },
    )
    expect(log_markers.marks.Li?.map(({ color }) => color)).toEqual([
      undefined,
      step_color(log_markers.ramp, 1),
    ])
    const log_bars = tile_plot_marks(
      { H: { values: [-1.5, 1.5] } },
      { bins: 2, color_scale: log_scale },
    )
    expect(log_bars.marks.H?.[0].color).toBeUndefined()
  })

  test.each<[string, Args, string]>([
    [`neither shape`, [{ Fe: { y: [1] } as never }], `tile_plots.Fe: each series needs`],
    [
      `both shapes`,
      [{ Fe: { values: [1], x: [1], y: [1] } }],
      `got {"values":[1],"x":[1],"y":[1]}`,
    ],
    [`a non-symbol key`, [{ fe: { values: [1] } }], `keys must be element symbols, got fe`],
    [
      `fractional bins`,
      [{ Fe: { values: [1] } }, { bins: 0.4 }],
      `integer in [1, 1000], got 0.4`,
    ],
    [
      `null bins`,
      [{ Fe: { values: [1] } }, { bins: null as never }],
      `integer in [1, 1000], got null`,
    ],
    [
      `histograms and x/y plots in one table`,
      [{ H: { values: [1] }, Li: [{ x: [0], y: [0] }] }],
      `use one kind per table`,
    ],
    [`more bins than grid columns`, [{ Fe: { values: [1] } }, { bins: 1001 }], `got 1001`],
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
