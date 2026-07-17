import { Sunburst } from '$lib'
import type { PositionedArc, SunburstNode, SunburstNodeHandlerProps } from '$lib/plot'
import { DEFAULT_SERIES_COLORS } from '$lib/plot'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized, resize_element } from '../setup'

// A (explicit color) -> {A1: 4, A2: 6}, B: 10. Root total = 20.
const tree: SunburstNode[] = [
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

// 3-level chain for zoom-depth tests: L1 -> L2 -> {L3a, L3b}
const deep: SunburstNode[] = [
  {
    label: `L1`,
    children: [
      {
        label: `L2`,
        children: [
          { label: `L3a`, value: 1 },
          { label: `L3b`, value: 2 },
        ],
      },
    ],
  },
]

// duration 0 makes zoom transitions synchronous for assertions
const mount_sized_sunburst = (
  props: Partial<ComponentProps<typeof Sunburst>>,
): Promise<HTMLElement> =>
  mount_sized(
    Sunburst,
    { tween: { duration: 0 }, ...props },
    {
      selector: `.sunburst`,
      width: 500,
      height: 360,
    },
  )

// Pre-order node indices for the `tree` fixture (root=0)
const IDX = { A: 1, A1: 2, A2: 3, B: 4 } as const

const arc_path = (plot: HTMLElement, label: keyof typeof IDX): SVGPathElement => {
  const path = plot.querySelector<SVGPathElement>(`[data-sunburst-node-idx="${IDX[label]}"]`)
  if (!path) throw new Error(`no arc path for label ${label}`)
  return path
}

const mouse = (type: string) => new MouseEvent(type, { bubbles: true })
const key = (key_name: string) =>
  new KeyboardEvent(`keydown`, { key: key_name, bubbles: true })

// Dispatch a bubbling event on a node (defaults to a click) and flush the update
const fire = async (
  node: Element | null | undefined,
  event: Event = mouse(`click`),
): Promise<void> => {
  if (!node) throw new Error(`event target not found`)
  node.dispatchEvent(event)
  await tick()
}

const n_arcs = (plot: HTMLElement) => plot.querySelectorAll(`.arcs path`).length

describe(`Sunburst`, () => {
  test(`renders arcs, center total and resolved colors`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    expect(n_arcs(plot)).toBe(4) // A, A1, A2, B
    expect(plot.querySelector(`.center-label`)?.textContent).toContain(`20`) // root total
    const fill = (label: keyof typeof IDX) => arc_path(plot, label).getAttribute(`fill`)
    expect(fill(`A`)).toBe(`#e15759`) // explicit
    expect(fill(`A1`)).toBe(`#e15759`) // inherited
    expect(fill(`B`)).toBe(DEFAULT_SERIES_COLORS[0]) // palette
  })

  test(`forwards group gaps into arc projection`, async () => {
    const plain_plot = await mount_sized_sunburst({ data: tree, pad_angle: 0 })
    const select_group = vi.fn((arc: PositionedArc) => arc.depth === 1)
    const grouped_plot = await mount_sized_sunburst({
      data: tree,
      pad_angle: 0,
      group_gap: { select: select_group, gap_px: 20 },
    })

    expect(select_group).toHaveBeenCalled()
    expect(arc_path(grouped_plot, `A`).getAttribute(`d`)).not.toBe(
      arc_path(plain_plot, `A`).getAttribute(`d`),
    )
  })

  test.each([
    [{ data: [] as SunburstNode[] }, 0],
    [{ data: [{ label: `solo`, value: 1 }] }, 1],
  ])(`renders without error for empty/degenerate data %#`, async (props, expected) => {
    const plot = await mount_sized_sunburst(props)
    expect(n_arcs(plot)).toBe(expected)
  })

  test(`shows the default tooltip and fires hover callback with breadcrumb payload`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_hover })
    await fire(arc_path(plot, `A1`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)?.textContent).toMatch(
      /A › A1[\s\S]*20% of total[\s\S]*40% of parent/,
    )
    expect(on_node_hover).toHaveBeenCalledOnce()
    expect(on_node_hover.mock.calls[0][0] as SunburstNodeHandlerProps).toMatchObject({
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

  test(`clicking a branch zooms, fires callbacks, and dismisses its tooltip`, async () => {
    const on_node_click = vi.fn()
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_click, on_zoom })
    await fire(arc_path(plot, `A`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    await fire(arc_path(plot, `A`))
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_zoom).toHaveBeenCalledOnce()
    expect(on_zoom.mock.calls[0][0].root.id).toBe(`A`)
    // zoomed view: only A's children remain visible (A collapses into the hole, B is
    // outside the angular window); center shows the zoom root + its value
    expect(n_arcs(plot)).toBe(2)
    expect(plot.querySelector(`.center-label`)?.textContent).toMatch(/A[\s\S]*10/)
    // the clicked arc collapsed into the hole - its tooltip must not linger
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
  })

  test.each([
    [`clicking a leaf`, {}, `B`],
    [`zoom_on_click=false`, { zoom_on_click: false }, `A`],
  ] as const)(`%s fires on_node_click but does not zoom`, async (_name, props, label) => {
    const [on_zoom, on_node_click] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_sunburst({ data: tree, on_node_click, on_zoom, ...props })
    await fire(arc_path(plot, label))
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_zoom).not.toHaveBeenCalled()
    expect(n_arcs(plot)).toBe(4)
  })

  test.each([
    [`zoom_root_id re-roots the view`, { zoom_root_id: `A` }, 2],
    [`stale zoom_root_id falls back to the root`, { zoom_root_id: `ghost` }, 4],
    [`max_depth limits the number of rings`, { max_depth: 1 }, 2],
  ] as const)(`%s`, async (_name, props, expected_arcs) => {
    const plot = await mount_sized_sunburst({ data: tree, ...props })
    expect(n_arcs(plot)).toBe(expected_arcs)
  })

  // boolean props that remove a feature's DOM when false
  test.each([
    [`show_labels`, `.arc-label`, {}],
    [`export_buttons`, `[aria-label="Download SVG"]`, { controls_open: true }], // buttons live in the controls pane
    [`show_breadcrumbs`, `.breadcrumbs`, { zoom_root_id: `A` }],
  ] as const)(`%s=false removes %s`, async (prop, selector, extra) => {
    // each mount lives in its own container, so both variants can coexist
    const shown = await mount_sized_sunburst({ data: tree, ...extra })
    const hidden = await mount_sized_sunburst({ data: tree, ...extra, [prop]: false })
    expect(shown.querySelectorAll(selector).length).toBeGreaterThan(0)
    expect(hidden.querySelectorAll(selector)).toHaveLength(0)
  })

  // labels auto-contrast with the arc fill (white labels would vanish on light arcs)
  test.each([
    [`#ffe0b3`, `black`],
    [`#1f3a5f`, `white`],
  ])(`arc label on %s renders %s text for contrast`, async (color, expected_fill) => {
    const plot = await mount_sized_sunburst({ data: [{ label: `N`, color, value: 10 }] })
    expect(plot.querySelector(`.arc-label`)?.getAttribute(`fill`)).toBe(expected_fill)
  })

  test(`legend renders categories and toggles subtree and label opacity`, async () => {
    const plot = await mount_sized_sunburst({
      data: tree,
      show_legend: true,
      show_labels: true,
    })
    const items = [...plot.querySelectorAll(`.legend-item`)]
    expect(items.map((item) => item.querySelector(`.legend-label`)?.textContent)).toEqual([
      `A`,
      `B`,
    ])
    const opacities = () =>
      ([`A`, `A1`, `A2`, `B`] as const).map((lbl) =>
        arc_path(plot, lbl).getAttribute(`fill-opacity`),
      )
    const label_opacity = (text: string) =>
      [...plot.querySelectorAll(`.arc-label`)]
        .find((el) => el.textContent?.trim().startsWith(text))
        ?.getAttribute(`fill-opacity`)
    await fire(plot.querySelector(`.legend-item`)) // mute A
    expect(opacities()).toEqual([`0.12`, `0.12`, `0.12`, `1`])
    // muted arcs must not keep fully opaque labels floating over invisible arcs
    expect(label_opacity(`A`)).toBe(`0.12`)
    expect(label_opacity(`B`)).toBeNull()
    await fire(plot.querySelector(`.legend-item`)) // unmute A
    expect(opacities()).toEqual([`1`, `1`, `1`, `1`])
    expect(label_opacity(`A`)).toBeNull()
  })

  test(`hovering an arc dims unrelated arcs but keeps its ancestors opaque`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    await fire(arc_path(plot, `A1`), mouse(`mousemove`))
    const opacity = (lbl: keyof typeof IDX) => arc_path(plot, lbl).getAttribute(`fill-opacity`)
    expect([opacity(`A1`), opacity(`A`), opacity(`B`)]).toEqual([`1`, `1`, `0.3`])
  })

  test(`value_mode total respects authoritative parent values`, async () => {
    const data: SunburstNode[] = [
      { label: `P`, value: 10, children: [{ label: `c1`, value: 3 }] },
    ]
    const plot = await mount_sized_sunburst({ data, value_mode: `total` })
    expect(plot.querySelector(`.center-label`)?.textContent).toContain(`10`)
  })

  // Regression guard for the effect_update_depth_exceeded class: a multi-root
  // value_mode='total' hierarchy rendered as two instances with the default
  // (non-zero) tween - the exact shape that surfaced the bug. A reactive read/write
  // cycle in an effect (e.g. the view tween feeding back into its own target) trips
  // Svelte's infinite-loop guard, which logs via console.error and throws; happy-dom
  // flushes effects eagerly at mount, so it fires here. Mounts directly (not via the
  // duration:0 helper) so the real Tween.of render-effect path is exercised.
  test(`multi-root value_mode=total renders two instances without a reactive loop`, async () => {
    const errors: unknown[][] = []
    const error_spy = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => void errors.push(args))
    // 7 roots x 34 numeric-labeled children, parent value == children sum (no warning)
    const multi_root: SunburstNode[] = Array.from({ length: 7 }, (_root, sys) => ({
      id: `sys${sys}`,
      label: `sys${sys}`,
      value: 34,
      children: Array.from({ length: 34 }, (_child, num) => ({
        id: `sys${sys}/${num}`,
        label: `${num}`,
        value: 1,
      })),
    }))
    try {
      for (let idx = 0; idx < 2; idx++) {
        const target = document.createElement(`div`)
        document.body.append(target)
        mount(Sunburst, {
          target,
          props: {
            data: multi_root,
            value_mode: `total`,
            style: `width: 500px; height: 360px`,
          },
        })
        const plot = target.querySelector<HTMLElement>(`.sunburst`)
        if (!plot) throw new Error(`Sunburst root element not found`)
        await resize_element(plot, 500, 360)
        expect(n_arcs(plot)).toBe(7 * 35) // 7 roots x (34 children + 1 root arc)
      }
    } finally {
      error_spy.mockRestore()
    }
    // a clean render logs nothing; the loop guard logs (and throws) on a feedback cycle
    expect(errors, errors.map(String).join(`\n`)).toHaveLength(0)
  })

  test.each([`Enter`, ` `])(
    `keyboard activation key %j on an arc triggers click handling`,
    async (key_name) => {
      const on_node_click = vi.fn()
      const plot = await mount_sized_sunburst({ data: tree, on_node_click })
      await fire(arc_path(plot, `B`), key(key_name))
      expect(on_node_click).toHaveBeenCalledOnce()
    },
  )

  // regression for cf6e3e62: leaving the chart must reset the bindable hover state
  test(`mouseleave clears the tooltip and reports one null hover`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_hover })
    await fire(arc_path(plot, `A1`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    await fire(plot.querySelector(`svg[role="application"]`), new MouseEvent(`mouseleave`))
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
    expect(on_node_hover).toHaveBeenLastCalledWith(null)
    // leaving the chart fires mouseleave on both the chart <g> and the <svg>; a hover
    // clear must only report null once (and not at all when nothing was hovered)
    await fire(plot.querySelector(`svg[role="application"]`), new MouseEvent(`mouseleave`))
    expect(on_node_hover.mock.calls.map((args) => args[0] && `info`)).toEqual([`info`, null])
  })

  // hover/focus state is index-based - swapping data must clear it, else the old
  // tooltip lingers and whatever node now occupies the index renders as hovered
  test(`swapping data clears stale hover/tooltip state`, async () => {
    const props = $state({
      data: tree,
      tween: { duration: 0 },
      style: `width: 500px; height: 360px;`,
    })
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Sunburst, { target, props })
    const plot = target.querySelector<HTMLElement>(`.sunburst`)
    if (!plot) throw new Error(`Sunburst root element not found`)
    await resize_element(plot, 500, 360)
    await fire(arc_path(plot, `B`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    props.data = Array.from({ length: 5 }, (_node, idx) => ({
      label: `N${idx}`,
      value: idx + 1,
    }))
    flushSync()
    await tick()
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
    // no arc of the new data may inherit the stale hover highlight/dimming
    const opacities = [...plot.querySelectorAll(`.arcs path`)].map((path) =>
      path.getAttribute(`fill-opacity`),
    )
    expect(opacities).toEqual([`1`, `1`, `1`, `1`, `1`])
  })

  // legend hover sets hovered_idx without hover_info (dim-only); the same-arc early
  // return in set_arc_hover must not then suppress the arc's own tooltip forever
  test(`tooltip still appears on an arc after its legend item was hovered`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, show_legend: true })
    const legend_item = plot.querySelector(`.legend-item`) // item for category A
    await fire(legend_item, mouse(`mouseenter`))
    await fire(arc_path(plot, `A`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
  })

  // a fast double-click on the center zoom-out button fires click+click+dblclick;
  // the dblclick background-reset must not compound onto the two zoom-out steps
  test(`double-clicking the center circle steps out without resetting to root`, async () => {
    const chain: SunburstNode[] = [
      {
        label: `L1`,
        children: [
          {
            label: `L2`,
            children: [
              {
                label: `L3`,
                children: [
                  { label: `L4a`, value: 1 },
                  { label: `L4b`, value: 2 },
                ],
              },
            ],
          },
        ],
      },
    ]
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: chain, on_zoom })
    await fire(plot.querySelector(`[data-sunburst-node-idx="3"]`)) // zoom to L3 (depth 3)
    const center = plot.querySelector(`.center-circle`)
    await fire(center) // zoom out -> L2
    await fire(center) // zoom out -> L1
    await fire(center, mouse(`dblclick`)) // must NOT additionally reset to root
    const last_root = on_zoom.mock.lastCall?.[0]?.root
    expect(last_root?.label).toBe(`L1`)
  })

  // keyboard-zooming an icicle must move focus to the new root's first child: the
  // clicked row itself collapses once the zoom tween settles, so focusing it (the
  // roving index) would drop keyboard users out of the chart onto <body>
  test(`icicle keyboard zoom focuses the new root's first child`, async () => {
    const plot = await mount_sized_sunburst({
      data: deep,
      shape: `icicle`,
      tween: { duration: 50 }, // real tween: the collapsing row is still mounted at t=0
    })
    const l1 = plot.querySelector<SVGPathElement>(`[data-sunburst-node-idx="1"]`)
    l1?.focus()
    await fire(l1, key(`Enter`)) // zoom to L1
    await tick() // focus handoff runs in tick().then()
    await tick()
    expect(document.activeElement?.getAttribute(`data-sunburst-node-idx`)).toBe(`2`)
  })

  test.each([
    [`L1/L2`, `zoom out to L1`], // names the parent, not the current root
    [`L1`, `zoom out to full chart`],
  ])(`center circle aria-label when zoomed to %s is "%s"`, async (zoom_root_id, aria) => {
    const plot = await mount_sized_sunburst({ data: deep, zoom_root_id })
    expect(plot.querySelector(`.center-circle`)?.getAttribute(`aria-label`)).toBe(aria)
  })

  test(`keyboard zoom moves focus to the center circle`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    await fire(arc_path(plot, `A`), key(`Enter`))
    await tick() // focus is deferred one extra tick (center tabindex appears after zoom)
    expect(document.activeElement?.classList.contains(`center-circle`)).toBe(true)
  })
})

describe(`Sunburst label selection`, () => {
  test(`labels carry the arc's data index and forward hover + click to their arc`, async () => {
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_zoom })
    const label = plot.querySelector(`.arc-label[data-sunburst-node-idx="${IDX.A}"]`)
    expect(label).not.toBeNull()
    await fire(label, mouse(`mousemove`)) // hover forwards to the arc -> tooltip shows
    expect(plot.querySelector(`.plot-tooltip`)?.textContent).toContain(`A`)
    await fire(label) // click forwards to the arc -> zoom in
    expect(on_zoom).toHaveBeenCalledOnce()
    expect(on_zoom.mock.calls[0][0].root.id).toBe(`A`)
  })

  test(`an active text selection inside the chart suppresses click-zoom`, async () => {
    const [on_zoom, on_node_click] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_sunburst({ data: tree, on_zoom, on_node_click })
    const label = plot.querySelector(`.arc-label[data-sunburst-node-idx="${IDX.A}"]`)
    const get_selection = vi
      .spyOn(globalThis, `getSelection`)
      .mockReturnValue({ isCollapsed: false, anchorNode: label } as unknown as Selection)
    try {
      await fire(arc_path(plot, `A`))
      // the mouseup ending a selection drag must not zoom or fire click handlers
      expect(on_zoom).not.toHaveBeenCalled()
      expect(on_node_click).not.toHaveBeenCalled()
    } finally {
      get_selection.mockRestore() // always restore so the spy can't leak into other tests
    }
  })
})

describe(`Sunburst zoom navigation`, () => {
  test(`breadcrumbs render when zoomed and clicking a crumb re-roots`, async () => {
    const plot = await mount_sized_sunburst({ data: deep, zoom_root_id: `L1/L2` })
    const crumbs = [...plot.querySelectorAll<HTMLButtonElement>(`.breadcrumbs button`)]
    expect(crumbs.map((btn) => btn.textContent?.trim())).toEqual([`all`, `L1`, `L2`])
    expect(crumbs[2].disabled).toBe(true) // current root
    await fire(crumbs[1]) // jump to L1
    expect(plot.querySelector(`.center-label`)?.textContent).toContain(`L1`)
    await fire(crumbs[0]) // jump back to the root -> breadcrumbs disappear
    expect(plot.querySelector(`.breadcrumbs`)).toBeNull()
  })

  // every zoom-out trigger returns a depth-1 zoomed view to the full chart
  test.each<[string, (plot: HTMLElement) => Promise<void>]>([
    [`center circle click`, (plot) => fire(plot.querySelector(`.center-circle`))],
    [`center label click`, (plot) => fire(plot.querySelector(`.center-label`))],
    [
      `Escape key`,
      async (plot) => {
        plot.querySelector<SVGCircleElement>(`.center-circle`)?.focus()
        await fire(globalThis as unknown as Element, key(`Escape`))
      },
    ],
    [
      `background double-click`,
      (plot) => fire(plot.querySelector(`.arcs`), mouse(`dblclick`)),
    ],
  ])(`%s zooms a depth-1 view back to the root`, async (trigger, zoom_out) => {
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, zoom_root_id: `A`, on_zoom })
    expect(n_arcs(plot)).toBe(2)
    await zoom_out(plot)
    expect(n_arcs(plot)).toBe(4)
    if (trigger === `center circle click`) {
      expect(on_zoom).toHaveBeenLastCalledWith({ root: null })
      // back at the root, the center is no longer an interactive zoom-out target
      expect(plot.querySelector(`.center-circle`)?.getAttribute(`role`)).toBeNull()
    }
  })

  test(`arrow keys move focus between siblings and across levels`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    arc_path(plot, `A`).focus()
    for (const [arrow, from, to] of [
      [`ArrowRight`, `A`, `B`], // next sibling
      [`ArrowRight`, `B`, `A`], // wraps around
      [`ArrowLeft`, `B`, `A`], // previous sibling
      [`ArrowDown`, `A`, `A1`], // first child
      [`ArrowUp`, `A1`, `A`], // back to parent
    ] as const) {
      await fire(arc_path(plot, from), key(arrow))
      expect(document.activeElement, `${arrow} ${from}->${to}`).toBe(arc_path(plot, to))
    }
  })

  test(`roving tabindex keeps exactly one arc in the tab order and follows focus`, async () => {
    // on_node_click makes every arc (including leaves) clickable/focusable
    const plot = await mount_sized_sunburst({ data: tree, on_node_click: vi.fn() })
    const tab_stops = () =>
      [...plot.querySelectorAll(`.arcs path`)].filter(
        (el) => el.getAttribute(`tabindex`) === `0`,
      )
    expect(tab_stops()).toEqual([arc_path(plot, `A`)]) // first clickable arc
    await fire(arc_path(plot, `B`), new FocusEvent(`focusin`, { bubbles: true }))
    expect(tab_stops()).toEqual([arc_path(plot, `B`)]) // tab stop follows focus
  })
})

describe(`Sunburst display options`, () => {
  // tree fixture: A=10 (50%), A1=4 (20%), A2=6 (30%), B=10 (50%)
  test.each([
    [`percent`, `50%`],
    [`value`, `4`],
    [`label+value`, `A1 4`],
    [`label+percent`, `A1 20%`],
    // % of PARENT: A1 is 4 of A's 10
    [`label+parent-percent`, `A1 (40%)`],
  ] as const)(`label_text=%s renders %j`, async (label_text, expected) => {
    const plot = await mount_sized_sunburst({ data: tree, label_text })
    const labels = [...plot.querySelectorAll(`.arc-label`)].map((el) => el.textContent?.trim())
    expect(labels).toContain(expected)
  })

  test(`color_values colors arcs from the colormap and renders a colorbar`, async () => {
    const plot = await mount_sized_sunburst({
      data: tree,
      color_values: (arc: PositionedArc) => arc.value,
      colorbar: { orientation: `vertical` },
    })
    // A and B have equal values -> identical metric color despite different categories
    expect(arc_path(plot, `A`).getAttribute(`fill`)).toBe(
      arc_path(plot, `B`).getAttribute(`fill`),
    )
    expect(arc_path(plot, `A`).getAttribute(`fill`)).not.toBe(`#e15759`)
    const colorbar = plot.querySelector<HTMLElement>(`.colorbar`)
    expect(colorbar?.style.getPropertyValue(`--cbar-height`)).toBe(
      `var(--sunburst-colorbar-height, 150px)`,
    )
  })

  test.each([
    [`right`, 210, 130],
    [`left`, 290, 370],
  ] as const)(
    `vertical colorbar on %s reserves capped width`,
    async (colorbar_side, expected_center, expected_capped_center) => {
      const color_values = (arc: PositionedArc): number => arc.value
      const base_props = { data: tree, color_values, inner_radius: 0.5 }
      const mount_vertical_colorbar = () =>
        mount_sized_sunburst({
          ...base_props,
          colorbar: { orientation: `vertical` },
          colorbar_side,
        })
      let measured_colorbar_width = 64
      const client_width = vi
        .spyOn(HTMLElement.prototype, `clientWidth`, `get`)
        .mockImplementation(function (this: HTMLElement): number {
          return this.classList.contains(`colorbar`) ? measured_colorbar_width : 800
        })
      try {
        const without_colorbar = await mount_sized_sunburst({
          ...base_props,
          colorbar: null,
        })
        const expected_path = arc_path(without_colorbar, `A`).getAttribute(`d`)
        const with_vertical_colorbar = await mount_vertical_colorbar()
        const chart_group = with_vertical_colorbar.querySelector(`svg > g[transform]`)
        expect(chart_group?.getAttribute(`transform`)).toBe(
          `translate(${expected_center}, 180)`,
        )
        expect(arc_path(with_vertical_colorbar, `A`).getAttribute(`d`)).toBe(expected_path)
        expect(with_vertical_colorbar.querySelector(`.center-circle`)?.getAttribute(`r`)).toBe(
          `85`,
        )
        expect(
          with_vertical_colorbar
            .querySelector(`.colorbar .tick-label`)
            ?.classList.contains(`tick-${colorbar_side === `left` ? `secondary` : `primary`}`),
        ).toBe(true)

        measured_colorbar_width = 1000
        const width_limited = await mount_vertical_colorbar()
        // The reserve is capped at half of the 480px padded width, leaving a
        // 240px diameter and radius 120 (half-radius center circle = 60).
        expect(
          width_limited.querySelector(`svg > g[transform]`)?.getAttribute(`transform`),
        ).toBe(`translate(${expected_capped_center}, 180)`)
        expect(width_limited.querySelector(`.center-circle`)?.getAttribute(`r`)).toBe(`60`)
      } finally {
        client_width.mockRestore()
      }
    },
  )

  test(`min_fraction prop buckets small arcs into Other`, async () => {
    const data: SunburstNode[] = [
      { label: `big`, value: 90 },
      { label: `t1`, value: 5 },
      { label: `t2`, value: 5 },
    ]
    const plot = await mount_sized_sunburst({ data, min_fraction: 0.07 })
    expect(n_arcs(plot)).toBe(2) // big + Other
  })
})

describe(`controls pane`, () => {
  test(`inputs drive chart props through snippet function bindings`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, controls_open: true })
    expect(n_arcs(plot)).toBe(4)
    // the max-depth number input is bound via the num_row snippet's get/set pair
    const inputs = [...plot.querySelectorAll<HTMLInputElement>(`input[type="number"]`)]
    const max_depth_input = inputs.find((el) => el.min === `0` && el.max === `10`)
    if (!max_depth_input) throw new Error(`max depth input not found`)
    max_depth_input.value = `1`
    await fire(max_depth_input, new Event(`input`, { bubbles: true }))
    expect(n_arcs(plot)).toBe(2) // only depth-1 ring left
  })
})

describe(`icicle shape`, () => {
  test(`renders rect paths, no center circle, zooms via breadcrumbs`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, shape: `icicle` })
    expect(plot.classList.contains(`icicle`)).toBe(true)
    expect(plot.querySelector(`.center-circle`)).toBeNull()
    const d_attr = plot.querySelector(`.arcs path`)?.getAttribute(`d`) ?? ``
    expect(d_attr).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+H[\d.]+Z$/) // rect, not arc
    // click branch A to zoom -> breadcrumbs appear
    await fire(arc_path(plot, `A`))
    expect(n_arcs(plot)).toBe(2)
    expect(plot.querySelector(`.breadcrumbs`)).not.toBeNull()
  })

  test(`rotates labels 90° in thin-but-tall cells, keeps wide cells horizontal`, async () => {
    // jsdom's canvas measureText returns 0, so force a width wide enough that a narrow
    // cell can't fit a horizontal label but a tall one fits it rotated
    const get_context = vi.spyOn(HTMLCanvasElement.prototype, `getContext`)
    get_context.mockReturnValue({
      font: ``,
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D)
    try {
      // one wide leaf (~320px) + 10 narrow ones (~16px) sharing one full-height row
      const data: SunburstNode[] = [
        { label: `wide`, value: 20 },
        ...Array.from({ length: 10 }, (_unused, idx) => ({ label: `n${idx}`, value: 1 })),
      ]
      const plot = await mount_sized_sunburst({ data, shape: `icicle` })
      const transforms = [...plot.querySelectorAll(`.arc-label`)].map(
        (el) => el.getAttribute(`transform`) ?? ``,
      )
      // narrow cells use vertical labels, the wide one stays horizontal
      expect(transforms.filter((tf) => tf.includes(`rotate(-90)`)).length).toBeGreaterThan(0)
      expect(transforms.filter((tf) => !tf.includes(`rotate`)).length).toBeGreaterThan(0)
    } finally {
      get_context.mockRestore()
    }
  })
})
