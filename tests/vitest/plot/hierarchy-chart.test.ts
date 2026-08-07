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
const root = arcs[0]
const alpha = by_label(`alpha`)
const beta = by_label(`beta`)
const alpha_child = by_label(`a1`)
const node_info_opts = {
  label_text: `label` as const,
  value_format: `.2~f`,
  label_font: `11px sans-serif`,
  color_for: () => `#336699`,
  text_width: (text: string) => text.length * 7,
  contrast: () => `white`,
}

describe(`hierarchy chart helpers`, () => {
  test(`returns valid layouts and recovers from layout errors`, () => {
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
  })

  test(`computes metric colors with inferred, explicit, and missing ranges`, () => {
    for (const color_values of [undefined, () => null]) {
      expect(compute_metric_colors(arcs, color_values, `interpolateViridis`)).toBeNull()
    }
    const derived = compute_metric_colors(arcs, (arc) => arc.value, `interpolateViridis`)
    expect(derived?.range).toEqual([1, 6])
    expect(derived?.colors).toHaveLength(arcs.length)
    expect(
      compute_metric_colors(arcs, (arc) => arc.value, `interpolateViridis`, [0, 100])?.range,
    ).toEqual([0, 100])
    const partial = compute_metric_colors(
      arcs,
      (arc) => (arc.label === `alpha` ? null : arc.value),
      `interpolateViridis`,
    )
    expect(partial?.colors[alpha.node_idx]).toBe(alpha.color)
  })

  test(`dims, toggles, and builds legend state for categories`, () => {
    const empty = new SvelteSet<string | number>()
    expect(compute_node_dim(arcs, empty, null).every((dim) => dim.opacity === 1)).toBe(true)
    const hover = compute_node_dim(arcs, empty, alpha.node_idx)
    expect([alpha, alpha_child, root, beta].map((arc) => hover[arc.node_idx].opacity)).toEqual(
      [1, 1, 1, 0.3],
    )
    const muted = new SvelteSet([alpha.id])
    expect(compute_node_dim(arcs, muted, null)[alpha.node_idx].opacity).toBe(0.12)
    expect(compute_node_dim(arcs, muted, alpha.node_idx)[alpha.node_idx].opacity).toBe(0.12)

    const stale = new SvelteSet<string | number>([alpha.id, `stale`, alpha_child.id])
    prune_muted_ids(arcs, stale)
    expect([...stale]).toEqual([alpha.id])
    const toggled = new SvelteSet<string | number>([`x`])
    toggle_muted(toggled, `x`)
    toggle_muted(toggled, `y`)
    expect([...toggled]).toEqual([`y`])

    const items = hierarchy_legend_items(
      arcs.filter((arc) => arc.depth === 1),
      new SvelteSet([beta.id]),
      (arc) => `c-${arc.label}`,
    ).map(({ series_idx, label, visible, display_style }) => [
      series_idx,
      label,
      visible,
      display_style.symbol_color,
    ])
    expect(items).toEqual([
      [0, `alpha`, true, `c-alpha`],
      [1, `beta`, false, `c-beta`],
    ])
  })

  test(`builds public handler props and ancestor chains`, () => {
    const child_props = node_handler_props(arcs, alpha_child, `tomato`)
    expect(child_props).toMatchObject({ label: `a1`, parent_id: alpha.id, color: `tomato` })
    expect(child_props).not.toHaveProperty(`x0`)
    expect(node_handler_props(arcs, root, `grey`).parent_id).toBeNull()
    expect(ancestor_chain(arcs, alpha_child).map((arc) => arc.label)).toEqual([
      `root`,
      `alpha`,
      `a1`,
    ])
    expect(ancestor_chain(arcs, null)).toEqual([])
  })

  test(`computes label variants, colors, accessibility text, and clickability`, () => {
    const child_info = compute_node_infos(arcs, node_info_opts)[alpha_child.node_idx]
    expect([child_info.fill, child_info.label_fill, child_info.aria]).toEqual([
      `#336699`,
      `white`,
      `a1: 3`,
    ])
    expect(child_info.variants.map(({ text }) => text)).toEqual([`a1`])
    const clickable = compute_node_infos(arcs, {
      ...node_info_opts,
      clickable: (arc) => !arc.is_leaf,
    })
    expect(clickable[alpha.node_idx].clickable).toBe(true)
    expect(clickable[alpha_child.node_idx].clickable).toBe(false)

    const short_arcs = compute_sunburst_layout(
      { label: `root`, children: [{ label: `alpha`, label_short: `A`, value: 1 }] },
      {},
    ).arcs
    const short_info = compute_node_infos(short_arcs, {
      ...node_info_opts,
      label_text: `label+percent`,
    })
    expect(short_info[1].variants.map(({ text }) => text)).toEqual([
      `alpha 100%`,
      `alpha`,
      `A`,
    ])
    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: `Enter` }))).toBe(true)
    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: ` ` }))).toBe(true)
    expect(is_activation_key(new KeyboardEvent(`keydown`, { key: `Escape` }))).toBe(false)
  })

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
    const summary = (
      result: ReturnType<typeof color_bar_layout>,
    ): [boolean, number, number, number, string] => [
      result.is_vertical,
      result.inner_width,
      result.inner_height,
      result.plot_left,
      result.tick_side,
    ]
    const vertical = { orientation: `vertical` } as const
    expect(summary(layout({}))).toEqual([false, 400, 254, 10, `primary`])
    expect(summary(layout(vertical))).toEqual([true, 324, 300, 10, `primary`])
    expect(summary(layout(vertical, `left`))).toEqual([true, 324, 300, 86, `secondary`])
    expect(layout(vertical).offset_px).toBe(10 + COLOR_BAR_GAP)
    expect(layout(vertical, `right`, { width: 9999, height: 0 }).inner_width).toBe(200)
    const unmeasured = layout({ orientation: `vertical`, tick_side: `inside` }, `left`, {
      width: 0,
      height: 0,
    })
    expect(summary(unmeasured)).toEqual([true, 400, 300, 10, `inside`])
    expect(unmeasured.tick_padding).toBe(`0`)
    expect(layout(vertical).tick_padding).toBe(`0 var(--x-tick-space, 5em) 0 0`)
    expect(layout(vertical, `left`).tick_padding).toBe(`0 0 0 var(--x-tick-space, 5em)`)
    for (const tick_labels of [0, []]) {
      expect(layout({ orientation: `vertical`, tick_labels }).tick_padding).toBe(`0`)
    }
  })
})
