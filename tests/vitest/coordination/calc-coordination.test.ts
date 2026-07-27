// to_structure_entries and its two types are imported from the package ROOT on purpose: they
// are the headline prop type of CoordinationBarPlot and BondAnglePlot, and used to be
// reachable only through $lib/plot/core/structure-input.
import { to_structure_entries } from '$lib'
import type { StructureEntry, StructureInput } from '$lib'
import { calc_coordination_nums, CoordinationBarPlot } from '$lib/coordination'
import type { Molecule } from '$lib/structure'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_crystal, mount_sized } from '../setup'

// Simple cubic structure (NaCl-like)
const simple_cubic = make_crystal(5, [
  [`Na`, [0, 0, 0], 1],
  [`Cl`, [0.5, 0.5, 0.5], -1],
  [`Na`, [0.5, 0, 0], 1],
  { element: `Cl`, abc: [0, 0.5, 0.5], oxidation_state: -1 },
])
// Water, so a lattice-less molecule exercises the single-structure input shape. Built in a
// 10 Å box and stripped of its lattice, so the O-H separation stays a plain 0.958 Å.
const water: Molecule = {
  sites: make_crystal(10, [
    [`O`, [0.5, 0.5, 0.5]],
    [`H`, [0.5757, 0.5587, 0.5]],
    [`H`, [0.4243, 0.5587, 0.5]],
  ]).sites,
}

test.each([
  [`lone crystal`, simple_cubic, [`Structure`]],
  // detected by its `sites` array, not is_crystal(): a lattice-less molecule used to be read
  // as a Record of structures, which then blew up on Object.entries of its sites array
  [`lone lattice-less molecule`, water, [`Structure`]],
  [`record`, { cubic: simple_cubic, water }, [`cubic`, `water`]],
  [
    `record with per-entry color`,
    { cubic: { structure: simple_cubic, color: `#f00` } },
    [`cubic`],
  ],
  [`entry array`, [{ label: `cubic`, structure: simple_cubic }], [`cubic`]],
])(`to_structure_entries labels a %s`, (_name, input: StructureInput, labels) => {
  const entries: StructureEntry[] = to_structure_entries(input)
  expect(entries.map((entry) => entry.label)).toEqual(labels)
  expect(entries.every((entry) => entry.structure.sites.length > 0)).toBe(true)
})

describe(`calc_coordination_nums`, () => {
  test.each([`electroneg_ratio`] as const)(
    `computes per-element coordination (%s)`,
    (strategy) => {
      const result = calc_coordination_nums(simple_cubic, strategy)
      expect(result.sites).toHaveLength(4)
      expect(result.cn_histogram.size).toBeGreaterThan(0)
      expect(result.cn_by_element.size).toBe(2) // Na and Cl
      for (const elem of [`Na`, `Cl`] as const) {
        expect(result.cn_by_element.has(elem)).toBe(true)
        expect(result.cn_histogram_by_element.has(elem)).toBe(true)
      }
    },
  )

  test(`should handle structure with distant atoms`, () => {
    const isolated_atoms = make_crystal(
      100,
      [
        [`H`, [0, 0, 0]],
        [`He`, [0.5, 0.5, 0.5]],
      ],
      { pbc: [false, false, false] },
    )

    // With atoms 50 Å apart, no bonds should form with default electroneg_ratio strategy
    const result = calc_coordination_nums(isolated_atoms, `electroneg_ratio`)

    expect(result.sites).toHaveLength(2)
    // Both atoms should have CN = 0 since they are too far apart for bonding
    const cn_values = result.sites.map((site) => site.coordination_num)
    expect(cn_values.every((cn) => cn === 0)).toBe(true)
    expect(result.cn_histogram.get(0)).toBe(2)
  })

  // PBC-expanded structures append image atoms after the originals and pass the
  // original-atom count as center_count; only the originals must appear as centers.
  test.each([
    [undefined, 4],
    [2, 2],
    [1, 1],
  ])(
    `center_count=%s restricts per-site data/histograms to %s centers`,
    (center_count, expected) => {
      const result = calc_coordination_nums(simple_cubic, `electroneg_ratio`, center_count)
      expect(result.sites).toHaveLength(expected)
      const histogram_total = [...result.cn_histogram.values()].reduce((sum, n) => sum + n, 0)
      expect(histogram_total).toBe(expected)
    },
  )

  test(`buckets disordered sites by majority element, not species[0]`, () => {
    const struct = make_crystal(3, [
      [`Cl`, [0, 0, 0]],
      [`O`, [0.5, 0.5, 0.5]],
    ])
    // Disordered site whose minority species (Na) is listed first
    struct.sites[0].species = [
      { element: `Na`, occu: 0.3, oxidation_state: 0 },
      { element: `Cl`, occu: 0.7, oxidation_state: 0 },
    ]
    const result = calc_coordination_nums(struct, `electroneg_ratio`)
    expect(result.cn_by_element.has(`Cl`)).toBe(true)
    expect(result.cn_histogram_by_element.has(`Cl`)).toBe(true)
    // Minority element must NOT create its own bucket for the disordered site
    expect(result.cn_by_element.has(`Na`)).toBe(false)
    expect(result.sites[0].element).toBe(`Cl`)
  })
})

// Mounting BarPlot in happy-dom costs seconds, so every case here earns its mount
describe(`CoordinationBarPlot`, { timeout: 30_000 }, () => {
  const mount_plot = (props: Record<string, unknown>) =>
    mount_sized(CoordinationBarPlot, props, {
      selector: `.bar-plot, .status-message, section`,
    })

  test.each([
    [`single crystal`, { structures: simple_cubic }],
    [`single lattice-less molecule`, { structures: water }],
    [`record of structures`, { structures: { cubic: simple_cubic } }],
    [`array of entries`, { structures: [{ label: `cubic`, structure: simple_cubic }] }],
  ])(`renders coordination bars for %s`, async (_name, props) => {
    const root = await mount_plot(props)
    expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    expect(root.textContent).toContain(`Coordination Number`)
    expect(root.textContent).toContain(`Count`)
  })

  test.each([`by_structure`, `none`] as const)(
    `split_mode=%s renders without error`,
    async (split_mode) => {
      const root = await mount_plot({ structures: { cubic: simple_cubic }, split_mode })
      expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    },
  )

  test.each([
    [true, `Drag and drop structure files`],
    [false, `No coordination data to display`],
  ])(`allow_file_drop=%s shows %s when empty`, async (allow_file_drop, message) => {
    const root = await mount_plot({ structures: {}, allow_file_drop })
    expect(root.textContent).toContain(message)
  })

  // Series identity (element here, triplet in BondAnglePlot) reaches the tooltip as string
  // metadata that StructureBarPlot turns into a `value —` prefix. Both wrappers rely on the
  // shell for it, so nothing in either component would notice if the prefix disappeared.
  test(`tooltip prefixes the hovered bar with its string metadata`, async () => {
    const root = await mount_plot({ structures: simple_cubic })
    const bar = root.querySelector(`path[role="button"]`)
    expect(bar).toBeInstanceOf(SVGPathElement)
    bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    const tooltip = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(tooltip).toMatch(/^\s*(?<element>Cl|Na)\s+—/)
    expect(tooltip).toContain(`CN:`)
  })
})
