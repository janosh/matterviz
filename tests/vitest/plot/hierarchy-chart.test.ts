import {
  ancestor_chain,
  COLOR_BAR_GAP,
  color_bar_layout,
  compute_metric_colors,
  compute_node_dim,
  compute_node_infos,
  hierarchy_legend_items,
  is_activation_key,
  node_handler_props,
  prune_muted_ids,
  safe_hierarchy_layout,
  toggle_muted,
} from '$lib/plot/core/utils/hierarchy-chart'
import type { PositionedArc, SunburstNode } from '$lib/plot/sunburst/sunburst'
import { compute_sunburst_layout } from '$lib/plot/sunburst/sunburst'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test, vi } from 'vitest'

// oxfmt-ignore
const tree: SunburstNode = {
  label: `root`,
  children: [
    { label: `alpha`, children: [{ label: `a1`, value: 3 }, { label: `a2`, value: 1 }] },
    { label: `beta`, children: [{ label: `b1`, value: 4 }, { label: `b2`, value: 2 }] },
  ],
}
const { arcs } = compute_sunburst_layout(tree, {})
const by_label = (label: string): PositionedArc => {
  const arc = arcs.find((candidate) => candidate.label === label)
  if (!arc) throw new Error(`no arc labelled ${label}`)
  return arc
}

describe(`hierarchy chart helpers`, () => {
  test(`layout, metrics, dim/mute, legend, props, ancestors, infos, keys`, () => {
    expect(safe_hierarchy_layout(tree, {})).toEqual(compute_sunburst_layout(tree, {}))
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      expect(
        safe_hierarchy_layout(
          {
            label: `boom`,
            get children(): SunburstNode[] {
              throw new Error(`bad`)
            },
          },
          {},
        ),
      ).toEqual({ arcs: [], root: null, max_depth: 0 })
      expect(error_spy).toHaveBeenCalled()
    } finally {
      error_spy.mockRestore()
    }

    const [alpha, beta] = [by_label(`alpha`), by_label(`beta`)]
    expect(compute_metric_colors(arcs, undefined, `interpolateViridis`)).toBeNull()
    expect(compute_metric_colors(arcs, () => null, `interpolateViridis`)).toBeNull()
    const derived = compute_metric_colors(arcs, (arc) => arc.value, `interpolateViridis`)
    expect(derived?.range).toEqual([1, 6])
    expect(derived?.colors).toHaveLength(arcs.length)
    expect(
      compute_metric_colors(arcs, (arc) => arc.value, `interpolateViridis`, [0, 100])?.range,
    ).toEqual([0, 100])
    expect(
      compute_metric_colors(
        arcs,
        (arc) => (arc.label === `alpha` ? null : arc.value),
        `interpolateViridis`,
      )?.colors[alpha.node_idx],
    ).toBe(alpha.color)

    const empty = new SvelteSet<string | number>()
    expect(compute_node_dim(arcs, empty, null).every((dim) => dim.opacity === 1)).toBe(true)
    const hover = compute_node_dim(arcs, empty, alpha.node_idx)
    expect(
      [alpha, by_label(`a1`), arcs[0], beta].map((arc) => hover[arc.node_idx].opacity),
    ).toEqual([1, 1, 1, 0.3])
    const muted = new SvelteSet([alpha.id])
    expect(compute_node_dim(arcs, muted, null)[alpha.node_idx].opacity).toBe(0.12)
    expect(compute_node_dim(arcs, muted, alpha.node_idx)[alpha.node_idx].opacity).toBe(0.12)

    const stale = new SvelteSet<string | number>([alpha.id, `stale`, by_label(`a1`).id])
    prune_muted_ids(arcs, stale)
    expect([...stale]).toEqual([alpha.id])
    const toggled = new SvelteSet<string | number>([`x`])
    toggle_muted(toggled, `x`)
    toggle_muted(toggled, `y`)
    expect([...toggled]).toEqual([`y`])

    expect(
      hierarchy_legend_items(
        arcs.filter((arc) => arc.depth === 1),
        new SvelteSet([beta.id]),
        (arc) => `c-${arc.label}`,
      ).map(({ series_idx, label, visible, display_style }) => [
        series_idx,
        label,
        visible,
        display_style.symbol_color,
      ]),
    ).toEqual([
      [0, `alpha`, true, `c-alpha`],
      [1, `beta`, false, `c-beta`],
    ])

    const a1_props = node_handler_props(arcs, by_label(`a1`), `tomato`)
    expect(a1_props).toMatchObject({ label: `a1`, parent_id: alpha.id, color: `tomato` })
    expect(a1_props).not.toHaveProperty(`x0`)
    expect(node_handler_props(arcs, arcs[0], `grey`).parent_id).toBeNull()
    expect(ancestor_chain(arcs, by_label(`a1`)).map((arc) => arc.label)).toEqual([
      `root`,
      `alpha`,
      `a1`,
    ])
    expect(ancestor_chain(arcs, null)).toEqual([])

    const opts = {
      label_text: `label` as const,
      value_format: `.2~f`,
      label_font: `11px sans-serif`,
      color_for: () => `#336699`,
      text_width: (text: string) => text.length * 7,
      contrast: () => `white`,
    }
    const a1 = compute_node_infos(arcs, opts)[by_label(`a1`).node_idx]
    expect(a1).toMatchObject({ fill: `#336699`, label_fill: `white`, aria: `a1: 3` })
    expect(a1.variants.map(({ text }) => text)).toEqual([`a1`])
    const clickable = compute_node_infos(arcs, { ...opts, clickable: (arc) => !arc.is_leaf })
    expect(clickable[alpha.node_idx].clickable).toBe(true)
    expect(clickable[by_label(`a1`).node_idx].clickable).toBe(false)
    const short_arcs = compute_sunburst_layout(
      { label: `root`, children: [{ label: `alpha`, label_short: `A`, value: 1 }] },
      {},
    ).arcs
    expect(
      compute_node_infos(short_arcs, { ...opts, label_text: `label+percent` })[
        short_arcs.findIndex((arc) => arc.label === `alpha`)
      ].variants.map(({ text }) => text),
    ).toEqual([`alpha 100%`, `alpha`, `A`])

    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: `Enter` }))).toBe(true)
    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: ` ` }))).toBe(true)
    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: `Escape` }))).toBe(false)
  })

  // Sunburst and Treemap share this so a vertical bar reserves width on either side and a
  // horizontal one reserves height, never both.
  test(`color_bar_layout reserves the right axis per orientation and side`, () => {
    const base = {
      measured: { width: 60, height: 30 },
      avail_width: 400,
      avail_height: 300,
      pad: { l: 10, r: 10 },
      tick_space_var: `--x-tick-space`,
    }
    const layout = (
      color_bar: Parameters<typeof color_bar_layout>[0][`color_bar`],
      side: `left` | `right` = `right`,
      measured = base.measured,
    ) => color_bar_layout({ ...base, color_bar, side, measured })
    const horizontal = layout({})
    expect(horizontal).toMatchObject({
      is_vertical: false,
      inner_width: 400, // horizontal bars never shrink width
      inner_height: 300 - (30 + 2 * COLOR_BAR_GAP),
      plot_left: 10,
      tick_side: `primary`,
    })

    const vertical = { orientation: `vertical` } as const
    expect(layout(vertical)).toMatchObject({
      is_vertical: true,
      inner_width: 400 - (60 + 2 * COLOR_BAR_GAP),
      inner_height: 300, // vertical bars never shrink height
      plot_left: 10, // right-side bar leaves the plot origin alone
      tick_side: `primary`,
      offset_px: 10 + COLOR_BAR_GAP,
    })
    // A left-side bar shifts the plot origin right by exactly what it reserved, and flips
    // its ticks so they point away from the chart.
    expect(layout(vertical, `left`)).toMatchObject({
      plot_left: 10 + (60 + 2 * COLOR_BAR_GAP),
      tick_side: `secondary`,
    })

    // Reserves are capped at half the axis so a bad measurement can't collapse the chart.
    expect(layout(vertical, `right`, { width: 9999, height: 0 }).inner_width).toBe(200)
    // Unmeasured (0) reserves nothing, and an explicit tick_side always wins.
    expect(
      layout({ orientation: `vertical`, tick_side: `inside` }, `left`, {
        width: 0,
        height: 0,
      }),
    ).toMatchObject({
      inner_width: 400,
      plot_left: 10,
      tick_side: `inside`,
      tick_padding: `0`,
    })

    // Tick padding reserves label room on the side the ticks render, and nothing when
    // ticks are switched off.
    expect(layout(vertical).tick_padding).toBe(`0 var(--x-tick-space, 5em) 0 0`)
    expect(layout(vertical, `left`).tick_padding).toBe(`0 0 0 var(--x-tick-space, 5em)`)
    for (const tick_labels of [0, []]) {
      expect(layout({ orientation: `vertical`, tick_labels }).tick_padding).toBe(`0`)
    }
  })
})
