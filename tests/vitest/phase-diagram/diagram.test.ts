import {
  diagram_errors,
  diagram_hit,
  diagram_name,
  diagram_points,
  format_hover_info_text,
  format_reaction,
  model_phase_keys,
  observation_markers,
  parse_diagram,
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
import { hsl } from 'd3-color'
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
  test(`a valid diagram has none`, () => {
    expect(diagram_errors(eutectic)).toEqual([])
  })

  // every phase reference is checked, so label/color lookups by id never miss
  test.each<[string, Partial<BinaryPhaseDiagram>, string]>([
    [`format`, { format: `x` as `binary-phase-diagram/2` }, `format is "x"`],
    [
      `components`,
      { components: [`A`] as unknown as [string, string] },
      `components must be two distinct strings`,
    ],
    [
      `duplicate components`,
      { components: [`Ag`, `Ag`] },
      `components must be two distinct strings, got ["Ag","Ag"]`,
    ],
    [`negative temperature`, { temperature_range: [-50, 1200] }, `temperature_range must be`],
    [`missing regions`, { regions: undefined }, `regions must be an array`],
    [
      `missing polymorphic transitions`,
      { polymorphic_transitions: undefined },
      `polymorphic_transitions must be an array`,
    ],
    [
      `three-phase region`,
      { regions: [{ phases: [`A`, `B`, `LIQUID`], vertices: pts(0, 0, 1, 0, 1, 1) }] },
      `regions[0] needs one phase or two distinct phases`,
    ],
    [
      `repeated region phase`,
      { regions: [{ phases: [`A`, `A`], vertices: pts(0, 0, 1, 0, 1, 1) }] },
      `regions[0] needs one phase or two distinct phases`,
    ],
    [
      `invariant line side`,
      {
        boundaries: [
          {
            kind: `invariant`,
            phases: [`A`, `LIQUID`, `B`],
            side: `A`,
            points: pts(0, 500, 1, 500),
          },
        ],
      },
      `boundaries[0] is invariant: three phases and no side`,
    ],
    [
      `two-phase invariant`,
      {
        invariants: [{ ...eutectic.invariants[0], phases: [`A`, `B`], compositions: [0, 1] }],
      },
      `invariants[0] needs 3 phases and 3 compositions, got 2 and 2`,
    ],
    [
      `phaseless invariant`,
      { invariants: [{ ...eutectic.invariants[0], phases: [], compositions: [] }] },
      `invariants[0] needs 3 phases and 3 compositions, got 0 and 0`,
    ],
    [
      `unordered invariant compositions`,
      { invariants: [{ ...eutectic.invariants[0], compositions: [0.5, 0, 1] }] },
      `invariants[0] compositions must increase with x`,
    ],
    [
      `composition outside [0, 1]`,
      { congruent_points: [{ temperature: 600, composition: 5, phases: [`LIQUID`, `A`] }] },
      `congruent_points[0] needs a finite temperature and compositions in [0, 1]`,
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
      `invariants[0] needs 3 phases and 3 compositions, got 3 and 1`,
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
      `polymorphic phases`,
      { boundaries: [{ kind: `polymorphic`, phases: [`A`, `B`], points: pts(0, 0, 1, 1) }] },
      `boundaries[0] is polymorphic: three phases and no side`,
    ],
    [
      `polymorphic transition`,
      {
        polymorphic_transitions: [
          { temperature: 450, composition: Number.NaN, above: `A`, below: `C` },
        ],
      },
      `polymorphic_transitions[0] references unknown phase C; polymorphic_transitions[0] needs a finite`,
    ],
    [
      `invariant kind`,
      { invariants: [{ ...eutectic.invariants[0], kind: `catatectic` as `eutectic` }] },
      `invariants[0] has unknown kind "catatectic"`,
    ],
    [
      `invariant temperature`,
      { invariants: [{ ...eutectic.invariants[0], temperature: null as unknown as number }] },
      `invariants[0] needs a finite temperature and compositions`,
    ],
    [`non-object region`, { regions: [null] as never }, `regions must hold objects`],
    [
      `non-finite vertex`,
      { regions: [{ phases: [`A`], vertices: pts(0, 0, 1, 0, Number.NaN, 1) }] },
      `regions[0] vertices must be [x, T] number pairs`,
    ],
    // the renderer's x window is fixed to [0, 1], so a vertex at x = 1.5 would sit off-plot
    [
      `off-plot vertex`,
      { regions: [{ phases: [`A`], vertices: pts(0, 0, 1.5, 0, 0, 1) }] },
      `regions[0] vertices need x in [0, 1]`,
    ],
    [
      `off-plot boundary point`,
      { boundaries: [{ kind: `solvus`, phases: [`A`, `B`], points: pts(-0.5, 0, 1, 1) }] },
      `boundaries[0] points need x in [0, 1]`,
    ],
    // a malformed reaction would otherwise pass and make diagram_points throw on an empty id
    ...[`LIQUID -> A +`, ` -> A + B`, `LIQUID A B`, `LIQUID -> A -> B`].map(
      (reaction): [string, Partial<BinaryPhaseDiagram>, string] => [
        `reaction ${JSON.stringify(reaction)}`,
        { invariants: [{ ...eutectic.invariants[0], reaction }] },
        `invariants[0] reaction must read "A [+ B] -> C [+ D]"`,
      ],
    ),
  ])(`reports a bad %s`, (_label, patch, message) => {
    // exactly the listed errors fire (`; ` separates several), each matched by its prefix
    expect(diagram_errors({ ...eutectic, ...patch })).toEqual(
      message.split(`; `).map((part) => expect.stringContaining(part)),
    )
  })
  test(`x within float noise of [0, 1] is accepted`, () => {
    const vertices = pts(-1e-12, 0, 1 + 1e-12, 0, 0, 1)
    expect(diagram_errors({ ...eutectic, regions: [{ phases: [`A`], vertices }] })).toEqual([])
  })
  test(`parse_diagram returns a valid diagram and throws the joined errors otherwise`, () => {
    expect(parse_diagram(eutectic)).toBe(eutectic)
    expect(() => parse_diagram({ ...eutectic, regions: [null], boundaries: 3 })).toThrow(
      `Invalid phase diagram: boundaries must be an array; regions must hold objects`,
    )
  })
  test.each([`syntectic`, `inverse_melting`] as const)(`accepts invariant kind %s`, (kind) => {
    expect(
      diagram_errors({ ...eutectic, invariants: [{ ...eutectic.invariants[0], kind }] }),
    ).toEqual([])
  })

  // untrusted JSON never makes validation throw, and emitter failure records say why
  test.each<[unknown, string]>([
    [null, `a diagram is a JSON object, got null`],
    [[1, 2], `a diagram is a JSON object, got [1,2]`],
    [{ error: `no convergence`, expected: true }, `emitter failure record: no convergence`],
    [
      { ...eutectic, regions: [{ phases: `A`, vertices: 3 }] },
      `regions[0] phases must be an array of ids; regions[0] needs one phase; regions[0] has 0 vertices`,
    ],
  ])(`untrusted value %j`, (value, message) => {
    expect(diagram_errors(value)).toEqual(
      message.split(`; `).map((part) => expect.stringContaining(part)),
    )
  })

  test(`a magnetic line inside one phase is valid`, () => {
    const magnetic = {
      kind: `magnetic` as const,
      phases: [`A`],
      points: pts(0, 400, 0.2, 380),
    }
    expect(diagram_errors({ ...eutectic, boundaries: [magnetic] })).toEqual([])
  })

  test(`a polymorphic line with its transition is valid`, () => {
    const polymorphic = {
      kind: `polymorphic` as const,
      phases: [`A`, `LIQUID`, `B`],
      points: pts(0.1, 450, 0.5, 450),
    }
    const polymorphic_transitions = [
      { temperature: 450, composition: 0.5, above: `LIQUID`, below: `B` },
    ]
    expect(
      diagram_errors({ ...eutectic, boundaries: [polymorphic], polymorphic_transitions }),
    ).toEqual([])
  })
})

test(`format_reaction, region_label and phase_labeler use phase labels`, () => {
  const label_of = phase_labeler(eutectic)
  expect(format_reaction(`LIQUID -> A + B`, label_of)).toBe(`L → α + β`)
  expect(format_reaction(`LIQUID + A -> B`, label_of)).toBe(`L + α → β`)
  expect(region_label(eutectic.regions[1], label_of)).toBe(`α + β`)
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
  const liquid = phase(`LIQUID`, `LIQUID`, `liquid`)
  // Au-Ni style: a wrapping fcc field (bare id) around a gap of two composition sets
  const au_ni = [
    liquid,
    phase(`FCC_A1`),
    phase(`FCC_A1#1`, `FCC_A1`),
    phase(`FCC_A1#2`, `FCC_A1`),
  ]
  const hue_light = (color = ``) => {
    const { h, l } = hsl(color)
    return [Math.round(h), l]
  }

  test(`liquid is sky blue, composition sets share their model phase's hue, darker per set`, () => {
    const colors = phase_colors(au_ni)
    expect(colors.get(`LIQUID`)).toBe(LIQUID_COLOR)
    const [bare, set_1, set_2] = [`FCC_A1`, `FCC_A1#1`, `FCC_A1#2`].map((id) =>
      hue_light(colors.get(id)),
    )
    expect(SOLID_PHASE_PALETTE).toContain(colors.get(`FCC_A1`))
    expect([set_1[0], set_2[0]]).toEqual([bare[0], bare[0]])
    // 0.09 lightness steps; hex rounding (1/255 per channel) moves HSL lightness < 0.004
    expect(bare[1] - set_1[1]).toBeCloseTo(0.09, 2)
    expect(set_1[1] - set_2[1]).toBeCloseTo(0.09, 2)
  })

  test(`does not depend on phase order`, () => {
    expect(phase_colors(au_ni.toReversed())).toEqual(phase_colors(au_ni))
  })

  // real CALPHAD systems exceed the palette: extra keys get golden-angle hues, never a reuse
  test.each([0, 1, 7])(`palette size + %i model phases all get distinct colors`, (n_extra) => {
    const phases = Array.from({ length: SOLID_PHASE_PALETTE.length + n_extra }, (_, idx) =>
      phase(`P${String(idx).padStart(2, `0`)}`),
    )
    expect(new Set(phase_colors(phases).values()).size).toBe(phases.length)
  })

  // B2_BCC and BCC_A2 hash to one palette slot: on its own, the model diagram's BCC_A2 takes
  // the slot that B2_BCC holds in the reference, so only shared keys make the colors agree
  test(`diagrams with different phase sets match on shared model phases given shared keys`, () => {
    const reference = [liquid, phase(`B2_BCC`), phase(`BCC_A2`), phase(`BCC_A2#1`, `BCC_A2`)]
    const model = [liquid, phase(`BCC_A2`), phase(`HCP_A3`)]
    expect(phase_colors(model).get(`BCC_A2`)).toBe(phase_colors(reference).get(`B2_BCC`))
    const keys = model_phase_keys(
      [reference, model].map((phases) => ({ ...eutectic, phases })),
    )
    expect(keys).toEqual([`B2_BCC`, `BCC_A2`, `HCP_A3`, `LIQUID`])
    const [ref_colors, model_colors] = [reference, model].map((phases) =>
      phase_colors(phases, keys),
    )
    for (const id of [`LIQUID`, `BCC_A2`])
      expect(model_colors.get(id)).toBe(ref_colors.get(id))
    expect(model_colors.get(`BCC_A2`)).not.toBe(ref_colors.get(`B2_BCC`))
    expect(hue_light(ref_colors.get(`BCC_A2#1`))[0]).toBe(
      hue_light(model_colors.get(`BCC_A2`))[0],
    )
  })
})

test(`diagram_points describes invariant, congruent, critical, unary and polymorphic points`, () => {
  const points = diagram_points({
    ...eutectic,
    congruent_points: [{ temperature: 800, composition: 0.4, phases: [`LIQUID`, `A`] }],
    critical_points: [{ temperature: 400, composition: 0.6, phase: `B` }],
    unary_transitions: [
      { component: `Al`, temperature: 933, above: `LIQUID`, below: `A` },
      { component: `Cu`, temperature: 700, above: `A`, below: `B` },
    ],
    polymorphic_transitions: [{ temperature: 450, composition: 0.3, above: `A`, below: `B` }],
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
    [`polymorphic`, `polymorphic`, 0.3, ``, `α → β at fixed composition`],
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

  // sample points just off bin centres of the composition-temperature window, so none lands
  // exactly on a hand-drawn edge (e.g. x = 0.5, where an on-edge point counts for both sides)
  const grid = ([t_min, t_max]: [number, number], n_bins = 40): [number, number][] =>
    Array.from({ length: n_bins * n_bins }, (_, idx) => [
      (Math.floor(idx / n_bins) + 0.5 + 1e-7) / n_bins,
      t_min + (((idx % n_bins) + 0.5 + 1e-7) / n_bins) * (t_max - t_min),
    ])

  // every fixture tiles its window: each sample point lies in exactly one region
  test.each(Object.keys(binary_diagrams))(`%s regions tile the plane`, (name) => {
    const { temperature_range, regions } = binary_diagrams[name]
    for (const [x_val, temp] of grid(temperature_range)) {
      const hits = regions.filter(({ vertices }) => point_in(x_val, temp, vertices))
      expect(hits, `${name} at (${x_val}, ${temp})`).toHaveLength(1)
    }
  })

  // two-phase regions list their phases in composition order: just beyond each end of the
  // isothermal tie line lies a region of that end's phase, or of the bare-id field a
  // composition set wraps into (Au-Ni's FCC_A1 flanks both ends of its FCC_A1#1 + FCC_A1#2 gap)
  test.each(Object.keys(binary_diagrams))(
    `%s two-phase regions are in composition order`,
    (name) => {
      const { temperature_range, regions, phases } = binary_diagrams[name]
      const ids = new Set(phases.map(({ id }) => id))
      const wrapping_field = new Map(
        phases.map(({ id, model_phase }) => [id, ids.has(model_phase) ? model_phase : id]),
      )
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
          const neighbor = find_region_at(regions, beyond, temp)?.phases ?? []
          expect(
            [phase, wrapping_field.get(phase)].some((id) => id && neighbor.includes(id)),
            `${name} ${region.phases} at (${x_val}, ${temp}) next to ${neighbor}`,
          ).toBe(true)
        }
      }
    },
  )

  // Au-Ni wrap rule: the fcc field above and around the gap is the bare id, the gap its sets
  test.each([
    [0.3, 1100, `α`],
    [0.706, 1100, `α`],
    [0.7, 800, `α₁ + α₂`],
    [0.5, 1500, `L`],
  ])(`Au-Ni at x=%s, T=%s K is %s`, (x_val, temp, label) => {
    const au_ni = binary_diagrams[`Au-Ni`]
    expect(region_label(diagram_hit(au_ni, x_val, temp).region, phase_labeler(au_ni))).toBe(
      label,
    )
  })

  test(`Au-Ni critical point names the wrapping field`, () => {
    const points = diagram_points(binary_diagrams[`Au-Ni`])
    const critical = points.find(({ category }) => category === `critical`)
    expect(critical?.description).toBe(`α miscibility gap closes`)
  })

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
