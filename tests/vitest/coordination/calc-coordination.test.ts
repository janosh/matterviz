// to_structure_entries and its two types are imported from the package ROOT on purpose: they
// are the headline prop type of CoordinationBarPlot and BondAnglePlot, and the rest of
// $lib/plot/core is deliberately not published.
import { to_structure_entries } from '$lib'
import { element_by_symbol } from '$lib/element/data'
import type { StructureEntry, StructureInput } from '$lib'
import { calc_coordination_nums, CoordinationBarPlot } from '$lib/coordination'
import type { Molecule } from '$lib/structure'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_rocksalt, mount_sized } from '../setup'

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
  // Rocksalt: every ion is octahedrally coordinated by 6 counter-ions. Bonded as a finite
  // box a conventional-cell ion only sees the 3 partners inside it; the default (the
  // lattice's pbc, what the bar plot and the 3D viewer use) bonds across the faces too.
  test(`rocksalt gives CN 6 with counter-ion neighbours across periodic boundaries`, () => {
    const rocksalt = make_rocksalt()
    const bare = calc_coordination_nums(rocksalt, { pbc: [false, false, false] })
    expect(bare.coordination_nums).toEqual(Array(8).fill(3))

    const { coordination_nums, cn_histogram, cn_histogram_by_element } =
      calc_coordination_nums(rocksalt)
    expect(coordination_nums).toEqual(Array(8).fill(6))
    expect([...cn_histogram]).toEqual([[6, 8]])
    expect([...cn_histogram_by_element].map(([el, hist]) => [el, [...hist]])).toEqual([
      [`Na`, [[6, 4]]],
      [`Cl`, [[6, 4]]],
    ])
  })

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
    const result = calc_coordination_nums(isolated_atoms, { strategy: `electroneg_ratio` })
    expect(result.coordination_nums).toEqual([0, 0])
    expect(result.cn_histogram.get(0)).toBe(2)
  })

  // A site bonded to its own periodic image counts that image as a neighbour from both
  // directions: in a one-atom simple cubic cell the six images are the whole shell.
  test(`one-atom cell counts each of its own images as a neighbour`, () => {
    const radius = element_by_symbol.get(`Po`)?.covalent_radius ?? 0
    const po = make_crystal(2 * radius, [[`Po`, [0, 0, 0]]])
    const { coordination_nums, cn_histogram, cn_histogram_by_element } =
      calc_coordination_nums(po)
    expect(coordination_nums).toEqual([6])
    expect([...cn_histogram]).toEqual([[6, 1]])
    expect([...cn_histogram_by_element].map(([el, hist]) => [el, [...hist]])).toEqual([
      [`Po`, [[6, 1]]],
    ])
    // a slab under an explicit pbc override loses the two vacuum-axis images
    expect(calc_coordination_nums(po, { pbc: [true, true, false] }).coordination_nums).toEqual(
      [4],
    )
  })

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
    const result = calc_coordination_nums(struct)
    // Minority element must NOT create its own bucket for the disordered site
    expect([...result.cn_histogram_by_element.keys()]).toEqual([`Cl`, `O`])
  })

  // neighbor_query rejects a non-finite position; the wrapper must let that through rather
  // than hand the plot a histogram computed from garbage
  test(`throws on a NaN site position`, () => {
    const broken = make_crystal(5, [
      [`Na`, [0, 0, 0]],
      [`Cl`, [0.5, 0.5, 0.5]],
    ])
    broken.sites[1].xyz = [NaN, 0, 0]
    expect(() => calc_coordination_nums(broken)).toThrow(/non-finite position/)
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
    [
      `split_mode=by_structure`,
      { structures: { cubic: simple_cubic }, split_mode: `by_structure` },
    ],
    [`split_mode=none`, { structures: { cubic: simple_cubic }, split_mode: `none` }],
  ])(`renders coordination bars for %s`, async (_name, props) => {
    const root = await mount_plot(props)
    expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    expect(root.textContent).toContain(`Coordination Number`)
    expect(root.textContent).toContain(`Count`)
  })

  test.each([
    [true, `Drag and drop structure files`],
    [false, `No coordination data to display`],
  ])(`allow_file_drop=%s shows %s when empty`, async (allow_file_drop, message) => {
    const root = await mount_plot({ structures: {}, allow_file_drop })
    expect(root.textContent).toContain(message)
  })

  // neighbor_query throws on a non-finite position; an unguarded compute derived would take
  // the whole render down with it. The healthy structure next to it must still plot.
  test(`reports a NaN site as an error and keeps plotting the other structures`, async () => {
    const broken = make_crystal(5, [
      [`Na`, [0, 0, 0]],
      [`Cl`, [0.5, 0.5, 0.5]],
    ])
    broken.sites[0].xyz = [NaN, 0, 0]
    // the error StatusMessage is a sibling of the mount root, so read the whole container
    const container = (await mount_plot({ structures: { cubic: simple_cubic, broken } }))
      .parentElement
    await tick()
    expect(container?.textContent).toMatch(/broken: .*non-finite position/)
    expect(container?.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
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
