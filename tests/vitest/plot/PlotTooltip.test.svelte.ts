import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
import BarPlot from '#lib/plot/bar/BarPlot.svelte'
import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import Histogram from '#lib/plot/histogram/Histogram.svelte'
import Sankey from '#lib/plot/sankey/Sankey.svelte'
import Sunburst from '#lib/plot/sunburst/Sunburst.svelte'
import TernaryPlot from '#lib/plot/ternary/TernaryPlot.svelte'
import TooltipValue from '#lib/tooltip/TooltipValue.svelte'
import { hover_tooltip } from '#lib/tooltip/hover.svelte.js'
import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
import { DEFAULT_CURSOR_SIZE } from '#lib/plot/core/decorations/tooltip.js'
import { color as d3_color } from 'd3-color'
import {
  type Component,
  createRawSnippet,
  flushSync,
  mount,
  type ComponentProps,
} from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import {
  doc_query,
  pin_cycle,
  pin_spot,
  fire,
  keydown,
  mount_sized,
  mouse,
  query,
  trigger_resize_observer,
} from '../setup'

const make_children = (text: string = `Test`) =>
  createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }))

// oxfmt-ignore
test.each([
  { label: `Energy (eV)`, value: `−789`, expected: `Energy: −789 eV`, units: `eV` },
  { label: `Heat capacity (J/(mol·K))`, value: `1.23`, expected: `Heat capacity: 1.23 J/(mol·K)`, units: `J/(mol·K)` },
  { label: `Time (ms)`, value: `2.00`, unit: `ms`, expected: `Time: 2.00 ms`, units: `ms` },
  { label: `ρ residual (rms)`, value: `0.02`, unit: `a.u.`, expected: `ρ residual (rms): 0.02 a.u.`, units: `a.u.` },
  { label: `Fraction`, value: `25%`, expected: `Fraction: 25 %`, units: `%` },
  { label: `g(r)`, value: 2, expected: `g(r): 2`, units: undefined },
  { label: `F<sub>max</sub> (eV/Å)`, value: `0.35`, expected: `Fmax: 0.35 eV/Å`, units: `eV/Å` },
])(`renders $label units after the value in small text`, ({ expected, units, ...props }) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(TooltipValue, { target, props })
  flushSync()
  expect(target.textContent).toBe(expected)
  expect(target.querySelector(`small`)?.textContent).toBe(units)
})

// avoid_cursor defaults to true on the component (most anchors are the pointer), which
// widens offset.x to the glyph's width. These tests are about offset/flip/clamp
// arithmetic, so they opt out; the default itself is pinned in its own test below.
const mount_tooltip = (
  props: Partial<ComponentProps<typeof PlotTooltip>> & {
    children?: ReturnType<typeof make_children>
  } = {},
): HTMLElement => {
  mount(PlotTooltip, {
    target: document.body,
    props: { x: 0, y: 0, avoid_cursor: false, children: make_children(), ...props },
  })
  flushSync()
  return doc_query(`.plot-tooltip`)
}
// Set a CSS custom property on <body> for the current test only
const body_var = (name: string, value: string): void => {
  document.body.style.setProperty(name, value)
  onTestFinished(() => void document.body.style.removeProperty(name))
}

describe(`PlotTooltip`, () => {
  test(`renders with default offset, absolute position, content-wide chips, class and style`, () => {
    const tooltip = mount_tooltip({
      x: 100,
      y: 200,
      children: make_children(`Test content`),
      class: `custom-tooltip my-class`,
      style: `z-index: 9999; backdrop-filter: blur(4px);`,
    })
    const { left, top, position, pointerEvents: events } = tooltip.style
    // 100 + default offset 6
    expect([left, top, position, events]).toEqual([`106px`, `200px`, `absolute`, `none`])
    expect(tooltip.textContent).toBe(`Test content`)
    // as wide as its content up to --plot-tooltip-max-width, wrapping only beyond that
    const { whiteSpace, width } = getComputedStyle(tooltip)
    expect([whiteSpace, width]).toEqual([`normal`, `max-content`])
    // no container cap, and no inline max-width that would override a caller's CSS
    expect(tooltip.style.getPropertyValue(`--plot-tooltip-cap`)).toBe(``)
    expect(tooltip.style.maxWidth).toBe(``)
    expect([...tooltip.classList]).toEqual(
      expect.arrayContaining([`plot-tooltip`, `custom-tooltip`, `my-class`]),
    )
    expect(tooltip.style.zIndex).toBe(`9999`)
  })

  // Contrast ratios are covered in colors.test.ts; here only the wiring. No fill (or one
  // that resolves to nothing) paints the neutral --plot-tooltip-bg chip (resolved where it renders)
  test.each([
    [`#000000`, `rgb(0, 0, 0)`, `rgb(255, 255, 255)`],
    [`#4fc3f7`, `rgb(79, 195, 247)`, `rgb(0, 0, 0)`],
    [`rgba(79, 195, 247, 0.4)`, `rgb(79, 195, 247)`, `rgb(0, 0, 0)`], // flattened
    [null, `rgb(5, 5, 5)`, `rgb(255, 255, 255)`],
    [`transparent`, `rgb(5, 5, 5)`, `rgb(255, 255, 255)`],
    [`var(--unset-color)`, `rgb(5, 5, 5)`, `rgb(255, 255, 255)`],
  ])(`bg_color %s paints %s with %s text`, (background, expected_bg, expected_text) => {
    body_var(`--plot-tooltip-bg`, `rgba(5, 5, 5, 0.9)`)
    const tooltip = mount_tooltip({ bg_color: background })
    expect(d3_color(tooltip.style.backgroundColor)?.formatRgb()).toBe(expected_bg)
    expect(d3_color(tooltip.style.color)?.formatRgb()).toBe(expected_text)
  })

  // hover_tooltip's mark-fill getter may yield nothing (e.g. a mark without a palette color):
  // the tooltip falls back to the neutral chip instead of losing its background
  test.each([
    [() => null, `rgb(5, 5, 5)`, `white`],
    [undefined, `rgb(5, 5, 5)`, `white`],
    [() => `#4fc3f7`, `rgb(79, 195, 247)`, `black`],
  ])(`hover_tooltip with fill getter %s paints %s`, (bg_color, expected_bg, expected_text) => {
    body_var(`--plot-tooltip-bg`, `rgba(5, 5, 5, 0.9)`)
    const mark = document.createElement(`span`)
    document.body.append(mark)
    const cleanup = $effect.root(() => {
      $effect(() => hover_tooltip(make_children(), bg_color)(mark))
    })
    onTestFinished(cleanup)
    flushSync()
    mark.dispatchEvent(new PointerEvent(`pointerenter`, { clientX: 5, clientY: 5 }))
    flushSync()
    const tooltip = doc_query(`.plot-tooltip`)
    expect(d3_color(tooltip.style.backgroundColor)?.formatRgb()).toBe(expected_bg)
    expect(tooltip.style.color).toBe(expected_text)
  })

  // One pin across every hover_tooltip mark on the page; a button's click is its own
  test(`hover_tooltip: a click pins, the mark again, a press elsewhere or Escape unpin`, async () => {
    const marks = [`span`, `span`, `button`].map((tag, idx) => {
      const mark = document.createElement(tag)
      mark.textContent = `mark ${idx}`
      document.body.append(mark)
      return mark
    })
    const cleanup = $effect.root(() => {
      for (const [idx, mark] of marks.entries())
        $effect(() => hover_tooltip(make_children(`tip ${idx}`))(mark))
    })
    onTestFinished(cleanup)
    flushSync()
    const enter = (mark: Element) => mark.dispatchEvent(new PointerEvent(`pointerenter`))
    const text = await pin_cycle(
      (step, mark_idx) => {
        const mark = mark_idx === null ? document.body : marks[mark_idx]
        if (step === `escape`) document.dispatchEvent(keydown(`Escape`))
        else if (step === `leave`) mark.dispatchEvent(new PointerEvent(`pointerleave`))
        else if (step === `nudge`)
          mark.dispatchEvent(new PointerEvent(`pointermove`, pin_spot(mark_idx, step)))
        else if (mark !== document.body) enter(mark)
        if (step === `click`) {
          mark.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
          mark.dispatchEvent(mouse(`click`))
        }
      },
      { lit: (idx) => marks[idx].hasAttribute(`data-pinned`) },
    ) // CSS adds :hover
    expect(text).toBe(`tip 0`)
    enter(marks[2])
    marks[2].click()
    flushSync()
    expect(doc_query(`.plot-tooltip`).classList.contains(`pinned`)).toBe(false)
  })

  test(`resolves CSS-variable backgrounds and reacts to token changes`, async () => {
    body_var(`--series-color`, `white`)
    const tooltip = mount_tooltip({ bg_color: `var(--series-color)` })
    const { backgroundColor, color } = tooltip.style
    expect([d3_color(backgroundColor)?.formatHex(), color]).toEqual([`#ffffff`, `black`])
    document.body.style.setProperty(`--series-color`, `black`)
    await vi.waitFor(() => expect(tooltip.style.color).toBe(`white`))
  })

  // Tooltip props change on every mousemove: the measure + color observers must be created
  // once per host element (was 2 MutationObservers/move), and moving must not re-read
  // computed styles (its own style:left/top writes used to trigger a re-resolve each move)
  test.each([`#000000`, `var(--series-color)`])(
    `%s: mousemoves rebuild no observers and read no computed styles`,
    async (bg_color) => {
      const count_constructions = (name: `ResizeObserver` | `MutationObserver`) => {
        const Original = globalThis[name]
        let count = 0
        vi.stubGlobal(
          name,
          new Proxy(Original, {
            construct(target, args, new_target) {
              count++
              return Reflect.construct(target, args, new_target)
            },
          }),
        )
        onTestFinished(() => void vi.stubGlobal(name, Original))
        return () => count
      }
      const resize_observers = count_constructions(`ResizeObserver`)
      const mutation_observers = count_constructions(`MutationObserver`)
      const computed_styles = vi.spyOn(globalThis, `getComputedStyle`)
      onTestFinished(() => computed_styles.mockRestore())
      const props = $state({ x: 0, y: 0, bg_color })
      mount(PlotTooltip, {
        target: document.body,
        props: Object.assign(props, { children: make_children() }),
      })
      flushSync()
      const tooltip = doc_query(`.plot-tooltip`)
      const n_styles = () => computed_styles.mock.calls.length
      const counts = () => [resize_observers(), mutation_observers(), n_styles()]
      const at_mount = counts()
      expect(at_mount[0]).toBe(1)
      for (let idx = 1; idx <= 50; idx++) {
        props.x = idx
        props.y = 2 * idx
        flushSync()
      }
      await new Promise((resolve) => setTimeout(resolve, 0)) // MutationObserver callbacks
      expect(tooltip.style.left).toBe(`56px`)
      expect(counts()).toEqual(at_mount)
    },
  )

  // Position clamping is covered in layout.test.ts; this only checks wrap width = box - 16.
  test(`wraps inside a constrained width`, () => {
    const tooltip = mount_tooltip({
      constrain_to: { width: 100, height: 300 },
      children: make_children(`a`.repeat(80)),
    })
    // the container cap rides a CSS variable, not an inline max-width that would beat the
    // caller's own CSS; the stylesheet combines it with --plot-tooltip-max-width
    expect(tooltip.style.getPropertyValue(`--plot-tooltip-cap`)).toBe(`84px`)
    expect(tooltip.style.maxWidth).toBe(``)
    expect(getComputedStyle(tooltip).maxWidth).toBe(`min(256px, 84px)`) // the 16rem default
    expect(getComputedStyle(tooltip).whiteSpace).toBe(`normal`)
    // never inherits a centered page section
    expect(getComputedStyle(tooltip).textAlign).toBe(`start`)
    // --plot-tooltip-max-width narrows the box, the container cap still applies
    tooltip.style.setProperty(`--plot-tooltip-max-width`, `50px`)
    expect(getComputedStyle(tooltip).maxWidth).toBe(`min(50px, 84px)`)
  })

  // a caller's class cannot beat the scoped white-space rule, so it is set by variable
  test.each([
    [`chip`, {}],
    [`wrapping box`, { constrain_to: { width: 100, height: 300 } }],
  ])(`--plot-tooltip-white-space overrides the %s default`, (_label, props) => {
    const tooltip = mount_tooltip({ ...props, style: `--plot-tooltip-white-space: pre-line` })
    expect(getComputedStyle(tooltip).whiteSpace).toBe(`pre-line`)
  })

  // A pinned chip says how to unpin in a tab on its top edge (no extra height, no overlap with
  // a full-width first row), which slides back in after a couple of seconds
  test.each([false, true])(`pinned=%s shows the unpin tab`, (pinned) => {
    const tooltip = mount_tooltip({ pinned })
    const hint = tooltip.querySelector<HTMLElement>(`.pin-hint`)
    expect(hint !== null).toBe(pinned)
    if (!hint) return
    // happy-dom keeps the animation shorthand unexpanded
    const { position, animation } = getComputedStyle(hint)
    expect(position).toBe(`absolute`)
    expect(animation).toMatch(/pin-hint-retract.* 2\.5s /)
  })

  // UA and page margins would pad a dense chip; the reset has zero specificity, so a tooltip
  // snippet's own (here inline) styles still win
  test(`resets h4, p, small, .key and sup inside the chip`, () => {
    const tooltip = mount_tooltip({
      children: createRawSnippet(() => ({
        render: () =>
          `<div><h4>Fe</h4><p><span class="key">E</span> 1 <small>Å<sup>−3</sup></small></p><p style="margin: 5px">x</p></div>`,
      })),
    })
    const style = (selector: string) => getComputedStyle(query(tooltip, selector))
    expect([style(`h4`).marginTop, style(`h4`).marginBottom]).toEqual([`0px`, `0px`])
    expect(style(`p`).marginTop).toBe(`1px`)
    expect([style(`small`).opacity, style(`.key`).opacity]).toEqual([`0.75`, `0.75`])
    expect(style(`sup`).lineHeight).toBe(`0`) // a unit's superscript keeps the row dense
    expect(style(`p[style]`).marginTop).toBe(`5px`)
  })

  // Without a constraining box the signed offset is applied verbatim, absolute or fixed.
  // With one, the fallback size drives decoration-aware placement until a measurement lands.
  const box = { width: 100, height: 100 }
  const small = { width: 20, height: 10 }
  // oxfmt-ignore
  test.each<[string, Partial<ComponentProps<typeof PlotTooltip>>, number, number]>([
    [`absolute offset`, { x: 50, y: 40, offset: { x: -10, y: -5 } }, 40, 35],
    [`fixed offset`, { x: 50, y: 40, fixed: true, offset: { x: -10, y: -5 } }, 40, 35],
    [`positive x offset`, { x: 50, y: 40, offset: { x: 10, y: -10 } }, 60, 30],
    [`fallback size dodging an exclusion rect`, { x: 50, y: 50, offset: { x: 0, y: 0 }, constrain_to: box, fallback_size: small, exclusion_rects: [{ x: 50, y: 50, ...small }] }, 50, 40],
    [`fallback size flipping at the box edge`, { x: 95, y: 50, constrain_to: box, fallback_size: { width: 30, height: 20 } }, 59, 50],
    [`decoration-aware placement kept fixed`, { x: 95, y: 50, fixed: true, offset: { x: 5, y: 5 }, constrain_to: box, fallback_size: small, exclusion_rects: [] }, 70, 55],
    [`centered under the anchor`, { x: 50, y: 50, offset: { x: 0, y: 20 }, center: `x`, constrain_to: box, fallback_size: small }, 40, 70],
    [`centered beside the anchor`, { x: 50, y: 50, offset: { x: 20, y: 0 }, center: `y`, constrain_to: box, fallback_size: small }, 70, 45],
    [`centered without bounds`, { x: 50, y: 40, offset: { x: 0, y: 10 }, center: `x`, fallback_size: small }, 40, 50],
  ])(`placement: %s`, (_desc, props, left, top) => {
    const tooltip = mount_tooltip(props)
    expect(tooltip.style.position).toBe(props.fixed ? `fixed` : `absolute`)
    expect([tooltip.style.left, tooltip.style.top]).toEqual([`${left}px`, `${top}px`])
  })

  // the arrow sits on the edge facing the anchor, also after a flip, and needs `center`
  test.each([
    [`below the anchor`, { y: 20, center: `x` }, `top: -6px`],
    [
      `flipped above at the bottom edge`,
      { y: 95, center: `x` },
      `bottom: -6px; rotate: 180deg`,
    ],
    [
      `right of the anchor`,
      { y: 50, x: 20, center: `y`, offset: { x: 20, y: 0 } },
      `left: -9px; rotate: -90deg`,
    ],
    [`without center`, { y: 20 }, null],
  ] as const)(`arrow %s`, (_desc, props, edge) => {
    mount_tooltip({
      x: 50,
      offset: { x: 0, y: 20 },
      constrain_to: box,
      fallback_size: small,
      arrow: true,
      ...props,
    })
    const style = document.querySelector(`.plot-tooltip .arrow`)?.getAttribute(`style`) ?? null
    if (edge === null) expect(style).toBeNull()
    else expect(style).toContain(edge)
  })

  // Fixed tooltips are bounded by the viewport: anchors near its right/bottom edges flip the
  // tooltip to the other side instead of letting it overflow off-screen.
  test.each([
    [`inside`, 100, 100, 110, 105],
    [`right edge flips left`, innerWidth - 20, 100, innerWidth - 20 - 10 - 60, 105],
    [`bottom edge flips up`, 100, innerHeight - 10, 110, innerHeight - 10 - 5 - 30],
    [`corner clamps`, innerWidth + 50, innerHeight + 50, innerWidth - 60, innerHeight - 30],
  ])(`fixed placement at viewport %s`, (_desc, coord_x, coord_y, left, top) => {
    const [offset, fallback_size] = [
      { x: 10, y: 5 },
      { width: 60, height: 30 },
    ]
    const tip = mount_tooltip({ x: coord_x, y: coord_y, fixed: true, offset, fallback_size })
    expect([tip.style.left, tip.style.top]).toEqual([`${left}px`, `${top}px`])
  })

  // a 100px box with a 10px fallback size, so measured sizes show in the placement
  const fallback_box = { constrain_to: box, fallback_size: { width: 10, height: 10 } }
  test(`re-measures when its content resizes`, () => {
    const tooltip = mount_tooltip({ x: 80, y: 50, offset: { x: 0, y: 0 }, ...fallback_box })
    expect(tooltip.style.left).toBe(`80px`)
    const width_spy = vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(50)
    onTestFinished(() => width_spy.mockRestore())
    trigger_resize_observer(tooltip)
    flushSync()
    expect(tooltip.style.left).toBe(`30px`) // 50px wide no longer fits right of x=80
  })

  test(`prefers measured size over fallback size`, () => {
    for (const [getter, size] of [
      [`offsetWidth`, 40],
      [`offsetHeight`, 20],
    ] as const) {
      const spy = vi.spyOn(HTMLElement.prototype, getter, `get`).mockReturnValue(size)
      onTestFinished(() => spy.mockRestore())
    }
    const props = { x: 75, y: 50, offset: { x: 0, y: 0 }, exclusion_rects: [] }
    const tooltip = mount_tooltip({ ...props, ...fallback_box })
    flushSync()
    expect([tooltip.style.left, tooltip.style.top]).toEqual([`35px`, `50px`])
  })

  // Most anchors track the pointer, so clearing its glyph is the default and only
  // mark-anchored charts (scatter/bar/histogram) opt out. A caller's narrower
  // offset.x is widened to the glyph's width rather than left under the cursor.
  // undefined lets the component's own default apply, so this pins the default itself
  test.each([
    [`off`, false, `55px`],
    [`on`, true, `${50 + DEFAULT_CURSOR_SIZE.width}px`],
    [`left to its default`, undefined, `${50 + DEFAULT_CURSOR_SIZE.width}px`],
  ])(`widens a narrower offset to the glyph with avoid_cursor %s`, (_desc, flag, left) => {
    const constrain_to = { width: 400, height: 400 }
    const props = { x: 50, y: 50, offset: { x: 5, y: 5 }, constrain_to, fallback_size: small }
    expect(mount_tooltip({ ...props, avoid_cursor: flag }).style.left).toBe(left)
  })

  // The bug `avoid_cursor` exists for: a tooltip too wide to sit beside its anchor
  // clamps to nearly the same box from either side, and that box runs under the
  // pointer that summoned it. Widening cannot help — only the glyph's own rect can
  // push the choice to the one direction that clears it.
  // 405 puts the 24px-tall glyph on the tooltip's first line; 351 ends it (+44 high)
  // exactly at the hotspot, the only one of the four candidates that clears it.
  test.each([
    [false, `405px`],
    [true, `351px`],
  ])(`avoid_cursor=%s places a clamped wide tooltip at top %s`, (avoid_cursor, top) => {
    // The usage sunburst that reported this: a long breadcrumb in a ~1135px pane
    const constrain_to = { width: 1135, height: 700 }
    const fallback_size = { width: 1030, height: 44 }
    const props = { x: 900, y: 400, avoid_cursor, offset: { x: 20, y: 5 }, constrain_to }
    expect(mount_tooltip({ ...props, fallback_size }).style.top).toBe(top)
  })
})

// A chart's tooltip={false} skips its PlotTooltip but still runs the hover handler (Sunburst's
// HierarchyShell serves Treemap too)
type Props = Record<string, unknown>
const two_nodes = {
  nodes: [{ id: `a` }, { id: `b` }],
  links: [{ source: `a`, target: `b`, value: 1 }],
}
// oxfmt-ignore
test.each<[string, unknown, string, Props, string, MouseEventInit?]>([
  [`.bar-plot`, BarPlot, `on_bar_hover`, { series: [{ x: [1, 2], y: [3, 4] }] }, `path[role="button"]`],
  [`.box-plot`, BoxPlot, `on_box_hover`, { series: [{ y: [1, 2, 3] }] }, `g.box-series[role="button"]`],
  [`.histogram`, Histogram, `on_bar_hover`, { series: [{ values: [0, 1] }] }, `g.histogram-series path[role="button"]`],
  [`.sankey`, Sankey, `on_node_hover`, { data: two_nodes }, `.nodes rect`, { clientX: 30, clientY: 40 }],
  [`.sunburst`, Sunburst, `on_node_hover`, { data: [{ label: `A`, value: 1 }], tween: { duration: 0 } }, `[data-sunburst-node-idx="1"]`],
  [`.ternary`, TernaryPlot, `on_point_hover`, { series: [{ points: [[0.2, 0.3, 0.5]] }] }, `[data-ternary-idx="0"]`, { clientX: 100, clientY: 100 }],
])(`%s with tooltip=false keeps its hover handler`, async (selector, chart, handler, props, target, init) => {
  for (const tooltip of [undefined, false]) {
    const on_hover = vi.fn()
    const options = { selector, width: 500, height: 360 }
    const plot = await mount_sized(chart as Component<Props>, { ...props, [handler]: on_hover, tooltip }, options)
    await fire(plot.querySelector(target), mouse(`mousemove`, init))
    expect(on_hover).toHaveBeenCalledOnce()
    expect(plot.querySelector(`.plot-tooltip`) !== null).toBe(tooltip === undefined)
    plot.parentElement?.remove()
  }
})

// The pin state machine every pinnable tooltip shares. Marks are keyed by `id`, so `a2` is a
// fresher snapshot of the pinned `a`; `off` stands for a mark whose click the host claimed.
describe(`TooltipPin`, () => {
  type Mark = { id: string }
  const [a, a2, b, off] = [{ id: `a` }, { id: `a` }, { id: `b` }, { id: `off` }]
  test.each<[string, (Mark | null)[], Mark | null, number]>([
    [`a click pins the mark`, [a], a, 0],
    [`clicking it again unpins, even as a fresher snapshot`, [a, a2], null, 1],
    [`another mark moves the pin`, [a, b], b, 0],
    [`empty space unpins`, [a, null], null, 1],
    [`a claimed mark only unpins`, [a, off], null, 1],
    [`a claimed mark never pins`, [off], null, 0],
  ])(`%s`, (_label, clicks, pinned, n_unpins) => {
    const on_unpin = vi.fn()
    const pin = new TooltipPin<Mark>({
      key: ({ id }) => id,
      enabled: ({ id }) => id !== `off`,
      on_unpin,
    })
    for (const mark of clicks) pin.toggle(mark)
    expect(pin.value).toBe(pinned)
    expect(on_unpin).toHaveBeenCalledTimes(n_unpins)
  })

  test(`hovers other than the pinned mark are held off; Escape reports whether it unpinned`, () => {
    const pin = new TooltipPin<Mark>({ key: ({ id }) => id })
    expect([pin.allows(b), pin.is(a), pin.unpin()]).toEqual([true, false, false])
    pin.toggle(a)
    expect([pin.allows(a2), pin.allows(b), pin.is(a2), pin.is(null)]).toEqual([
      true,
      false,
      true,
      false,
    ])
    expect([pin.unpin(), pin.value, pin.unpin()]).toEqual([true, null, false])
  })
})
