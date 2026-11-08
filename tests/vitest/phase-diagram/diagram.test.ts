import {
  diagram_errors,
  diagram_name,
  diagram_points,
  format_reaction,
  observation_markers,
  phase_colors,
  phase_labeler,
  provenance_caption,
  region_label,
  temperature_extent,
} from '#lib/phase-diagram/diagram.js'
import type { BinaryPhase, BinaryPhaseDiagram } from '#lib/phase-diagram/index.js'
import { LIQUID_COLOR, SOLID_PHASE_PALETTE } from '#lib/phase-diagram/utils.js'
import { binary_diagrams, observations_for } from '#site/phase-diagrams.js'
import { describe, expect, test } from 'vitest'
import { eutectic, observations, pts, rect, shifted_eutectic } from './fixtures/test-data'

describe(`diagram_errors`, () => {
  test(`a valid diagram, with or without regions, has none`, () => {
    expect(diagram_errors(eutectic)).toEqual([])
    const { regions: _regions, ...boundaries_only } = eutectic
    expect(diagram_errors(boundaries_only)).toEqual([])
  })

  // every phase reference is checked, so label/color lookups by id never miss
  test.each<[string, Partial<BinaryPhaseDiagram>, string]>([
    [`format`, { format: `x` as `binary-phase-diagram/2` }, `format is "x"`],
    [
      `components`,
      { components: [`A`] as unknown as [string, string] },
      `components must be two strings`,
    ],
    [`temperature range`, { temperature_range: [900, 300] }, `temperature_range must be`],
    [`missing array`, { invariants: undefined }, `invariants must be an array`],
    [
      `duplicate phase`,
      { phases: [...eutectic.phases, eutectic.phases[0]] },
      `duplicate phase id "LIQUID"`,
    ],
    [
      `region phase`,
      { regions: [{ phases: [`GAS`], vertices: rect(0, 0, 1, 1) }] },
      `regions[0] references unknown phase GAS`,
    ],
    [
      `region vertices`,
      { regions: [{ phases: [`A`], vertices: pts(0, 0, 1, 1) }] },
      `regions[0] has 2 vertices`,
    ],
    [
      `boundary kind`,
      { boundaries: [{ kind: `tie-line` as `solvus`, phases: [], points: pts(0, 0, 1, 1) }] },
      `boundaries[0] has unknown kind "tie-line"`,
    ],
    [
      `boundary side`,
      {
        boundaries: [
          { kind: `liquidus`, phases: [`A`, `LIQUID`], side: `B`, points: pts(0, 0, 1, 1) },
        ],
      },
      `boundaries[0] side "B" is not one of its phases`,
    ],
    [
      `reaction id`,
      { invariants: [{ ...eutectic.invariants[0], reaction: `LIQUID -> A + GAS` }] },
      `invariants[0] references unknown phase GAS`,
    ],
    [
      `invariant compositions`,
      { invariants: [{ ...eutectic.invariants[0], compositions: [0.5] }] },
      `invariants[0] has 3 phases but 1 compositions`,
    ],
    [
      `critical phase`,
      { critical_points: [{ temperature: 1, composition: 0.5, phase: `C` }] },
      `critical_points[0] references unknown phase C`,
    ],
    [
      `unary component`,
      {
        unary_transitions: [
          { component: `Zn`, temperature: 700, above: `LIQUID`, below: `A` },
        ],
      },
      `unary_transitions[0] component "Zn" is not a diagram component`,
    ],
  ])(`reports a bad %s`, (_label, patch, message) => {
    expect(diagram_errors({ ...eutectic, ...patch }).join(`; `)).toContain(message)
  })
})

test(`format_reaction, region_label and phase_labeler use phase labels`, () => {
  const label_of = phase_labeler(eutectic)
  expect(format_reaction(`LIQUID -> A + B`, label_of)).toBe(`L → α + β`)
  expect(format_reaction(`LIQUID + A -> B`, label_of)).toBe(`L + α → β`)
  expect(region_label(eutectic.regions?.[1] ?? null, label_of)).toBe(`α + β`)
  expect(region_label(null, label_of)).toBe(`–`)
  expect(() => label_of(`GAS`)).toThrow(`Unknown phase id "GAS"`)
})

describe(`phase_colors`, () => {
  const phase = (id: string, model_phase = id, kind: BinaryPhase[`kind`] = `solid`) => ({
    id,
    model_phase,
    label: id,
    kind,
  })
  const ag_cu = [
    phase(`LIQUID`, `LIQUID`, `liquid`),
    phase(`FCC_A1#1`, `FCC_A1`),
    phase(`FCC_A1#2`, `FCC_A1`),
  ]

  test(`liquid is sky blue, composition sets of one phase get distinct palette slots`, () => {
    const colors = phase_colors(ag_cu)
    expect(colors.get(`LIQUID`)).toBe(LIQUID_COLOR)
    const [fcc_1, fcc_2] = [colors.get(`FCC_A1#1`), colors.get(`FCC_A1#2`)]
    expect(SOLID_PHASE_PALETTE).toContain(fcc_1)
    expect(SOLID_PHASE_PALETTE).toContain(fcc_2)
    expect(fcc_1).not.toBe(fcc_2)
  })

  // stable across diagrams: a pure function of the phase list, independent of its order
  test(`does not depend on phase order`, () => {
    expect(phase_colors(ag_cu.toReversed())).toEqual(phase_colors(ag_cu))
  })

  test(`many phases all get distinct colors up to the palette size`, () => {
    const phases = SOLID_PHASE_PALETTE.map((_, idx) => phase(`P${idx}`))
    expect(new Set(phase_colors(phases).values()).size).toBe(SOLID_PHASE_PALETTE.length)
  })
})

test(`diagram_points describes invariant, congruent, critical and unary points`, () => {
  const points = diagram_points({
    ...eutectic,
    congruent_points: [{ temperature: 800, composition: 0.4, phases: [`LIQUID`, `A`] }],
    critical_points: [{ temperature: 400, composition: 0.6, phase: `B` }],
    unary_transitions: [
      { component: `Al`, temperature: 933, above: `LIQUID`, below: `A` },
      { component: `Cu`, temperature: 700, above: `A`, below: `B` },
    ],
  })
  expect(
    points.map(({ category, kind, composition, marker_label, description }) => [
      category,
      kind,
      composition,
      marker_label,
      description,
    ]),
  ).toEqual([
    [`invariant`, `eutectic`, 0.5, `E`, `L → α + β`],
    [`congruent`, `congruent`, 0.4, ``, `L ⇌ α without composition change`],
    [`critical`, `critical`, 0.6, ``, `β miscibility gap closes`],
    [`unary`, `melting`, 0, `Tₘ(Al)`, `Al: L → α`],
    [`unary`, `transition`, 1, ``, `Cu: α → β`],
  ])
})

test(`observation_markers puts each phase on the row's isotherm and pure rows on their edge`, () => {
  const markers = observation_markers(observations, eutectic.components)
  expect(
    markers.map(({ row, composition, temperature }) => [row.id, composition, temperature]),
  ).toEqual([
    [`Al-Cu:eutectic`, 0.45, 520],
    [`Al-Cu:eutectic`, 0.1, 520],
    [`Al-Cu:eutectic`, 0.9, 520],
    [`Cu:melting`, 1, 900],
  ])
  expect(markers[3].phase).toBeNull()
  // a pure-component row of another system has no edge to sit on (callers filter the rest)
  const other = observation_markers(observations, [`Ag`, `Au`])
  expect(other.map(({ row }) => row.id)).not.toContain(`Cu:melting`)
})

test(`diagram_name, provenance_caption and temperature_extent`, () => {
  expect([diagram_name(eutectic), diagram_name(shifted_eutectic)]).toEqual([
    `Assessment`,
    `Model: test-model`,
  ])
  expect(provenance_caption(eutectic)).toBe(`test fixture`)
  expect(provenance_caption(shifted_eutectic)).toBe(``)
  const wide = { ...shifted_eutectic, temperature_range: [-50, 1200] as [number, number] }
  expect(temperature_extent([eutectic, wide])).toEqual([-50, 1200])
})

// the site's demo diagrams (converted or script-built) must all render
describe(`site demo diagrams`, () => {
  test.each(Object.entries(binary_diagrams))(`%s is valid`, (_name, diagram) => {
    expect(diagram_errors(diagram)).toEqual([])
  })

  // script-built fixtures tile the composition-temperature window: every sample point lies in
  // exactly one region, and two-phase regions list their phases left to right
  test.each([`Ag-Cu`, `Ag-Cu-model`, `Mg-Si`, `Au-Ni`])(
    `%s regions tile the plane`,
    (name) => {
      const diagram = binary_diagrams[name]
      const [t_min, t_max] = diagram.temperature_range
      const regions = diagram.regions ?? []
      for (let ix = 0; ix < 40; ix++) {
        for (let it = 0; it < 40; it++) {
          const [x_val, temp] = [(ix + 0.5) / 40, t_min + ((it + 0.5) / 40) * (t_max - t_min)]
          const hits = regions.filter(({ vertices }) => point_in(x_val, temp, vertices))
          expect(hits, `${name} at (${x_val}, ${temp})`).toHaveLength(1)
        }
      }
    },
  )

  test(`Ag-Cu observations include the eutectic and both melting points`, () => {
    const ids = observations_for(binary_diagrams[`Ag-Cu`].components).map(({ id }) => id)
    expect(ids.toSorted()).toEqual([`Ag-Cu:eutectic`, `Ag:melting`, `Cu:melting`])
  })
})

// even-odd ray cast, independent of the library implementation under test
function point_in(x_val: number, y_val: number, vertices: [number, number][]): boolean {
  let inside = false
  for (let idx = 0, prev = vertices.length - 1; idx < vertices.length; prev = idx++) {
    const [x_a, y_a] = vertices[idx]
    const [x_b, y_b] = vertices[prev]
    if (
      y_a > y_val !== y_b > y_val &&
      x_val < ((x_b - x_a) * (y_val - y_a)) / (y_b - y_a) + x_a
    ) {
      inside = !inside
    }
  }
  return inside
}
