// SweepTrends: one descriptor of a sweep against its axis, a click selecting a frame
import type { ScatterHandlerEvent } from '#lib/plot/core/types.js'
import type ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import type { Sweep, SweepFrame, SweepSeries } from '#lib/spectral/sweep.js'
import SweepTrends from '#lib/spectral/SweepTrends.svelte'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { make_crystal } from '../test-fixtures'

// the plot's props as SweepTrends builds them
const plot = vi.hoisted(() => ({
  props: null as Partial<ComponentProps<typeof ScatterPlot>> | null,
}))
vi.mock(`#lib/plot/scatter/ScatterPlot.svelte`, () => ({
  default: (_anchor: Node, props: Partial<ComponentProps<typeof ScatterPlot>>) => {
    plot.props = props
    return {}
  },
}))

const structure = make_crystal(3, [[`Cu`, [0, 0, 0]]])
const sweep: Sweep = {
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [
    {
      id: `fcc`,
      label: `fcc Cu`,
      frames: [
        { value: 0, scalars: { tc: 1, tc_lo: 0.5, tc_hi: 2 } },
        { value: 50, scalars: { tc: null } }, // known missing: no point
        { value: 100, scalars: { tc: 3 }, status: { unstable: true } },
      ],
    },
    { id: `bcc`, frames: [{ value: 100, scalars: { tc: 4 } }] },
  ],
  descriptors: [
    { key: `tc`, label: `Tc`, unit: `K`, range: [`tc_lo`, `tc_hi`], threshold: 2.5 },
    { key: `vol`, label: `Volume`, unit: `Å³`, compute: `volume_per_atom` },
  ],
}
function render(props: Partial<ComponentProps<typeof SweepTrends>> = {}) {
  const on_frame_select = vi.fn()
  const state = $state({
    sweep,
    frame_of: (series: SweepSeries, idx: number): SweepFrame => series.frames[idx],
    series_id: `fcc`,
    frame_idx: 0,
    descriptor: undefined as string | undefined,
    on_frame_select,
    ...props,
  })
  const component = mount(SweepTrends, { target: document.body, props: state })
  onTestFinished(() => void unmount(component))
  flushSync()
  if (!plot.props) throw new Error(`no plot`)
  return { props: plot.props, state, on_frame_select }
}

test(`plots one line per series, skipping missing values, with ranges and a threshold`, () => {
  const { props } = render()
  const [fcc, bcc] = props.series ?? []
  expect([fcc.label, bcc.label]).toEqual([`fcc Cu`, `bcc`])
  expect([fcc.x, fcc.y]).toEqual([
    [0, 100],
    [1, 3],
  ])
  expect(fcc.metadata).toEqual([
    { series_id: `fcc`, frame_idx: 0 },
    { series_id: `fcc`, frame_idx: 2 },
  ])
  // the selected frame's marker is enlarged, the unstable one hollow and grey
  const [selected, unstable] = Array.isArray(fcc.point_style) ? fcc.point_style : []
  expect(selected.radius).toBeGreaterThan(unstable.radius ?? 0)
  expect(unstable).toMatchObject({ fill: `transparent`, stroke: `gray` })
  // the range becomes asymmetric error bars, absent bounds zero
  expect(fcc.y_error).toEqual({ lower: [0.5, 0], upper: [1, 0] })
  expect(bcc.y_error).toBeUndefined()
  expect(props.ref_lines).toMatchObject([{ type: `horizontal`, y: 2.5 }])
  expect(props.current_x_value).toBe(0)
  expect(props.x_axis?.label).toBe(`Pressure (GPa)`)
  expect(props.x_axis?.range).toEqual([-5, 105]) // every frame's value, padded 5 %
  expect(props.y_axis?.label).toBe(`Tc (K)`)
  expect(props.show_legend).toBe(true)
})

test(`a computed descriptor fills frames from their data`, () => {
  const with_structures: Sweep = {
    ...sweep,
    series: [{ id: `fcc`, frames: [{ value: 0, structure }, { value: 10 }] }],
  }
  const { props } = render({ sweep: with_structures, descriptor: `vol` })
  expect(props.series?.[0].y).toEqual([27]) // 3³ Å³ for one atom; the frame without one skipped
  expect(props.y_axis?.label).toBe(`Volume (Å³)`)
  expect(props.ref_lines).toEqual([])
})

test(`clicking a point selects its series and frame, then calls the caller's handler`, () => {
  const on_point_click = vi.fn()
  const { props, on_frame_select } = render({ on_point_click })
  // a plot click on a point carrying `metadata`
  const click = (metadata: Record<string, unknown>) => {
    const position = { x: 0, y: 0, cx: 0, cy: 0, x_formatted: ``, y_formatted: `` }
    const event: ScatterHandlerEvent = {
      ...position,
      metadata,
      series_idx: 0,
      x_axis: {},
      y_axis: {},
      event: new MouseEvent(`click`),
      point: { x: 0, y: 0, series_idx: 0, point_idx: 0, metadata },
    }
    props.on_point_click?.(event)
  }
  click({ series_id: `bcc`, frame_idx: 0 })
  expect(on_frame_select).toHaveBeenCalledExactlyOnceWith(`bcc`, 0)
  click({ other: 1 }) // not a sweep point
  expect(on_frame_select).toHaveBeenCalledOnce()
  expect(on_point_click).toHaveBeenCalledTimes(2)
})
