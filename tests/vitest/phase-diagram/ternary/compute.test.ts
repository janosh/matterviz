import type { PhaseData } from '$lib/convex-hull/types'
import {
  compute_section,
  compute_ternary_phase_diagram,
  create_section_evaluator,
  decompose_composition,
  decompose_phase,
  format_reaction,
  prepare_diagram,
} from '$lib/phase-diagram/ternary/compute'
import type { TernaryPhaseDiagram } from '$lib/phase-diagram/ternary/types'
import { describe, expect, test } from 'vitest'
import { load_json } from '../../setup'
import { phase, toy_elements, toy_entries, toy_temps } from './fixtures'

const labels = (diagram: Pick<TernaryPhaseDiagram, `phases`>, idxs: number[]) =>
  idxs.map((idx) => diagram.phases[idx].label).toSorted()
const reactions = (diagram: TernaryPhaseDiagram, idx: number) =>
  diagram.events[idx].reactions.map((rxn) => format_reaction(diagram, rxn)).toSorted()
// Sections from the cached evaluator must match from-scratch hulls (outside the bisection
// tolerance around transitions)
const expect_evaluator_matches = (
  entries: PhaseData[],
  diagram: TernaryPhaseDiagram,
  temps: number[],
) => {
  const model = prepare_diagram(entries, { elements: diagram.elements })
  const evaluator = create_section_evaluator(model, diagram)
  for (const temperature of temps) {
    const [fast, slow] = [
      evaluator.section_at(temperature),
      compute_section(model, temperature),
    ]
    expect(fast.stable).toEqual(slow.stable)
    expect(fast.edges).toEqual(slow.edges)
    const max_diff = Math.max(
      ...slow.e_above_hull.map((val, idx) =>
        Number.isNaN(val)
          ? Number(!Number.isNaN(fast.e_above_hull[idx]))
          : Math.abs(val - fast.e_above_hull[idx]),
      ),
    )
    expect(max_diff).toBeLessThan(1e-9)
  }
}
// Replaying the events must reproduce every sampled stable set (re-anchored after a data gap)
const expect_events_consistent = (diagram: TernaryPhaseDiagram) => {
  let [stable, event_idx]: [number[] | null, number] = [null, 0]
  for (const section of diagram.sections) {
    while (diagram.events[event_idx]?.temperature < section.temperature)
      stable = diagram.events[event_idx++].stable_after
    if (section.stable.length === 0) stable = null
    else if (stable) expect(section.stable).toEqual(stable)
    else stable = section.stable
  }
  for (const [idx, windows] of diagram.stability_windows.entries()) {
    for (const [lo, hi] of windows) expect(hi).toBeGreaterThan(lo)
    expect(windows.length > 0).toBe(
      diagram.sections.some((section) => section.stable.includes(idx)),
    )
  }
}

describe(`prepare_diagram`, () => {
  test(`orders corners, appends synthetic elements and places phases`, () => {
    const model = prepare_diagram(toy_entries, { elements: toy_elements })
    expect(model.phases.map((entry) => entry.label)).toEqual([
      `NaLi`,
      `KLi`,
      `KNa`,
      `KNaLi`,
      `Li`,
      `Na`,
      `K`,
    ])
    expect(model.phases[4]).toMatchObject({
      xy: [1, 0],
      is_element: true,
      entry: { entry_id: `synthetic-element:Li` },
    })
    expect(model.phases[3].barycentric.map((val) => val.toFixed(4))).toEqual([
      `0.3333`,
      `0.3333`,
      `0.3333`,
    ])
    expect(model.phases[3].n_atoms).toBe(3)
    expect(model.t_range).toEqual([300, 1500])
    expect(prepare_diagram(toy_entries).elements).toEqual([`K`, `Na`, `Li`]) // electronegativity
  })

  test.each([
    [[phase({ Li: 1, Na: 1 }, -0.5)], undefined, /exactly 3 elements, got 2/],
    [[phase({ Li: 1, Na: 1, K: 1, Rb: 1 }, -0.5)], undefined, /exactly 3 elements, got 4/],
    [[...toy_entries, phase({ Rb: 1 }, 0)], toy_elements, /outside the Li-Na-K system/],
    [[{ composition: {}, energy: 0 }], toy_elements, /no recognizable elements/],
  ])(`rejects invalid systems (%#)`, (entries, elements, message) => {
    expect(() => prepare_diagram(entries, { elements })).toThrow(message)
  })
})

describe(`compute_section`, () => {
  const model = prepare_diagram(toy_entries, { elements: toy_elements })

  test(`hull, hull distances and lever rule at 300 K and 1400 K`, () => {
    const low = compute_section(model, 300)
    expect(low.stable).toEqual([0, 1, 2, 4, 5, 6])
    expect([low.facets.length, low.edges.length]).toEqual([4, 9])
    expect(low.e_above_hull[3]).toBeCloseTo(-0.35 - (-0.5 - 0.3 - 0.3) / 3, 10)
    expect(low.e_above_hull[0]).toBe(0)
    expect(decompose_phase(model, low, 3)?.phases).toEqual([0, 1, 2])
    expect(decompose_phase(model, low, 0)).toEqual({ phases: [0], fractions: [1] })
    const high = compute_section(model, 1400)
    expect(high.stable).toEqual([1, 2, 3, 4, 5, 6])
    expect(high.e_above_hull[0]).toBeCloseTo(-0.5 + 0.0005 * 1100, 10)
    expect(decompose_phase(model, high, 0)).toEqual({ phases: [4, 5], fractions: [0.5, 0.5] })
    // Centroid of the A-AB-AC facet: equal thirds
    const centroid = [0, 1].map(
      (axis) =>
        (model.phases[4].xy[axis] + model.phases[0].xy[axis] + model.phases[1].xy[axis]) / 3,
    ) as [number, number]
    const result = decompose_composition(model, low, centroid)
    expect(result?.phases).toEqual([0, 1, 4])
    for (const frac of result?.fractions ?? []) expect(frac).toBeCloseTo(1 / 3, 8)
    expect(decompose_composition(model, low, [2, 2])).toBeNull()
  })

  test(`edge cases: only elements, data range, exclude_from_hull`, () => {
    const elements_only = prepare_diagram(
      [phase({ Li: 1 }, -1), phase({ Na: 1 }, -1), phase({ K: 1 }, -1)],
      { elements: toy_elements },
    )
    expect(compute_section(elements_only, 500)).toMatchObject({
      facets: [[0, 1, 2]],
      e_above_hull: new Float64Array([0, 0, 0]),
    })
    const out_of_range = compute_section(model, 1500.5)
    expect(out_of_range.e_above_hull[0]).toBeNaN()
    expect(out_of_range.stable).not.toContain(0)
    const excluded = prepare_diagram(
      [...toy_entries, phase({ Li: 3, Na: 1 }, -5, { exclude_from_hull: true })],
      { elements: toy_elements },
    )
    const section = compute_section(excluded, 300)
    expect(section.stable).not.toContain(4)
    expect(section.e_above_hull[4]).toBeLessThan(0) // below a hull it is not part of
    // An excluded element neither anchors the hull (a synthetic corner does) nor sets the
    // formation-energy zero
    const excluded_li = prepare_diagram(
      [...toy_entries, phase({ Li: 1 }, -3, { exclude_from_hull: true })],
      { elements: toy_elements },
    )
    expect(excluded_li.phases.map(({ label }) => label)).toContain(`Li`)
    expect(excluded_li.phases).toHaveLength(8)
    expect(compute_section(excluded_li, 300).stable).toEqual([0, 1, 2, 5, 6, 7])
    expect(compute_section(excluded_li, 300).e_above_hull[4]).toBe(-3)
  })
})

describe(`compute_ternary_phase_diagram`, () => {
  const diagram = compute_ternary_phase_diagram(toy_entries, { elements: toy_elements })

  test(`samples, transitions, reactions and windows of the toy system`, () => {
    expect(diagram.temperatures).toEqual(expect.arrayContaining(toy_temps))
    expect(diagram.sources).toEqual([`tabulated`, `static`])
    expect(
      diagram.events.map((event) => [Math.round(event.temperature * 2) / 2, event.kind]),
    ).toEqual([
      [400, `appear`],
      [850, `tie_line_flip`],
      [1300, `vanish`],
    ])
    for (const [idx, target] of [400, 850, 1300].entries())
      expect(Math.abs(diagram.events[idx].temperature - target)).toBeLessThanOrEqual(0.5)
    expect(reactions(diagram, 0)).toEqual([`NaLi + KLi + KNa → 2 KNaLi`])
    expect(reactions(diagram, 1)).toEqual([
      `NaLi + KLi → KNaLi + Li`,
      `NaLi + KNa → KNaLi + Na`,
    ])
    expect(diagram.events[1]).toMatchObject({
      appeared: [],
      vanished: [],
      edges_added: [expect.anything(), expect.anything()],
    })
    expect(reactions(diagram, 2)).toEqual([`NaLi → Li + Na`])
    expect(
      diagram.stability_windows.map((windows) =>
        windows.map(([lo, hi]) => [Math.round(lo), Math.round(hi)]),
      ),
    ).toEqual([
      [[300, 1300]],
      [[300, 1500]],
      [[300, 1500]],
      [[400, 1500]],
      [[300, 1500]],
      [[300, 1500]],
      [[300, 1500]],
    ])
    expect_events_consistent(diagram)
    expect_evaluator_matches(
      toy_entries,
      diagram,
      [300, 399, 401, 849, 851, 1000, 1299, 1301, 1500],
    )
  })

  test(`data gaps: a sweep wider than a tabulated reference stays consistent`, () => {
    // A flat Li table over 500-1100 K leaves the energetics alone but undefines the hull in
    // 300-500 and 1100-1500 K
    const li_tab = phase({ Li: 1 }, 0, {
      temperatures: [500, 800, 1100],
      free_energies: [0, 0, 0],
    })
    const entries = [...toy_entries, li_tab]
    const wide = compute_ternary_phase_diagram(entries, {
      elements: toy_elements,
      t_range: [300, 1500],
      n_samples: 7, // 300, 500, ..., 1500 plus the knots
    })
    const valid = (temp: number) => temp >= 500 && temp <= 1100
    for (const section of wide.sections)
      expect(section.stable.length > 0).toBe(valid(section.temperature))
    // The 850 K flip lies inside the gap-free range; the 400/1300 K events are out of data
    expect(wide.events.map((event) => Math.round(event.temperature))).toEqual([850])
    expect(wide.stability_windows[3]).toEqual([[500, 1100]]) // ABC: whole valid range
    expect_events_consistent(wide)
    expect_evaluator_matches(entries, wide, [300, 499, 500, 700, 849, 851, 1100, 1101, 1500])
  })

  test(`options: coarse grid without bisection, explicit range, progress, static data`, () => {
    const coarse = compute_ternary_phase_diagram(toy_entries, {
      elements: toy_elements,
      event_tolerance: 0,
      temperatures: [300, 600, 900, 1200, 1500],
    })
    expect(coarse.events.map((event) => event.temperature)).toEqual([450, 750, 1350])
    const seen: number[] = []
    const narrow = compute_ternary_phase_diagram(
      toy_entries,
      { elements: toy_elements, t_range: [500, 700], n_samples: 3 },
      ({ done }) => seen.push(done),
    )
    expect(narrow.temperatures).toEqual([500, 600, 700])
    expect(seen).toEqual([1, 2, 3])
    expect(narrow.events).toEqual([])
    expect(narrow.stability_windows[3]).toEqual([[500, 700]])
    const frozen = compute_ternary_phase_diagram(
      toy_entries.map(({ temperatures: _t, free_energies: _g, ...rest }) => rest),
      { elements: toy_elements },
    )
    expect(frozen).toMatchObject({ sources: [`static`], events: [], t_range: [300, 1500] })
  })
})

// Materials Project Li-Co-O (457 entries with structures) under the SISSO model: the classic
// high-temperature reductions must fall out of the sweep
describe(`Li-Co-O with the SISSO model`, () => {
  const entries = load_json<PhaseData[]>(
    `${import.meta.dirname}/../../../../src/site/convex-hull/quaternaries/Li-Co-Ni-O.json.gz`,
  ).filter((entry) =>
    Object.entries(entry.composition).every(
      ([el, amt]) => amt <= 0 || [`Li`, `Co`, `O`].includes(el),
    ),
  )
  const diagram = compute_ternary_phase_diagram(entries, { n_samples: 35 })
  const vanish_of = (label: string) =>
    diagram.events.find((event) =>
      event.vanished.some((idx) => diagram.phases[idx].label === label),
    )
  const reaction_of = (label: string) => {
    const reaction = vanish_of(label)?.reactions.find(
      (rxn) => rxn.phase !== undefined && diagram.phases[rxn.phase].label === label,
    )
    return reaction && format_reaction(diagram, reaction)
  }

  test(`oxides reduce on heating; Li2O and CoO survive to 2000 K`, () => {
    expect([entries.length, diagram.elements, diagram.sources]).toEqual([
      457,
      [`Li`, `Co`, `O`],
      [`sisso`],
    ])
    // Li2O2 (reduced formula LiO) → Li2O + O2 near 420 K, Co3O4 → CoO near 1430 K
    expect(vanish_of(`LiO`)?.temperature).toBeGreaterThan(350)
    expect(vanish_of(`LiO`)?.temperature).toBeLessThan(600)
    expect(reaction_of(`LiO`)).toBe(`2 LiO → O + Li2O`)
    expect(vanish_of(`Co3O4`)?.temperature).toBeGreaterThan(1200)
    expect(vanish_of(`Co3O4`)?.temperature).toBeLessThan(1700)
    expect(reaction_of(`Co3O4`)).toMatch(/^Co3O4 → .*CoO/)
    const final = labels(diagram, diagram.sections.at(-1)?.stable ?? [])
    expect(final).toEqual(expect.arrayContaining([`Li2O`, `CoO`, `Li`, `Co`, `O`]))
    expect(final).not.toContain(`Co3O4`)
    const polymorph = diagram.events.find((event) => event.kind === `polymorph`)
    expect(
      polymorph?.reactions[0] && format_reaction(diagram, polymorph.reactions[0]),
    ).toMatch(/^(?<f>\w+) \(mp-[\w+-]+\) → \k<f> \(mp-[\w+-]+\)$/)
    expect_events_consistent(diagram)
    expect_evaluator_matches(entries, diagram, [300, 417, 666, 1000, 1430, 1432, 1777, 2000])
  })

  test(`static mode reproduces the Materials Project stable set at every T`, () => {
    const frozen = compute_ternary_phase_diagram(entries, {
      n_samples: 3,
      free_energy: { mode: `static` },
    })
    const mp_stable = [
      ...new Set(
        entries
          .filter((entry) => entry.is_stable)
          .map(
            (entry) =>
              frozen.phases.find((ph) => ph.entry.entry_id === entry.entry_id)?.label ?? ``,
          ),
      ),
    ].toSorted()
    expect(frozen.events).toEqual([])
    for (const section of frozen.sections)
      expect(labels(frozen, section.stable)).toEqual(mp_stable)
  })
})
