// FermiSurfaceBands: a Fermi surface linked to the band structure of the same calculation
import type * as backdrop from '#lib/colors/backdrop.svelte.js'
import { sheet_color } from '#lib/fermi-surface/constants.js'
import FermiSurfaceBands from '#lib/fermi-surface/FermiSurfaceBands.svelte'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import { band_crossings, band_k_path, BANDS_CSS_COLORS } from '#lib/spectral/helpers.js'
import type { Vec2 } from '#lib/math.js'
import type { BaseBandStructure } from '#lib/spectral/types.js'
import { createRawSnippet, flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fire, mount_sized, mouse, plot_svg } from '../setup'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

// the nodes CSS colour tokens are resolved on, for three.js (which parses no var())
const resolved = vi.hoisted(() => [] as { node: Element; value: string }[])
vi.mock(`#lib/colors/backdrop.svelte.js`, async (original) => {
  const actual = await original<typeof backdrop>()
  return {
    ...actual,
    resolve_color_token: (node: Element, value: string) => {
      resolved.push({ node, value })
      return actual.resolve_color_token(node, value)
    },
  }
})

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

// Crossings interpolate linearly between q-points in plot x (here Γ→X spans x 2 → 4) and in k
// (identity lattice: k = frac coords). A band meeting the energy at a q-point is one crossing
// there whichever side it comes from or turns back to (each q-point of a flat run too), and so
// is a q-point two branches share (Γ→X split at q-point 1 gives the same crossings).
// oxfmt-ignore
test.each<[string, number[], number, [number, number, number][]]>([
  [`rising through q-point 1`, [0.1, 0.3, 0.5], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`rising, between q-points`, [0.1, 0.3, 0.5], 0.45, [[8, 3.75, 0.4375], [9, 2.9, 0.225]]],
  [`branch start`, [0.1, 0.3, 0.5], 0.1, [[8, 2, 0], [9, 2.2, 0.05]]],
  [`touching from below`, [0, 0.3, 0], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`touching from above`, [0.5, 0.3, 0.5], 0.3, [[8, 3, 0.25], [9, 2.6, 0.15]]],
  [`flat at the energy`, [0.3, 0.3, 0.3], 0.3, [[8, 2, 0], [8, 3, 0.25], [8, 4, 0.5], [9, 2.6, 0.15]]],
  [`flat, then leaving`, [0.3, 0.3, 0.5], 0.3, [[8, 2, 0], [8, 3, 0.25], [9, 2.6, 0.15]]],
  [`band 1 not in the grid`, [0.1, 0.3, 0.5], -0.6, []], // [-8, -7.5, -7] would cross
])(`band_crossings: %s`, (_desc, band_8, energy, expected) => {
  const bands = band_struct.bands.map((energies, band) => (band === 8 ? band_8 : energies))
  const { points } = band_k_path(band_struct, IDENTITY_MATRIX3)
  const split = {
    ...band_struct,
    bands,
    branches: [
      { start_index: 0, end_index: 1, name: `GAMMA-q` },
      { start_index: 1, end_index: 2, name: `q-X` },
    ],
  }
  for (const [struct, x_positions] of [
    [{ ...band_struct, bands }, { GAMMA_X: [2, 4] }],
    [split, { GAMMA_null: [2, 3], null_X: [3, 4] }],
  ] satisfies [BaseBandStructure, Record<string, Vec2>][]) {
    const crossings = band_crossings(struct, energy, points, x_positions, (band) =>
      [8, 9].includes(band),
    ).toSorted(
      (cross_a, cross_b) => cross_a.band_idx - cross_b.band_idx || cross_a.x - cross_b.x,
    )
    expect(crossings.map(({ band_idx, spin }) => [band_idx, spin])).toEqual(
      expected.map(([band]) => [band, `up`]),
    )
    for (const [idx, [, x_val, k_x]] of expected.entries()) {
      expect(crossings[idx].x).toBeCloseTo(x_val, 12)
      for (const [axis, coord] of [k_x, 0, 0].entries()) {
        expect(crossings[idx].k[axis]).toBeCloseTo(coord, 12)
      }
    }
  }
})

// Hover previews a band point's energy (the dashed E_F + mu line follows it, mu itself stays), a
// click pins that energy as mu and isolates the band, a second click ends the isolation
test(`hover previews a band point's energy, a click pins it and isolates the band`, async () => {
  // extraction runs on animation frames: fake them to step it deterministically
  vi.useFakeTimers({
    toFake: [
      `setTimeout`,
      `clearTimeout`,
      `requestAnimationFrame`,
      `cancelAnimationFrame`,
      `performance`,
    ],
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const on_plot_click = vi.fn()
  const props = $state<
    { selected_bands?: number[]; mu: number; bands_props?: object } & Record<string, unknown>
  >({
    band_data,
    band_struct,
    mu: 0,
    selected_bands: undefined,
    fermi_props: { controls_open: true }, // its band checkboxes show the sheets displayed
    bands_props: {
      point_tween: { duration: 0 },
      line_tween: { duration: 0 }, // paths jump to where the (untweened) dots are
      style: `width: 600px; height: 400px`,
      on_plot_click,
      header_controls: createRawSnippet(() => ({ render: () => `<i class="caller"></i>` })),
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
  // Bands draws plain lines (no markers): aim at a vertex (default Γ) of a band's path, whose
  // series id is JSON [label, segment, band_idx, spin]
  const band_path = (band: number) =>
    [...svg.querySelectorAll(`g[data-series-id]`)]
      .find((node) => JSON.parse(node.getAttribute(`data-series-id`) ?? `[]`)[2] === band)
      ?.querySelector(`path`)
  const band_vertex = (band: number, qpoint_idx = 0) => {
    const coords = (band_path(band)?.getAttribute(`d`) ?? ``).match(/[-\d.e]+/g)?.map(Number)
    if (!coords) throw new Error(`no path for band ${band}`)
    // M x,y then one cubic (C c1 c2 end) per step, straight with its controls on the chord
    const end_idx = 6 * qpoint_idx
    return { clientX: coords[end_idx], clientY: coords[end_idx + 1] }
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
  // the emphasised band keeps its sheet colour, so count it by its widened stroke
  const selected_strokes = () =>
    [...wrapper.querySelectorAll(`svg path[fill="none"]`)].filter(
      (path) => Number(path.getAttribute(`stroke-width`)) >= 3,
    ).length
  expect(wrapper.querySelectorAll(`.marker`)).toHaveLength(0) // lines only
  // the 3D crossing markers resolve the 2D dots' colours where the dots do, inside Bands
  // (whose bands_props.style may set them)
  const fermi_nodes = resolved.filter(({ value }) => value === BANDS_CSS_COLORS.fermi)
  const on_dots_svg = fermi_nodes.map(({ node }) => node.classList.contains(`band-crossings`))
  expect(new Set(on_dots_svg)).toEqual(new Set([true]))
  expect(reference_y()).toBeUndefined() // mu = 0: only the E_F line
  // band lines in their sheet's colour (FermiSurfaceScene's sheet_color), bands without a sheet
  // in the grid muted
  expect([8, 9, 3].map((band) => band_path(band)?.getAttribute(`stroke`))).toEqual([
    sheet_color(8, null, `band`),
    sheet_color(9, null, `band`),
    expect.stringContaining(`--bands-muted-color`),
  ])
  // E_F crossings dotted at the interpolated x: band 8 meets 0.3 eV at q-point 1, band 9
  // (0 → 0.5 eV) 60% of the way from Γ to it
  const fermi_y = Number(wrapper.querySelector(`line.fermi-level-line`)?.getAttribute(`y1`))
  const lerp_x = (band: number, frac: number) =>
    band_vertex(band).clientX +
    frac * (band_vertex(band, 1).clientX - band_vertex(band).clientX)
  const expect_dots = (expected: [number, number, string][]) => {
    const dots = [...wrapper.querySelectorAll(`.band-crossings circle`)].map((dot) => [
      Number(dot.getAttribute(`cx`)),
      Number(dot.getAttribute(`cy`)),
      dot.getAttribute(`fill`),
    ])
    // path d rounds to 1e-3 px
    const close = ([x_px, y_px, color]: [number, number, string]) => [
      expect.closeTo(x_px, 2),
      expect.closeTo(y_px, 2),
      color,
    ]
    expect(dots).toEqual(expected.map(close))
  }
  // dots in the colour of the line they sit on (Bands' E_F and reference line CSS)
  const { fermi: fermi_css, reference: ref_css } = BANDS_CSS_COLORS
  const fermi_dots = (): [number, number, string][] => [
    [band_vertex(8, 1).clientX, fermi_y, fermi_css],
    [lerp_x(9, 0.6), fermi_y, fermi_css],
  ]
  expect_dots(fermi_dots())

  await hover(8) // band 8 at Γ: 0.1 eV, 0.2 below E_F
  expect(Number(reference_y())).toBeCloseTo(band_vertex(8).clientY, 2) // path d rounds to 1e-3 px
  expect([props.mu, selected_strokes()]).toEqual([0, 1])
  // the previewed energy's crossings join E_F's: band 8 meets 0.1 eV at Γ, band 9 20% of the
  // way to q 1
  expect_dots([
    ...fermi_dots(),
    [band_vertex(8).clientX, Number(reference_y()), ref_css],
    [lerp_x(9, 0.2), Number(reference_y()), ref_css],
  ])
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
  // only the isolated band's crossings stay (E_F at q 1, the pinned 0.1 eV at Γ)
  expect_dots([fermi_dots()[0], [band_vertex(8).clientX, Number(reference_y()), ref_css]])
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
  props.mu = 0
  flushSync()
  expect_dots(fermi_dots())

  // the caller's line style (one for all, or per band and spin) under the sheet colours, its
  // colour kept by bands without a sheet; in property mode without vertex properties (controls
  // hidden, so nothing resets it) the sheets keep flat colours and so do the band lines
  const line_style = (band: number) =>
    [`stroke`, `stroke-width`].map((attr) => band_path(band)?.getAttribute(attr))
  const sheet_8 = sheet_color(8, null, `band`)
  for (const line_kwargs of [
    { stroke: `#123456`, stroke_width: 2.5 },
    (band: number) => ({ stroke: `#123456`, stroke_width: band === 8 ? 2.5 : 1 }),
  ]) {
    props.bands_props = { ...props.bands_props, line_kwargs }
    flushSync()
    expect([line_style(8), line_style(3)[0]]).toEqual([[sheet_8, `2.5`], `#123456`])
  }
  props.fermi_props = { color_property: `property`, show_controls: { hidden: [`controls`] } }
  flushSync()
  expect(line_style(8)).toEqual([sheet_color(8, null, `property`), `2.5`])
  // with grid properties the sheets are coloured by them and the band lines keep the caller's
  // style, also at an energy without sheets (as when hovering one)
  props.band_data = { ...band_data, properties: { v_F: band_data.energies } }
  for (const mu of [0, -0.5]) {
    props.mu = mu
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
    expect(line_style(8)).toEqual([`#123456`, `2.5`])
  }
  props.band_data = band_data
  props.mu = 0
  // the spin channel Bands hides (its control or bands_props) gets no crossings either
  for (const [band_spin_mode, dots] of [
    [`down_only`, () => []],
    [`up_only`, fermi_dots],
  ] as const) {
    props.bands_props = { ...props.bands_props, band_spin_mode }
    await vi.advanceTimersByTimeAsync(50)
    flushSync()
    expect_dots(dots())
  }

  // the E_F line marks the grid's Fermi level (mu = 0), not the band structure's efermi
  const fermi_line_y = () => wrapper.querySelector(`line.fermi-level-line`)?.getAttribute(`y1`)
  const grid_fermi_y = fermi_line_y()
  props.band_struct = { ...band_struct, efermi: 0.25 }
  flushSync()
  expect(fermi_line_y()).toBe(grid_fermi_y)

  // one fullscreen button for both views, in the bands' header beside the caller's controls,
  // hidden by the wrapper's fullscreen_toggle or the bands' show_controls
  const n_btns = (scope = ``) => wrapper.querySelectorAll(`${scope}.fullscreen-btn`).length
  expect([n_btns(`.scatter .caller ~ `), n_btns()]).toEqual([1, 1])
  props.fullscreen_toggle = false
  flushSync()
  expect(n_btns()).toBe(0)
  props.fullscreen_toggle = true
  props.bands_props = { show_controls: { hidden: [`fullscreen`] } }
  flushSync()
  expect(n_btns()).toBe(0)
})
