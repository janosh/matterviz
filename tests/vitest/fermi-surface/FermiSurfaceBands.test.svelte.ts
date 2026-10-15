// FermiSurfaceBands: a Fermi surface linked to the band structure of the same calculation
import FermiSurfaceBands from '#lib/fermi-surface/FermiSurfaceBands.svelte'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import { createRawSnippet, flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fire, mount_sized, mouse, plot_svg } from '../setup'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

// Ten electronic bands of one run; the grid holds bands 8 and 9 (band_indices). Band 8 runs
// 0.1 → 0.5 eV through E_F = 0.3 like the grid's |k| sphere, the others lie far from it
const band_struct: BaseBandStructure = {
  type: `electronic`,
  efermi: 0.3,
  qpoints: [
    { label: `GAMMA`, frac_coords: [0, 0, 0], distance: 0 },
    { label: null, frac_coords: [0.25, 0, 0], distance: 0.5 },
    { label: `X`, frac_coords: [0.5, 0, 0], distance: 1 },
  ],
  branches: [{ start_index: 0, end_index: 2, name: `GAMMA-X` }],
  labels_dict: { GAMMA: [0, 0, 0], X: [0.5, 0, 0] },
  distance: [0, 0.5, 1],
  nb_bands: 10,
  bands: Array.from({ length: 10 }, (_, band_idx) =>
    band_idx === 8 ? [0.1, 0.3, 0.5] : [band_idx - 9, band_idx - 8.5, band_idx - 8],
  ),
}
// ε = |k − centre| on an endpoint-inclusive 5³ grid, crossing E_F = 0.3 in a sphere
const sphere = Float64Array.from({ length: 125 }, (_, idx) =>
  Math.hypot(
    ...[Math.floor(idx / 25), Math.floor(idx / 5) % 5, idx % 5].map((ii) => ii / 4 - 0.5),
  ),
)
const band_data: BandGridData = {
  energies: [
    [
      { values: sphere, dims: [5, 5, 5], order: `z_fastest` },
      { values: sphere.map((energy) => energy + 0.05), dims: [5, 5, 5], order: `z_fastest` },
    ],
  ],
  k_grid: [5, 5, 5],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0.3,
  n_bands: 2,
  n_spins: 1,
  band_indices: [8, 9],
}

// Hover previews a band point's energy (the dashed E_F + mu line follows it, mu itself stays), a
// click pins that energy as mu and isolates the band, a second click ends the isolation
test(`hover previews a band point's energy, a click pins it and isolates the band`, async () => {
  // extraction runs on animation frames: fake them to step it deterministically
  vi.useFakeTimers({
    toFake: [`setTimeout`, `clearTimeout`, `requestAnimationFrame`, `cancelAnimationFrame`],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const on_plot_click = vi.fn()
  const props = $state<{ selected_bands?: number[]; mu: number } & Record<string, unknown>>({
    band_data,
    band_struct,
    mu: 0,
    selected_bands: undefined,
    fermi_props: { controls_open: true }, // its band checkboxes show the sheets displayed
    bands_props: {
      point_tween: { duration: 0 },
      style: `width: 600px; height: 400px`,
      on_plot_click,
    },
  })
  const wrapper = await mount_sized(FermiSurfaceBands, props, {
    selector: `.fermi-surface-bands`,
    width: 1200,
    height: 600,
  })
  await vi.advanceTimersByTimeAsync(200)
  const scatter = wrapper.querySelector(`.scatter`)
  if (!scatter) throw new Error(`no band plot`)
  const svg = plot_svg(scatter)
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 400 })
  // Bands draws plain lines (no markers): aim at the first vertex (Γ) of a band's path, whose
  // series id is JSON [label, segment, band_idx, spin]
  const band_vertex = (band: number) => {
    const group = [...svg.querySelectorAll(`g[data-series-id]`)].find(
      (node) => JSON.parse(node.getAttribute(`data-series-id`) ?? `[]`)[2] === band,
    )
    const match = /M\s*(?<x>[-\d.e]+)[ ,]\s*(?<y>[-\d.e]+)/.exec(
      group?.querySelector(`path`)?.getAttribute(`d`) ?? ``,
    )?.groups
    if (!match) throw new Error(`no path for band ${band}`)
    return { clientX: Number(match.x), clientY: Number(match.y) }
  }
  const hover = async (band: number) => {
    svg.dispatchEvent(mouse(`mousemove`, band_vertex(band)))
    await vi.advanceTimersByTimeAsync(50) // hover frame, then the preview extraction
    flushSync()
  }
  const leave = async () => {
    await fire(svg, mouse(`mouseleave`))
    await vi.advanceTimersByTimeAsync(50) // re-extraction at the pinned mu
    flushSync()
  }
  const click = async (band: number) => {
    await hover(band) // a real click follows the pointer onto the band
    svg.dispatchEvent(mouse(`click`, band_vertex(band)))
    flushSync()
  }
  const reference_y = () =>
    wrapper.querySelector(`line[stroke*="bands-reference-line-color"]`)?.getAttribute(`y1`)
  const selected_strokes = () =>
    wrapper.querySelectorAll(`svg path[fill="none"][stroke*="--bands-selected-color"]`).length
  expect(wrapper.querySelectorAll(`.marker`)).toHaveLength(0) // lines only
  expect(reference_y()).toBeUndefined() // mu = 0: only the E_F line

  await hover(8) // band 8 at Γ: 0.1 eV, 0.2 below E_F
  expect(Number(reference_y())).toBeCloseTo(band_vertex(8).clientY, 2) // path d rounds to 1e-3 px
  expect([props.mu, selected_strokes()]).toEqual([0, 1])
  // the hovered q-point's whole branch (Γ→X, the only one) is shaded on the bands, as beside a BZ
  expect(wrapper.querySelector(`rect.highlighted-segment`)).toBeInstanceOf(SVGRectElement)
  await leave()
  expect([reference_y(), selected_strokes()]).toEqual([undefined, 0])
  expect(wrapper.querySelector(`rect.highlighted-segment`)).toBeNull()

  // band 3 is not in the grid: no preview, and a click pins nothing
  await click(3)
  expect([reference_y(), props.mu]).toEqual([undefined, 0])
  await leave()

  // the 3D controls list the sheets shown: both, then band 8 alone once isolated
  const shown_bands = () =>
    [...wrapper.querySelectorAll<HTMLInputElement>(`.band-checkbox input`)].map(
      (input) => input.checked,
    )
  expect(shown_bands()).toEqual([true, true])
  await click(8)
  expect(props.mu).toBeCloseTo(-0.2, 12) // the clicked energy, pinned
  expect(on_plot_click).toHaveBeenCalledTimes(2)
  await leave()
  expect(shown_bands()).toEqual([true, false])
  expect(selected_strokes()).toBe(1) // isolated, still emphasised without hover
  expect(Number(reference_y())).toBeCloseTo(band_vertex(8).clientY, 2) // path d rounds to 1e-3 px
  // a mu change while isolated that drops band 9 (ε ≥ 0.05 eV) and restores it must not leak
  // the isolation into the bands the user hid
  for (const mu of [-0.28, -0.2]) {
    props.mu = mu
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
  }
  expect(shown_bands()).toEqual([true, false])

  await click(8) // again: isolation ends, both sheets return
  await leave()
  expect(selected_strokes()).toBe(0)
  expect(shown_bands()).toEqual([true, true])

  // the E_F line marks the grid's Fermi level (the surface's mu = 0), not a differing efermi
  // stored with the band structure
  const fermi_line_y = () => wrapper.querySelector(`line.fermi-level-line`)?.getAttribute(`y1`)
  const grid_fermi_y = fermi_line_y()
  props.band_struct = { ...band_struct, efermi: 0.25 }
  await vi.advanceTimersByTimeAsync(50)
  flushSync()
  expect(fermi_line_y()).toBe(grid_fermi_y)
})

// One fullscreen button for both views, in the bands' header beside the caller's header
// controls; the wrapper's fullscreen_toggle and the bands' show_controls can still hide it
test.each([
  [`default`, {}, {}, 1],
  [`fullscreen_toggle`, { fullscreen_toggle: false }, {}, 0],
  [`show_controls`, {}, { show_controls: { hidden: [`fullscreen`] as const } }, 0],
])(`fullscreen button (%s)`, async (_variant, wrapper_props, extra_bands_props, n_buttons) => {
  const header_controls = createRawSnippet(() => ({
    render: () => `<span class="caller-ctrl"></span>`,
  }))
  const wrapper = await mount_sized(
    FermiSurfaceBands,
    {
      band_data,
      band_struct,
      ...wrapper_props,
      bands_props: { header_controls, ...extra_bands_props },
    },
    { selector: `.fermi-surface-bands`, width: 1200, height: 600 },
  )
  const caller_ctrl = wrapper.querySelector(`.scatter .header-controls .caller-ctrl`)
  expect(caller_ctrl).toBeInstanceOf(HTMLSpanElement)
  const buttons = wrapper.querySelectorAll(`.fullscreen-btn`)
  expect(buttons).toHaveLength(n_buttons)
  if (n_buttons) expect(caller_ctrl?.parentElement?.contains(buttons[0])).toBe(true)
})
