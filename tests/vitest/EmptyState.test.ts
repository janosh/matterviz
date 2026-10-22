import HeatmapMatrix from '#lib/heatmap-matrix/HeatmapMatrix.svelte'
import BarPlot from '#lib/plot/bar/BarPlot.svelte'
import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import Histogram from '#lib/plot/histogram/Histogram.svelte'
import Sankey from '#lib/plot/sankey/Sankey.svelte'
import BinnedScatterPlot from '#lib/plot/scatter/BinnedScatterPlot.svelte'
import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import ScatterPlot3D from '#lib/plot/scatter-3d/ScatterPlot3D.svelte'
import Sunburst from '#lib/plot/sunburst/Sunburst.svelte'
import TernaryPlot from '#lib/plot/ternary/TernaryPlot.svelte'
import Treemap from '#lib/plot/treemap/Treemap.svelte'
import { type Component, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { mount_sized } from './setup'

describe(`charts overlay the shared empty state exactly while they have no data`, () => {
  const xy = { x: [1, 2], y: [3, 4] }
  const hierarchy = [{ id: `a`, value: 1 }]
  const none = { series: [] }
  const nodes = [{ id: `a` }, { id: `b` }]
  const links = [{ source: `a`, target: `b`, value: 1 }]
  type Props = Record<string, unknown>
  // Each chart demands its own data props; the table feeds them all one loose shape
  test.each<[string, unknown, Props, Props]>([
    [`.scatter`, ScatterPlot, none, { series: [xy] }],
    // reference lines and surfaces are content too
    [`.scatter`, ScatterPlot, none, { ref_lines: [{ type: `horizontal`, y: 3 }] }],
    [`.binned-scatter`, BinnedScatterPlot, none, { series: [xy] }],
    [`.histogram`, Histogram, none, { series: [{ values: [1, 2] }] }],
    [`.bar-plot`, BarPlot, none, { series: [xy] }],
    [`.box-plot`, BoxPlot, none, { series: [{ y: [1, 2, 3] }] }],
    [`.sankey`, Sankey, { data: { nodes: [], links: [] } }, { data: { nodes, links } }],
    [`.sunburst`, Sunburst, { data: [] }, { data: hierarchy }],
    [`.treemap`, Treemap, { data: [] }, { data: hierarchy }],
    [`.ternary`, TernaryPlot, none, { series: [{ points: [[0.2, 0.3, 0.5]] }] }],
    [`.scatter-3d`, ScatterPlot3D, none, { series: [{ ...xy, z: [5, 6] }] }],
    [`.scatter-3d`, ScatterPlot3D, none, { surfaces: [{ type: `grid`, z_fn: () => 1 }] }],
  ])(`%s`, async (selector, component, empty_props, data_props) => {
    for (const [props, expected] of [
      [empty_props, `No data to display`],
      [data_props, null],
    ] as const) {
      const root = await mount_sized(component as Component<Props>, props, { selector })
      const overlay = root.querySelector(`.empty-state.overlay[role="status"]`)
      expect(overlay?.textContent ?? null).toBe(expected)
      root.parentElement?.remove()
    }
  })

  // Grid-based, so it shows the message in place of its (empty) cells instead of overlaying
  test.each([
    [[], [], `No data to display`],
    [[{ label: `a` }], [[1]], null],
  ])(`HeatmapMatrix with items %j`, (items, values, expected) => {
    const props = { x_items: items, y_items: items, values }
    mount(HeatmapMatrix, { target: document.body, props })
    const empty_state = document.querySelector(`.heatmap .empty-state[role="status"]`)
    expect(empty_state?.textContent ?? null).toBe(expected)
  })
})
