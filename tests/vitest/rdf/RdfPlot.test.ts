import { RdfPlot } from '$lib'
import type { RdfPattern } from '$lib/rdf'
import type { Pbc } from '$lib/structure'
import { structure_map } from '$site/structures'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

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
  const r = Array.from({ length: n_points }, (_, idx) => (idx + 1) * 0.2)
  const g_r = r.map((r_val) => {
    let g_val = 1 - Math.exp(-r_val / 2)
    for (let idx = 0; idx < peaks.length; idx++) {
      g_val += heights[idx] * Math.exp(-((r_val - peaks[idx]) ** 2) / 0.3)
    }
    return g_val
  })
  return { r, g_r, element_pair: [`Li`, `O`] }
}

async function mount_sized_rdf_plot(
  props: ComponentProps<typeof RdfPlot>,
): Promise<HTMLElement> {
  mount(RdfPlot, {
    target: document.body,
    props: { ...props, style: `width: 400px; height: 300px; ${props.style ?? ``}` },
  })
  const plot = document.querySelector<HTMLElement>(`.scatter, .empty-drop`)
  if (!plot) throw new Error(`RdfPlot root element not found`)
  if (plot.classList.contains(`scatter`)) {
    Object.defineProperty(plot, `clientWidth`, { value: 400, configurable: true })
    Object.defineProperty(plot, `clientHeight`, { value: 300, configurable: true })
    plot.dispatchEvent(new Event(`resize`))
    await tick()
  }
  return plot
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
    [{ cutoff: 1, n_bins: 20 }],
    [{ cutoff: 10, n_bins: 100 }],
    [{ cutoff: 20, n_bins: 200 }],
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

  test(`single atom structure`, async () => {
    const single_atom = make_crystal(5, [[`Si`, [0, 0, 0]]])
    const plot = await mount_sized_rdf_plot({ structures: single_atom, mode: `full` })
    expect(plot.querySelector(`svg[role="application"]`)).toBeInstanceOf(SVGSVGElement)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`g(r)`)
  })
})
