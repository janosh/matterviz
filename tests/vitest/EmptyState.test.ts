import EmptyState from '#lib/EmptyState.svelte'
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
import { type Component, createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query, mount_sized } from './setup'

describe(`EmptyState`, () => {
  test(`renders message in a span (valid inside <p>) and forwards class, attributes and style`, () => {
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `No data available`,
        class: `custom-class`,
        id: `my-empty-state`,
        style: `min-height: 200px; background: red`,
      },
    })
    const container = doc_query<HTMLDivElement>(`.empty-state.custom-class`)
    expect(container.querySelector(`span.message`)?.textContent).toBe(`No data available`)
    expect(container.id).toBe(`my-empty-state`)
    expect(container.style.minHeight).toBe(`200px`)
    expect(container.style.background).toBe(`red`)
  })

  test.each([
    [{}, `No data to display`],
    [{ message: undefined }, `No data to display`],
    [{ message: `` }, null],
  ])(`props %j render message %s`, (props, message) => {
    mount(EmptyState, { target: document.body, props })
    const container = doc_query(`.empty-state`)
    expect(container.querySelector(`span.message`)?.textContent ?? null).toBe(message)
    expect(container.classList.contains(`overlay`)).toBe(false)
  })

  test(`children snippet takes precedence over message prop`, () => {
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `This should not render`,
        children: createRawSnippet(() => ({
          render: () => `<p class="custom-content">Custom snippet content</p>`,
        })),
      },
    })
    const container = doc_query(`.empty-state`)
    expect(container.querySelector(`.custom-content`)?.textContent).toBe(
      `Custom snippet content`,
    )
    expect(container.querySelector(`span.message`)).toBeNull()
  })
})

describe(`charts overlay the shared empty state exactly while they have no data`, () => {
  const xy = { x: [1, 2], y: [3, 4] }
  const hierarchy = [{ id: `a`, value: 1 }]
  type Props = Record<string, unknown>
  // Each chart demands its own data props; the table feeds them all one loose shape
  const chart = (component: unknown) => component as Component<Props>
  test.each<[string, Component<Props>, Props, Props]>([
    [`.scatter`, chart(ScatterPlot), { series: [] }, { series: [xy] }],
    // reference lines and surfaces are content too
    [
      `.scatter`,
      chart(ScatterPlot),
      { series: [] },
      { series: [], ref_lines: [{ type: `horizontal`, y: 3 }] },
    ],
    [`.binned-scatter`, chart(BinnedScatterPlot), { series: [] }, { series: [xy] }],
    [`.histogram`, chart(Histogram), { series: [] }, { series: [{ values: [1, 2] }] }],
    [`.bar-plot`, chart(BarPlot), { series: [] }, { series: [xy] }],
    [`.box-plot`, chart(BoxPlot), { series: [] }, { series: [{ y: [1, 2, 3] }] }],
    [
      `.sankey`,
      chart(Sankey),
      { data: { nodes: [], links: [] } },
      {
        data: {
          nodes: [{ id: `a` }, { id: `b` }],
          links: [{ source: `a`, target: `b`, value: 1 }],
        },
      },
    ],
    [`.sunburst`, chart(Sunburst), { data: [] }, { data: hierarchy }],
    [`.treemap`, chart(Treemap), { data: [] }, { data: hierarchy }],
    [
      `.ternary`,
      chart(TernaryPlot),
      { series: [] },
      { series: [{ points: [[0.2, 0.3, 0.5]] }] },
    ],
    [`.scatter-3d`, chart(ScatterPlot3D), { series: [] }, { series: [{ ...xy, z: [5, 6] }] }],
    [
      `.scatter-3d`,
      chart(ScatterPlot3D),
      { series: [] },
      { series: [], surfaces: [{ type: `grid`, z_fn: (x: number, y: number) => x * y }] },
    ],
  ])(`%s`, async (selector, component, empty_props, data_props) => {
    for (const [props, expected] of [
      [empty_props, `No data to display`],
      [data_props, null],
    ] as const) {
      const root = await mount_sized(component, props, { selector })
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
    mount(HeatmapMatrix, {
      target: document.body,
      props: { x_items: items, y_items: items, values },
    })
    expect(
      document.querySelector(`.heatmap .empty-state[role="status"]`)?.textContent ?? null,
    ).toBe(expected)
  })
})
