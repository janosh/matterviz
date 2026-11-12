import { add_alpha } from '#lib/colors/index.js'
import { point_in_polygon, type Vec2 } from '#lib/math.js'
import { LIQUID_COLOR } from '#lib/phase-diagram/utils.js'
import IsobaricBinaryPhaseDiagram from '#lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import type {
  BinaryPhaseDiagram,
  DiagramCursor,
  DiagramHighlight,
  PhaseLegendEntry,
} from '#lib/phase-diagram/types.js'
import { binary_diagrams } from '#site/phase-diagrams.js'
import { type ComponentProps, createRawSnippet, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  create_drop_event,
  doc_query,
  pin_cycle,
  expect_shortcuts_in_pane,
  keydown,
  mount_sized,
  mouse,
  plot_svg,
  resize_element,
} from '../setup'
import {
  eutectic,
  eutectic_regions,
  observations,
  pts,
  rect,
  shifted_eutectic,
} from './fixtures/test-data'
import IsobaricBinaryPhaseDiagramHarness from './IsobaricBinaryPhaseDiagramHarness.svelte'
import SyncedDiagramsHarness from './SyncedDiagramsHarness.svelte'

// With a 500x400 mount and default margins (l=60 r=25 t=25 b=50) the plot area spans
// x: [60, 475], y: [25, 350]; to_client converts (composition, temperature) -> client coords
// for the eutectic fixture's [0, 1000] K window.
const [width, height] = [500, 400]
const [left, right, top, bottom] = [60, 475, 25, 350] // from default margins
const to_client = (composition: number, temperature: number) => ({
  clientX: left + composition * (right - left),
  clientY: bottom - (temperature / 1000) * (bottom - top),
})

const mount_diagram = (
  props: Partial<ComponentProps<typeof IsobaricBinaryPhaseDiagram>> = {},
): Promise<HTMLElement> =>
  mount_sized(
    IsobaricBinaryPhaseDiagram,
    { data: eutectic, ...props },
    { selector: `.binary-phase-diagram`, width, height },
  )

const hover_at = async (
  wrapper: HTMLElement,
  composition: number,
  temperature: number,
): Promise<SVGElement> => {
  const svg = plot_svg(wrapper)
  svg.dispatchEvent(
    new PointerEvent(`pointermove`, { ...to_client(composition, temperature), bubbles: true }),
  )
  await tick()
  return svg
}
const tooltip_text = (wrapper: HTMLElement) =>
  wrapper.querySelector(`.tooltip-container`)?.textContent?.replaceAll(/\s+/g, ` `).trim() ??
  null
// Harness with load/clear buttons for its data prop; `click` presses one by test id
const mount_harness = async () => {
  const wrapper = await mount_sized(
    IsobaricBinaryPhaseDiagramHarness,
    { loaded_data: eutectic },
    { selector: `.binary-phase-diagram`, width, height },
  )
  const click = async (test_id: string) => {
    doc_query<HTMLButtonElement>(`[data-testid="${test_id}"]`).click()
    await tick()
  }
  return { wrapper, click }
}
// Two diagrams bound to one cursor: returns the first's and the second's wrapper
const mount_synced = async (): Promise<[HTMLElement, HTMLElement]> => {
  const first = await mount_sized(
    SyncedDiagramsHarness,
    { diagrams: [eutectic, shifted_eutectic] },
    { selector: `.binary-phase-diagram.first`, width, height },
  )
  const second = doc_query(`.binary-phase-diagram.second`)
  await resize_element(second, width, height)
  return [first, second]
}
const legend_click = async (wrapper: HTMLElement, label: string) => {
  const item = [
    ...wrapper.querySelectorAll<HTMLElement>(`.phase-diagram-legend .legend-item`),
  ].find((element) => element.textContent?.includes(label))
  if (!item) throw new Error(`No legend item "${label}"`)
  item.click()
  await tick()
}

// The highlight a diagram writes while the eutectic fixture's eutectic is hovered: its phases
// by model phase and label, so a partner diagram can pair by phases
const eutectic_ref = {
  point: {
    category: `invariant`,
    kind: `eutectic`,
    at: [0.5, 500],
    phases: [`FCC_A1`, `α`, `LIQUID`, `L`, `BCC_A2`, `β`],
  },
}

describe(`IsobaricBinaryPhaseDiagram`, () => {
  // A 2D chart reveals its buttons on hover like every other chart (it used to pin them), and
  // its controls pane lists the keyboard shortcuts
  test.each([
    [undefined, `hover-visible`],
    [`always`, `always-visible`],
  ] as const)(`show_controls=%s gives a %s button row`, async (show_controls, row_class) => {
    const wrapper = await mount_diagram(show_controls ? { show_controls } : {})
    const row = wrapper.querySelector(`section.control-buttons`)
    expect(row?.classList.contains(row_class)).toBe(true)
    expect_shortcuts_in_pane(wrapper, `.phase-diagram-controls-pane`, [
      `viewer`,
      `binary-phase-diagram`,
    ])
  })

  // A container briefly narrower than the margins (mid-resize) gave a negative plot width,
  // which the SVG rejected (`<rect> attribute width: A negative value is not valid`)
  test(`renders no plot while smaller than its margins`, async () => {
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      { data: eutectic },
      { selector: `.binary-phase-diagram`, width: 40, height },
    )
    expect(wrapper.querySelector(`svg`)).toBeNull()
  })

  // a failed drop's banner is about the dropped file: new data from the parent clears it
  test(`a new data prop clears a failed drop's error`, async () => {
    const { wrapper, click } = await mount_harness()
    await click(`load-phase-data`)
    wrapper.dispatchEvent(
      create_drop_event(
        new File([`<svg xmlns="http://www.w3.org/2000/svg"></svg>`], `pd.svg`, {
          type: `image/svg+xml`,
        }),
      ),
    )
    await vi.waitFor(() =>
      expect(wrapper.querySelector(`[role="alert"] .error`)?.textContent).toContain(`pd.svg`),
    )
    await click(`clear-phase-data`)
    await click(`load-phase-data`)
    expect(wrapper.querySelector(`[role="alert"] .error`)).toBeNull()
    expect(wrapper.querySelectorAll(`.phase-regions path`).length).toBeGreaterThan(0)
  })

  test(`recovers across missing, loaded, cleared, and reloaded data`, async () => {
    const { wrapper, click } = await mount_harness()
    expect(wrapper.textContent).toContain(`Missing phase diagram data`)
    expect(wrapper.textContent).toContain(`Provide diagram data through the data prop.`)
    expect(wrapper.querySelector(`.empty-state`)?.getAttribute(`role`)).toBe(`status`)
    expect(wrapper.getAttribute(`aria-label`)).toBe(
      `Missing phase diagram data. Provide diagram data through the data prop.`,
    )
    expect(wrapper.querySelector(`svg`)).toBeNull()
    await click(`load-phase-data`)
    expect(wrapper.querySelector(`svg`)).not.toBeNull()

    const component_value = Array.from(
      document.querySelectorAll<HTMLElement>(`.json-value.string`),
    ).find((element) => element.textContent?.trim() === `"Al"`)
    if (!component_value) throw new Error(`Editable Al component value not found`)
    component_value.dispatchEvent(mouse(`dblclick`))
    await tick()
    const edit_input = doc_query<HTMLInputElement>(`.edit-input`)
    edit_input.value = `Edited`
    edit_input.dispatchEvent(new InputEvent(`input`, { bubbles: true }))
    edit_input.dispatchEvent(keydown(`Enter`))
    await tick()
    expect(wrapper.getAttribute(`aria-label`)).toBe(`Edited-Cu binary phase diagram`)

    const svg = await hover_at(wrapper, 0.5, 750)
    expect(doc_query(`[data-testid="hovered-region"]`).textContent).toBe(`LIQUID`)
    svg.dispatchEvent(mouse(`click`))
    await tick()
    expect(wrapper.querySelector(`.plot-tooltip.pinned`)).not.toBeNull()

    await click(`clear-phase-data`)
    expect(wrapper.textContent).toContain(`Missing phase diagram data`)
    expect(wrapper.querySelector(`svg`)).toBeNull()
    expect(doc_query(`[data-testid="hovered-region"]`).textContent).toBe(`none`)
    await click(`load-phase-data`)
    expect(wrapper.querySelector(`svg`)).not.toBeNull()
    expect(wrapper.getAttribute(`aria-label`)).toBe(`Al-Cu binary phase diagram`)
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()
    document.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
  })

  test(`renders regions, kind-styled boundaries, phase labels, marked points and axes`, async () => {
    const wrapper = await mount_diagram()
    expect(wrapper.querySelectorAll(`.phase-regions path`)).toHaveLength(2)
    const boundary = wrapper.querySelector(`.boundaries path`)
    expect(boundary?.getAttribute(`data-kind`)).toBe(`invariant`)
    expect(boundary?.getAttribute(`stroke`)).toBe(`#d32f2f`)
    const labels = [...wrapper.querySelectorAll(`.region-labels > g`)].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual([`L`, `α + β`])
    expect(wrapper.querySelectorAll(`.special-point-marker`)).toHaveLength(1)
    expect(wrapper.querySelector(`.special-points`)?.textContent).toContain(`E`)
    expect(wrapper.querySelector(`.x-axis`)?.textContent).toContain(`Cu (at%)`)
    expect(wrapper.querySelector(`.y-axis`)?.textContent).toContain(`Temperature (K)`)
    // no overlay and no observations: no legend
    expect(wrapper.querySelector(`.phase-diagram-legend`)).toBeNull()
  })

  // a diagram with an empty regions list (e.g. an SVG import that traced none) still draws
  // boundaries and points, and the hover reports (x, T) with no phase set
  test(`a diagram without regions draws boundaries and points and still reports the cursor`, async () => {
    const boundaries_only = { ...eutectic, regions: [] }
    const on_phase_hover = vi.fn()
    const wrapper = await mount_diagram({ data: boundaries_only, on_phase_hover })
    expect(wrapper.querySelector(`[role="alert"] .error`)).toBeNull()
    expect(wrapper.querySelectorAll(`.phase-regions path`)).toHaveLength(0)
    expect(wrapper.querySelectorAll(`.boundaries path`)).toHaveLength(1)
    expect(wrapper.querySelectorAll(`.special-point-marker`)).toHaveLength(1)
    await hover_at(wrapper, 0.3, 750)
    expect(on_phase_hover.mock.lastCall?.[0]).toMatchObject({ region: null, lever_rule: null })
    // no regions, so no phase set to name in the header
    expect(tooltip_text(wrapper)).toMatch(/^Temperature 750 K/)
  })

  // with regions, a gap between them drops the tooltip but keeps the shared cursor on it
  test(`hovering a gap between regions clears the hover once and keeps the cursor`, async () => {
    const state: { cursor: DiagramCursor | null } = { cursor: null }
    const on_phase_hover = vi.fn()
    const data = { ...eutectic, regions: [eutectic_regions[0]] } // liquid only, gap below
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      bind_props({ data, on_phase_hover }, state),
      { selector: `.binary-phase-diagram`, width, height },
    )
    await hover_at(wrapper, 0.25, 750)
    expect(tooltip_text(wrapper)).toMatch(/^L /)
    await hover_at(wrapper, 0.25, 250)
    await hover_at(wrapper, 0.3, 200)
    expect(on_phase_hover.mock.calls.map(([info]) => info === null)).toEqual([false, true])
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()
    expect(state.cursor).toMatchObject({ composition: expect.closeTo(0.3, 9) })
  })

  // every point category gets its own marker: filled circle (invariant, unary), diamond
  // (congruent), ring (critical); melting points are labelled Tm(component)
  test(`marks congruent, critical and pure-component points`, async () => {
    const data: BinaryPhaseDiagram = {
      ...eutectic,
      congruent_points: [{ temperature: 800, composition: 0.4, phases: [`LIQUID`, `A`] }],
      critical_points: [{ temperature: 300, composition: 0.6, phase: `B` }],
      unary_transitions: [{ component: `Cu`, temperature: 900, above: `LIQUID`, below: `B` }],
    }
    const wrapper = await mount_diagram({ data })
    const markers = [...wrapper.querySelectorAll(`.special-point-marker`)]
    expect(markers.map((el) => [el.tagName, el.getAttribute(`data-category`)])).toEqual([
      [`circle`, `invariant`],
      [`path`, `congruent`], // diamond
      [`path`, `critical`], // triangle, filled like the rest so its legend swatch shows
      [`circle`, `unary`],
    ])
    expect(new Set(markers.map((el) => el.getAttribute(`fill`)))).toEqual(new Set([`#d32f2f`]))
    expect(wrapper.querySelector(`.special-points`)?.textContent).toContain(`Tₘ(Cu)`)
  })

  // The area centroid of an L-shaped field lies outside it (here at x ≈ 0.31, T ≈ 373, right
  // of the x = 0.3 arm): the label must sit inside its own region, not on the neighbor
  test(`a concave region's label lands inside the region`, async () => {
    const l_shape = pts(0, 0, 1, 0, 1, 200, 0.3, 200, 0.3, 1000, 0, 1000)
    const regions = [
      { phases: [`A`], vertices: l_shape },
      { phases: [`LIQUID`], vertices: pts(0.3, 200, 1, 200, 1, 1000, 0.3, 1000) },
    ]
    const wrapper = await mount_diagram({ data: { ...eutectic, regions } })
    const label = [...wrapper.querySelectorAll(`.region-labels > g`)].find(
      (group) => group.textContent === `α`,
    )
    const [, label_x, label_y] =
      /translate\((?<x>[-\d.e]+), (?<y>[-\d.e]+)\)/.exec(
        label?.getAttribute(`transform`) ?? ``,
      ) ?? []
    const to_svg = ([comp, temp]: Vec2): Vec2 => {
      const { clientX, clientY } = to_client(comp, temp)
      return [clientX, clientY]
    }
    expect(point_in_polygon(Number(label_x), Number(label_y), l_shape.map(to_svg))).toBe(true)
  })

  // a snippet replaces the default tooltip content, false hides the tooltip
  test.each([
    [`snippet`, createRawSnippet(() => ({ render: () => `<b>custom</b>` })), `custom`],
    [`false`, false, null],
  ] as const)(`tooltip %s`, async (_label, tooltip, text) => {
    const wrapper = await mount_diagram({ tooltip })
    await hover_at(wrapper, 0.5, 750)
    const container = wrapper.querySelector(`.tooltip-container`)
    expect(container?.textContent?.trim() ?? null).toBe(text)
    expect(wrapper.querySelector(`.phase-diagram-tooltip`)).toBeNull()
  })

  test(`hover reports phase info and the two-phase lever rule/tie-line, clears on leave`, async () => {
    const on_phase_hover = vi.fn()
    const wrapper = await mount_diagram({ on_phase_hover })
    await hover_at(wrapper, 0.5, 750) // inside the liquid
    const info = on_phase_hover.mock.lastCall?.[0]
    expect(info?.region).toBe(eutectic_regions[0]) // the data's own region, not a proxy of it
    expect(info?.composition).toBeCloseTo(0.5, 9)
    expect(info?.temperature).toBeCloseTo(750, 9)
    expect([info?.lever_rule, info?.point, info?.observation]).toEqual([null, null, null])
    expect(tooltip_text(wrapper)).toMatch(/^L /)
    expect(wrapper.querySelector(`g.tie-line`)).toBeNull()
    // a single-phase region's tooltip wears its opaque phase color; a two-phase gradient keeps
    // the neutral chip. The content paints no card of its own.
    const tip_bgs = () => [
      doc_query(`.tooltip-container`).style.backgroundColor,
      getComputedStyle(doc_query(`.phase-diagram-tooltip`)).backgroundColor,
    ]
    expect(tip_bgs()).toEqual([LIQUID_COLOR, ``])

    await hover_at(wrapper, 0.25, 250) // inside the α + β field spanning x: [0, 1]
    expect(on_phase_hover.mock.lastCall?.[0]?.lever_rule).toMatchObject({
      left_phase: `A`,
      right_phase: `B`,
      left_composition: expect.closeTo(0, 9),
      right_composition: expect.closeTo(1, 9),
      fraction_right: expect.closeTo(0.25, 9),
    })
    // tie-line spans the full field at the hovered temperature
    const tie_line = wrapper.querySelector(`g.tie-line line`)
    expect(tie_line?.getAttribute(`x1`)).toBe(`${left}`)
    expect(tie_line?.getAttribute(`x2`)).toBe(`${right}`)
    if (!tie_line?.parentElement) throw new Error(`missing tie line`)
    expect(getComputedStyle(tie_line.parentElement).pointerEvents).toBe(`none`)
    expect(tooltip_text(wrapper)).toContain(`α + β`)
    expect(tooltip_text(wrapper)).toContain(`α: 75 % at 0 at%`)
    expect(tip_bgs()).toEqual([``, ``])

    // outside the plot area (left of the y-axis) -> hover cleared
    plot_svg(wrapper).dispatchEvent(
      new PointerEvent(`pointermove`, { clientX: 10, clientY: 100, bubbles: true }),
    )
    await tick()
    expect(on_phase_hover).toHaveBeenLastCalledWith(null)
    expect(wrapper.querySelector(`.tooltip-container`)).toBeNull()
  })

  // The marks are the liquid and two-phase regions, empty space the margin left of the axes
  test(`click pins the hovered region's tooltip, its region, the margin or Escape unpin it`, async () => {
    const wrapper = await mount_diagram()
    const svg = plot_svg(wrapper)
    const at: [number, number][] = [
      [0.5, 750],
      [0.5, 250],
      [-0.1, 500],
    ]
    const text = await pin_cycle(
      async (step, mark_idx) => {
        if (step === `escape`) {
          // keys reach the diagram through the hover forwarder, not the whole document
          wrapper.dispatchEvent(new PointerEvent(`pointerenter`))
          globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
        } else if (step === `leave`) svg.dispatchEvent(new PointerEvent(`pointerleave`))
        else {
          const [composition, temperature] = at[mark_idx ?? 2]
          const nudge = step === `nudge` ? 1 : 0 // further into the same region
          await hover_at(wrapper, composition + 0.05 * nudge, temperature + 50 * nudge)
        }
        if (step === `click`) svg.dispatchEvent(mouse(`click`))
      },
      {
        lit: (idx) =>
          svg.querySelectorAll(`.phase-regions path`)[idx].classList.contains(`hovered`),
      },
    )
    expect(text).toMatch(/L\s*Temperature 750 K/)
  })

  // data stays in K and mole fraction, the units only change what the axes print
  test.each([
    [{}, [`1000`, `Temperature (K)`], `Cu (at%)`, `20`],
    // K range [0, 1000] -> °C [-273.15, 726.85]
    [{ temp_unit: `°C` }, [`600`, `Temperature (°C)`], `Cu (at%)`, `20`],
    [{ comp_unit: `fraction` }, [`1000`], `x Cu (mole fraction)`, `0.2`],
  ] as const)(`display units %o`, async (props, y_parts, x_label, x_tick) => {
    const wrapper = await mount_diagram(props)
    const y_text = wrapper.querySelector(`.y-axis`)?.textContent ?? ``
    for (const part of y_parts) expect(y_text).toContain(part)
    if (`temp_unit` in props) expect(y_text).not.toContain(`1000`)
    const x_text = wrapper.querySelector(`.x-axis`)?.textContent ?? ``
    expect(x_text).toContain(x_label)
    expect(
      [...wrapper.querySelectorAll(`.x-axis > g`)].map((el) => el.textContent?.trim()),
    ).toContain(x_tick)
    // the eutectic line at 500 K sits mid-plot whatever the units
    expect(wrapper.querySelector(`.boundaries path`)?.getAttribute(`d`)).toContain(
      `,${(top + bottom) / 2}`,
    )
  })

  test(`zoomed axes clip data to the plot area and y_axis.range (K) sets the temperature window`, async () => {
    const wrapper = await mount_diagram({
      x_axis: { range: [0.4, 0.6] },
      y_axis: { range: [400, 600] },
    })
    const clip = `url(#${wrapper.querySelector(`clipPath`)?.id})`
    for (const selector of [`.phase-regions`, `.boundaries`, `.region-labels`])
      expect(wrapper.querySelector(selector)?.getAttribute(`clip-path`)).toBe(clip)
    const clip_rect = wrapper.querySelector(`clipPath rect`)
    expect(
      [`x`, `y`, `width`, `height`].map((attr) => Number(clip_rect?.getAttribute(attr))),
    ).toEqual([left, top, right - left, bottom - top])
    const y_ticks = [...wrapper.querySelectorAll(`.y-axis > g`)].map((el) =>
      Number(el.textContent),
    )
    expect(y_ticks.filter((temp) => temp < 400 || temp > 600)).toEqual([])
    // the eutectic line at 500 K sits mid-plot in a 400..600 K window
    const eutectic_path = wrapper.querySelector(`.boundaries path`)?.getAttribute(`d`) ?? ``
    expect(eutectic_path).toContain(`,${(top + bottom) / 2}`)
    // the eutectic point (x 0.5, 500 K) stays; zooming it out of view drops it
    expect(wrapper.querySelectorAll(`.special-point-marker`)).toHaveLength(1)
    document.body.innerHTML = ``
    const panned = await mount_diagram({ x_axis: { range: [0.6, 0.9] } })
    expect(panned.querySelectorAll(`.special-point-marker`)).toHaveLength(0)
  })

  test(`keeps default temperature ticks sparse`, async () => {
    const wrapper = await mount_diagram({
      data: { ...eutectic, temperature_range: [0, 1800] },
    })
    expect(wrapper.querySelectorAll(`.y-axis > g`)).toHaveLength(4)
  })

  // gradient ids derive from region indices - two diagrams on one page would otherwise
  // cross-reference each other's gradients (first id wins, with that instance's
  // userSpaceOnUse pixel coords)
  test(`multi-phase gradient ids are unique per instance`, async () => {
    await mount_diagram()
    await mount_diagram()
    const ids = [...document.querySelectorAll(`linearGradient`)].map((element) => element.id)
    expect(ids).toHaveLength(2) // one gradient (the α + β region) per instance
    expect(new Set(ids).size).toBe(2)
    // each two-phase region path references its own instance's gradient, a one-phase region
    // fills with its translucent phase color
    const fills = [...document.querySelectorAll(`.phase-regions path`)].map((element) =>
      element.getAttribute(`fill`),
    )
    const liquid_fill = add_alpha(LIQUID_COLOR, 0.55) // the component's REGION_ALPHA
    expect(fills).toEqual(ids.flatMap((identifier) => [liquid_fill, `url(#${identifier})`]))
  })

  // the overlay draws dashed boundaries only (no regions, no labels) in its own color, widens
  // the temperature window to both diagrams', and adds its phase set to the hover
  test(`overlay draws dashed boundaries, joins the hover and toggles from the legend`, async () => {
    const overlay: BinaryPhaseDiagram = {
      ...shifted_eutectic,
      temperature_range: [0, 1200],
      boundaries: [
        ...shifted_eutectic.boundaries,
        { kind: `magnetic`, phases: [`A`], points: pts(0, 400, 0.2, 380) },
      ],
    }
    const on_phase_hover = vi.fn()
    const wrapper = await mount_diagram({
      overlays: [overlay],
      on_phase_hover,
      config: { colors: { overlay: `#123456` } },
    })
    const overlay_paths = [...wrapper.querySelectorAll(`.overlay-boundaries path`)]
    expect(overlay_paths.map((el) => el.getAttribute(`stroke`))).toEqual([
      `#123456`,
      `#123456`,
    ])
    // phase boundaries share the overlay dash, a magnetic line keeps its dash-dot
    expect(overlay_paths.map((el) => el.getAttribute(`stroke-dasharray`))).toEqual([
      `7,4`,
      `8,3,2,3`,
    ])
    expect(wrapper.querySelectorAll(`.phase-regions path`)).toHaveLength(2) // main only
    expect(wrapper.querySelector(`.y-axis`)?.textContent).toContain(`1200`)

    // 550 K: liquid in the main diagram, below the overlay's 600 K eutectic
    const svg = plot_svg(wrapper)
    const { clientX, clientY } = {
      clientX: left + 0.5 * (right - left),
      clientY: bottom - (550 / 1200) * (bottom - top),
    }
    svg.dispatchEvent(new PointerEvent(`pointermove`, { clientX, clientY, bubbles: true }))
    await tick()
    expect(on_phase_hover.mock.lastCall?.[0]?.region).toBe(eutectic_regions[0])
    expect(tooltip_text(wrapper)).toContain(`Overlay α + β`)
    expect(tooltip_text(wrapper)).toContain(
      `Overlay lever rule: α 50% at 0 at% / β 50% at 100 at%`,
    )

    const legend = [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)]
    // the hatch covers where the overlay's phase set differs: between the 500 K and 600 K
    // eutectics, as a share of the commonly covered isotherm length
    expect(legend.map((item) => item.textContent?.trim())).toEqual([
      `Assessment`,
      `test-model`,
      // 100 K of the 1000 K window differ, at every x; a lone overlay's row already names it
      `Phases differ (10%)`,
    ])
    // the hatch is opt-in: off by default, its legend entry turns it on and off
    expect(wrapper.querySelector(`path.disagreement`)).toBeNull()
    await legend_click(wrapper, `Phases differ`)
    expect(wrapper.querySelector(`path.disagreement`)?.getAttribute(`d`)).toMatch(/^M[\d.]+,/)
    await legend_click(wrapper, `Phases differ`)
    expect(wrapper.querySelector(`path.disagreement`)).toBeNull()
    // a pinned tooltip drops the overlay's phase set with the overlay (it used to keep a stale
    // snapshot and throw looking up the overlay's ids in the main diagram)
    svg.dispatchEvent(mouse(`click`))
    await tick()
    await legend_click(wrapper, `test-model`)
    expect(wrapper.querySelector(`.overlay-boundaries`)).toBeNull()
    expect(wrapper.querySelector(`.plot-tooltip.pinned`)).not.toBeNull()
    expect(tooltip_text(wrapper)).not.toContain(`Overlay`)
  })

  // map_legend maps the default rows (relabel, reorder, drop) while each keeps its target;
  // legend passes props through, and null (or mapping every row away) hides the legend
  test(`map_legend relabels, reorders and drops rows that still toggle their targets`, async () => {
    const legend_texts = (wrapper: HTMLElement) =>
      [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)].map((item) =>
        item.textContent?.trim(),
      )
    let seen: PhaseLegendEntry[`target`][] = []
    const wrapper = await mount_diagram({
      overlays: [shifted_eutectic],
      observations,
      legend: { style: `opacity: 0.8` },
      map_legend: (entries: PhaseLegendEntry[]) => {
        seen = entries.map(({ target }) => target)
        return entries
          .filter(({ target }) => target.kind !== `disagreement` && target.kind !== `main`)
          .map((entry) => {
            const { target } = entry
            if (target.kind === `overlay`)
              return { ...entry, item: { ...entry.item, label: `MACE` } }
            if (target.kind === `group`)
              return { ...entry, item: { ...entry.item, label: `[${target.group}]` } }
            return entry
          })
          .toReversed()
      },
    })
    // the callback sees every default row in order, each with its full target
    expect(seen).toEqual([
      { kind: `main` },
      { kind: `overlay`, overlay_idx: 0 },
      // statuses with a drawn marker (needs_value rows have no T or x), keyed `status:<status>`
      { kind: `group`, group: `status:ok` },
      { kind: `group`, group: `status:needs_verification` },
      { kind: `disagreement` },
    ])
    expect(legend_texts(wrapper)).toEqual([
      `[status:needs_verification]`,
      `[status:ok]`,
      `MACE`,
    ])
    expect(wrapper.querySelector<HTMLElement>(`.phase-diagram-legend`)?.style.opacity).toBe(
      `0.8`,
    )
    // with main dropped and the rest reversed, each row still toggles its own target
    const n_markers = wrapper.querySelectorAll(`.observation-marker`).length
    await legend_click(wrapper, `[status:needs_verification]`)
    expect(wrapper.querySelectorAll(`.observation-marker`).length).toBeLessThan(n_markers)
    expect(wrapper.querySelector(`.overlay-boundaries`)).not.toBeNull()
    await legend_click(wrapper, `MACE`)
    expect(wrapper.querySelector(`.overlay-boundaries`)).toBeNull()
    expect(wrapper.querySelectorAll(`.phase-regions path`).length).toBeGreaterThan(0)

    for (const props of [{ legend: null }, { map_legend: () => [] }]) {
      const hidden = await mount_diagram({ overlays: [shifted_eutectic], ...props })
      expect(hidden.querySelector(`.phase-diagram-legend`)).toBeNull()
    }
  })

  test(`observations draw status-colored markers, error bars and one isotherm per row`, async () => {
    const wrapper = await mount_diagram({ observations })
    const markers = [...wrapper.querySelectorAll(`.observation-marker`)]
    // three phases of the eutectic row + the Cu melting point at x = 1; rows without T or x
    // are skipped
    expect(markers.map((el) => el.getAttribute(`data-status`))).toEqual([
      `ok`,
      `ok`,
      `ok`,
      `needs_verification`,
    ])
    expect(markers.map((el) => el.getAttribute(`fill`))).toEqual([
      `#2e7d32`,
      `#2e7d32`,
      `#2e7d32`,
      `#ef6c00`,
    ])
    const [cu_x, cu_y] = [
      Number(markers[3].getAttribute(`cx`)),
      Number(markers[3].getAttribute(`cy`)),
    ]
    expect(cu_x).toBe(right)
    expect(cu_y).toBeCloseTo(to_client(1, 900).clientY, 9)
    // 4 T bars (σ_T > 0) + 1 x bar (the liquid's σ_x); a null σ_x draws none
    expect(wrapper.querySelectorAll(`.observations .error-bar`)).toHaveLength(5)
    const x_bar = [...wrapper.querySelectorAll(`.observations .error-bar`)][1]
    const x_span = [0.43, 0.47].map((x_val) => to_client(x_val, 0).clientX)
    expect(x_bar.getAttribute(`d`)).toContain(`M${x_span[0]},`)
    expect(wrapper.querySelectorAll(`.observations > line`)).toHaveLength(1)

    // hovering a marker cites its source; legend entries toggle statuses
    await hover_at(wrapper, 0.45, 520)
    expect(tooltip_text(wrapper)).toContain(`Doe et al., J. Test. 1 (2020) 1`)
    expect(
      [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual([`Assessment`, `Observed`, `Observed (unverified)`])
    await legend_click(wrapper, `Observed`)
    expect(wrapper.querySelectorAll(`.observation-marker`)).toHaveLength(1)
    // markers on the x = 1 edge are drawn whole: their layer is not clipped to the plot
    expect(wrapper.querySelector(`.observation-markers`)?.hasAttribute(`clip-path`)).toBe(
      false,
    )
  })

  // with observations off, a status click shows that status, not every other one
  test(`a legend status click with observations off shows the clicked status`, async () => {
    const wrapper = await mount_diagram({ observations, show_observations: false })
    expect(wrapper.querySelectorAll(`.observation-marker`)).toHaveLength(0)
    await legend_click(wrapper, `Observed (unverified)`)
    const statuses = [...wrapper.querySelectorAll(`.observation-marker`)].map((el) =>
      el.getAttribute(`data-status`),
    )
    expect(statuses).toEqual([`ok`, `ok`, `ok`, `needs_verification`])
  })

  // the hovering diagram writes the bound cursor in data units and clears it on leave; a
  // diagram given someone else's cursor draws a crosshair and its own phase set there
  test(`cursor syncs hover between diagrams`, async () => {
    const state: { cursor: DiagramCursor | null } = { cursor: null }
    const source = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      bind_props({ data: eutectic }, state),
      { selector: `.binary-phase-diagram`, width, height },
    )
    const svg = await hover_at(source, 0.25, 750)
    expect(state.cursor?.composition).toBeCloseTo(0.25, 9)
    expect(state.cursor?.temperature).toBeCloseTo(750, 9)
    expect(source.querySelector(`.remote-cursor`)).toBeNull() // own pointer: tooltip, no crosshair
    svg.dispatchEvent(new PointerEvent(`pointerleave`))
    expect(state.cursor).toBeNull()
    // moving into the margin clears it too
    await hover_at(source, 0.25, 750)
    svg.dispatchEvent(
      new PointerEvent(`pointermove`, { clientX: 10, clientY: 100, bubbles: true }),
    )
    expect(state.cursor).toBeNull()

    document.body.innerHTML = ``
    const follower = await mount_diagram({
      cursor: { composition: 0.25, temperature: 250, source: `partner` },
    })
    const [vertical] = follower.querySelectorAll(`.remote-cursor line`)
    expect(Number(vertical.getAttribute(`x1`))).toBeCloseTo(to_client(0.25, 0).clientX, 9)
    expect(follower.querySelector(`.remote-cursor-label`)?.textContent?.trim()).toBe(`α + β`)
    const lit = [...follower.querySelectorAll(`.phase-regions path`)].map((el) =>
      el.classList.contains(`hovered`),
    )
    expect(lit).toEqual([false, true])

    // a boundaries-only diagram follows with the crosshair but has no phase set to name
    document.body.innerHTML = ``
    const bare = await mount_diagram({
      data: { ...eutectic, regions: [] },
      cursor: { composition: 0.25, temperature: 250, source: `partner` },
    })
    expect(bare.querySelector(`.remote-cursor`)).not.toBeNull()
    expect(bare.querySelector(`.remote-cursor-label`)).toBeNull()
  })

  // two live instances bound to one cursor: hovering one draws the crosshair in the other only,
  // and unmounting the hovered one mid-hover releases the cursor
  test(`two diagrams bound to one cursor stay in sync`, async () => {
    const [harness, second] = await mount_synced()
    await hover_at(harness, 0.25, 550)
    expect(harness.querySelector(`.remote-cursor`)).toBeNull()
    expect(second.querySelector(`.remote-cursor`)).not.toBeNull()
    // 550 K is liquid in the first diagram, α + β under the second's 600 K eutectic
    expect(second.querySelector(`.remote-cursor-label`)?.textContent?.trim()).toBe(`α + β`)
    doc_query<HTMLButtonElement>(`[data-testid="hide-first"]`).click()
    await tick()
    expect(doc_query(`[data-testid="cursor"]`).textContent).toBe(`none`)
    expect(second.querySelector(`.remote-cursor`)).toBeNull()
  })

  // touch sends no pointerleave: a tap on the second diagram must still hand it the cursor,
  // dropping the first's stale tooltip and drawing the crosshair there instead
  test(`a touch tap on the partner takes over the shared cursor`, async () => {
    const [harness, second] = await mount_synced()
    const tap = async (wrapper: HTMLElement, composition: number, temperature: number) => {
      const svg = plot_svg(wrapper)
      const init = {
        ...to_client(composition, temperature),
        bubbles: true,
        pointerType: `touch`,
      }
      svg.dispatchEvent(new PointerEvent(`pointermove`, init))
      svg.dispatchEvent(new PointerEvent(`pointerleave`, init))
      await tick()
    }
    await tap(harness, 0.25, 550)
    expect(harness.querySelector(`.tooltip-container`)).not.toBeNull()
    expect(second.querySelector(`.remote-cursor`)).not.toBeNull()
    await tap(second, 0.75, 300)
    expect(harness.querySelector(`.remote-cursor`)).not.toBeNull()
    expect(second.querySelector(`.remote-cursor`)).toBeNull()
    expect(harness.querySelector(`.tooltip-container`)).toBeNull()
  })

  // dense diagrams drop labels that would overlap another label or a marked point, largest
  // regions keep theirs; the tooltip still names every region
  test(`region labels never overlap each other or marked points`, async () => {
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      { data: binary_diagrams[`Fe-Fe3C`] },
      { selector: `.binary-phase-diagram`, width: 600, height: 500 },
    )
    const labels = [...wrapper.querySelectorAll(`.region-labels > g`)].map((el) =>
      el.textContent?.trim(),
    )
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(binary_diagrams[`Fe-Fe3C`].regions.length)
    // the liquid, the largest field, always keeps its label
    expect(labels).toContain(`L`)
  })

  // the controls offer the marked-points toggle exactly when the diagram marks a point, of
  // any kind (a polymorphic transition alone counts)
  test.each([
    [`an invariant`, eutectic, true],
    [`no points`, { ...eutectic, invariants: [] }, false],
    [
      `only a polymorphic transition`,
      {
        ...eutectic,
        invariants: [],
        polymorphic_transitions: [
          { temperature: 450, composition: 0.5, above: `A`, below: `B` },
        ],
      },
      true,
    ],
  ])(`Special pts toggle with %s: %s`, async (_label, data, expected) => {
    const wrapper = await mount_diagram({ data, controls_open: true })
    const grid = wrapper.querySelector(`.visibility-grid`)
    expect(grid).toBeInstanceOf(HTMLElement)
    expect(grid?.textContent?.includes(`Special pts`)).toBe(expected)
  })

  // a zoomed window clips the wide α strip's label (anchor at 20 K, below the 22 K edge):
  // it must not block the β label just above the edge
  test(`a label clipped by a zoomed window does not hide a visible one`, async () => {
    const regions = [
      { phases: [`A`], vertices: rect(0, 0, 1, 40) },
      { phases: [`B`], vertices: rect(0.4, 40, 0.6, 70) },
    ]
    const wrapper = await mount_diagram({
      data: { ...eutectic, regions },
      y_axis: { range: [22, 1000] },
      show_special_points: false,
    })
    const labels = [...wrapper.querySelectorAll(`.region-labels > g`)]
    expect(labels.map((el) => el.textContent?.trim())).toEqual([`β`])
  })

  const empty_svg_text = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
  const empty_svg = () => new File([empty_svg_text], `pd.svg`, { type: `image/svg+xml` })
  // the SVG drop routes through the shared file-drop zone rather than a FileReader, so
  // it inherits folder expansion and the drop queue. Pin that dropped content still reaches
  // the parser, and that an unrelated file is ignored rather than reported.
  test(`dropped SVG reaches the parser, other files are ignored`, async () => {
    const on_file_load = vi.fn()
    const wrapper = await mount_diagram({ on_file_load })
    const drop = async (file: File, target = wrapper) => {
      target.dispatchEvent(create_drop_event(file))
      await tick()
    }

    // allow_file_drop=false ignores the drop and never shows the drop highlight
    const disabled = await mount_diagram({ allow_file_drop: false })
    disabled.dispatchEvent(new DragEvent(`dragover`, { bubbles: true, cancelable: true }))
    expect(disabled.classList.contains(`dragover`)).toBe(false)
    await drop(empty_svg(), disabled)
    await tick()
    expect(disabled.querySelector(`.error`)).toBeNull()

    await drop(new File([`not an svg`], `notes.txt`, { type: `text/plain` }))
    await tick()
    expect(wrapper.querySelector(`.error`)).toBeNull()

    // a contentless SVG throws inside parse_phase_diagram_svg, and the shared handler
    // reports it against the dropped filename as a visible error banner (not a console
    // message) — which is what proves the parse ran on it
    await drop(empty_svg())
    await vi.waitFor(() =>
      expect(wrapper.querySelector(`[role="alert"] .error`)?.textContent).toContain(`pd.svg`),
    )
    // the previously rendered diagram is kept behind the banner
    expect(wrapper.querySelectorAll(`.phase-regions path`).length).toBeGreaterThan(0)
    expect(on_file_load).not.toHaveBeenCalled()

    // invalid JSON is validated before it reaches on_file_load or replaces the diagram
    const bad = {
      ...shifted_eutectic,
      regions: [{ phases: [`A`], vertices: pts(0, 0, 1.5, 0, 0, 1) }],
    }
    await drop(new File([JSON.stringify(bad)], `bad.json`))
    await vi.waitFor(() =>
      expect(wrapper.querySelector(`[role="alert"] .error`)?.textContent).toMatch(
        /bad\.json.*Invalid phase diagram: regions\[0\] vertices need x in \[0, 1\]/,
      ),
    )
    expect(wrapper.querySelectorAll(`.phase-regions path`).length).toBeGreaterThan(0)
    expect(on_file_load).not.toHaveBeenCalled()

    // a v2 JSON file replaces the diagram
    const json = new File([JSON.stringify(shifted_eutectic)], `model.json`)
    await drop(json)
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    expect(on_file_load.mock.calls[0][0]).toMatchObject({
      diagram: shifted_eutectic,
      filename: `model.json`,
    })
    expect(wrapper.querySelector(`[role="alert"] .error`)).toBeNull()
  })

  // on_file_drop takes the raw file instead of the SVG parse, like every viewer's
  test(`on_file_drop intercepts dropped files before parsing`, async () => {
    const on_file_drop = vi.fn()
    const on_file_load = vi.fn()
    const wrapper = await mount_diagram({ on_file_drop, on_file_load })
    const file = empty_svg()
    wrapper.dispatchEvent(create_drop_event(file))
    const dropped = [empty_svg_text, `pd.svg`, expect.objectContaining({ file })]
    await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledWith(...dropped))
    expect(on_file_load).not.toHaveBeenCalled()
    expect(wrapper.querySelector(`.error`)).toBeNull()
  })

  // Invalid data is reported, not half-rendered: unknown phase references would crash the label
  // and color lookups, a wrong format string means another shape entirely. Malformed elements
  // (a boundary that is not an object) are reported too, never thrown from validation.
  test.each([
    [
      `unknown phase id`,
      { data: { ...eutectic, regions: [{ phases: [`GAS`], vertices: rect(0, 0, 1, 1) }] } },
      /Invalid phase diagram data: regions\[0\] references unknown phase GAS/,
      false,
    ],
    [
      `old format`,
      {
        data: {
          ...eutectic,
          format: `binary-phase-diagram/1`,
        } as unknown as BinaryPhaseDiagram,
      },
      /format is "binary-phase-diagram\/1"/,
      false,
    ],
    [
      `malformed boundary`,
      { data: { ...eutectic, boundaries: [null] } as unknown as BinaryPhaseDiagram },
      /boundaries must hold objects/,
      false,
    ],
    [
      `boundary without phases or points`,
      {
        data: {
          ...eutectic,
          boundaries: [{ kind: `liquidus` }],
        } as unknown as BinaryPhaseDiagram,
      },
      /boundaries\[0\] phases must be an array of ids; boundaries\[0\] has 0 points/,
      false,
    ],
    [
      `overlay of other components`,
      { overlays: [{ ...shifted_eutectic, components: [`Ag`, `Cu`] as [string, string] }] },
      /Invalid overlay diagram: components Ag-Cu differ from Al-Cu/,
      true,
    ],
    [
      `malformed overlay`,
      { overlays: [{ format: `x` } as unknown as BinaryPhaseDiagram] },
      /Invalid overlay diagram: format is "x"/,
      true,
    ],
    [
      // among several overlays the banner names the bad one; valid ones still draw
      `second of two overlays malformed`,
      { overlays: [shifted_eutectic, { format: `x` } as unknown as BinaryPhaseDiagram] },
      /Invalid overlay diagram 2: format is "x"/,
      true,
    ],
  ])(`error banner for %s`, async (_label, props, error, data_drawn) => {
    const wrapper = await mount_diagram(props)
    await tick()
    expect(wrapper.querySelector(`[role="alert"] .error`)?.textContent ?? ``).toMatch(error)
    // the banner explains bad data: no 'missing data' placeholder on top of it
    expect(wrapper.textContent).not.toContain(`Missing phase diagram data`)
    expect(wrapper.querySelector(`svg.binary-phase-diagram`) !== null).toBe(data_drawn)
    // only the valid overlay (the shifted eutectic) draws
    const n_valid =
      `overlays` in props
        ? props.overlays.filter((overlay) => overlay === shifted_eutectic).length
        : 0
    expect(wrapper.querySelectorAll(`.overlay-boundaries`)).toHaveLength(n_valid)
  })
})

// === Benchmark views: predictions, highlight, marked-point legend, isopleth, lens, σ bands,
// several overlays ===
describe(`IsobaricBinaryPhaseDiagram comparison views`, () => {
  const predictions = [
    { id: `Al-Cu:eutectic`, T_K: 450, x: [0.5, null, 0.95], pass: false },
    { id: `Cu:melting`, T_K: 905, pass: true }, // 5 K (1.6 px): shorter than a head, no arrow
  ]
  const numbers = (path: string | null) => (path?.match(/-?[\d.]+/g) ?? []).map(Number)

  test(`predictions draw residual arrows and color markers by verdict`, async () => {
    const wrapper = await mount_diagram({ observations, predictions })
    const markers = [...wrapper.querySelectorAll(`.observation-marker`)]
    expect(
      markers.map((el) => [el.getAttribute(`data-verdict`), el.getAttribute(`fill`)]),
    ).toEqual([
      [`fail`, `#d32f2f`],
      [`fail`, `#d32f2f`],
      [`fail`, `#d32f2f`],
      [`pass`, `#00897b`],
    ])
    const arrows = [...wrapper.querySelectorAll(`line.residual`)]
    expect(arrows).toHaveLength(3)
    const { clientX, clientY } = to_client(0.5, 450)
    expect(Number(arrows[0].getAttribute(`x2`))).toBeCloseTo(clientX, 9)
    expect(Number(arrows[0].getAttribute(`y2`))).toBeCloseTo(clientY, 9)
    // one arrowhead per arrow color, filled with that color
    const head_id = arrows[0].getAttribute(`marker-end`)?.match(/^url\(#(?<id>.+)\)$/)
      ?.groups?.id
    expect(wrapper.querySelector(`marker[id="${head_id}"] path`)?.getAttribute(`fill`)).toBe(
      `#d32f2f`,
    )
    const legend = [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)].map(
      (item) => item.textContent?.trim(),
    )
    // verdicts list in a fixed order (pass, fail), whatever order the markers come in
    expect(legend).toEqual([`Assessment`, `Prediction passes`, `Prediction fails`])
    // the tooltip gives the prediction and its error per observed point
    await hover_at(wrapper, 0.45, 520)
    expect(tooltip_text(wrapper)).toMatch(
      /fail Predicted T = 450 K \([−-]70 K\), x = 50 at% \(\+5 at%\)/,
    )
    await legend_click(wrapper, `Prediction fails`)
    expect(wrapper.querySelectorAll(`.observation-marker`)).toHaveLength(1)
    expect(wrapper.querySelectorAll(`line.residual`)).toHaveLength(0)
  })

  // a host's highlight lights observations by row id, single-phase fields and the boundary
  // edges tracing a phase (by id, model phase or phase_matches target) and nearby points
  const alpha_field: BinaryPhaseDiagram = {
    ...eutectic,
    regions: [{ phases: [`A`], vertices: rect(0, 0, 0.1, 500) }, ...eutectic_regions],
    boundaries: [
      ...eutectic.boundaries,
      { kind: `solvus`, phases: [`A`, `B`], side: `A`, points: pts(0.1, 0, 0.1, 500) },
    ],
  }
  test.each([
    [{ observation: `Al-Cu:eutectic` }, { markers: 3, regions: [], boundaries: 0, points: 0 }],
    [{ phases: [`A`] }, { markers: 0, regions: [0], boundaries: 1, points: 0 }],
    [{ phases: [`FCC_A1`] }, { markers: 0, regions: [0], boundaries: 1, points: 0 }],
    [{ phases: [`(Al)`] }, { markers: 0, regions: [0], boundaries: 1, points: 0 }],
    [{ phases: [`LIQUID`] }, { markers: 0, regions: [1], boundaries: 0, points: 0 }],
    // a point by meaning: the eutectic lights however far off, a category it lacks lights none
    [
      { point: { category: `invariant` as const, kind: `eutectic`, at: [0.3, 620] as Vec2 } },
      { markers: 0, regions: [], boundaries: 0, points: 1 },
    ],
    [
      { point: { category: `critical` as const, kind: `critical`, at: [0.5, 500] as Vec2 } },
      { markers: 0, regions: [], boundaries: 0, points: 0 },
    ],
  ])(`highlight %o lights its marks`, async (highlight, expected) => {
    const wrapper = await mount_diagram({
      data: alpha_field,
      observations,
      highlight,
      phase_matches: { FCC_A1: `(Al)` },
    })
    const lit = (selector: string) => wrapper.querySelectorAll(`${selector}.lit`).length
    expect(lit(`.observation-marker`)).toBe(expected.markers)
    const regions = [...wrapper.querySelectorAll(`.phase-regions path`)]
    expect(regions.flatMap((el, idx) => (el.classList.contains(`lit`) ? [idx] : []))).toEqual(
      expected.regions,
    )
    expect(lit(`.boundaries path`)).toBe(expected.boundaries)
    expect(lit(`.special-point-marker`)).toBe(expected.points)
  })

  // the diagram reports the observation or point under the pointer through the bound
  // highlight, and clears only what it set
  test(`hovering an observation or marked point writes the bound highlight`, async () => {
    const state: { highlight: DiagramHighlight | null } = { highlight: null }
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      bind_props({ data: eutectic, observations }, state),
      { selector: `.binary-phase-diagram`, width, height },
    )
    await hover_at(wrapper, 0.45, 520)
    expect(state.highlight).toEqual({ observation: `Al-Cu:eutectic` })
    await hover_at(wrapper, 0.5, 500)
    expect(state.highlight).toEqual(eutectic_ref)
    await hover_at(wrapper, 0.8, 800)
    expect(state.highlight).toBeNull()
    // a host's highlight survives moves over plain fields
    state.highlight = { phases: [`LIQUID`] }
    await hover_at(wrapper, 0.8, 850)
    expect(state.highlight).toEqual({ phases: [`LIQUID`] })
    // a host's tooltip in the diagram also names the reference phase a phase stands in for
    document.body.innerHTML = ``
    const matched = await mount_diagram({ data: alpha_field, phase_matches: { A: `(Al)` } })
    await hover_at(matched, 0.05, 250)
    // α + β wins over α at (0.05, 250 K): the later region; its α stands in for (Al)
    expect(tooltip_text(matched)).toContain(`Stands in for (Al) (α)`)
  })

  test(`unlabelled point kinds get legend entries; nearby labels avoid each other`, async () => {
    const data: BinaryPhaseDiagram = {
      ...eutectic,
      invariants: [
        ...eutectic.invariants,
        {
          ...eutectic.invariants[0],
          kind: `peritectic`,
          temperature: 520,
        },
      ],
      congruent_points: [{ temperature: 800, composition: 0.3, phases: [`LIQUID`, `A`] }],
      critical_points: [{ temperature: 300, composition: 0.6, phase: `A` }],
    }
    const wrapper = await mount_diagram({ data })
    const legend = [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)].map(
      (item) => item.textContent?.trim(),
    )
    expect(legend).toEqual([`Assessment`, `Congruent point`, `Critical point`])
    await legend_click(wrapper, `Congruent`)
    expect(wrapper.querySelector(`[data-category="congruent"]`)).toBeNull()
    expect(wrapper.querySelector(`[data-category="critical"]`)).not.toBeNull()
    // E at (0.5, 500 K) and P at (0.5, 520 K) are 6.5 px apart: their default spots (above)
    // would cover the other's marker, so the placement moves them; no label box may overlap
    // a marker or another label
    const font = 12
    const label_boxes = [...wrapper.querySelectorAll(`.special-points text`)].map((el) => {
      const [x_val, y_val] = [`x`, `y`].map((attr) => Number(el.getAttribute(attr)))
      const text_w = (el.textContent?.trim().length ?? 0) * font * 0.6
      const anchor = el.getAttribute(`text-anchor`)
      const x_min =
        anchor === `start` ? x_val : anchor === `end` ? x_val - text_w : x_val - text_w / 2
      return [x_min, y_val - font * 0.6, x_min + text_w, y_val + font * 0.6]
    })
    // circles only here (no congruent diamonds near E and P), radius 5
    const marker_boxes = [...wrapper.querySelectorAll(`circle.special-point-marker`)].map(
      (el) => {
        const [cx, cy] = [`cx`, `cy`].map((attr) => Number(el.getAttribute(attr)))
        return [cx - 5, cy - 5, cx + 5, cy + 5]
      },
    )
    const hit = (box_a: number[], box_b: number[]) =>
      box_a[0] < box_b[2] && box_b[0] < box_a[2] && box_a[1] < box_b[3] && box_b[1] < box_a[3]
    expect(label_boxes).toHaveLength(2)
    for (const [idx, box] of label_boxes.entries()) {
      expect(marker_boxes.some((marker) => hit(box, marker))).toBe(false)
      expect(
        label_boxes.some((other, other_idx) => other_idx !== idx && hit(box, other)),
      ).toBe(false)
    }
  })

  test(`isopleth draws a phase-fraction strip and marks its phase changes`, async () => {
    const state: { isopleth: number | null } = { isopleth: 0.25 }
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      bind_props({ data: eutectic }, state),
      { selector: `.binary-phase-diagram`, width, height },
    )
    // L above 500 K; α 75 % and β 25 % below
    const strip = [...wrapper.querySelectorAll(`.isopleth > path`)]
    expect(strip).toHaveLength(3)
    // each step's bar widths are its phase fractions of the 64 px strip
    const widths = strip.map((el) => numbers(el.getAttribute(`d`))[2])
    expect(widths).toEqual([64, 48, 16])
    const labels = [...wrapper.querySelectorAll(`.isopleth text.halo`)].map((el) =>
      el.textContent?.trim(),
    )
    expect(labels).toEqual([`500 K`])
    // the strip takes room from the plot
    const plot_right =
      Number(wrapper.querySelector(`clipPath rect`)?.getAttribute(`width`)) + left
    expect(plot_right).toBe(right - 64 - 14)
    const [strip_x] = numbers(strip[1].getAttribute(`d`)) // α starts the stack below 500 K
    expect(strip_x).toBeCloseTo(plot_right + 14, 9)

    // shift+click on the line clears it, shift+click elsewhere sets it (the narrowed plot
    // maps x to client coordinates differently)
    const svg = plot_svg(wrapper)
    const narrow_x = (comp: number) => left + comp * (plot_right - left)
    const { clientY } = to_client(0, 300)
    svg.dispatchEvent(
      new PointerEvent(`pointermove`, { clientX: narrow_x(0.25), clientY, bubbles: true }),
    )
    svg.dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
    await tick()
    expect(state.isopleth).toBeNull()
    // unbound, the diagram keeps its own isopleth: shift+click off the line moves it there,
    // on the line removes the strip
    document.body.innerHTML = ``
    const own = await mount_diagram({ isopleth: 0.25 })
    const shift_click_at = async (comp: number) => {
      const own_svg = plot_svg(own)
      own_svg.dispatchEvent(
        new PointerEvent(`pointermove`, { clientX: narrow_x(comp), clientY, bubbles: true }),
      )
      own_svg.dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()
    }
    await shift_click_at(0.6)
    const line_x = Number(own.querySelector(`.isopleth-line`)?.getAttribute(`x1`))
    expect(line_x).toBeCloseTo(narrow_x(0.6), 9)
    await shift_click_at(0.6)
    expect(own.querySelector(`.isopleth`)).toBeNull()
    // key i sets it at the cursor's composition (the plot still spans its full width here)
    await hover_at(own, 0.3, 300)
    own.dispatchEvent(keydown(`i`))
    await tick()
    expect(Number(own.querySelector(`.isopleth-line`)?.getAttribute(`x1`))).toBeCloseTo(
      narrow_x(0.3),
      9,
    )
    // a boundaries-only diagram has no fractions, so no strip takes room from its plot
    document.body.innerHTML = ``
    const bare = await mount_diagram({ data: { ...eutectic, regions: [] }, isopleth: 0.3 })
    expect(bare.querySelector(`.isopleth`)).toBeNull()
    expect(Number(bare.querySelector(`clipPath rect`)?.getAttribute(`width`))).toBe(
      right - left,
    )
    // an edge isopleth's fraction caption (`1`) repeats the strip axis' `1` caption, which
    // threw each_key_duplicate while the captions were keyed by their text
    document.body.innerHTML = ``
    const edge = await mount_diagram({ isopleth: 1, comp_unit: `fraction` })
    const captions = [...edge.querySelectorAll(`.isopleth > text:not(.halo)`)]
    expect(captions.map((el) => el.textContent?.trim())).toEqual([`1`, `0`, `1`, `fraction`])
  })

  // m toggles a lens showing the plot layers 4x about the pointer; marks in it keep their size
  // and shape at magnified positions, and hidden marked points stay hidden there
  test.each([true, false])(`lens (marked points shown: %s)`, async (show_special_points) => {
    const data = {
      ...eutectic,
      congruent_points: [{ temperature: 515, composition: 0.45, phases: [`LIQUID`, `A`] }],
    }
    const wrapper = await mount_diagram({ data, observations, show_special_points })
    wrapper.dispatchEvent(keydown(`m`))
    await tick()
    // 10 px left of the eutectic's liquid marker at (0.45, 520 K): it lands 40 px right
    const marker = to_client(0.45, 520)
    const pointer = { clientX: marker.clientX - 10, clientY: marker.clientY }
    plot_svg(wrapper).dispatchEvent(
      new PointerEvent(`pointermove`, { ...pointer, bubbles: true }),
    )
    await tick()
    const layers_id = wrapper.querySelector(`g[id$="-layers"]`)?.id
    expect(wrapper.querySelector(`.lens use`)?.getAttribute(`href`)).toBe(`#${layers_id}`)
    expect(wrapper.querySelector(`.lens [transform]`)?.getAttribute(`transform`)).toBe(
      `translate(${pointer.clientX * -3}, ${pointer.clientY * -3}) scale(4)`,
    )
    const lens_markers = [...wrapper.querySelectorAll(`.lens .observation-marker`)]
    expect(lens_markers).toHaveLength(4)
    expect(Number(lens_markers[0].getAttribute(`cx`))).toBeCloseTo(pointer.clientX + 40, 9)
    expect(lens_markers[0].getAttribute(`r`)).toBe(`4.5`)
    const lens_point = wrapper.querySelector(`.lens [data-category="congruent"]`)
    expect(lens_point?.tagName ?? null).toBe(show_special_points ? `path` : null)
    wrapper.dispatchEvent(keydown(`m`))
    await tick()
    expect(wrapper.querySelector(`.lens`)).toBeNull()
  })

  test.each([true, false])(
    `sigma_T draws bands and point error bars (shown: %s)`,
    async (show) => {
      const data: BinaryPhaseDiagram = {
        ...eutectic,
        boundaries: [{ ...eutectic.boundaries[0], sigma_T: [10, 20] }],
        invariants: [{ ...eutectic.invariants[0], sigma_T: 15 }],
      }
      const wrapper = await mount_diagram({ data, show_uncertainty: show })
      const bands = [...wrapper.querySelectorAll(`.uncertainty-bands path`)]
      expect(bands).toHaveLength(show ? 1 : 0)
      expect(wrapper.querySelectorAll(`.special-points .error-bar`)).toHaveLength(show ? 1 : 0)
      if (!show) return
      // T ± σ at each end: 510/490 K at x = 0, 520/480 K at x = 1
      const ys = numbers(bands[0].getAttribute(`d`)).filter((_, idx) => idx % 2)
      const expected = [510, 520, 480, 490].map((temp) => to_client(0, temp).clientY)
      ys.forEach((y_val, idx) => expect(y_val).toBeCloseTo(expected[idx], 9))
    },
  )

  test(`several overlays take their own color and dash and toggle one by one`, async () => {
    const second: BinaryPhaseDiagram = {
      ...shifted_eutectic,
      provenance: { kind: `model`, model: `other-model` },
    }
    const wrapper = await mount_diagram({
      overlays: [shifted_eutectic, second],
      show_disagreement: true,
    })
    const strokes = () =>
      [...wrapper.querySelectorAll(`.overlay-boundaries path`)].map((el) => [
        el.getAttribute(`stroke`),
        el.getAttribute(`stroke-dasharray`),
      ])
    const hatch_label = () =>
      [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)]
        .map((item) => item.textContent?.trim())
        .filter((label) => label?.startsWith(`Phases differ`))
    expect(strokes()).toEqual([
      [`#e6007e`, `7,4`],
      [`#ef6c00`, `3,3`],
    ])
    // the tooltip names each overlay's phase set at the cursor (α + β below 600 K in both)
    await hover_at(wrapper, 0.5, 550)
    expect(tooltip_text(wrapper)).toMatch(/test-model α \+ β\s*other-model α \+ β/)
    // with several overlays shown, the label names the one it compares against
    expect(hatch_label()).toEqual([`Phases differ from test-model (10%)`])
    await legend_click(wrapper, `other-model`)
    expect(strokes()).toEqual([[`#e6007e`, `7,4`]])
    expect(hatch_label()).toEqual([`Phases differ (10%)`])
    expect(wrapper.querySelector(`path.disagreement`)).not.toBeNull()
    // the hatch follows the first shown overlay; the tooltip names only the shown one
    await legend_click(wrapper, `other-model`)
    await legend_click(wrapper, `test-model`)
    expect(strokes()).toEqual([[`#ef6c00`, `3,3`]])
    expect(hatch_label()).toEqual([`Phases differ (10%)`])
    await hover_at(wrapper, 0.5, 550)
    expect(tooltip_text(wrapper)).toMatch(/other-model α \+ β/)
    expect(tooltip_text(wrapper)).not.toMatch(/test-model α/)
    // with every overlay hidden there is nothing to compare: no hatch, no share in the legend
    await legend_click(wrapper, `other-model`)
    expect(strokes()).toEqual([])
    expect(hatch_label()).toEqual([])
    expect(wrapper.querySelector(`path.disagreement`)).toBeNull()
  })

  // hidden_overlays keys are indices into `overlays` (invalid ones included); the legend writes
  // a new set to the binding
  test(`hidden_overlays hides overlays by index and is written by the legend`, async () => {
    const second: BinaryPhaseDiagram = {
      ...shifted_eutectic,
      provenance: { kind: `model`, model: `other-model` },
    }
    const bad = { format: `x` } as unknown as BinaryPhaseDiagram
    const wrapper = await mount_diagram({
      overlays: [bad, shifted_eutectic, second],
      hidden_overlays: new Set([1]),
      show_disagreement: true,
    })
    const strokes = [...wrapper.querySelectorAll(`.overlay-boundaries path`)].map((el) =>
      el.getAttribute(`stroke-dasharray`),
    )
    expect(strokes).toEqual([`3,3`]) // second valid overlay's dash
    const labels = [...wrapper.querySelectorAll(`.phase-diagram-legend .legend-item`)].map(
      (item) => item.textContent?.trim(),
    )
    expect(labels).toContain(`Phases differ (10%)`)

    const state = { hidden_overlays: new Set([1]) }
    const bound = await mount_sized(
      IsobaricBinaryPhaseDiagram,
      bind_props({ data: eutectic, overlays: [bad, shifted_eutectic, second] }, state),
      { selector: `.binary-phase-diagram`, width, height },
    )
    await legend_click(bound, `other-model`)
    expect(state.hidden_overlays).toEqual(new Set([1, 2]))
    await legend_click(bound, `test-model`)
    expect(state.hidden_overlays).toEqual(new Set([2]))
  })

  // a partner diagram's highlight survives this diagram dropping its own mark
  test(`two diagrams sharing one highlight never clear each other's`, async () => {
    const state: { highlight: DiagramHighlight | null } = { highlight: null }
    const mount_one = () =>
      mount_sized(
        IsobaricBinaryPhaseDiagram,
        bind_props({ data: eutectic, observations }, state),
        {
          selector: `.binary-phase-diagram`,
          width,
          height,
        },
      )
    const first = await mount_one()
    const second = await mount_one()
    await hover_at(first, 0.45, 520)
    expect(state.highlight).toEqual({ observation: `Al-Cu:eutectic` })
    await hover_at(second, 0.5, 500)
    expect(state.highlight).toEqual(eutectic_ref)
    plot_svg(first).dispatchEvent(new PointerEvent(`pointerleave`))
    await tick()
    expect(state.highlight).toEqual(eutectic_ref)
  })

  test(`point labels stay in the plot when zoomed`, async () => {
    const data: BinaryPhaseDiagram = {
      ...eutectic,
      invariants: [{ ...eutectic.invariants[0], compositions: [0, 0.41, 1] }],
    }
    // x window 0.4..0.6: the eutectic sits 5 % from the left edge, its label runs inwards
    const wrapper = await mount_diagram({ data, x_axis: { range: [0.4, 0.6] } })
    const label = wrapper.querySelector(`.special-points text`)
    expect(label?.getAttribute(`text-anchor`)).toBe(`start`)
    expect(Number(label?.getAttribute(`x`))).toBeGreaterThanOrEqual(left)
  })
})
