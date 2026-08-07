import { PdfPlot, RdfPlot } from '$lib'
import type { RdfPattern } from '$lib/rdf'
import type { RadiationType } from '$lib/scattering'
import type { Pbc } from '$lib/structure'
import { structure_map } from '$site/structures'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_crystal, mount_sized, resize_element } from '../setup'
import RdfPlotHarness from './RdfPlotHarness.svelte'

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
  test.each([
    [{ patterns: { label: `Test`, pattern: create_synthetic_pattern() } }],
    [
      {
        patterns: [
          { label: `P1`, pattern: create_synthetic_pattern() },
          { label: `P2`, pattern: create_synthetic_pattern(50, [3, 5], [1.8, 1.2]) },
        ],
      },
    ],
    [{ structures: nacl_structure }],
    [{ structures: [nacl_structure, pd_structure] }],
    [{ structures: { NaCl: nacl_structure, Pd: pd_structure } }],
    [{ structures: make_crystal(5, [[`Si`, [0, 0, 0]]]), mode: `full` as const }],
    [{ structures: [], patterns: [] }],
  ])(`renders %s`, async (props) => {
    const plot = await mount_sized_rdf_plot(props)
    if (`patterns` in props && Array.isArray(props.patterns) && props.patterns.length === 0) {
      expect(plot.textContent).toContain(`No RDF data to display`)
    } else {
      expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
      expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`r (Å)`)
      expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`g(r)`)
    }
  })

  test.each([
    [`element_pairs`, nacl_structure],
    [`full`, pd_structure],
    [`element_pairs`, bi2zr2o8_structure],
  ] as const)(`mode=%s`, async (mode, structure) => {
    const plot = await mount_sized_rdf_plot({ structures: structure, mode })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.textContent).toContain(`g(r) = 1`)
  })

  test.each([
    { cutoff: 1, n_bins: 20 },
    { cutoff: 10, n_bins: 100 },
    { cutoff: 20, n_bins: 200 },
  ])(
    `cutoff/n_bins %s`,
    async (opts) => {
      const plot = await mount_sized_rdf_plot({ structures: pd_structure, ...opts })
      expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
      expect(plot.querySelectorAll(`.x-axis .tick`)).not.toHaveLength(0)
      expect(plot.querySelectorAll(`.y-axis .tick`)).not.toHaveLength(0)
    },
    10_000,
  )

  test.each([[[true, true, true] as Pbc], [[false, false, false] as Pbc]])(
    `pbc=%s`,
    async (pbc) => {
      const plot = await mount_sized_rdf_plot({ structures: nacl_structure, pbc })
      expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
      expect(plot.textContent).toContain(`g(r) = 1`)
    },
  )

  test.each([[true], [false]])(`show_reference_line=%s`, async (show_ref) => {
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      show_reference_line: show_ref,
    })
    expect(plot.textContent?.includes(`g(r) = 1`)).toBe(show_ref)
  })

  test(`custom props`, async () => {
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      x_axis: { label: `Custom X` },
      y_axis: { label: `Custom Y` },
      style: `height: 500px;`,
      class: `custom-class`,
      enable_drop: true,
    })
    expect(plot.classList.contains(`custom-class`)).toBe(true)
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Custom X`)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`Custom Y`)
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

  test(`children snippet`, () => {
    let called = false
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        children: createRawSnippet(() => {
          called = true
          return { render: () => `<div class="rdf-child">RDF child content</div>` }
        }),
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.rdf-child`)?.textContent).toBe(`RDF child content`)
  })

  test(`mixed patterns and structures`, async () => {
    const plot = await mount_sized_rdf_plot({
      patterns: { label: `Test`, pattern: create_synthetic_pattern() },
      structures: nacl_structure,
      mode: `full`,
    })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.textContent).toContain(`Test`)
  })

  test(`color assignment`, async () => {
    const plot = await mount_sized_rdf_plot({
      patterns: [
        { label: `Red`, pattern: create_synthetic_pattern(), color: `red` },
        { label: `Blue`, pattern: create_synthetic_pattern(50, [3], [2]), color: `blue` },
      ],
    })
    expect(plot.textContent).toContain(`Red`)
    expect(plot.textContent).toContain(`Blue`)
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

  test(`surfaces a missing scattering length instead of crashing`, async () => {
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
  })

  // error_msg is bindable on all nine sibling plot components; PdfPlot has to reach the parent
  // through an $effect because the failure is produced inside a $derived
  test(`error_msg reaches a binding parent`, async () => {
    const target = await mount_harness({
      pattern: create_synthetic_pattern(),
      pdf_structure: make_crystal(3.35, [[`Po`, [0, 0, 0]]]),
    })
    expect(target.querySelector(`.pdf-error-mirror`)?.textContent).toContain(
      `No neutron scattering length for Po`,
    )
  })

  test(`renders a message when given no structures`, async () => {
    const target = await mount_pdf_plot({})
    expect(target.textContent).toContain(`No structures to compute a PDF for`)
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
    const target = await mount_pdf_plot({ structures: nih })
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

    // b_coh(H) < 0, so switching to neutrons is what flips w(H-Ni) negative. format_num emits
    // U+2212 MINUS SIGN, not ASCII hyphen.
    expect(caption()).not.toContain(`w(H-Ni) = −`)
    const neutron_btn = click(`Neutron`)
    await tick()
    expect(neutron_btn.classList.contains(`active`)).toBe(true)
    expect(caption()).toContain(`w(H-Ni) = −`)

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
    const labels = [...target.querySelectorAll(`.legend-label`)].map((el) =>
      el.textContent?.trim(),
    )
    expect(labels).toHaveLength(4)
    for (const pair of [`H-H`, `H-Ni`, `Ni-Ni`]) {
      expect(labels.filter((label) => label?.endsWith(pair))).toHaveLength(1)
    }
  })
})
