import PdfPlot from '#lib/rdf/PdfPlot.svelte'
import RdfPlot from '#lib/rdf/RdfPlot.svelte'
import type { RdfPattern } from '#lib/rdf/index.js'
import type { RadiationType } from '#lib/scattering/index.js'
import { structure_map } from '#site/structures.js'
import { type Component, type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { create_drop_event, mount_sized, resize_element } from '../setup'
import { BAD_ROW_CIF, make_crystal } from '../test-fixtures'
import RdfPlotHarness from './RdfPlotHarness.svelte'
import type * as calc_rdf from '#lib/rdf/calc-rdf.js'
import { calculate_all_pair_rdfs, rdf_bin_sites } from '#lib/rdf/calc-rdf.js'
import * as plot_module from '#lib/plot/index.js'

// Spy on the neighbour search so the radiation buttons can be shown not to re-run it
vi.mock(`#lib/rdf/calc-rdf.js`, async (import_original) => {
  const actual = await import_original<typeof calc_rdf>()
  return { ...actual, calculate_all_pair_rdfs: vi.fn(actual.calculate_all_pair_rdfs) }
})

const nacl_structure = structure_map.get(`mp-1234`)
const pd_structure = structure_map.get(`mp-2`)
const bi2zr2o8_structure = structure_map.get(`Bi2Zr2O8-Fm3m`)

if (!nacl_structure || !pd_structure || !bi2zr2o8_structure) {
  throw new Error(`Required test structures not found in structure_map`)
}

function create_synthetic_pattern(
  n_points = 50,
  peaks: number[] = [2, 4],
  heights: number[] = [2, 1.5],
): RdfPattern {
  const radii = Array.from({ length: n_points }, (_, idx) => (idx + 1) * 0.2)
  const g_r = radii.map((r_val) => {
    let g_val = 1 - Math.exp(-r_val / 2)
    for (let idx = 0; idx < peaks.length; idx++) {
      g_val += heights[idx] * Math.exp(-((r_val - peaks[idx]) ** 2) / 0.3)
    }
    return g_val
  })
  return { r: radii, g_r, element_pair: [`Li`, `O`] }
}

// a NaN position the neighbour search rejects
const good_and_broken = () => {
  const broken = make_crystal(4, [[`Si`, [0, 0, 0]]])
  broken.sites[0].xyz = [NaN, 0, 0]
  return { good: nacl_structure, broken }
}

const mount_sized_rdf_plot = (props: ComponentProps<typeof RdfPlot>) =>
  mount_sized(RdfPlot, props, { selector: `.scatter, .empty-drop` })

// Mounted un-sized: the harness wraps the plot in a binding parent, and the tests resize
// whichever plot they care about themselves.
const mount_harness = async (props: ComponentProps<typeof RdfPlotHarness>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(RdfPlotHarness, { target, props })
  await tick()
  return target
}

describe(`RdfPlot`, () => {
  const pattern_props = { patterns: { label: `Test`, pattern: create_synthetic_pattern() } }
  test.each<[ComponentProps<typeof RdfPlot>, boolean]>([
    [pattern_props, true],
    [{ ...pattern_props, show_reference_line: false }, false],
    [
      {
        patterns: [
          { label: `P1`, pattern: create_synthetic_pattern() },
          { label: `P2`, pattern: create_synthetic_pattern(50, [3, 5], [1.8, 1.2]) },
        ],
      },
      true,
    ],
    [{ structures: nacl_structure, mode: `element_pairs` }, true],
    [{ structures: pd_structure, mode: `full` }, true],
    [{ structures: [nacl_structure, pd_structure] }, true],
    [{ structures: { NaCl: nacl_structure, Pd: pd_structure } }, true],
    [{ structures: pd_structure, cutoff: 1, n_bins: 20 }, true],
  ])(`renders %s`, async (props, has_ref_line) => {
    const plot = await mount_sized_rdf_plot(props)
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`r (Å)`)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`g(r)`)
    expect(plot.querySelectorAll(`.x-axis .tick`)).not.toHaveLength(0)
    expect(plot.querySelectorAll(`.y-axis .tick`)).not.toHaveLength(0)
    expect(plot.textContent?.includes(`g(r) = 1`)).toBe(has_ref_line)
  })

  test.each([
    [{}, `Drag and drop structure files here to visualize RDFs`, true],
    [{ allow_file_drop: false }, `No RDF data to display`, false],
    [{ loading: true }, `Reading dropped file…`, true],
    [{ loading: true, loading_message: `Computing RDFs…` }, `Computing RDFs…`, true],
  ] as const)(`empty state %#`, async (props, message, accepts_drag) => {
    const plot = await mount_sized_rdf_plot(props)
    expect(plot.textContent).toContain(message)
    plot.dispatchEvent(new DragEvent(`dragover`, { bubbles: true, cancelable: true }))
    await tick()
    expect(plot.classList.contains(`dragover`)).toBe(accepts_drag)
  })

  test(`custom props and children snippet`, async () => {
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      x_axis: { label: `Custom X` },
      y_axis: { label: `Custom Y` },
      class: `custom-class`,
      allow_file_drop: true,
      children: createRawSnippet(() => ({
        render: () => `<div class="rdf-child">RDF child content</div>`,
      })),
    })
    expect(plot.querySelector(`.rdf-child`)?.textContent).toBe(`RDF child content`)
    expect(plot.classList.contains(`custom-class`)).toBe(true)
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Custom X`)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`Custom Y`)
  })

  test(`forwards the controls pane attribute props to PlotControls`, async () => {
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      controls_open: true,
      controls_toggle_props: { 'data-testid': `rdf-toggle` },
      controls_pane_props: { 'data-testid': `rdf-pane`, style: `min-width: 20rem` },
    })
    const pane = await vi.waitFor(() => {
      const found = plot.querySelector(`[data-testid="rdf-pane"]`)
      expect(found).not.toBeNull()
      return found
    })
    expect(pane?.getAttribute(`style`)).toContain(`min-width: 20rem`)
    expect(plot.querySelector(`[data-testid="rdf-toggle"]`)).not.toBeNull()
  })

  test(`updates axis title when external axis props change`, async () => {
    const target = await mount_harness({ pattern: create_synthetic_pattern() })
    let plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`RdfPlot root element not found`)
    await resize_element(plot, 400, 300)
    expect(target.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Initial r`)

    target.querySelector<HTMLButtonElement>(`.change-rdf-axis`)?.click()
    await tick()
    plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`RdfPlot root element not found after axis change`)
    await resize_element(plot, 400, 300)
    expect(target.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Updated r`)
  })

  // Supplied patterns come before the computed curves, so the series index must still find
  // the right structure; a pattern has no structure to point into
  test(`mixed patterns and structures: hovers report the curve and the atoms behind it`, async () => {
    const scatter = vi.spyOn(
      plot_module as unknown as {
        ScatterPlot: Component<{
          series?: { label?: string; y: readonly number[] }[]
          on_point_hover?: (event: {
            series_idx: number
            point: { point_idx: number }
          }) => void
        }>
      },
      `ScatterPlot`,
    )
    const [on_bin_hover, on_sites_hover] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      structures: nacl_structure,
      mode: `element_pairs`,
      on_bin_hover,
      on_sites_hover,
    })
    for (const label of [`Test`, `Lu-Lu`]) {
      const item = [...plot.querySelectorAll(`.legend-item`)].find(
        (node) => node.textContent?.trim() === label,
      )
      item?.dispatchEvent(new MouseEvent(`mouseenter`))
      item?.dispatchEvent(new MouseEvent(`mouseleave`))
    }
    const lu_sites = nacl_structure.sites.flatMap(({ species }, idx) =>
      species[0].element === `Lu` ? [idx] : [],
    )
    expect(lu_sites).toHaveLength(8)
    const lu_highlight = {
      label: expect.stringContaining(`Lu`),
      structure: nacl_structure,
      site_indices: lu_sites,
    }
    expect(on_sites_hover.mock.calls).toEqual([[null], [null], [[lu_highlight]], [null]])
    expect(
      on_bin_hover.mock.calls.map(([hover]) => hover && [hover.entry.label, hover.bin_idx]),
    ).toEqual([[`Test`, null], null, [`Lu-Lu`, null], null])

    // a curve point is one r bin: its pairs are found on demand, once per bin
    const { series = [], on_point_hover } = scatter.mock.lastCall?.[1] ?? {}
    const series_idx = series.findIndex(({ label }) => label === `Lu-Lu`)
    const bin_idx = series[series_idx]?.y.findIndex((g_val) => g_val > 0) ?? -1
    expect(bin_idx).toBeGreaterThan(0)
    on_sites_hover.mockClear()
    on_point_hover?.({ series_idx, point: { point_idx: bin_idx } })
    on_point_hover?.({ series_idx, point: { point_idx: bin_idx } })
    const lu_lu = { cutoff: 15, n_bins: 75, element_pair: [`Lu`, `Lu`] as [string, string] }
    const { n_pairs, ...expected } = rdf_bin_sites(nacl_structure, { ...lu_lu, bin_idx })
    expect(n_pairs).toBeGreaterThan(0)
    expect(on_sites_hover).toHaveBeenCalledOnce()
    expect(on_sites_hover.mock.calls[0][0]).toEqual([
      expect.objectContaining({ structure: nacl_structure, ...expected }),
    ])
    expect(on_bin_hover).toHaveBeenLastCalledWith({
      entry: expect.objectContaining({ label: `Lu-Lu` }),
      bin_idx,
    })
  })

  // Drops open through open_material, whose parse warnings reach a notice named by file
  test(`dropped crystals are plotted with their parse warnings, molecules are reported`, async () => {
    const empty = await mount_sized_rdf_plot({})
    empty.dispatchEvent(create_drop_event(new File([BAD_ROW_CIF], `si.cif`)))
    await vi.waitFor(() =>
      expect(document.querySelector(`.dropped-info`)?.textContent).toContain(
        `1 structure loaded`,
      ),
    )
    expect(document.querySelector(`.status-message.warning`)?.textContent).toMatch(
      /1 parse warning: si\.cif: CIF: skipped 1 atom-site row/,
    )
    // the populated plot is a drop zone too
    const plot = document.querySelector(`.scatter`)
    if (!plot) throw new Error(`RdfPlot did not render the dropped crystal`)
    plot.dispatchEvent(create_drop_event(new File([`1\n\nSi 0 0 0\n`], `mol.xyz`)))
    await vi.waitFor(() =>
      expect(document.body.textContent).toMatch(/mol\.xyz: no lattice or sites/),
    )
    expect(document.querySelector(`.dropped-info`)?.textContent).toContain(
      `1 structure loaded`,
    )
    // a multi-frame file opens as a trajectory and plots its first frame, saying so
    const frame = (x: number) =>
      `1\nLattice="4 0 0 0 4 0 0 0 4" Properties=species:S:1:pos:R:3 pbc="T T T"\nSi ${x} 0 0\n`
    const traj = new File([frame(0) + frame(0.1)], `traj.xyz`)
    plot.dispatchEvent(create_drop_event(traj))
    await vi.waitFor(() =>
      expect(document.querySelector(`.dropped-info`)?.textContent).toContain(
        `2 structures loaded`,
      ),
    )
    expect(document.querySelector(`.status-message.warning`)?.textContent).toMatch(
      /1 parse warning: traj\.xyz: 2 frames; plotted frame 1/,
    )
  })

  test(`reports a structure the neighbour search rejects and still plots the others`, async () => {
    const plot = await mount_sized_rdf_plot({ structures: good_and_broken() })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/broken: .*non-finite/))
  })

  test(`the failure message clears once the broken structure is removed`, async () => {
    const structures = good_and_broken()
    const target = await mount_harness({ pattern: create_synthetic_pattern(), structures })
    await vi.waitFor(() => expect(target.textContent).toMatch(/broken: .*non-finite/))
    target.querySelector<HTMLButtonElement>(`.drop-broken`)?.click()
    await vi.waitFor(() => expect(target.textContent).not.toMatch(/non-finite/))
  })

  // drop errors, structure failures and the parent's own error_msg are separate sources:
  // none may overwrite or clear another, whatever order they arrive in
  const drop_msg = `mol.xyz: no lattice or sites`
  const failure_re = /broken: .*non-finite/
  test.each<[string, string[], (string | RegExp)[], string?]>([
    [`drop error, then a cutoff change`, [`drop-broken`, `drop`, `change-cutoff`], [drop_msg]],
    [`failure, then a drop error`, [`drop`], [drop_msg, failure_re]],
    [
      `drop error, then a failure, then its fix`,
      [`drop-broken`, `drop`, `restore-structures`, `check-failure`, `drop-broken`],
      [drop_msg],
    ],
    [`parent message, then a failure fix`, [`drop-broken`], [`parent note`], `parent note`],
  ])(`keeps every error source: %s`, async (_label, steps, expected, rdf_error) => {
    const pattern = create_synthetic_pattern()
    const target = await mount_harness({ pattern, structures: good_and_broken(), rdf_error })
    const mirror = () => target.querySelector(`.rdf-error-mirror`)?.textContent ?? ``
    await vi.waitFor(() => expect(mirror()).toMatch(failure_re))
    if (rdf_error) expect(mirror()).toContain(rdf_error)
    for (const step of steps) {
      if (step === `drop`) {
        const plot = target.querySelector(`.scatter`)
        plot?.dispatchEvent(create_drop_event(new File([`1\n\nSi 0 0 0\n`], `mol.xyz`)))
        await vi.waitFor(() => expect(mirror()).toContain(drop_msg))
      } else if (step === `check-failure`) {
        await vi.waitFor(() => expect(mirror()).toMatch(failure_re))
        expect(mirror()).toContain(drop_msg)
      } else target.querySelector<HTMLButtonElement>(`.${step}`)?.click()
      await tick()
    }
    await vi.waitFor(() => {
      for (const part of expected) expect(mirror()).toMatch(part)
    })
    if (!expected.includes(failure_re)) expect(mirror()).not.toMatch(failure_re)
    // the bound error_msg and the rendered notice say the same thing
    expect(target.querySelector(`[role="alert"]`)?.textContent?.trim()).toContain(mirror())
  })

  test(`dismissing clears every error source until a new one arrives`, async () => {
    const target = await mount_harness({
      pattern: create_synthetic_pattern(),
      structures: good_and_broken(),
      rdf_error: `parent note`,
    })
    const mirror = () => target.querySelector(`.rdf-error-mirror`)?.textContent
    await vi.waitFor(() => expect(mirror()).toMatch(/^parent note; .*broken: .*non-finite/))
    target.querySelector<HTMLButtonElement>(`[role="alert"] button`)?.click()
    await vi.waitFor(() => expect(mirror()).toBe(`none`))
    expect(target.querySelector(`[role="alert"]`)).toBeNull()
    // recomputing the same failure keeps it dismissed
    target.querySelector<HTMLButtonElement>(`.change-cutoff`)?.click()
    await tick()
    expect(mirror()).toBe(`none`)
  })
})

describe(`PdfPlot`, () => {
  const nih = make_crystal(3.73, [
    [`Ni`, [0, 0, 0]],
    [`Ni`, [0, 0.5, 0.5]],
    [`Ni`, [0.5, 0, 0.5]],
    [`Ni`, [0.5, 0.5, 0]],
    [`H`, [0.5, 0, 0]],
    [`H`, [0.5, 0.5, 0.5]],
    [`H`, [0, 0, 0.5]],
    [`H`, [0, 0.5, 0]],
  ])

  // Returns the container, not the plot: the empty and error states below have no `.scatter`
  // at all, which mount_sized would reject.
  const mount_pdf_plot = async (props: ComponentProps<typeof PdfPlot>) => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const style = `width: 400px; height: 300px;`
    mount(PdfPlot, { target, props: { cutoff: 8, n_bins: 400, ...props, style } })
    await tick()
    const plot = target.querySelector<HTMLElement>(`.scatter`)
    if (plot) await resize_element(plot, 400, 300)
    return target
  }

  test.each([
    { show_controls: false, shown: false },
    { show_controls: `never`, shown: false },
    { show_controls: { mode: `never` }, shown: false },
    { show_controls: { hidden: [`controls`] }, shown: false },
    { show_controls: { mode: `hover`, style: `opacity: 0.5` }, shown: true },
  ] as const)(
    `honors PDF controls visibility: $show_controls`,
    async ({ show_controls, shown }) => {
      const target = await mount_pdf_plot({ structures: [], show_controls })
      const toolbar = target.querySelector<HTMLElement>(`.pdf-controls`)
      expect(Boolean(toolbar)).toBe(shown)
      if (shown) {
        expect(toolbar?.classList.contains(`hover-visible`)).toBe(true)
        expect(toolbar?.style.opacity).toBe(`0.5`)
        expect(toolbar?.textContent).toContain(`Cutoff`)
      }
    },
  )

  // Regression: computing the PDFs inside a $derived used to assign the error message to a
  // bindable prop, which Svelte 5 rejects with state_unsafe_mutation and which tore down the
  // whole page — a passing calc-pdf suite said nothing about it.
  test.each([`xray`, `neutron`, `electron`] as const)(
    `mounts and draws for radiation=%s`,
    async (radiation: RadiationType) => {
      const target = await mount_pdf_plot({ structures: nih, radiation })
      expect(target.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
      expect(target.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`G(r)`)
      // the weight caption must be plain text, not the <sub>-tagged formula markup
      const caption = target.querySelector(`.weights`)?.textContent ?? ``
      expect(caption).toContain(`w(H-Ni)`)
      expect(caption).not.toContain(`<`)
    },
  )

  test.each([
    { quantity: `g_r` as const, axis_label: `g(r)`, reference: `g(r) = 1` },
    { quantity: `reduced_g_r` as const, axis_label: `G(r)`, reference: `G(r) = 0` },
  ])(
    `quantity=$quantity labels the axis and reference line`,
    async ({ quantity, axis_label, reference }) => {
      const target = await mount_pdf_plot({ structures: nih, quantity })
      expect(target.querySelector(`.y-axis .axis-label`)?.textContent).toContain(axis_label)
      expect(target.textContent).toContain(reference)
    },
  )

  test(`surfaces a missing scattering length instead of the empty-state message`, async () => {
    // Po has no entry in the NIST b_coh table
    const target = await mount_pdf_plot({
      structures: make_crystal(3.35, [[`Po`, [0, 0, 0]]]),
      radiation: `neutron`,
      cutoff: 6,
      n_bins: 200,
    })
    expect(target.textContent).toContain(`No neutron scattering length for Po`)
    expect(target.querySelector(`svg[role="application"]`)).toBeNull()
    // a structure WAS supplied, so the empty-state message would contradict the error
    expect(target.textContent).not.toContain(`No structures to compute a PDF for`)
    expect((await mount_pdf_plot({})).textContent).toContain(
      `No structures to compute a PDF for`,
    )
  })

  // PdfPlot's failures come from a $derived, so they reach a binding parent through an $effect:
  // every failing structure under its label, after (never over) the parent's message
  test(`error_msg joins the parent message with each labelled failure`, async () => {
    const po_crystal = (lattice: number) => make_crystal(lattice, [[`Po`, [0, 0, 0]]])
    const target = await mount_harness({
      pattern: create_synthetic_pattern(),
      pdf_structure: { first: po_crystal(3.35), second: po_crystal(3.4) },
      pdf_error: `parent note`,
    })
    const no_b_coh = `No neutron scattering length for Po`
    await vi.waitFor(() =>
      expect(target.querySelector(`.pdf-error-mirror`)?.textContent).toMatch(
        new RegExp(`^parent note; first: .*${no_b_coh}.*; second: .*${no_b_coh}`),
      ),
    )
  })

  test.each([true, false])(
    `show_controls=%s applies to both control surfaces`,
    async (show_controls) => {
      const target = await mount_pdf_plot({ structures: nih, show_controls })
      expect(Boolean(target.querySelector(`.pdf-controls`))).toBe(show_controls)
      expect(Boolean(target.querySelector(`.plot-controls-toggle`))).toBe(show_controls)
    },
  )

  // The control panel was previously reachable only through props, so none of its buttons,
  // sliders or checkboxes were ever clicked.
  test(`quantity and radiation buttons redraw the plot`, async () => {
    const target = await mount_pdf_plot({ structures: { '&beta;-NiH': nih } })
    const click = (label: string): HTMLButtonElement => {
      const btn = [...target.querySelectorAll(`button`)].find(
        (candidate) => candidate.textContent?.trim() === label,
      )
      if (!btn) throw new Error(`No control button labelled ${label}`)
      btn.click()
      return btn
    }
    const caption = () => target.querySelector(`.weights`)?.textContent ?? ``
    const y_label = () => target.querySelector(`.y-axis .axis-label`)?.textContent ?? ``

    expect(caption()).toMatch(/^β-NiH ⟨b⟩ = /) // caller-supplied label, entities decoded
    // b_coh(H) < 0, so switching to neutrons is what flips w(H-Ni) negative. format_num emits
    // U+2212 MINUS SIGN, not ASCII hyphen.
    expect(caption()).not.toContain(`w(H-Ni) = −`)
    vi.mocked(calculate_all_pair_rdfs).mockClear()
    const neutron_btn = click(`Neutron`)
    await tick()
    expect(neutron_btn.classList.contains(`active`)).toBe(true)
    expect(caption()).toContain(`w(H-Ni) = −`)
    // radiation only re-weights the partials; the neighbour search must not re-run
    expect(calculate_all_pair_rdfs).not.toHaveBeenCalled()

    expect(y_label()).toContain(`G(r)`)
    click(`g(r)`)
    await tick()
    expect(y_label()).toContain(`g(r)`)
  })

  test(`the partials checkbox adds one curve per element pair`, async () => {
    const target = await mount_pdf_plot({ structures: nih })
    // ScatterPlot draws no legend for a lone series, so the total on its own has none
    expect(target.querySelectorAll(`.legend-label`)).toHaveLength(0)

    const checkbox = target.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    if (!checkbox) throw new Error(`Partials checkbox not rendered`)
    checkbox.click()
    await tick()

    // the total plus the three unordered H/Ni pairs
    const labels = [...target.querySelectorAll(`.legend-label`)].map((element) =>
      element.textContent?.trim(),
    )
    expect(labels).toHaveLength(4)
    for (const pair of [`H-H`, `H-Ni`, `Ni-Ni`]) {
      expect(labels.filter((label) => label?.endsWith(pair))).toHaveLength(1)
    }
  })

  test(`every curve of several structures gets its own colour`, async () => {
    // 2 structures x (total + 3 partials) = 8 curves, within the 10-colour palette
    const target = await mount_pdf_plot({
      structures: { a: nih, b: nih },
      show_partials: true,
    })
    const strokes = [...target.querySelectorAll(`.legend-item line`)].map((line) =>
      line.getAttribute(`stroke`),
    )
    expect(strokes).toHaveLength(8)
    expect(new Set(strokes).size).toBe(8)
  })
})
