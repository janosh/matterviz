// Series columns accept typed arrays (Float64Array, ...) as well as plain arrays: every chart
// must draw them exactly as it draws the same numbers in a plain array.
import BarPlot from '#lib/plot/bar/BarPlot.svelte'
import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import Histogram from '#lib/plot/histogram/Histogram.svelte'
import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import { clean_series } from '#lib/plot/core/data-cleaning.js'
import type { DataSeries, NumericColumn } from '#lib/plot/core/types.js'
import { materialize_series_points } from '#lib/plot/scatter/scatter-data.js'
import { mulberry32 } from '#lib/math.js'
import { type mount, unmount } from 'svelte'
import { describe, expect, test } from 'vite-plus/test'
import { mount_sized, plot_svg } from '../setup'

const rand = mulberry32(7)
const xs = Array.from({ length: 40 }, (_, idx) => idx * 0.5)
// gaps and a non-finite value exercise the filtering paths
const ys = xs.map((_, idx) => (idx === 5 ? NaN : idx === 9 ? Infinity : rand() * 10 - 3))
const typed = (values: readonly number[]): Float64Array => Float64Array.from(values)

// Unique ids (clip paths, gradients) differ between mounts; the drawing must not
const normalized_svg = async (
  component: Parameters<typeof mount_sized>[0],
  props: Record<string, unknown>,
  selector: string,
): Promise<string> => {
  let mounted: ReturnType<typeof mount> | undefined
  const root = await mount_sized(component, props, {
    selector,
    on_mount: (instance) => (mounted = instance),
  })
  const html = plot_svg(root).outerHTML.replaceAll(
    /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g,
    `<id>`,
  )
  if (mounted) await unmount(mounted)
  root.parentElement?.remove()
  return html
}

describe(`typed-array series`, () => {
  test(`materialize_series_points gives a Float64Array series the plain series' points`, () => {
    const extra = { color_values: ys.map((val) => val * 2), point_ids: xs.map(String) }
    const [plain] = materialize_series_points([{ x: xs, y: ys, ...extra }])
    const [from_typed] = materialize_series_points([{ x: typed(xs), y: typed(ys), ...extra }])
    for (const key of [`points`, `point_bounds`, `x_direction`, `line_direction`] as const)
      expect(from_typed[key]).toStrictEqual(plain[key])
  })

  test.each([
    [`a string`, `1,2,3`],
    [`undefined`, undefined],
    [`a DataView`, new DataView(new ArrayBuffer(8))],
  ])(`materialize_series_points throws on x given as %s`, (_name, bad_x) => {
    const series = { id: `bad`, x: bad_x, y: [1, 2, 3] } as unknown as DataSeries
    expect(() => materialize_series_points([series])).toThrow(
      /Series "bad": x and y must be arrays or typed arrays, got \[object/,
    )
  })

  test(`clean_series filters a typed raw_y alongside x and y`, () => {
    const config = { in_place: false, smooth: { type: `savgol`, window: 5 } } as const
    const plain = clean_series({ x: xs, y: ys, raw_y: ys }, config)
    const from_typed = clean_series({ x: typed(xs), y: typed(ys), raw_y: typed(ys) }, config)
    expect(Array.from(from_typed.series.raw_y ?? [])).toStrictEqual(plain.series.raw_y)
    expect(from_typed.series.x).toStrictEqual(plain.series.x)
    expect(from_typed.series.y).toStrictEqual(plain.series.y)
    expect(from_typed.quality).toStrictEqual(plain.quality)
  })

  type Cols = (vals: number[]) => NumericColumn
  // oxfmt-ignore
  test.each([
    [`.scatter`, ScatterPlot, (cols: Cols) => ({ series: [{ x: cols(xs), y: cols(ys), markers: `line+points` }] })],
    [`.bar-plot`, BarPlot, (cols: Cols) => ({
      series: [{ x: cols(xs), y: cols(ys) }, { x: cols(xs), y: cols(ys.map((val) => -val)), render_mode: `line` }],
      mode: `stacked`,
    })],
    [`.histogram`, Histogram, (cols: Cols) => ({ series: [{ values: cols(ys), weights: cols(xs.map((val) => val + 1)) }], bins: 12 })],
    [`.box-plot`, BoxPlot, (cols: Cols) => ({ series: [{ y: cols(ys), kind: `violin+box`, points: `strip` }] })],
  ])(`%s draws a Float64Array series exactly like the plain array`, async (selector, component, props_for) => {
    const plain = await normalized_svg(component, props_for((vals) => vals), selector)
    const from_typed = await normalized_svg(component, props_for(typed), selector)
    expect(plain.length).toBeGreaterThan(1000) // something was drawn
    expect(from_typed).toBe(plain)
  })
})
