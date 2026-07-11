import { Treemap } from '$lib'
import type { TreemapArc, TreemapNode, TreemapNodeHandlerProps } from '$lib/plot'
import { DEFAULT_SERIES_COLORS } from '$lib/plot'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized, resize_element } from '../setup'

// A (explicit color) -> {A1: 4, A2: 6}, B: 10. Root total = 20.
const tree: TreemapNode[] = [
  {
    label: `A`,
    color: `#e15759`,
    children: [
      { label: `A1`, value: 4 },
      { label: `A2`, value: 6 },
    ],
  },
  { label: `B`, value: 10 },
]

// duration 0 makes zoom transitions synchronous for assertions
const mount_sized_treemap = (
  props: Partial<ComponentProps<typeof Treemap>>,
): Promise<HTMLElement> =>
  mount_sized(
    Treemap,
    { tween: { duration: 0 }, ...props },
    { selector: `.treemap`, width: 500, height: 360 },
  )

// Pre-order node indices for the `tree` fixture (root=0). The default
// descending sort places A2 (6) before its smaller sibling A1 (4); the equal-
// value A/B pair keeps input order (stable sort).
const IDX = { A: 1, A2: 2, A1: 3, B: 4 } as const

const cell_rect = (plot: HTMLElement, label: keyof typeof IDX): SVGRectElement => {
  const rect = plot.querySelector<SVGRectElement>(
    `.cells [data-treemap-node-idx="${IDX[label]}"]`,
  )
  if (!rect) throw new Error(`no cell rect for label ${label}`)
  return rect
}

const mouse = (type: string) => new MouseEvent(type, { bubbles: true })

const fire = async (node: Element | null | undefined, event: Event = mouse(`click`)) => {
  node?.dispatchEvent(event)
  await tick()
}

const n_cells = (plot: HTMLElement) => plot.querySelectorAll(`.cells rect`).length
// Sorted node indices of all rendered cells (which cells survive zoom/max_depth)
const shown_idxs = (plot: HTMLElement) =>
  [...plot.querySelectorAll(`.cells rect[data-treemap-node-idx]`)]
    .map((rect) => Number(rect.getAttribute(`data-treemap-node-idx`)))
    .toSorted((idx_a, idx_b) => idx_a - idx_b)

describe(`Treemap`, () => {
  test(`renders cells with resolved colors and value-proportional areas`, async () => {
    const plot = await mount_sized_treemap({ data: tree })
    expect(n_cells(plot)).toBe(4) // A, A1, A2, B (hidden root not rendered)
    const fill = (label: keyof typeof IDX) => cell_rect(plot, label).getAttribute(`fill`)
    expect(fill(`A`)).toBe(`#e15759`) // explicit
    expect(fill(`A1`)).toBe(`#e15759`) // inherited
    expect(fill(`B`)).toBe(DEFAULT_SERIES_COLORS[0]) // palette
    // A and B have equal value -> equal area
    const size_of = (label: keyof typeof IDX) => {
      const rect = cell_rect(plot, label)
      return Number(rect.getAttribute(`width`)) * Number(rect.getAttribute(`height`))
    }
    expect(size_of(`A`)).toBeCloseTo(size_of(`B`), 4)
    expect(size_of(`A2`)).toBeGreaterThan(size_of(`A1`)) // 6 > 4
  })

  test.each([
    [{ data: [] as TreemapNode[] }, 0],
    [{ data: [{ label: `solo`, value: 1 }] }, 1],
  ])(`renders without error for empty/degenerate data %#`, async (props, expected) => {
    const plot = await mount_sized_treemap(props)
    expect(n_cells(plot)).toBe(expected)
  })

  test(`shows a tooltip and fires hover callback with breadcrumb payload`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_treemap({ data: tree, on_node_hover })
    await fire(cell_rect(plot, `A1`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    expect(on_node_hover).toHaveBeenCalledOnce()
    expect(on_node_hover.mock.calls[0][0] as TreemapNodeHandlerProps).toMatchObject({
      type: `node`,
      label: `A1`,
      value: 4,
      depth: 2,
      is_leaf: true,
      path: [`A`, `A/A1`],
      label_path: [`A`, `A1`],
      fraction: expect.closeTo(0.2, 9),
      parent_fraction: expect.closeTo(0.4, 9),
    })
  })

  test(`clicking a branch cell zooms in (fires on_zoom + on_node_click, hides siblings)`, async () => {
    const on_node_click = vi.fn()
    const on_zoom = vi.fn()
    const plot = await mount_sized_treemap({ data: tree, on_node_click, on_zoom })
    await fire(cell_rect(plot, `A`))
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_zoom).toHaveBeenCalledOnce()
    expect(on_zoom.mock.calls[0][0].root.id).toBe(`A`)
    await tick()
    // zoomed into A: A itself and sibling B are hidden, A1/A2 fill the viewport
    expect(shown_idxs(plot)).toEqual([IDX.A2, IDX.A1]) // ascending node_idx order
    // breadcrumbs show the zoom path
    const crumbs = [...plot.querySelectorAll(`.breadcrumb`)].map((btn) =>
      btn.textContent?.trim(),
    )
    expect(crumbs).toEqual([`all`, `A`])
  })

  test.each([
    [`branch`, `A`],
    [`leaf`, `B`],
  ] as const)(
    `zoom_on_click=false: %s click fires on_node_click but does not zoom`,
    async (_kind, label) => {
      const [on_zoom, on_node_click] = [vi.fn(), vi.fn()]
      const plot = await mount_sized_treemap({
        data: tree,
        on_node_click,
        on_zoom,
        zoom_on_click: false,
      })
      await fire(cell_rect(plot, label))
      expect(on_node_click).toHaveBeenCalledOnce()
      expect(on_zoom).not.toHaveBeenCalled()
      expect(n_cells(plot)).toBe(4)
    },
  )

  test(`clicking a leaf zooms into it (plotly semantics); clicking the zoomed leaf zooms back out`, async () => {
    const [on_zoom, on_node_click] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_treemap({ data: tree, on_zoom, on_node_click })
    await fire(cell_rect(plot, `B`))
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_zoom).toHaveBeenLastCalledWith({ root: expect.objectContaining({ id: `B` }) })
    await tick()
    expect(n_cells(plot)).toBe(1) // leaf zoom root renders full-viewport
    // B's parent is the hidden root, so clicking the zoomed leaf returns to `all`
    await fire(cell_rect(plot, `B`))
    expect(on_zoom).toHaveBeenLastCalledWith({ root: null })
    await tick()
    expect(n_cells(plot)).toBe(4)
  })

  // keyboard zoom must keep focus inside the chart: branch zoom focuses the new
  // root's first child in pre-order (A2, the larger sibling under descending
  // sort), leaf zoom focuses the full-viewport leaf cell itself
  test.each([
    [`branch`, `A`, IDX.A2, 2],
    [`leaf`, `B`, IDX.B, 1],
  ] as const)(
    `keyboard Enter on a %s zooms and moves focus to cell %i`,
    async (_kind, label, focus_idx, cells_after) => {
      const plot = await mount_sized_treemap({ data: tree })
      const cell = cell_rect(plot, label)
      cell.focus()
      await fire(cell, new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
      await tick()
      await tick()
      expect(n_cells(plot)).toBe(cells_after)
      const active_idx = document.activeElement?.getAttribute?.(`data-treemap-node-idx`)
      expect(active_idx).toBe(`${focus_idx}`)
    },
  )

  test(`breadcrumb 'all' zooms back out to the root`, async () => {
    const plot = await mount_sized_treemap({ data: tree })
    await fire(cell_rect(plot, `A`))
    await fire(plot.querySelector(`.breadcrumb`)) // 'all'
    await tick()
    expect(n_cells(plot)).toBe(4)
    expect(plot.querySelector(`.breadcrumbs`)).toBeNull()
  })

  test.each([
    {
      name: `zoom_root_id re-roots the view`,
      props: { zoom_root_id: `A` },
      expected: [IDX.A2, IDX.A1], // ascending node_idx order
    },
    {
      name: `stale zoom_root_id falls back to the root`,
      props: { zoom_root_id: `ghost` },
      expected: [IDX.A, IDX.A2, IDX.A1, IDX.B],
    },
    {
      name: `leaf zoom_root_id renders that leaf full-viewport, not a blank chart`,
      props: { zoom_root_id: `B` },
      expected: [IDX.B],
      min_cell_width: 400,
    },
    {
      name: `max_depth limits rendered levels below the zoom root`,
      props: { max_depth: 1 },
      expected: [IDX.A, IDX.B], // A1/A2 at depth 2 are cut off
    },
  ])(`$name`, async ({ props, expected, min_cell_width }) => {
    const plot = await mount_sized_treemap({ data: tree, ...props })
    expect(shown_idxs(plot)).toEqual(expected)
    if (min_cell_width) {
      const width = Number(plot.querySelector(`.cells rect`)?.getAttribute(`width`))
      expect(width).toBeGreaterThan(min_cell_width)
    }
  })

  test.each([
    [
      `Escape key`,
      (_plot: HTMLElement): Promise<void> =>
        fire(
          globalThis as unknown as Element,
          new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
        ),
    ],
    [
      `background double-click on the svg`,
      // role selector: plot.querySelector('svg') would match an icon svg in the
      // header-controls buttons, not the chart
      (plot: HTMLElement): Promise<void> =>
        fire(plot.querySelector(`svg[role="application"]`), mouse(`dblclick`)),
    ],
  ] as const)(`%s zooms a depth-1 view back to the root`, async (_trigger, zoom_out) => {
    const plot = await mount_sized_treemap({ data: tree, zoom_root_id: `A` })
    expect(n_cells(plot)).toBe(2)
    // Escape only fires when interacting with the chart: focus a cell first
    plot.querySelector<SVGRectElement>(`.cells rect[tabindex="0"]`)?.focus()
    await zoom_out(plot)
    expect(n_cells(plot)).toBe(4)
  })

  test(`branch cells show header labels, leaves centered labels`, async () => {
    const plot = await mount_sized_treemap({ data: tree, padding_top: 18 })
    const labels = [...plot.querySelectorAll(`.cell-label`)]
    const texts = labels.map((lbl) => lbl.textContent?.trim())
    expect(texts).toEqual(expect.arrayContaining([`A`, `A1`, `A2`, `B`]))
    const header = labels.find((lbl) => lbl.textContent?.trim() === `A`)
    expect(header?.classList.contains(`header`)).toBe(true)
    expect(header?.getAttribute(`font-size`)).toBe(`14`)
    const leaf = labels.find((lbl) => lbl.textContent?.trim() === `B`)
    expect(leaf?.classList.contains(`header`)).toBe(false)
    expect(leaf?.getAttribute(`font-size`)).toBe(`11`)
  })

  test.each([
    [`the header strip is absent`, { padding_top: 0 }],
    [
      `its font is taller than the header strip`,
      { padding_top: 12, parent_label_font_size: 30 },
    ],
  ] as const)(`hide mode drops a parent label when %s`, async (_reason, props) => {
    const plot = await mount_sized_treemap({ data: tree, ...props })
    const texts = [...plot.querySelectorAll(`.cell-label`)].map((label) =>
      label.textContent?.trim(),
    )
    expect(texts).not.toContain(`A`) // branch label suppressed
    expect(texts).toEqual(expect.arrayContaining([`A1`, `A2`, `B`])) // leaves keep theirs
  })

  test(`show_labels=false renders no labels`, async () => {
    const plot = await mount_sized_treemap({ data: tree, show_labels: false })
    expect(plot.querySelectorAll(`.cell-label`)).toHaveLength(0)
  })

  test(`label_formatter renders styled lines without replacing cell interactions`, async () => {
    const plot = await mount_sized_treemap({
      data: tree,
      label_fit: `clip`,
      label_formatter: (arc: TreemapArc) => [
        {
          text: arc.label_path.join(`/`),
          class: `path-line`,
          font_scale: 0.6,
          font_weight: 300,
          opacity: 0.7,
        },
        { text: arc.label ?? `${arc.id}`, class: `name-line`, font_weight: 700 },
      ],
    })
    const a1_label = [...plot.querySelectorAll<SVGTextElement>(`.cell-label`)].find(
      (label) => label.querySelector(`.name-line`)?.textContent === `A1`,
    )
    expect(a1_label?.querySelector(`.path-line`)?.textContent).toBe(`A/A1`)
    expect(a1_label?.querySelector(`.path-line`)?.getAttribute(`font-weight`)).toBe(`300`)
    expect(a1_label?.querySelector(`.path-line`)?.getAttribute(`opacity`)).toBe(`0.7`)
    expect(a1_label?.querySelector(`.name-line`)?.getAttribute(`font-weight`)).toBe(`700`)
    expect(cell_rect(plot, `A1`).getAttribute(`role`)).toBe(`button`)
    expect(cell_rect(plot, `A1`).getAttribute(`aria-label`)).toBe(`A1: 4`)
    // hovering a label tspan reaches the underlying cell via event delegation
    await fire(a1_label?.querySelector(`.name-line`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
  })

  test(`label_formatter is never invoked for the hidden root`, async () => {
    const label_formatter = vi.fn((arc: TreemapArc) => arc.label ?? `${arc.id}`)
    await mount_sized_treemap({ data: tree, label_formatter })
    const seen_depths = label_formatter.mock.calls.map(([arc]) => arc.depth)
    expect(label_formatter).toHaveBeenCalledTimes(4) // A, A2, A1, B - not the root
    expect(seen_depths).not.toContain(0)
  })

  test.each([
    [`hide drops overflowing labels`, `hide`, `very-long-label-`.repeat(100), 30, null],
    [
      `shrink uses the minimum for overflow`,
      `shrink`,
      `very-long-label-`.repeat(100),
      30,
      `6`,
    ],
    [`clip keeps the maximum for overflow`, `clip`, `very-long-label-`.repeat(100), 30, `30`],
    [`shrink grows labels to the maximum`, `shrink`, `large`, 32, `32`],
  ] as const)(`%s`, async (_name, label_fit, label_text, label_max_font_size, font_size) => {
    const plot = await mount_sized_treemap({
      data: [{ label: label_text, value: 1 }],
      label_fit,
      label_formatter: (arc: TreemapArc) => arc.label,
      label_min_font_size: 6,
      label_max_font_size,
    })
    const label = plot.querySelector<SVGTextElement>(`.cell-label`)
    expect(label?.getAttribute(`font-size`) ?? null).toBe(font_size)
    const clip_path = label?.parentElement?.getAttribute(`clip-path`) ?? null
    if (label_fit === `hide`) expect(clip_path).toBeNull()
    else expect(clip_path).toContain(`treemap-label-clip`)
  })

  test(`rotated labels use an untransformed clipping wrapper`, async () => {
    const plot = await mount_sized_treemap({
      data: [
        { label: `main`, value: 95 },
        { label: `needle-file.ts`, value: 5 },
      ],
      label_fit: `clip`,
      label_max_font_size: 20,
    })
    const labels = [...plot.querySelectorAll<SVGTextElement>(`.cell-label`)]
    const needle_label = labels.find((label) => label.textContent?.trim() === `needle-file.ts`)
    expect(labels).toHaveLength(n_cells(plot))
    expect(needle_label?.getAttribute(`transform`)).toContain(`rotate(-90`)
    expect(needle_label?.getAttribute(`clip-path`)).toBeNull()
    expect(needle_label?.parentElement?.getAttribute(`clip-path`)).toContain(
      `treemap-label-clip`,
    )
  })

  test(`legend lists depth-1 categories and muting dims the subtree`, async () => {
    const plot = await mount_sized_treemap({ data: tree, show_legend: true })
    const legend_items = plot.querySelectorAll(`.legend .legend-item`)
    expect(legend_items).toHaveLength(2) // A, B
    await fire(legend_items[0], mouse(`click`))
    await tick()
    expect(cell_rect(plot, `A`).getAttribute(`fill-opacity`)).toBe(`0.12`)
    expect(cell_rect(plot, `A1`).getAttribute(`fill-opacity`)).toBe(`0.12`)
    expect(cell_rect(plot, `B`).getAttribute(`fill-opacity`)).toBe(`1`)
  })

  test(`color_values colors cells by metric and shows a colorbar`, async () => {
    const plot = await mount_sized_treemap({
      data: tree,
      color_values: (arc: { is_leaf: boolean; value: number }) =>
        arc.is_leaf ? arc.value : null,
      colorbar: { title: `count`, orientation: `vertical` },
    })
    const colorbar = plot.querySelector<HTMLElement>(`.colorbar`)
    expect(colorbar?.style.getPropertyValue(`--cbar-height`)).toBe(
      `var(--treemap-colorbar-height, 150px)`,
    )
    // branches keep categorical colors, leaves get metric colors
    expect(cell_rect(plot, `A`).getAttribute(`fill`)).toBe(`#e15759`)
    expect(cell_rect(plot, `B`).getAttribute(`fill`)).not.toBe(DEFAULT_SERIES_COLORS[0])
  })

  test(`hatch flag overlays a pattern rect on that cell only`, async () => {
    const hatched: TreemapNode[] = [
      { label: `flagged`, value: 5, hatch: true },
      { label: `plain`, value: 5 },
    ]
    const plot = await mount_sized_treemap({ data: hatched })
    const overlays = plot.querySelectorAll(`.cells rect.cell-hatch`)
    expect(overlays).toHaveLength(1)
    expect(overlays[0].getAttribute(`fill`)).toContain(`treemap-hatch`)
  })

  test(`swapping data clears stale hover/tooltip state`, async () => {
    // mount directly (not via the spread helper) so the $state proxy stays live
    const props = $state({
      data: tree,
      tween: { duration: 0 },
      style: `width: 500px; height: 360px;`,
    })
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Treemap, { target, props })
    const plot = target.querySelector<HTMLElement>(`.treemap`)
    if (!plot) throw new Error(`Treemap root element not found`)
    await resize_element(plot, 500, 360)
    await fire(cell_rect(plot, `A1`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    props.data = [{ label: `fresh`, value: 1 }]
    flushSync()
    await tick()
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
  })

  test(`cells expose button semantics with a roving tabindex`, async () => {
    const plot = await mount_sized_treemap({ data: tree })
    const branch = cell_rect(plot, `A`)
    expect(branch.getAttribute(`role`)).toBe(`button`)
    expect(branch.getAttribute(`aria-label`)).toBe(`A: 10`)
    const tabbable = plot.querySelectorAll(`.cells rect[tabindex="0"]`)
    expect(tabbable).toHaveLength(1)
  })
})
