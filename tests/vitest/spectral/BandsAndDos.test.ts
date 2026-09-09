import BandsAndDos from '$lib/spectral/BandsAndDos.svelte'
import BrillouinBandsDos from '$lib/spectral/BrillouinBandsDos.svelte'
import type { BaseBandStructure, ElectronicDos, PhononDos } from '$lib/spectral/types'
import { flushSync } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { fire, clip_rect, make_crystal, mount_sized, plot_svg, translate_of } from '../setup'

const band_structs: BaseBandStructure = {
  type: `phonon`,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: null, frac_coords: [0.25, 0, 0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 0.5, 1],
  nb_bands: 3,
  bands: [
    [0, 1, 2],
    [1, 2, 3],
    [2, 3, 4],
  ],
}

const wrappers = [
  [`.bands-and-dos`, 1200, BandsAndDos],
  [`.bands-and-dos`, 400, BandsAndDos],
  [`.bands-dos-brillouin`, 1200, BrillouinBandsDos],
  [`.bands-dos-brillouin`, 400, BrillouinBandsDos],
] as const

describe(`bands/DOS wrappers`, () => {
  it.each(wrappers)(
    `shares an explicit Fermi reference in %s at %ipx`,
    async (selector, width, Component) => {
      const bands: BaseBandStructure = { ...band_structs, type: `electronic`, efermi: 2 }
      const dos: ElectronicDos = {
        type: `electronic`,
        energies: [0, 4],
        densities: [0, 1],
        efermi: 3,
      }
      const reference = fromStore(writable<number | undefined>(undefined))
      const root = await mount_sized(
        Component,
        {
          structure: make_crystal(3, []),
          band_structs: { '': bands },
          doses: { '': dos },
          get fermi_level() {
            return reference.current
          },
        },
        { selector, width, height: 600 },
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
      expect([bands.efermi, dos.efermi]).toEqual([2, 3])
    },
  )

  it.each(wrappers)(
    `keeps parent data and shares changing frequency units in %s at %ipx`,
    async (selector, width, Component) => {
      const dos: PhononDos = { type: `phonon`, frequencies: [0, 4], densities: [0, 1] }
      // Runtime callers can supply extra keys; the parent's data must still win.
      const props = {
        structure: make_crystal(3, []),
        band_structs: { '': band_structs },
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
      const root = await mount_sized(Component, props, { selector, width, height: 600 })
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
      const units_select = (id: string) => {
        const select = root.querySelector<HTMLSelectElement>(`#${id}-units`)
        if (!select) throw new Error(`Missing ${id} unit selector`)
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

  it(`passes the Brillouin panel's cell to the bands popup`, async () => {
    const root = await mount_sized(
      BrillouinBandsDos,
      {
        structure: make_crystal(3, []),
        band_structs: { '': band_structs },
        doses: { '': { type: `phonon`, frequencies: [0, 4], densities: [0, 1] } },
      },
      { selector: `.bands-dos-brillouin`, width: 1200, height: 400 },
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
    const doses: PhononDos = {
      type: `phonon`,
      frequencies: [0, 1, 2, 3, dos_max],
      densities: [0, 1, 2, 1, 0],
    }
    const root = await mount_sized(
      BandsAndDos,
      { band_structs: { '': band_structs }, doses: { '': doses } },
      { selector: `.bands-and-dos`, width: 800, height: 400 },
    )
    expect(() => flushSync()).not.toThrow()
    const y_ticks = (plot: Element) =>
      [...plot.querySelectorAll(`.y-axis .tick text`)].map((el) => el.textContent)
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    expect(y_ticks(bands_plot)).toEqual(y_ticks(dos_plot))
    expect(y_ticks(bands_plot).length).toBeGreaterThan(2)
  })

  // The panels link their live y views: a rect zoom in the bands panel shows the same y range
  // in the DOS panel, and a reset in either panel returns both to the shared range without
  // either panel's axis pin having been touched
  it(`links a zoom in one panel to the other and resets both`, async () => {
    const doses: PhononDos = {
      type: `phonon`,
      frequencies: [0, 1, 2, 3, 4],
      densities: [0, 1, 2, 1, 0],
    }
    const root = await mount_sized(
      BandsAndDos,
      { band_structs: { '': band_structs }, doses: { '': doses } },
      { selector: `.bands-and-dos`, width: 800, height: 400 },
    )
    const y_ticks = (plot: Element) =>
      [...plot.querySelectorAll(`.y-axis .tick text`)].map((el) => Number(el.textContent))
    const [bands_plot, dos_plot] = [...root.querySelectorAll(`.scatter`)]
    const initial = y_ticks(bands_plot)
    expect(initial.length).toBeGreaterThan(2)

    const bands_svg = plot_svg(bands_plot)
    const clip = clip_rect(bands_plot)
    const at = (fx: number, fy: number): MouseEventInit => ({
      bubbles: true,
      clientX: clip.x + clip.width * fx,
      clientY: clip.y + clip.height * fy,
    })
    bands_svg.dispatchEvent(new MouseEvent(`mousedown`, at(0.1, 0.3)))
    window.dispatchEvent(new MouseEvent(`mousemove`, { buttons: 1, ...at(0.9, 0.6) }))
    await fire(window, new MouseEvent(`mouseup`, at(0.9, 0.6)))
    const zoomed = y_ticks(bands_plot)
    expect(Math.max(...zoomed) - Math.min(...zoomed)).toBeLessThan(
      Math.max(...initial) - Math.min(...initial),
    )
    expect(y_ticks(dos_plot)).toEqual(zoomed)

    await fire(plot_svg(dos_plot), new MouseEvent(`dblclick`, { bubbles: true }))
    expect(y_ticks(bands_plot)).toEqual(initial)
    expect(y_ticks(dos_plot)).toEqual(initial)
  })
})
