import { point_in_polygon, type Vec2 } from '#lib/math.js'
import { LIQUID_COLOR } from '#lib/phase-diagram/utils.js'
import IsobaricBinaryPhaseDiagram from '#lib/phase-diagram/IsobaricBinaryPhaseDiagram.svelte'
import type { BinaryPhaseDiagram, DiagramCursor } from '#lib/phase-diagram/types.js'
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
const legend_click = async (wrapper: HTMLElement, label: string) => {
  const item = [
    ...wrapper.querySelectorAll<HTMLElement>(`.phase-diagram-legend .legend-item`),
  ].find((element) => element.textContent?.includes(label))
  if (!item) throw new Error(`No legend item "${label}"`)
  item.click()
  await tick()
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
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagramHarness,
      { loaded_data: eutectic },
      { selector: `.binary-phase-diagram`, width, height },
    )
    const click = async (test_id: string) => {
      doc_query<HTMLButtonElement>(`[data-testid="${test_id}"]`).click()
      await tick()
    }
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
    const wrapper = await mount_sized(
      IsobaricBinaryPhaseDiagramHarness,
      { loaded_data: eutectic },
      { selector: `.binary-phase-diagram`, width, height },
    )
    const click = async (test_id: string) => {
      doc_query<HTMLButtonElement>(`[data-testid="${test_id}"]`).click()
      await tick()
    }

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
      [`path`, `congruent`],
      [`circle`, `critical`],
      [`circle`, `unary`],
    ])
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
    // each gradient-filled region path must reference its own instance's gradient
    const fills = [...document.querySelectorAll(`.phase-regions path`)]
      .map((element) => element.getAttribute(`fill`))
      .filter((fill) => fill?.startsWith(`url(`))
    expect(fills).toEqual(ids.map((identifier) => `url(#${identifier})`))
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
      overlay,
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
    expect(legend.map((item) => item.textContent?.trim())).toEqual([
      `Assessment`,
      `Model: test-model`,
    ])
    // a pinned tooltip drops the overlay's phase set with the overlay (it used to keep a stale
    // snapshot and throw looking up the overlay's ids in the main diagram)
    svg.dispatchEvent(mouse(`click`))
    await tick()
    await legend_click(wrapper, `Model`)
    expect(wrapper.querySelector(`.overlay-boundaries`)).toBeNull()
    expect(wrapper.querySelector(`.plot-tooltip.pinned`)).not.toBeNull()
    expect(tooltip_text(wrapper)).not.toContain(`Overlay`)
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
    const harness = await mount_sized(
      SyncedDiagramsHarness,
      { diagrams: [eutectic, shifted_eutectic] },
      { selector: `.binary-phase-diagram.first`, width, height },
    )
    const second = doc_query(`.binary-phase-diagram.second`)
    await resize_element(second, width, height)
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
    const harness = await mount_sized(
      SyncedDiagramsHarness,
      { diagrams: [eutectic, shifted_eutectic] },
      { selector: `.binary-phase-diagram.first`, width, height },
    )
    const second = doc_query(`.binary-phase-diagram.second`)
    await resize_element(second, width, height)
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
      { overlay: { ...shifted_eutectic, components: [`Ag`, `Cu`] as [string, string] } },
      /Invalid overlay diagram: components Ag-Cu differ from Al-Cu/,
      true,
    ],
    [
      `malformed overlay`,
      { overlay: { format: `x` } as unknown as BinaryPhaseDiagram },
      /Invalid overlay diagram: format is "x"/,
      true,
    ],
  ])(`error banner for %s`, async (_label, props, error, data_drawn) => {
    const wrapper = await mount_diagram(props)
    await tick()
    expect(wrapper.querySelector(`[role="alert"] .error`)?.textContent ?? ``).toMatch(error)
    // the banner explains bad data: no 'missing data' placeholder on top of it
    expect(wrapper.textContent).not.toContain(`Missing phase diagram data`)
    expect(wrapper.querySelector(`svg.binary-phase-diagram`) !== null).toBe(data_drawn)
    expect(wrapper.querySelector(`.overlay-boundaries`)).toBeNull()
  })
})
