import PressureTemperaturePhaseDiagram from '#lib/phase-diagram/pressure-temperature/PressureTemperaturePhaseDiagram.svelte'
import type {
  PressureUnit,
  PtHoverInfo,
  PtPhaseDiagramData,
} from '#lib/phase-diagram/pressure-temperature/types.js'
import type { TempUnit } from '#lib/phase-diagram/types.js'
import type { AxisConfig } from '#lib/plot/core/types.js'
import type { Vec2 } from '#lib/math.js'
import {
  iron_pt_diagram,
  water_pt_diagram,
} from '#site/phase-diagrams/pressure-temperature.js'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  clip_rect,
  fire,
  keydown,
  mount_sized,
  mouse,
  pin_cycle,
  plot_svg,
  translate_of,
} from '../../setup'

const mount_diagram = (
  props: Partial<ComponentProps<typeof PressureTemperaturePhaseDiagram>> = {},
): Promise<HTMLElement> =>
  mount_sized(
    PressureTemperaturePhaseDiagram,
    // copy descriptors, not values, so bind_props accessors survive
    Object.defineProperties(
      { data: iron_pt_diagram },
      Object.getOwnPropertyDescriptors(props),
    ),
    { selector: `.pt-phase-diagram`, width: 600, height: 450 },
  )

// Iron demo window: 0..150 GPa on x, 300..4000 K on y, both linear and unpadded, so a
// [pressure, temperature] maps onto the plot-area clip rect directly. happy-dom's
// getBoundingClientRect is all zeros, so client coords are plot-SVG pixels.
const to_client = (wrapper: HTMLElement, pressure: number, temp: number) => {
  const { x: left, y: top, width, height } = clip_rect(wrapper)
  return {
    clientX: left + (pressure / 150) * width,
    clientY: top + height - ((temp - 300) / 3700) * height,
  }
}
const hover = async (wrapper: HTMLElement, pressure: number, temp: number): Promise<void> => {
  plot_svg(wrapper).dispatchEvent(mouse(`mousemove`, to_client(wrapper, pressure, temp)))
  await tick()
}
const tooltip_text = (wrapper: HTMLElement): string | null =>
  wrapper.querySelector(`.plot-tooltip`)?.textContent ?? null
const count = (wrapper: HTMLElement, selector: string): number =>
  wrapper.querySelectorAll(selector).length
// Vertices of the first uncertainty band's path
const band_coords = (wrapper: HTMLElement): Vec2[] =>
  [
    ...(wrapper.querySelector(`.uncertainty-band`)?.getAttribute(`d`) ?? ``).matchAll(
      /(?<coord_x>-?[\d.e]+),(?<coord_y>-?[\d.e]+)/g,
    ),
  ].map((match): Vec2 => [Number(match.groups?.coord_x), Number(match.groups?.coord_y)])
// One a|b line with per-point sigmas in a P × T window
const one_line = (
  points: Vec2[],
  sigmas: { sigma_t?: number[]; sigma_p?: number[] },
  pressure_range: Vec2,
): PtPhaseDiagramData => ({
  phases: [{ id: `a` }, { id: `b` }],
  boundaries: [{ id: `ab`, phases: [`a`, `b`], points, ...sigmas }],
  pressure_range,
  temperature_range: [0, 1000],
})
const axis_text = (wrapper: HTMLElement, axis: `x` | `y`): string =>
  wrapper.querySelector(`.${axis}-axis`)?.textContent ?? ``

describe(`PressureTemperaturePhaseDiagram`, () => {
  // water: log pressure axis in Pa, explicit regions, a triple and a critical point
  // oxfmt-ignore
  test.each([
    [`iron`, {}, { phases: [`alpha`, `delta`, `epsilon`, `gamma`, `liquid`], boundaries: 7, bands: 7, specials: [`triple`, `triple`, `triple`], x_label: `Pressure (GPa)` }],
    [`water`, { data: water_pt_diagram, pressure_axis: { scale_type: `log` as const } }, { phases: [`ice-ih`, `liquid`, `supercritical`, `vapor`], boundaries: 3, bands: 3, specials: [`critical`, `triple`], x_label: `Pressure (Pa)` }],
  ])(
    `renders %s regions, boundaries, bands and special points`,
    async (_label, props, expected) => {
      const wrapper = await mount_diagram(props)
      const attrs = (selector: string, attr: string) =>
        [...wrapper.querySelectorAll(selector)]
          .map((node) => node.getAttribute(attr) ?? ``)
          .toSorted((left, right) => left.localeCompare(right))
      const { x_label, ...counts } = expected
      expect({
        phases: attrs(`.regions path`, `data-phase`),
        boundaries: count(wrapper, `.boundary`),
        bands: count(wrapper, `.uncertainty-band`),
        specials: attrs(`.special-point`, `data-type`),
      }).toEqual(counts)
      expect(axis_text(wrapper, `x`)).toContain(x_label)
      expect(count(wrapper, `.error-bars`)).toBe(0) // default uncertainty is `band`
      expect(wrapper.querySelector(`.status-message`)).toBeNull()
    },
  )

  // δ-Fe's sliver is too thin for its label, the other four fit
  test(`iron region labels skip regions too small for them`, async () => {
    const wrapper = await mount_diagram()
    const labels = wrapper.querySelector(`.region-labels`)?.textContent ?? ``
    for (const name of [`α`, `γ`, `ε`, `Liquid`]) expect(labels).toContain(name)
    expect(labels).not.toContain(`δ`)
    expect(count(wrapper, `.region-labels text`)).toBe(4)
  })

  // Every iron boundary has sigmas; special-point bars show for every mode but `none`
  test.each([
    [`band`, { bands: 7, has_bars: false, special_bars: 3 }],
    [`bars`, { bands: 0, has_bars: true, special_bars: 3 }],
    [`both`, { bands: 7, has_bars: true, special_bars: 3 }],
    [`none`, { bands: 0, has_bars: false, special_bars: 0 }],
  ] as const)(`uncertainty=%s`, async (uncertainty, expected) => {
    const wrapper = await mount_diagram({ uncertainty })
    expect({
      bands: count(wrapper, `.uncertainty-band`),
      has_bars: count(wrapper, `.error-bars`) > 0,
      // one capped-bar path per special point, all three iron triple points carry sigmas
      special_bars: count(wrapper, `.special-error-bars`),
    }).toEqual(expected)
  })

  // A temperature error widens a constant-T line along the temperature axis: y unswapped, x
  // swapped. The band spans 2 sigma of the 1000 K window, a fraction of the chart extent.
  test.each([false, true])(
    `sigma_t band follows the temperature axis (swap_axes=%s)`,
    async (swap_axes) => {
      // oxfmt-ignore
      const data = one_line([[0, 500], [10, 500]], { sigma_t: [100, 100] }, [0, 10])
      const wrapper = await mount_diagram({ data, swap_axes })
      const coords = band_coords(wrapper)
      expect(coords).toHaveLength(4)
      const span = (axis: 0 | 1) =>
        Math.max(...coords.map((point) => point[axis])) -
        Math.min(...coords.map((point) => point[axis]))
      const { width, height } = clip_rect(wrapper)
      // the d3 path writes coordinates to 3 decimals, so spans are good to ~1e-3 px
      expect(span(swap_axes ? 0 : 1)).toBeCloseTo(0.2 * (swap_axes ? width : height), 2)
      expect(span(swap_axes ? 1 : 0)).toBeCloseTo(swap_axes ? height : width, 2)
    },
  )

  // On a log pressure axis a -sigma_p reaching P <= 0 runs to the axis floor: mapped 6 decades
  // below it instead, the band of this slanted line flared ~900 px past the chart
  test(`log-axis pressure errors reaching P <= 0 stay near the chart`, async () => {
    // oxfmt-ignore
    const data = one_line([[1, 0], [100, 1000]], { sigma_p: [2, 2] }, [1, 100])
    const wrapper = await mount_diagram({ data, pressure_axis: { scale_type: `log` } })
    const ys = band_coords(wrapper).map(([, coord_y]) => coord_y)
    expect(ys).toHaveLength(4)
    const { y: top, height } = clip_rect(wrapper)
    for (const coord_y of ys) {
      expect(coord_y).toBeGreaterThan(top - height / 2)
      expect(coord_y).toBeLessThan(top + 1.5 * height)
    }
  })

  // oxfmt-ignore
  test.each([
    [`one error`, { ...iron_pt_diagram, phases: [...iron_pt_diagram.phases, { id: `alpha` }] }, `Invalid pressure-temperature phase diagram: duplicate phase id 'alpha'`],
    [`several errors`, { ...iron_pt_diagram, pressure_range: [10, 0], temperature_range: [5, 5] }, `Invalid pressure-temperature phase diagram: pressure_range must be [min, max] with min < max, got [10,0] (+1 more)`],
  ] satisfies [string, PtPhaseDiagramData, string][])(
    `invalid data (%s) shows the error and draws nothing`,
    async (_label, data, message) => {
      const wrapper = await mount_diagram({ data })
      await vi.waitFor(() =>
        expect(wrapper.querySelector(`.status-message.error`)?.textContent?.trim()).toBe(
          message,
        ),
      )
      expect(count(wrapper, `.regions path`)).toBe(0)
      expect(count(wrapper, `.boundary`)).toBe(0)
      expect(count(wrapper, `.special-point`)).toBe(0)
    },
  )

  test(`hover over a region shows its phase, lights it, and clears outside the plot`, async () => {
    const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram({ on_phase_hover })
    await hover(wrapper, 50, 1000)
    const info = on_phase_hover.mock.lastCall?.[0]
    expect(info?.phase?.id).toBe(`epsilon`)
    expect(info?.boundary_hit).toBeNull()
    expect(info?.special_point).toBeNull()
    // px -> data inverts a linear scale: round-off ~1e-13 at these magnitudes, 9 digits is safe
    expect(info?.point[0]).toBeCloseTo(50, 9)
    expect(info?.point[1]).toBeCloseTo(1000, 9)
    const text = tooltip_text(wrapper) ?? ``
    expect(text).toContain(`ε-Fe`)
    expect(text).toContain(`hcp`)
    expect(wrapper.querySelector(`.regions path.lit`)?.getAttribute(`data-phase`)).toBe(
      `epsilon`,
    )
    // the tooltip is anchored from the hovered data point, so it moves with the cursor
    const tooltip_left = () =>
      Number(
        wrapper.querySelector<HTMLElement>(`.plot-tooltip`)?.style.left.replace(/px$/, ``),
      )
    const left_at_50 = tooltip_left()
    await hover(wrapper, 60, 1000)
    // px -> data -> px round trip through linear scales: sub-1e-9 px, 6 digits is safe
    expect(tooltip_left() - left_at_50).toBeCloseTo((10 / 150) * clip_rect(wrapper).width, 6)

    plot_svg(wrapper).dispatchEvent(mouse(`mousemove`, { clientX: 5, clientY: 5 }))
    await tick()
    expect(on_phase_hover).toHaveBeenLastCalledWith(null)
    expect(tooltip_text(wrapper)).toBeNull()
  })

  // alpha-epsilon carries sigma_p [0.9, 0.8, ...] at its vertices; its 2nd vertex (12.4 GPa,
  // 420 K) is far from the α-γ-ε triple point marker (> 12 px), so it hits the line only
  test.each([
    [1, `± 0.8`, `± 1σ standard error`],
    [2, `± 1.6`, `± 2σ standard error`],
  ])(
    `hover on a boundary at n_sigma=%d shows its sigma`,
    async (n_sigma, sigma_text, note) => {
      const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
      const wrapper = await mount_diagram({ on_phase_hover, n_sigma })
      await hover(wrapper, 12.4, 420)
      const hit = on_phase_hover.mock.lastCall?.[0]?.boundary_hit
      expect(hit?.boundary.id).toBe(`alpha-epsilon`)
      // sigmas are linearly interpolated at the nearest point, here a vertex up to round-off
      expect(hit?.sigma_p).toBeCloseTo(0.8, 6)
      expect(hit?.sigma_t).toBeNull()
      const text = tooltip_text(wrapper) ?? ``
      expect(text).toContain(`α-Fe ⇌ ε-Fe`)
      expect(text).toContain(sigma_text)
      expect(text).toContain(note)
      expect(wrapper.querySelector(`.boundary.lit`)?.getAttribute(`data-boundary`)).toBe(
        `alpha-epsilon`,
      )
    },
  )

  // γ–ε–L carries sigma_t 140 K and sigma_p 4 GPa: a temperature error converts without the
  // zero offset (140 K = 140 °C = 252 °F), shown to 2 significant digits in plain decimals
  test.each([
    [`K`, `± 140`],
    [`°C`, `± 140`],
    [`°F`, `± 250`],
  ] as const)(
    `hover on a triple point names it with its phases and sigmas (%s)`,
    async (display_temp_unit, sigma_t_text) => {
      const wrapper = await mount_diagram({ display_temp_unit })
      await hover(wrapper, 90, 2950)
      const text = tooltip_text(wrapper) ?? ``
      expect(text).toContain(`γ–ε–L`)
      expect(text).toContain(`Triple point`)
      expect(text).toContain(sigma_t_text)
      expect(text).toContain(`± 4`)
    },
  )

  // On a log axis region edges are straight in pixels, not in data units: between the last two
  // melting points (factor ~4 in P) the drawn ice|liquid line sags below the data-space chord,
  // and a cursor between the two must read liquid, the field drawn under it
  test(`log-axis hover hit-tests the drawn regions`, async () => {
    const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram({
      data: water_pt_diagram,
      pressure_axis: { scale_type: `log` },
      on_phase_hover,
    })
    const melting = water_pt_diagram.boundaries.find((line) => line.id === `melting`)
    const [[p_1, t_1], [p_2, t_2]] = melting?.points.slice(-2) ?? []
    const pressure = Math.sqrt(p_1 * p_2) // pixel midpoint of the segment
    const drawn_t = (t_1 + t_2) / 2
    const chord_t = t_1 + ((t_2 - t_1) * (pressure - p_1)) / (p_2 - p_1)
    expect(chord_t - drawn_t).toBeGreaterThan(2) // the two tests disagree by > 2 K here
    const { x: left, y: top, width, height } = clip_rect(wrapper)
    const temp = (drawn_t + chord_t) / 2
    const [p_min, p_max] = water_pt_diagram.pressure_range ?? [1, 1]
    const [t_min, t_max] = water_pt_diagram.temperature_range ?? [0, 1]
    const clientX = left + (Math.log10(pressure / p_min) / Math.log10(p_max / p_min)) * width
    const clientY = top + height - ((temp - t_min) / (t_max - t_min)) * height
    plot_svg(wrapper).dispatchEvent(mouse(`mousemove`, { clientX, clientY }))
    await tick()
    expect(on_phase_hover.mock.lastCall?.[0]?.phase?.id).toBe(`liquid`)
  })

  // Hover and pin describe the data and view they were taken in, so changing either drops them
  // oxfmt-ignore
  test.each([
    [`data`, (state: { data: PtPhaseDiagramData }) => (state.data = { ...iron_pt_diagram })],
    [`temperature unit`, (state: { display_temp_unit: TempUnit }) => (state.display_temp_unit = `°C`)],
    [`pressure unit`, (state: { display_pressure_unit: PressureUnit }) => (state.display_pressure_unit = `kbar`)],
    [`swapped axes`, (state: { swap_axes: boolean }) => (state.swap_axes = true)],
  ] as const)(`changing the %s clears hover and pin`, async (_label, change) => {
    const state = $state<{
      data: PtPhaseDiagramData
      display_temp_unit: TempUnit
      display_pressure_unit: PressureUnit
      swap_axes: boolean
    }>({ data: iron_pt_diagram, display_temp_unit: `K`, display_pressure_unit: `GPa`, swap_axes: false })
    const on_pin = vi.fn<(info: PtHoverInfo | null) => void>()
    const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram(bind_props({ on_pin, on_phase_hover }, state))
    await hover(wrapper, 50, 1000)
    await fire(plot_svg(wrapper), mouse(`click`))
    expect(wrapper.querySelector(`.pin-marker`)).not.toBeNull()
    change(state)
    await tick()
    expect(wrapper.querySelector(`.pin-marker`)).toBeNull()
    expect(tooltip_text(wrapper)).toBeNull()
    expect(on_pin).toHaveBeenLastCalledWith(null)
    expect(on_phase_hover).toHaveBeenLastCalledWith(null)
  })

  // Marks are the ε and liquid regions, empty space the margin left of the plot
  test(`click pins the hovered tooltip, a second click, the margin or Escape unpin it`, async () => {
    const on_pin = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram({ on_pin })
    const svg = plot_svg(wrapper)
    // oxfmt-ignore
    const spots: [number, number][] = [[50, 1000], [50, 3500]]
    const text = await pin_cycle(
      async (step, mark_idx) => {
        if (step === `escape`) svg.dispatchEvent(keydown(`Escape`))
        else if (step === `leave`) svg.dispatchEvent(mouse(`mouseleave`))
        else if (mark_idx === null) {
          svg.dispatchEvent(mouse(`mousemove`, { clientX: 5, clientY: 5 }))
        } else {
          const [pressure, temp] = spots[mark_idx]
          const nudge = step === `nudge` ? 1 : 0 // further into the same region
          await hover(wrapper, pressure + 5 * nudge, temp + 100 * nudge)
        }
        if (step === `click`) svg.dispatchEvent(mouse(`click`))
      },
      {
        lit: (idx) =>
          wrapper
            .querySelector(`.regions path[data-phase="${[`epsilon`, `liquid`][idx]}"]`)
            ?.classList.contains(`lit`) ?? false,
      },
    )
    expect(text).toContain(`ε-Fe`)
    // pin_cycle pins mark 0 three times, unpinning by a second click, Escape and a margin click
    const calls = on_pin.mock.calls.map(([info]) => info?.phase?.id ?? null)
    expect(calls).toEqual([`epsilon`, null, `epsilon`, null, `epsilon`, null])
  })

  test(`pinning draws a marker at the pinned point until Escape`, async () => {
    const on_pin = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram({ on_pin })
    const svg = plot_svg(wrapper)
    await hover(wrapper, 50, 1000)
    expect(wrapper.querySelector(`.pin-marker`)).toBeNull()
    await fire(svg, mouse(`click`))
    const { clientX, clientY } = to_client(wrapper, 50, 1000)
    // data -> px round trip through the linear scales: sub-1e-9 px round-off, 6 digits is safe
    const marker = translate_of(wrapper.querySelector(`.pin-marker`))
    expect(marker.x).toBeCloseTo(clientX, 6)
    expect(marker.y).toBeCloseTo(clientY, 6)
    expect(on_pin.mock.lastCall?.[0]?.phase?.id).toBe(`epsilon`)
    await fire(svg, keydown(`Escape`))
    expect(wrapper.querySelector(`.pin-marker`)).toBeNull()
    expect(on_pin).toHaveBeenLastCalledWith(null)
  })

  test(`legend click hides and restores a phase region`, async () => {
    const state = $state({ hidden_phases: [] as string[] })
    const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram(bind_props({ on_phase_hover }, state))
    const legend_item = wrapper.querySelector(
      `.legend-item[aria-label="Toggle visibility for γ-Fe"]`,
    )
    const gamma = () => wrapper.querySelector(`.regions path[data-phase="gamma"]`)
    expect(gamma()).not.toBeNull()
    await fire(legend_item)
    expect(state.hidden_phases).toEqual([`gamma`])
    expect(gamma()).toBeNull()
    expect(count(wrapper, `.regions path`)).toBe(4)
    expect(legend_item?.getAttribute(`aria-pressed`)).toBe(`false`)
    // a hidden phase's area reads as unmapped on hover
    await hover(wrapper, 2, 1400)
    expect(on_phase_hover.mock.lastCall?.[0]?.phase).toBeNull()
    expect(tooltip_text(wrapper)).toContain(`No mapped phase`)
    await fire(legend_item)
    expect(state.hidden_phases).toEqual([])
    expect(gamma()).not.toBeNull()
  })

  // oxfmt-ignore
  test.each([
    [{}, `Pressure (GPa)`, `Temperature (K)`],
    [{ swap_axes: true }, `Temperature (K)`, `Pressure (GPa)`],
    [{ display_pressure_unit: `kbar` as const }, `Pressure (kbar)`, `Temperature (K)`],
    [{ display_temp_unit: `°C` as const }, `Pressure (GPa)`, `Temperature (°C)`],
    [{ swap_axes: true, display_pressure_unit: `bar` as const }, `Temperature (K)`, `Pressure (bar)`],
  ])(`axis labels for %j`, async (props, x_label, y_label) => {
    const wrapper = await mount_diagram(props)
    expect(axis_text(wrapper, `x`)).toContain(x_label)
    expect(axis_text(wrapper, `y`)).toContain(y_label)
  })

  // Axis configs are by quantity: swapping sides keeps the log scale on pressure, and a pinned
  // range is in display units, so it converts along when the unit changes (from any source)
  test(`pressure_axis follows swaps and its pinned range converts with the unit`, async () => {
    const state = $state<{
      pressure_axis: AxisConfig
      display_pressure_unit: PressureUnit
      swap_axes: boolean
    }>({ pressure_axis: { range: [0, 100] }, display_pressure_unit: `GPa`, swap_axes: false })
    const wrapper = await mount_diagram(bind_props({}, state))
    state.display_pressure_unit = `kbar`
    await tick()
    expect(state.pressure_axis.range).toEqual([0, 1000])
    expect(axis_text(wrapper, `x`)).toContain(`Pressure (kbar)`)
    state.swap_axes = true
    await tick()
    expect(axis_text(wrapper, `y`)).toContain(`Pressure (kbar)`)
    expect(state.pressure_axis.range).toEqual([0, 1000])
  })

  // Python's None arrives as null; it must read as an omitted key, not crash the component
  test(`null optional fields render like omitted ones`, async () => {
    const from_python: unknown = { ...iron_pt_diagram, regions: null, title: null }
    const wrapper = await mount_diagram({ data: from_python as PtPhaseDiagramData })
    expect(count(wrapper, `.regions path`)).toBe(5)
    expect(wrapper.querySelector(`.status-message`)).toBeNull()
  })

  // Liquid and vapor share a face around the critical point: traced regions leave it unfilled
  // and say so instead of silently dropping it
  test(`traced regions that can't be named raise a notice`, async () => {
    const { regions: _explicit, ...water } = water_pt_diagram
    const wrapper = await mount_diagram({
      data: water,
      pressure_axis: { scale_type: `log` },
    })
    expect(count(wrapper, `.regions path`)).toBe(1)
    expect(wrapper.querySelector(`.status-message`)?.textContent).toMatch(
      /1 region\(s\) couldn't be assigned a phase/,
    )
  })

  // 150 GPa = 1500 kbar: ticks and tooltip follow the display unit, data stays in GPa
  test(`display_pressure_unit converts ticks and tooltip values`, async () => {
    const on_phase_hover = vi.fn<(info: PtHoverInfo | null) => void>()
    const wrapper = await mount_diagram({ display_pressure_unit: `kbar`, on_phase_hover })
    expect(axis_text(wrapper, `x`)).toContain(`1.4k`)
    await hover(wrapper, 50, 1000)
    expect(on_phase_hover.mock.lastCall?.[0]?.point[0]).toBeCloseTo(50, 9) // data units
    expect(tooltip_text(wrapper)).toMatch(/P\s*500\s*kbar/)
  })
})
