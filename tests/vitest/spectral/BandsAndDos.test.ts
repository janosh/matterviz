import BandsAndDos from '#lib/spectral/BandsAndDos.svelte'
import type { BaseBandStructure, ElectronicDos, PhononDos } from '#lib/spectral/types.js'
import { mock_band_structure as band_structs } from '#site/spectral-mocks.js'
import { createRawSnippet, flushSync } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import {
  clip_rect,
  fire,
  marker_position,
  mount_sized,
  mouse,
  plot_svg,
  translate_of,
} from '../setup'
import { make_crystal } from '../test-fixtures'

const phonon_dos: PhononDos = {
  type: `phonon`,
  frequencies: [0, 1, 2, 3, 4],
  densities: [0, 1, 2, 1, 0],
}
// electronic bands and DOS with their own Fermi energies
const electron_bands: BaseBandStructure = { ...band_structs, type: `electronic`, efermi: 2 }
const electron_dos: ElectronicDos = {
  type: `electronic`,
  energies: [0, 4],
  densities: [0, 1],
  efermi: 3,
}
const electron_pair = { band_structs: { '': electron_bands }, doses: { '': electron_dos } }
const pair_props = { band_structs: { '': band_structs }, doses: { '': phonon_dos } }
const structure = make_crystal(3, [])
// copies props' descriptors, so a getter prop stays live
const mount_pair = (props: object, width = 1200, height = 600) =>
  mount_sized(
    BandsAndDos,
    Object.defineProperties({ ...pair_props }, Object.getOwnPropertyDescriptors(props)),
    { selector: `.bands-and-dos`, width, height },
  )
const y_tick_text = (plot: Element) =>
  [...plot.querySelectorAll(`.y-axis .tick text`)].map((element) => element.textContent)
// side by side at 1200px, stacked at 400px, without and with a Brillouin zone
const layouts = [
  [`no BZ`, 1200, {}],
  [`no BZ`, 400, {}],
  [`BZ`, 1200, { structure }],
  [`BZ`, 400, { structure }],
] as const

describe(`bands/DOS wrappers`, () => {
  // Side by side, the shared padding fits the DOS's titles in both panels: the electron DOS's
  // two-line x title below, α²F's top axis and title above (the DOS reports them through
  // resolved_padding, as an explicit shared padding stops it measuring its own titles)
  it.each([
    [`an electron DOS`, electron_pair, [20, 70]],
    [
      `a phonon DOS with α²F`,
      { a2f: { 'α²F': { ...phonon_dos, densities: [0, 1, 1, 1, 0] } } },
      [50, 50],
    ],
  ] as const)(`side by side, %s fits both panels' titles`, async (_desc, props, sides) => {
    const root = await mount_pair(props)
    await vi.waitFor(() => {
      const top_bottom = [...root.querySelectorAll(`.scatter`)].map((plot) => {
        const { y, height } = clip_rect(plot)
        return [Math.round(y), Math.round(600 - y - height)]
      })
      expect(top_bottom).toEqual([sides, sides])
    })
  })

  it.each(layouts)(
    `shares an explicit Fermi reference (%s, %ipx)`,
    async (_label, width, layout_props) => {
      const reference = fromStore(writable<number | undefined>(undefined))
      const root = await mount_pair(
        {
          ...layout_props,
          ...electron_pair,
          get fermi_level() {
            return reference.current
          },
        },
        width,
      )
      const plots = [...root.querySelectorAll(`.scatter`)]
      expect(plots).toHaveLength(2)
      for (const value of [undefined, 0, 1, undefined]) {
        reference.current = value
        flushSync()
        for (const [idx, plot] of plots.entries()) {
          const horizontal = idx === 1 && width === 400
          const axis = horizontal ? `x` : `y`
          const tick = [...plot.querySelectorAll(`.${axis}-axis .tick`)].find(
            (node) => node.querySelector(`text`)?.textContent === String(value ?? 2),
          )
          const line = plot.querySelector(`.fermi-level-line`)
          expect(line).not.toBeNull()
          // Reference and tick use the same scale; compare in the current layout, since
          // annotation widths can change the available plot area between renders.
          expect(Number(line?.getAttribute(`${axis}1`))).toBe(translate_of(tick)[axis])
        }
      }
      expect([electron_bands.efermi, electron_dos.efermi]).toEqual([2, 3])
    },
  )

  it.each(layouts)(
    `keeps parent data and shares changing frequency units (%s, %ipx)`,
    async (_label, width, layout_props) => {
      const dos: PhononDos = { type: `phonon`, frequencies: [0, 4], densities: [0, 1] }
      // Runtime callers can supply extra keys; the parent's data must still win.
      const props = {
        ...layout_props,
        doses: { '': dos },
        units: `meV` as const,
        bands_props: {
          controls_open: true,
          band_structs: { '': { ...band_structs, nb_bands: 1, bands: [[100, 101, 102]] } },
        },
        dos_props: {
          controls_open: true,
          show_units_control: true,
          doses: { first: dos, second: dos },
        },
      }
      const root = await mount_pair(props, width)
      const plots = root.querySelectorAll(`.scatter`)
      expect(plots).toHaveLength(2)
      expect(plots[0].querySelectorAll(`svg path[fill="none"]`)).toHaveLength(3)
      expect(plots[1].querySelectorAll(`svg path[fill="none"]`)).toHaveLength(1)
      const frequency_ticks = (idx: number) =>
        [
          ...plots[idx].querySelectorAll(
            `${idx === 1 && width === 400 ? `.x-axis` : `.y-axis`} .tick text`,
          ),
        ].map((label) => Number(label.textContent))
      const units_select = (identifier: string) => {
        const select = root.querySelector<HTMLSelectElement>(`#${identifier}-units`)
        if (!select) throw new Error(`Missing ${identifier} unit selector`)
        return select
      }
      for (const idx of [0, 1]) expect(Math.max(...frequency_ticks(idx))).toBeGreaterThan(10)
      for (const [panel, unit, upper_min, upper_max] of [
        [`bands`, `THz`, 3, 5],
        [`dos`, `cm^-1`, 100, 140],
      ] as const) {
        units_select(panel).value = unit
        await fire(units_select(panel), new Event(`change`, { bubbles: true }))
        expect(units_select(`bands`).value).toBe(unit)
        expect(units_select(`dos`).value).toBe(unit)
        for (const idx of [0, 1]) {
          const upper = Math.max(...frequency_ticks(idx))
          expect(upper).toBeGreaterThan(upper_min)
          expect(upper).toBeLessThan(upper_max)
        }
      }
    },
  )

  // The bands report their own hover, the composite draws it in both panels: the DOS line
  // lands on the hovered point's pixel row (shared y scale side by side), and leaving the bands
  // clears both lines and, beside a BZ, the shaded branch
  it.each([{}, { structure }])(`mirrors a bands hover into the DOS (%o)`, async (props) => {
    const root = await mount_pair({
      ...props,
      bands_props: { on_point_click: vi.fn(), point_tween: { duration: 0 } },
    })
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    const ref_line = (plot: Element, panel: string) =>
      plot.querySelector(`line[stroke*="--${panel}-reference-line-color"]`)
    const svg = plot_svg(bands_plot)
    svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 800, height: 600 })
    const point = marker_position(bands_plot, 1) // band 1 at the middle q-point: 1 THz
    svg.dispatchEvent(mouse(`mousemove`, { clientX: point.x, clientY: point.y }))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    flushSync()
    expect(Number(ref_line(bands_plot, `bands`)?.getAttribute(`y1`))).toBeCloseTo(point.y, 6)
    expect(Number(ref_line(dos_plot, `dos`)?.getAttribute(`y1`))).toBeCloseTo(point.y, 6)
    const shaded = bands_plot.querySelector(`rect.highlighted-segment`)
    expect(shaded !== null).toBe(`structure` in props)

    await fire(svg, mouse(`mouseleave`))
    expect(ref_line(bands_plot, `bands`)).toBeNull()
    expect(ref_line(dos_plot, `dos`)).toBeNull()
    expect(bands_plot.querySelector(`rect.highlighted-segment`)).toBeNull()
  })

  it(`passes the Brillouin panel's cell to the bands popup`, async () => {
    const root = await mount_pair(
      { structure, doses: { '': { type: `phonon`, frequencies: [0, 4], densities: [0, 1] } } },
      1200,
      400,
    )
    const symmetry_label = [...root.querySelectorAll(`.x-axis .tick text`)].find(
      (label) => label.textContent === `X`,
    )
    expect(symmetry_label?.getAttribute(`role`)).toBe(`button`)
    symmetry_label?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await vi.waitFor(() =>
      expect(root.querySelector(`.bz-popup-stats strong`)?.textContent).toBe(`X`),
    )
  })
  // The shared y range BandsAndDos pins on both panels equals (or nearly equals) the padded
  // range Bands derives from its own data whenever the DOS lies inside the bands. Bands must
  // not treat that pin as its own default and clear it, or the sync effect re-pins it and the
  // two loop until Svelte's effect_update_depth_exceeded
  it.each([
    [`DOS inside the bands range`, 4],
    [`DOS ending within tolerance of the bands range`, 4.0001],
  ])(`renders both panels without an effect loop (%s)`, async (_label, dos_max) => {
    const root = await mount_pair(
      { doses: { '': { ...phonon_dos, frequencies: [0, 1, 2, 3, dos_max] } } },
      800,
      400,
    )
    expect(() => flushSync()).not.toThrow()
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    expect(y_tick_text(bands_plot)).toEqual(y_tick_text(dos_plot))
    expect(y_tick_text(bands_plot).length).toBeGreaterThan(2)
  })

  // The panels link their live y views: a rect zoom in the bands panel shows the same y range
  // in the DOS panel, and a reset in either panel returns both to the shared range without
  // either panel's axis pin having been touched
  it(`links a zoom in one panel to the other and resets both`, async () => {
    const root = await mount_pair({}, 800, 400)
    const y_ticks = (plot: Element) => y_tick_text(plot).map(Number)
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    const initial = y_ticks(bands_plot)
    expect(initial.length).toBeGreaterThan(2)

    const bands_svg = plot_svg(bands_plot)
    const clip = clip_rect(bands_plot)
    const position = (frac_x: number, frac_y: number): MouseEventInit => ({
      bubbles: true,
      clientX: clip.x + clip.width * frac_x,
      clientY: clip.y + clip.height * frac_y,
    })
    bands_svg.dispatchEvent(new MouseEvent(`mousedown`, position(0.1, 0.3)))
    window.dispatchEvent(new MouseEvent(`mousemove`, { buttons: 1, ...position(0.9, 0.6) }))
    await fire(window, new MouseEvent(`mouseup`, position(0.9, 0.6)))
    const zoomed = y_ticks(bands_plot)
    expect(Math.max(...zoomed) - Math.min(...zoomed)).toBeLessThan(
      Math.max(...initial) - Math.min(...initial),
    )
    expect(y_ticks(dos_plot)).toEqual(zoomed)

    await fire(plot_svg(dos_plot), new MouseEvent(`dblclick`, { bubbles: true }))
    expect(y_ticks(bands_plot)).toEqual(initial)
    expect(y_ticks(dos_plot)).toEqual(initial)
  })

  // One fullscreen button in the top-right plot's header (DOS side by side, bands when stacked)
  // beside the caller's controls, hidden by fullscreen_toggle or that plot's show_controls
  const kinds = [`default`, `fullscreen_toggle`, `show_controls`] as const
  const cases = layouts.flatMap((row) => kinds.map((kind) => [...row, kind] as const))
  it.each(cases)(
    `fullscreen btn (%s, %ipx, %s)`,
    async (_label, width, layout_props, kind) => {
      const [host_idx, shown] = [width === 1200 ? 1 : 0, Number(kind === `default`)]
      const hidden = { show_controls: { hidden: [`fullscreen`] as const } }
      const [bands_props, dos_props] = [`bands`, `dos`].map((name, idx) => ({
        header_controls: createRawSnippet(() => ({ render: () => `<i class=${name}></i>` })),
        ...(kind === `show_controls` && idx === host_idx ? hidden : {}),
      }))
      const fullscreen_toggle = kind !== `fullscreen_toggle`
      const props = { ...layout_props, bands_props, dos_props, fullscreen_toggle }
      const root = await mount_pair(props, width)
      const plots = [...root.querySelectorAll(`.scatter`)]
      const in_plots = (sel: string) => plots.map((plot) => plot.querySelectorAll(sel).length)
      expect([...in_plots(`.bands`), ...in_plots(`.dos`)]).toEqual([1, 0, 0, 1])
      expect(in_plots(`.fullscreen-btn`)).toEqual(host_idx ? [0, shown] : [shown, 0])
      expect(root.querySelectorAll(`.fullscreen-btn`)).toHaveLength(shown)
    },
  )
})
