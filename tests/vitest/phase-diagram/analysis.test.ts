import {
  common_tangents,
  compute_isopleth,
  gibbs_curves,
  lower_hull,
  phase_disagreement,
} from '#lib/phase-diagram/analysis.js'
import type { BinaryPhaseDiagram, GibbsEnergyGrid } from '#lib/phase-diagram/types.js'
import { describe, expect, test } from 'vitest'
import { find_region_at } from '#lib/phase-diagram/utils.js'
import { binary_diagrams } from '#site/phase-diagrams.js'
import { eutectic, pts, shifted_eutectic } from './fixtures/test-data'

// Lens-shaped α + L field over a liquid: the liquidus runs (0, 1000) → (1, 600), the solidus
// (0, 1000) → (1, 800) is replaced by a straight edge to keep the lever rule analytic
const two_phase: BinaryPhaseDiagram = {
  ...eutectic,
  regions: [
    { phases: [`LIQUID`], vertices: pts(0, 1000, 1, 600, 1, 1000) },
    { phases: [`A`, `LIQUID`], vertices: pts(0, 1000, 0, 0, 1, 0, 1, 600) },
  ],
}

describe(`compute_isopleth`, () => {
  test(`bisects each phase change and gives lever-rule fractions that sum to 1`, () => {
    // eutectic fixture at x = 0.25: L above 500 K, α + β below
    const { steps, transitions } = compute_isopleth(eutectic, 0.25, [0, 1000], 100, 0.01)
    // bin centres: 995 K down to 5 K
    expect(steps).toHaveLength(100)
    expect(steps[0].temperature).toBe(995)
    expect(steps.at(-1)?.temperature).toBe(5)
    expect(transitions).toHaveLength(1)
    expect(transitions[0].temperature).toBeCloseTo(500, 1)
    expect(transitions[0].above?.phases).toEqual([`LIQUID`])
    expect(transitions[0].below?.phases).toEqual([`A`, `B`])
    for (const { fractions, region } of steps) {
      if (!region) continue
      const total = fractions.reduce((sum, [, frac]) => sum + frac, 0)
      expect(total).toBeCloseTo(1, 12)
    }
    // α + β spans x 0..1 at every T: the lever rule at x = 0.25 is 75 % α
    expect(steps.at(-2)?.fractions).toEqual([
      [`A`, 0.75],
      [`B`, 0.25],
    ])
  })

  test(`finds the liquidus of a sloped field to the requested tolerance`, () => {
    // liquidus at x = 0.5 is 800 K
    const { transitions } = compute_isopleth(two_phase, 0.5, [0, 1000], 240, 0.05)
    expect(transitions).toHaveLength(1)
    expect(Math.abs(transitions[0].temperature - 800)).toBeLessThan(0.05)
  })

  // a field thinner than one bin, crossed by the bisection: both its edges are reported
  test(`walks every phase change between two bin centres`, () => {
    const thin: BinaryPhaseDiagram = {
      ...eutectic,
      regions: [
        { phases: [`LIQUID`], vertices: pts(0, 500.3, 1, 500.3, 1, 1000, 0, 1000) },
        { phases: [`A`, `LIQUID`], vertices: pts(0, 500.1, 1, 500.1, 1, 500.3, 0, 500.3) },
        { phases: [`A`, `B`], vertices: pts(0, 0, 1, 0, 1, 500.1, 0, 500.1) },
      ],
    }
    const { transitions } = compute_isopleth(thin, 0.5, [0, 1000], 100, 0.01)
    expect(
      transitions.map(({ temperature, above, below }) => [
        Math.round(temperature * 10) / 10,
        above?.phases,
        below?.phases,
      ]),
    ).toEqual([
      [500.3, [`LIQUID`], [`A`, `LIQUID`]],
      [500.1, [`A`, `LIQUID`], [`A`, `B`]],
    ])
  })

  test(`adjacent polygons with one phase set are no phase change`, () => {
    const split: BinaryPhaseDiagram = {
      ...eutectic,
      regions: [
        { phases: [`LIQUID`], vertices: pts(0, 700, 1, 700, 1, 1000, 0, 1000) },
        { phases: [`LIQUID`], vertices: pts(0, 500, 1, 500, 1, 700, 0, 700) },
        eutectic.regions[1],
      ],
    }
    const { transitions } = compute_isopleth(split, 0.5, [0, 1000], 100, 0.01)
    expect(transitions.map(({ temperature }) => Math.round(temperature))).toEqual([500])
  })

  test(`a composition outside every field has no fractions and no transitions`, () => {
    const gappy = { ...eutectic, regions: [eutectic.regions[0]] } // nothing below 500 K
    const { steps, transitions } = compute_isopleth(gappy, 0.5, [0, 1000], 10)
    expect(transitions).toHaveLength(1) // L -> nothing at 500 K, not the window's edges
    expect(transitions[0].below).toBeNull()
    expect(steps.at(-1)?.fractions).toEqual([])
  })
})

describe(`phase_disagreement`, () => {
  test(`identical diagrams never disagree`, () => {
    const temps = [100, 450, 550, 900]
    expect(phase_disagreement(eutectic, eutectic, temps)).toEqual({
      segments: [],
      fraction: 0,
    })
  })

  test(`a shifted eutectic disagrees between the two eutectics, across the full width`, () => {
    const temps = [100, 450, 550, 580, 650, 900]
    const { segments, fraction } = phase_disagreement(eutectic, shifted_eutectic, temps)
    expect(segments).toEqual([
      [550, 0, 1],
      [580, 0, 1],
    ])
    expect(fraction).toBeCloseTo(2 / 6, 12)
  })

  // a phase that stands in for the other diagram's phase (phase_matches) agrees with it
  test(`name_of maps a stand-in phase onto the other diagram's model phase`, () => {
    const renamed = {
      ...eutectic,
      phases: eutectic.phases.map((phase) =>
        phase.id === `A` ? { ...phase, model_phase: `A_STANDIN` } : phase,
      ),
    }
    const temps = [100, 450, 900]
    expect(phase_disagreement(renamed, eutectic, temps).fraction).toBeGreaterThan(0)
    const name_of = (id: string) => (id === `A` ? `FCC_A1` : undefined)
    expect(phase_disagreement(renamed, eutectic, temps, name_of)).toEqual({
      segments: [],
      fraction: 0,
    })
  })

  // a miscibility gap (two composition sets of fcc) is not the single-phase fcc field
  test(`the number of coexisting composition sets counts`, () => {
    const fcc_phases = [
      { id: `F#1`, model_phase: `FCC_A1`, label: `α₁`, kind: `solid` as const },
      { id: `F#2`, model_phase: `FCC_A1`, label: `α₂`, kind: `solid` as const },
    ]
    const square = pts(0, 0, 1, 0, 1, 1000, 0, 1000)
    const single = {
      ...eutectic,
      phases: fcc_phases,
      regions: [{ phases: [`F#1`], vertices: square }],
    }
    const gap = { ...single, regions: [{ phases: [`F#1`, `F#2`], vertices: square }] }
    expect(phase_disagreement(single, gap, [100, 900]).fraction).toBe(1)
    const other_set = { ...single, regions: [{ phases: [`F#2`], vertices: square }] }
    expect(phase_disagreement(single, other_set, [100, 900]).fraction).toBe(0)
  })

  test(`composition sets of one model phase match, other model phases do not`, () => {
    const relabelled: BinaryPhaseDiagram = {
      ...eutectic,
      phases: eutectic.phases.map((phase) =>
        phase.id === `A` ? { ...phase, id: `A#1` } : phase,
      ),
      regions: eutectic.regions.map((region) => ({
        ...region,
        phases: region.phases.map((id) => (id === `A` ? `A#1` : id)),
      })),
    }
    // same model phases under other ids: no disagreement
    expect(phase_disagreement(eutectic, relabelled, [100, 900]).segments).toEqual([])
    const other_model: BinaryPhaseDiagram = {
      ...eutectic,
      phases: eutectic.phases.map((phase) =>
        phase.id === `B` ? { ...phase, model_phase: `HCP_A3` } : phase,
      ),
    }
    expect(phase_disagreement(eutectic, other_model, [100, 900]).segments).toEqual([
      [100, 0, 1],
    ])
  })

  test(`only the commonly covered length counts, split at each region edge`, () => {
    // other covers x 0..0.5 only, with a different model phase there
    const half: BinaryPhaseDiagram = {
      ...eutectic,
      phases: [...eutectic.phases, { id: `C`, model_phase: `C`, label: `γ`, kind: `solid` }],
      regions: [{ phases: [`C`], vertices: pts(0, 0, 0.5, 0, 0.5, 1000, 0, 1000) }],
    }
    const { segments, fraction } = phase_disagreement(eutectic, half, [100, 900])
    expect(segments).toEqual([
      [100, 0, 0.5],
      [900, 0, 0.5],
    ])
    expect(fraction).toBe(1)
  })
})

// Two phases on a 3-node grid at two temperatures
const grid: GibbsEnergyGrid = {
  temperatures: [500, 700],
  compositions: [0, 0.5, 1],
  phases: [
    {
      model_phase: `LIQUID`,
      values: [
        [0, -1000, 0],
        [-200, -1400, -200],
      ],
    },
    {
      model_phase: `FCC_A1`,
      values: [
        [100, null, 100],
        [300, null, 300],
      ],
    },
  ],
}

describe(`gibbs_curves`, () => {
  test.each([
    [
      500,
      [
        [0, 0],
        [0.5, -1000],
        [1, 0],
      ],
    ],
    [
      600,
      [
        [0, -100],
        [0.5, -1200],
        [1, -100],
      ],
    ],
    [
      700,
      [
        [0, -200],
        [0.5, -1400],
        [1, -200],
      ],
    ],
  ])(`interpolates between grid rows at T = %s K`, (temperature, liquid) => {
    const [liq, fcc] = gibbs_curves(grid, temperature)
    expect(liq).toEqual({ id: `LIQUID`, points: liquid })
    // a null node is left out
    expect(fcc.points.map(([x_val]) => x_val)).toEqual([0, 1])
  })

  test.each([300, 900, Number.NaN])(`throws for T = %s K outside the grid`, (temperature) => {
    expect(() => gibbs_curves(grid, temperature)).toThrow(
      `outside the Gibbs grid [500, 700] K`,
    )
  })
})

test(`on a grid row only that row's values count`, () => {
  // the middle node is null at 500 K but defined at 600 K
  const partial: GibbsEnergyGrid = {
    temperatures: [500, 600],
    compositions: [0, 0.5, 1],
    phases: [
      {
        model_phase: `LIQUID`,
        values: [
          [0, null, 0],
          [0, -5, 0],
        ],
      },
    ],
  }
  expect(gibbs_curves(partial, 600)[0].points).toEqual([
    [0, 0],
    [0.5, -5],
    [1, 0],
  ])
  expect(gibbs_curves(partial, 500)[0].points).toEqual([
    [0, 0],
    [1, 0],
  ])
  expect(gibbs_curves(partial, 550)[0].points).toEqual([
    [0, 0],
    [1, 0],
  ])
})

describe(`lower_hull and common_tangents`, () => {
  test(`a double well's hull bridges its two minima with one tangent`, () => {
    const xs = Array.from({ length: 21 }, (_, idx) => idx / 20)
    // minima at x = 0.2 and 0.8 with equal depth
    const points = xs.map((x_val): [number, number] => [
      x_val,
      (x_val - 0.2) ** 2 * (x_val - 0.8) ** 2,
    ])
    const hull = lower_hull([{ id: `FCC_A1`, points }])
    const tangents = common_tangents(hull)
    expect(tangents).toHaveLength(1)
    expect(tangents[0].start.point[0]).toBeCloseTo(0.2, 12)
    expect(tangents[0].end.point[0]).toBeCloseTo(0.8, 12)
    // every curve point lies on or above the hull
    for (const [x_val, g_val] of points) {
      const seg = hull.findIndex(({ point }) => point[0] >= x_val)
      const [start, end] = [hull[Math.max(seg - 1, 0)].point, hull[seg].point]
      const on_hull =
        end[0] === start[0]
          ? end[1]
          : start[1] + ((x_val - start[0]) / (end[0] - start[0])) * (end[1] - start[1])
      expect(g_val).toBeGreaterThanOrEqual(on_hull - 1e-15)
    }
  })

  test(`hull edges switching phase are tangents, ones along one curve are not`, () => {
    const curves = [
      {
        id: `A`,
        points: [
          [0, -10],
          [0.1, -12],
          [0.2, -5],
        ] as [number, number][],
      },
      {
        id: `B`,
        points: [
          [0.8, -5],
          [0.9, -12],
          [1, -10],
        ] as [number, number][],
      },
    ]
    const hull = lower_hull(curves)
    expect(hull.map(({ point }) => point)).toEqual([
      [0, -10],
      [0.1, -12],
      [0.9, -12],
      [1, -10],
    ])
    expect(common_tangents(hull).map(({ start, end }) => [start.id, end.id])).toEqual([
      [`A`, `B`],
    ])
  })

  // a narrow gap on a fine part of a non-uniform grid still skips nodes of its curve
  test(`a gap is a tangent on any grid spacing`, () => {
    // wells at 0.005 and 0.025, convex everywhere else
    const points: [number, number][] = [
      [0, 0],
      [0.005, -2],
      [0.01, -1.5],
      [0.015, -1.3],
      [0.02, -1.5],
      [0.025, -2],
      [0.03, -1.98],
      [0.2, -1.2],
      [0.5, 0.3],
      [0.8, 2],
      [1, 3.5],
    ]
    const hull = lower_hull([{ id: `FCC_A1`, points }])
    expect(
      common_tangents(hull).map(({ start, end }) => [start.point[0], end.point[0]]),
    ).toEqual([[0.005, 0.025]])
  })

  test(`at a repeated x only the lowest point enters the hull`, () => {
    const hull = lower_hull([
      {
        id: `A`,
        points: [
          [0, 5],
          [1, 5],
        ],
      },
      {
        id: `B`,
        points: [
          [0, 1],
          [1, 9],
        ],
      },
    ])
    expect(hull.map(({ point, id, idx }) => [...point, id, idx])).toEqual([
      [0, 1, `B`, 0],
      [1, 5, `A`, 1],
    ])
  })
})

// the demo model's Gibbs grid and its drawn diagram tell one story: at each T the hull's tie
// lines end within a grid step and a half of the diagram's single-phase field edges
test.each([
  [900, [0.056, 0.978]],
  [1000, [0.095, 0.965]],
])(`demo Ag-Cu model: G hull tie lines match the diagram at %s K`, (temperature, edges) => {
  const model = binary_diagrams[`Ag-Cu-model`]
  const { gibbs_energy } = model
  if (!gibbs_energy) throw new Error(`Ag-Cu-model has no gibbs_energy`)
  const tangents = common_tangents(lower_hull(gibbs_curves(gibbs_energy, temperature)))
  expect(tangents).toHaveLength(1)
  const ends = [tangents[0].start.point[0], tangents[0].end.point[0]]
  ends.forEach((x_val, idx) => expect(Math.abs(x_val - edges[idx])).toBeLessThan(0.03))
  // and the diagram itself is two-phase between those ends
  expect(find_region_at(model.regions, 0.5, temperature)?.phases).toHaveLength(2)
})
