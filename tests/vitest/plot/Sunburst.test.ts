import { Sunburst } from '$lib'
import type { PositionedArc, SunburstNode, SunburstNodeHandlerProps } from '$lib/plot'
import { DEFAULT_SERIES_COLORS } from '$lib/plot'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { resize_element } from '../setup'

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

async function mount_sized_sunburst(
  props: Partial<ComponentProps<typeof Sunburst>>,
): Promise<HTMLElement> {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(Sunburst, {
    target,
    // duration 0 makes zoom transitions synchronous for assertions
    props: {
      tween: { duration: 0 },
      ...props,
      style: `width: 500px; height: 360px; ${props.style ?? ``}`,
    },
  })
  const plot = target.querySelector<HTMLElement>(`.sunburst`)
  if (!plot) throw new Error(`Sunburst root element not found`)
  await resize_element(plot, 500, 360)
  return plot
}

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
  node?.dispatchEvent(event)
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

  test.each([{ data: [] as SunburstNode[] }, { data: [{ label: `solo`, value: 1 }] }])(
    `renders without error for empty/degenerate data %#`,
    async (props) => {
      const plot = await mount_sized_sunburst(props)
      expect(n_arcs(plot)).toBeLessThanOrEqual(1)
    },
  )

  test(`shows a tooltip and fires hover callback with breadcrumb payload`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_hover })
    await fire(arc_path(plot, `A1`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
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

  test(`clicking a branch arc zooms in (fires on_zoom + on_node_click, hides siblings)`, async () => {
    const on_node_click = vi.fn()
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_click, on_zoom })
    await fire(arc_path(plot, `A`))
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_zoom).toHaveBeenCalledOnce()
    expect(on_zoom.mock.calls[0][0].root.id).toBe(`A`)
    // zoomed view: only A's children remain visible (A collapses into the hole, B is
    // outside the angular window); center shows the zoom root + its value
    expect(n_arcs(plot)).toBe(2)
    expect(plot.querySelector(`.center-label`)?.textContent).toMatch(/A[\s\S]*10/)
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

  test(`clicking the center circle zooms back out`, async () => {
    const on_zoom = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_zoom })
    await fire(arc_path(plot, `A`))
    expect(n_arcs(plot)).toBe(2)
    await fire(plot.querySelector(`.center-circle`))
    expect(n_arcs(plot)).toBe(4)
    expect(on_zoom).toHaveBeenLastCalledWith({ root: null })
    // back at the root, the center is no longer an interactive zoom-out target
    expect(plot.querySelector(`.center-circle`)?.getAttribute(`role`)).toBeNull()
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
    [`export_buttons`, `[aria-label="Download SVG"]`, {}],
    [`show_breadcrumbs`, `.breadcrumbs`, { zoom_root_id: `A` }],
  ] as const)(`%s=false removes %s`, async (prop, selector, extra) => {
    const shown = await mount_sized_sunburst({ data: tree, ...extra })
    expect(shown.querySelectorAll(selector).length).toBeGreaterThan(0)
    document.body.innerHTML = ``
    const hidden = await mount_sized_sunburst({ data: tree, ...extra, [prop]: false })
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

  test(`renders a legend with one item per depth-1 category`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, show_legend: true })
    expect(plot.querySelector(`.legend`)?.textContent).toMatch(/A[\s\S]*B/)
  })

  test(`default tooltip shows breadcrumb + percent of total`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    await fire(arc_path(plot, `A`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)?.textContent).toMatch(/A[\s\S]*50% of total/)
  })

  test(`value_mode total respects authoritative parent values`, async () => {
    const data: SunburstNode[] = [
      { label: `P`, value: 10, children: [{ label: `c1`, value: 3 }] },
    ]
    const plot = await mount_sized_sunburst({ data, value_mode: `total` })
    expect(plot.querySelector(`.center-label`)?.textContent).toContain(`10`)
  })

  test(`keyboard Enter on an arc triggers click handling`, async () => {
    const on_node_click = vi.fn()
    const plot = await mount_sized_sunburst({ data: tree, on_node_click })
    await fire(arc_path(plot, `B`), key(`Enter`))
    expect(on_node_click).toHaveBeenCalledOnce()
  })

  test(`click-to-zoom dismisses the tooltip of the clicked arc`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    await fire(arc_path(plot, `A`), mouse(`mousemove`))
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    await fire(arc_path(plot, `A`))
    // the clicked arc collapsed into the hole - its tooltip must not linger
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
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
    await fire(arc_path(plot, `A`))
    // the mouseup ending a selection drag must not zoom or fire click handlers
    expect(on_zoom).not.toHaveBeenCalled()
    expect(on_node_click).not.toHaveBeenCalled()
    get_selection.mockRestore()
  })

  test(`clicking the center label zooms out`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, zoom_root_id: `A` })
    expect(n_arcs(plot)).toBe(2)
    await fire(plot.querySelector(`.center-label`))
    expect(n_arcs(plot)).toBe(4)
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

  // Escape (one level out) and background double-click (reset to root) both return a
  // depth-1 zoomed view to the full chart; identical setup + assertion, only the trigger differs
  test.each<[string, (plot: HTMLElement) => Promise<void>]>([
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
  ])(`%s zooms a depth-1 view back to the root`, async (_name, zoom_out) => {
    const plot = await mount_sized_sunburst({ data: tree, zoom_root_id: `A` })
    expect(n_arcs(plot)).toBe(2)
    await zoom_out(plot)
    expect(n_arcs(plot)).toBe(4)
  })

  test(`arrow keys move focus between siblings and across levels`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    arc_path(plot, `A`).focus()
    for (const [arrow, from, to] of [
      [`ArrowRight`, `A`, `B`], // next sibling
      [`ArrowRight`, `B`, `A`], // wraps around
      [`ArrowDown`, `A`, `A1`], // first child
      [`ArrowUp`, `A1`, `A`], // back to parent
    ] as const) {
      await fire(arc_path(plot, from), key(arrow))
      expect(document.activeElement, `${arrow} ${from}->${to}`).toBe(arc_path(plot, to))
    }
  })

  test(`roving tabindex puts exactly one arc in the tab order`, async () => {
    const plot = await mount_sized_sunburst({ data: tree })
    const tab_stops = [...plot.querySelectorAll(`.arcs path`)].filter(
      (el) => el.getAttribute(`tabindex`) === `0`,
    )
    expect(tab_stops).toHaveLength(1)
  })
})

describe(`Sunburst display options`, () => {
  test(`label_text=percent renders percentages of the total`, async () => {
    const plot = await mount_sized_sunburst({ data: tree, label_text: `percent` })
    const labels = [...plot.querySelectorAll(`.arc-label`)].map((el) => el.textContent?.trim())
    expect(labels).toContain(`50%`) // A and B are each half the total
  })

  test(`color_values colors arcs from the colormap and renders a colorbar`, async () => {
    const plot = await mount_sized_sunburst({
      data: tree,
      color_values: (arc: PositionedArc) => arc.value,
    })
    // A and B have equal values -> identical metric color despite different categories
    expect(arc_path(plot, `A`).getAttribute(`fill`)).toBe(
      arc_path(plot, `B`).getAttribute(`fill`),
    )
    expect(arc_path(plot, `A`).getAttribute(`fill`)).not.toBe(`#e15759`)
    expect(
      plot.querySelector(`.colorbar, [class*='color-bar'], [class*='colorbar']`),
    ).not.toBeNull()
  })

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
