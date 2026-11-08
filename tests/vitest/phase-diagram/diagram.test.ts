import {
  diagram_errors,
  diagram_name,
  diagram_points,
  format_hover_info_text,
  format_reaction,
  observation_markers,
  phase_colors,
  phase_labeler,
  provenance_caption,
  region_label,
  temperature_extent,
} from '#lib/phase-diagram/diagram.js'
import type { BinaryPhase, BinaryPhaseDiagram } from '#lib/phase-diagram/index.js'
import {
  calculate_lever_rule,
  find_region_at,
  LIQUID_COLOR,
  SOLID_PHASE_PALETTE,
} from '#lib/phase-diagram/utils.js'
import { binary_diagrams, binary_observations } from '#site/phase-diagrams.js'
import { describe, expect, test } from 'vitest'
import {
  create_hover_info,
  eutectic,
  eutectic_regions,
  lever_rule,
  observations,
  pts,
  rect,
  shifted_eutectic,
} from './fixtures/test-data'

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
      `invariants[0] reaction references unknown phase GAS`,
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
    [
      `range length`,
      { temperature_range: [0, 1, 2] as unknown as [number, number] },
      `temperature_range must be`,
    ],
    [`provenance`, { provenance: undefined }, `provenance must be an object`],
    [
      `phase fields`,
      { phases: [...eutectic.phases, { id: `C`, label: `γ` } as BinaryPhase] },
      `phases[3] needs string id, label and model_phase; phases[3] kind must be`,
    ],
    [
      `null points`,
      { boundaries: [{ kind: `solvus`, phases: [`A`, `B`], points: [null, null] as never }] },
      `boundaries[0] points must be [x, T] number pairs`,
    ],
    [
      `magnetic phases`,
      { boundaries: [{ kind: `magnetic`, phases: [`A`, `B`], points: pts(0, 0, 1, 1) }] },
      `boundaries[0] is magnetic: one phase and no side`,
    ],
    [
      `invariant kind`,
      { invariants: [{ ...eutectic.invariants[0], kind: `catatectic` as `eutectic` }] },
      `invariants[0] has unknown kind "catatectic"`,
    ],
    [
      `invariant temperature`,
      { invariants: [{ ...eutectic.invariants[0], temperature: null as unknown as number }] },
      `invariants[0] needs a finite temperature and composition`,
    ],
  ])(`reports a bad %s`, (_label, patch, message) => {
    expect(diagram_errors({ ...eutectic, ...patch }).join(`; `)).toContain(message)
  })

  // untrusted JSON never makes validation throw, and emitter failure records say why
  test.each<[unknown, string]>([
    [null, `a diagram is a JSON object, got null`],
    [[1, 2], `a diagram is a JSON object, got [1,2]`],
    [{ error: `no convergence`, expected: true }, `emitter failure record: no convergence`],
    [{ ...eutectic, regions: [{ phases: `A`, vertices: 3 }] }, `regions[0] phases must be`],
  ])(`untrusted value %j`, (value, message) => {
    expect(diagram_errors(value).join(`; `)).toContain(message)
  })

  test(`a magnetic line inside one phase is valid`, () => {
    const magnetic = {
      kind: `magnetic` as const,
      phases: [`A`],
      points: pts(0, 400, 0.2, 380),
    }
    expect(diagram_errors({ ...eutectic, boundaries: [magnetic] })).toEqual([])
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
  // the reversed system mirrors compositions and moves the pure-Cu point to the other edge
  const mirrored = observation_markers(observations, [`Cu`, `Al`])
  const expected = [0.55, 0.9, 0.1, 0]
  expect(mirrored).toHaveLength(expected.length)
  mirrored.forEach(({ composition }, idx) =>
    expect(composition).toBeCloseTo(expected[idx], 12),
  )
  // rows of other systems draw nothing
  expect(observation_markers(observations, [`Ag`, `Au`])).toEqual([])
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

describe(`format_hover_info_text`, () => {
  test.each([
    { composition: 0.35, unit: `at%`, expected: `Composition: 35 at% Cu (65 at% Al)` },
    { composition: 0.456, unit: `fraction`, expected: `Composition: 0.456 Cu (0.544 Al)` },
    { composition: 0, unit: `at%`, expected: `Composition: 0 at% Cu (100 at% Al)` },
    { composition: 0.333, unit: `at%`, expected: `Composition: 33.3 at% Cu (66.7 at% Al)` },
  ] as const)(`composition $composition as $unit`, ({ composition, unit, expected }) => {
    const info = create_hover_info({ composition })
    expect(format_hover_info_text(info, eutectic, { comp_unit: unit })).toContain(expected)
  })

  test.each([
    { temperature: 273.15, unit: `K`, expected: `Temperature: 273 K` },
    { temperature: 2500.7, unit: `K`, expected: `Temperature: 2501 K` },
    // hover temperatures are K: 1200 K = 926.85 °C
    { temperature: 1200, unit: `°C`, expected: `Temperature: 927 °C` },
  ] as const)(
    `temperature $temperature K shown in $unit`,
    ({ temperature, unit, expected }) => {
      const info = create_hover_info({ temperature })
      expect(format_hover_info_text(info, eutectic, { temp_unit: unit })).toContain(expected)
    },
  )

  test.each([
    { unit: `at%`, expected: [`  α: 60.0% (at 20 at%)`, `  β: 40.0% (at 80 at%)`] },
    { unit: `fraction`, expected: [`  α: 60.0% (at 0.2)`, `  β: 40.0% (at 0.8)`] },
  ] as const)(`lever rule in $unit with phase labels`, ({ unit, expected }) => {
    const info = create_hover_info({ region: eutectic_regions[1], lever_rule })
    const lines = format_hover_info_text(info, eutectic, { comp_unit: unit }).split(`\n`)
    expect(lines).toContain(`Lever Rule:`)
    for (const line of expected) expect(lines).toContain(line)
  })

  test(`line structure: header order, overlay line, blank line before lever rule`, () => {
    // the overlay's phase set is looked up at the hovered point: liquid at 900 K
    const info = create_hover_info({
      region: eutectic_regions[1],
      composition: 0.5,
      temperature: 900,
      lever_rule,
    })
    const lines = format_hover_info_text(info, eutectic, { overlay: shifted_eutectic }).split(
      `\n`,
    )
    expect(lines.slice(0, 4)).toEqual([
      `Phase: α + β`,
      `Overlay phase: L`,
      `Temperature: 900 K`,
      `Composition: 50 at% Cu (50 at% Al)`,
    ])
    const lever_idx = lines.indexOf(`Lever Rule:`)
    expect(lever_idx).toBeGreaterThan(3)
    expect(lines[lever_idx - 1]).toBe(``)
    // single-phase hover (no lever_rule) -> no lever rule section, no overlay without one
    const single = format_hover_info_text(create_hover_info(), eutectic)
    expect(single).not.toContain(`Lever Rule`)
    expect(single).not.toContain(`Overlay`)
  })
})

// the site's demo diagrams (converted or script-built) must all render
describe(`site demo diagrams`, () => {
  test.each(Object.entries(binary_diagrams))(`%s is valid`, (_name, diagram) => {
    expect(diagram_errors(diagram)).toEqual([])
  })

  // sample points at bin centres of the composition-temperature window
  const grid = ([t_min, t_max]: [number, number], n_bins = 40): [number, number][] =>
    Array.from({ length: n_bins * n_bins }, (_, idx) => [
      (Math.floor(idx / n_bins) + 0.5) / n_bins,
      t_min + (((idx % n_bins) + 0.5) / n_bins) * (t_max - t_min),
    ])

  // script-built fixtures tile the window: every sample point lies in exactly one region
  test.each([`Ag-Cu`, `Ag-Cu-model`, `Mg-Si`, `Au-Ni`])(
    `%s regions tile the plane`,
    (name) => {
      const { temperature_range, regions = [] } = binary_diagrams[name]
      for (const [x_val, temp] of grid(temperature_range)) {
        const hits = regions.filter(({ vertices }) => point_in(x_val, temp, vertices))
        expect(hits, `${name} at (${x_val}, ${temp})`).toHaveLength(1)
      }
    },
  )

  // two-phase regions list their phases in composition order: just beyond each end of the
  // isothermal tie line lies a region of that end's phase. Au-Ni's single fcc field keeps id
  // FCC_A1#1 on both flanks of its miscibility gap (which id the right flank takes is open).
  test.each(Object.keys(binary_diagrams).filter((name) => name !== `Au-Ni`))(
    `%s two-phase regions are in composition order`,
    (name) => {
      const { temperature_range, regions = [] } = binary_diagrams[name]
      const step = 1e-3
      for (const [x_val, temp] of grid(temperature_range, 60)) {
        const region = find_region_at(regions, x_val, temp)
        if (region?.phases.length !== 2) continue
        const lever = calculate_lever_rule(region, x_val, temp)
        expect(lever, `${name} tie line at (${x_val}, ${temp})`).not.toBeNull()
        const ends = [
          [lever?.left_composition ?? 0, -step, region.phases[0]],
          [lever?.right_composition ?? 1, step, region.phases[1]],
        ] as const
        for (const [end, offset, phase] of ends) {
          const beyond = end + offset
          if (beyond <= 0 || beyond >= 1) continue
          const neighbor = find_region_at(regions, beyond, temp)
          expect(
            neighbor?.phases,
            `${name} ${region.phases} at (${x_val}, ${temp})`,
          ).toContain(phase)
        }
      }
    },
  )

  test(`Ag-Cu markers draw its eutectic and both melting points, not other systems' rows`, () => {
    const ids = observation_markers(
      binary_observations,
      binary_diagrams[`Ag-Cu`].components,
    ).map(({ row }) => row.id)
    expect([...new Set(ids)].toSorted()).toEqual([
      `Ag-Cu:eutectic`,
      `Ag:melting`,
      `Cu:melting`,
    ])
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
