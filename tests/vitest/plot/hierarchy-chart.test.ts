import { DEFAULT_FONT_SPEC, measure_text_line } from '$lib/plot/core/text-metrics'
import {
  ancestor_chain,
  arrow_nav_target,
  COLOR_BAR_GAP,
  color_bar_layout,
  compute_metric_colors,
  compute_node_dim,
  compute_node_infos,
  ellipsize_to_width,
  hierarchy_legend_items,
  node_handler_props,
  node_label_str,
  node_label_variants,
  toggle_muted,
} from '$lib/plot/core/utils/hierarchy-chart'
import type { PositionedArc, SunburstNode } from '$lib/plot/core/utils/hierarchy-layout'
import { compute_sunburst_layout } from '$lib/plot/core/utils/hierarchy-layout'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test } from 'vitest'

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
// 10px font: happy-dom has no canvas, so text-metrics' fallback measures 0.6px per
// character per px of font size (6px per character here)
const node_info_opts = {
  label_text: `label` as const,
  value_format: `.2~f`,
  font: { ...DEFAULT_FONT_SPEC, font_size: 10 },
  color_for: () => `#336699`,
  pattern_prefix: `test`,
}

describe(`hierarchy chart helpers`, () => {
  test(`label strings per label_text mode; compound modes degrade to the bare label`, () => {
    const node = { id: `A/A1`, label: `A1`, value: 4, fraction: 0.2, parent_fraction: 0.4 }
    const expected = {
      label: `A1`,
      value: `4`,
      percent: `20%`,
      'label+value': `A1 4`,
      'label+percent': `A1 20%`,
      'label+parent-percent': `A1 (40%)`,
    } as const
    const modes = Object.keys(expected) as (keyof typeof expected)[]
    expect(
      Object.fromEntries(modes.map((mode) => [mode, node_label_str(node, mode, `,`)])),
    ).toEqual(expected)
    // parent_fraction falls back to fraction when absent (e.g. depth-1 nodes)
    expect(
      node_label_str({ ...node, parent_fraction: undefined }, `label+parent-percent`, `,`),
    ).toBe(`A1 (20%)`)
    expect(node_label_variants(node, `label+parent-percent`, `,`)).toEqual({
      text: `A1`,
      extended: `A1 (40%)`,
    })
    expect(node_label_variants(node, `percent`, `,`)).toEqual({ text: `20%` })
    // label_short is the compact last-resort variant in every mode
    const with_short = { ...node, label_short: `41%` }
    expect(node_label_variants(with_short, `label+value`, `,`)).toEqual({
      text: `A1`,
      extended: `A1 4`,
      short: `41%`,
    })
    expect(node_label_variants(with_short, `label`, `,`)).toEqual({ text: `A1`, short: `41%` })
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
    const undimmed = compute_node_dim(arcs, empty, null)
    expect(arcs.every((arc) => undimmed(arc.node_idx).opacity === 1)).toBe(true)
    const hover = compute_node_dim(arcs, empty, alpha.node_idx)
    expect([alpha, alpha_child, root, beta].map((arc) => hover(arc.node_idx).opacity)).toEqual(
      [1, 1, 1, 0.3],
    )
    const muted = new SvelteSet([alpha.id])
    expect(compute_node_dim(arcs, muted, null)(alpha.node_idx).opacity).toBe(0.12)
    expect(compute_node_dim(arcs, muted, alpha.node_idx)(alpha.node_idx).opacity).toBe(0.12)

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
    // dark fill -> white label; measured at 10px -> 6px per character
    expect(child_info).toMatchObject({
      fill: `#336699`,
      label_fill: `white`,
      aria: `a1: 3`,
      variants: [{ text: `a1`, width: 12 }],
    })
    expect(child_info.clickable).toBeUndefined()
    // light fills get black labels; fills JS can't resolve (translucent, CSS vars)
    // inherit the surrounding text color instead of guessing
    const label_fills = [`#ffe0b3`, `rgba(0, 0, 0, 0.5)`, `var(--x)`].map(
      (fill) =>
        compute_node_infos(arcs, { ...node_info_opts, color_for: () => fill })[1].label_fill,
    )
    expect(label_fills).toEqual([`black`, `currentColor`, `currentColor`])
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
    // richest first, widths shrinking with the text
    expect(short_info[1].variants).toEqual([
      { text: `alpha 100%`, width: 60 },
      { text: `alpha`, width: 30 },
      { text: `A`, width: 6 },
    ])
  })

  test(`pattern nodes resolve a scoped <pattern> id while fill stays the label-contrast color`, () => {
    const patterned = compute_sunburst_layout(
      {
        label: `root`,
        children: [
          { label: `plain`, value: 1 },
          { label: `hatched`, value: 1, pattern: `/` },
          { label: `dotted`, value: 1, pattern: { shape: `dots`, size: 6 } },
          { label: `replaced`, value: 1, pattern: { shape: `/`, mode: `replace` } },
          { label: `on-black`, value: 1, pattern: { mode: `replace`, bg: `#000` } },
        ],
      },
      {},
    ).arcs
    const infos = compute_node_infos(patterned, node_info_opts)
    const [plain, hatched, dotted, replaced, on_black] = [1, 2, 3, 4, 5].map(
      (idx) => infos[idx],
    )
    expect(plain.pattern).toBeUndefined()
    expect(hatched.fill).toBe(`#336699`)
    expect(hatched.pattern?.id).toMatch(/^test-pat-[0-9a-z]+$/)
    expect(hatched.pattern?.url).toBe(`url(#${hatched.pattern?.id})`)
    // each spec resolves to its own tile (tile geometry itself is covered in patterns.test.ts)
    expect(dotted.pattern?.id).not.toBe(hatched.pattern?.id)
    // overlay tiles keep the node color under the texture -> label contrasts against it;
    // replace mode leaves the tile transparent -> label inherits, or contrasts a custom bg
    expect(hatched.label_fill).toBe(`white`)
    expect(replaced.label_fill).toBe(`currentColor`)
    expect(on_black.label_fill).toBe(`white`)
    // only patterned nodes get a label halo, painted in whatever sits under the texture
    expect(plain.label_halo).toBeUndefined()
    expect(hatched.label_halo).toBe(`#336699`)
    expect(replaced.label_halo).toBe(`var(--page-bg, white)`)
    expect(on_black.label_halo).toBe(`#000`)
    // legend swatches carry the raw pattern spec for the legend to resolve at its own scale
    const legend = hierarchy_legend_items(
      patterned.filter((arc) => arc.depth === 1),
      new SvelteSet(),
      () => `#336699`,
    )
    expect(legend.map((item) => item.display_style.pattern)).toEqual([
      undefined,
      `/`,
      { shape: `dots`, size: 6 },
      { shape: `/`, mode: `replace` },
      { mode: `replace`, bg: `#000` },
    ])
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

describe(`ellipsize_to_width`, () => {
  const width = (text: string) => measure_text_line(text, DEFAULT_FONT_SPEC).width
  const name = `pretrain-llama-70b-stage2`

  test(`keeps the longest prefix whose ellipsis form fits`, () => {
    const max_width = width(name) / 2
    const cut = ellipsize_to_width(name, max_width, DEFAULT_FONT_SPEC)
    expect(cut).toMatch(/^pretrain.*…$/u)
    expect(width(cut ?? ``)).toBeLessThanOrEqual(max_width)
    // one more character would not have fit
    const kept = (cut ?? ``).length - 1
    expect(width(`${name.slice(0, kept + 1)}…`)).toBeGreaterThan(max_width)
  })

  test.each([
    [`too narrow for two characters and the ellipsis`, name, 5, 2],
    [`text no longer than min_chars that does not fit`, `ab`, 1, 2],
  ])(`%s -> null`, (_name, text, max_width, min_chars) => {
    expect(ellipsize_to_width(text, max_width, DEFAULT_FONT_SPEC, min_chars)).toBeNull()
  })

  test(`text that already fits is returned uncut`, () => {
    expect(ellipsize_to_width(name, width(name), DEFAULT_FONT_SPEC)).toBe(name)
  })

  test(`cuts on graphemes, never inside an emoji`, () => {
    const text = `👩‍🔬👩‍🔬👩‍🔬👩‍🔬`
    const cut = ellipsize_to_width(text, width(`👩‍🔬👩‍🔬👩‍🔬`), DEFAULT_FONT_SPEC)
    expect(cut).toBe(`👩‍🔬👩‍🔬…`)
  })
})

describe(`arrow_nav_target`, () => {
  // pre-order indices: root=0, a=1, a1=2, a2=3, b=4, b1=5, c=6
  const nav_tree: SunburstNode[] = [
    {
      label: `a`,
      children: [
        { label: `a1`, value: 1 },
        { label: `a2`, value: 2 },
      ],
    },
    { label: `b`, children: [{ label: `b1`, value: 4 }] },
    { label: `c`, value: 8 },
  ]
  const { arcs: nav_arcs } = compute_sunburst_layout(nav_tree)
  const all_visible = () => true

  test.each([
    [`ArrowRight steps to the next sibling`, 1, `ArrowRight`, 4], // a -> b
    [`ArrowRight wraps from the last sibling to the first`, 6, `ArrowRight`, 1], // c -> a
    [`ArrowLeft wraps from the first sibling to the last`, 1, `ArrowLeft`, 6], // a -> c
    [`ArrowDown enters the first visible child`, 1, `ArrowDown`, 2], // a -> a1
    [`ArrowDown on a leaf is a no-op`, 6, `ArrowDown`, null], // c has no children
    [`ArrowUp returns to the parent`, 2, `ArrowUp`, 1], // a1 -> a
    [`ArrowUp never targets the hidden root at depth 0`, 1, `ArrowUp`, null], // a -> root
    [`non-arrow keys are ignored`, 1, `Enter`, null],
    [`unknown current index returns null`, 99, `ArrowRight`, null],
  ] as const)(`%s`, (_name, current_idx, key, expected) => {
    expect(arrow_nav_target(nav_arcs, all_visible, current_idx, key)).toBe(expected)
  })

  test(`hidden arcs are skipped when cycling siblings (wrap respects visibility)`, () => {
    const b_hidden = (idx: number) => idx !== 4
    // a -> c directly (b hidden), and c wraps back to a
    expect(arrow_nav_target(nav_arcs, b_hidden, 1, `ArrowRight`)).toBe(6)
    expect(arrow_nav_target(nav_arcs, b_hidden, 6, `ArrowRight`)).toBe(1)
    // only one sibling left visible (like b1 alone) -> no-op
    const only_a_visible = (idx: number) => idx === 1
    expect(arrow_nav_target(nav_arcs, only_a_visible, 1, `ArrowLeft`)).toBeNull()
  })

  test(`ArrowDown and ArrowUp respect visibility of the target`, () => {
    // a's first child a1 hidden -> ArrowDown is a no-op (no fall-through to a2)
    expect(arrow_nav_target(nav_arcs, (idx) => idx !== 2, 1, `ArrowDown`)).toBeNull()
    // parent a hidden -> ArrowUp from a1 is a no-op
    expect(arrow_nav_target(nav_arcs, (idx) => idx !== 1, 2, `ArrowUp`)).toBeNull()
  })
})
