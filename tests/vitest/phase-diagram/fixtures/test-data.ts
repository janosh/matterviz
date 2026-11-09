import type { Vec2 } from '#lib/math.js'
import {
  BINARY_DIAGRAM_FORMAT,
  type BinaryPhaseDiagram,
  type DiagramRegion,
  type LeverRuleResult,
  type PhaseHoverInfo,
  type PhaseObservation,
} from '#lib/phase-diagram/index.js'

// Vec2 vertices from a flat [x0, y0, x1, y1, ...] list, so polygons stay on one line
export const pts = (...flat: number[]): Vec2[] =>
  Array.from({ length: flat.length / 2 }, (_, idx): Vec2 => [flat[2 * idx], flat[2 * idx + 1]])
export const rect = (x_lo: number, y_lo: number, x_hi: number, y_hi: number): Vec2[] =>
  pts(x_lo, y_lo, x_hi, y_lo, x_hi, y_hi, x_lo, y_hi)

// Liquid over an α + β field split at T_e
const split_regions = (t_e: number): DiagramRegion[] => [
  { phases: [`LIQUID`], vertices: rect(0, t_e, 1, 1000) },
  { phases: [`A`, `B`], vertices: rect(0, 0, 1, t_e) },
]
export const eutectic_regions = split_regions(500)
export const shifted_regions = split_regions(600)

// Simple eutectic-style system: liquid on top of an α + β field, eutectic at (0.5, 500 K)
export const eutectic: BinaryPhaseDiagram = {
  format: BINARY_DIAGRAM_FORMAT,
  components: [`Al`, `Cu`],
  pressure_pa: 101325,
  temperature_range: [0, 1000],
  phases: [
    { id: `LIQUID`, model_phase: `LIQUID`, label: `L`, kind: `liquid` },
    { id: `A`, model_phase: `FCC_A1`, label: `α`, kind: `solid` },
    { id: `B`, model_phase: `BCC_A2`, label: `β`, kind: `solid` },
  ],
  regions: eutectic_regions,
  boundaries: [
    { kind: `invariant`, phases: [`A`, `LIQUID`, `B`], points: pts(0, 500, 1, 500) },
  ],
  invariants: [
    {
      kind: `eutectic`,
      temperature: 500,
      phases: [`A`, `LIQUID`, `B`],
      compositions: [0, 0.5, 1],
      reaction: `LIQUID -> A + B`,
    },
  ],
  congruent_points: [],
  critical_points: [],
  unary_transitions: [],
  polymorphic_transitions: [],
  provenance: { kind: `assessment`, source: `test fixture` },
}

// The eutectic shifted 100 K up, as a model's prediction of the same system
export const shifted_eutectic: BinaryPhaseDiagram = {
  ...eutectic,
  regions: shifted_regions,
  boundaries: [
    { kind: `invariant`, phases: [`A`, `LIQUID`, `B`], points: pts(0, 600, 1, 600) },
  ],
  invariants: [{ ...eutectic.invariants[0], temperature: 600 }],
  provenance: { kind: `model`, model: `test-model` },
}

// An invariant observed with three phase compositions, and a pure-Cu melting point
export const observations: PhaseObservation[] = [
  {
    id: `Al-Cu:eutectic`,
    system: `Al-Cu`,
    kind: `invariant`,
    reaction: `L -> (Al) + (Cu)`,
    T_K: 520,
    sigma_T_K: 10,
    status: `ok`,
    phases: [
      { name: `liquid`, x: 0.45, sigma_x: 0.02 },
      { name: `fcc`, x: 0.1 },
      { name: `bcc`, x: 0.9, sigma_x: null },
    ],
    source: { kind: `primary`, citation: `Doe et al., J. Test. 1 (2020) 1`, doi: `10.1/test` },
  },
  {
    id: `Cu:melting`,
    system: `Cu`,
    kind: `melting`,
    T_K: 900,
    sigma_T_K: 0.001,
    status: `needs_verification`,
    source: { citation: `ITS-90` },
  },
  // not drawn: no temperature, or a phase without composition
  {
    id: `no-T`,
    system: `Al-Cu`,
    kind: `liquidus`,
    T_K: null,
    sigma_T_K: null,
    status: `needs_value`,
    phases: [{ name: `liquid`, x: 0.3 }],
    source: { citation: `x` },
  },
  {
    id: `no-x`,
    system: `Al-Cu`,
    kind: `critical_point`,
    T_K: 700,
    sigma_T_K: 5,
    status: `needs_value`,
    phases: [{ name: `ss`, x: null }],
    source: { citation: `x` },
  },
]

export const create_hover_info = (
  overrides: Partial<PhaseHoverInfo> = {},
): PhaseHoverInfo => ({
  region: eutectic_regions[0],
  lever_rule: null,
  composition: 0.5,
  temperature: 850,
  position: { x: 100, y: 100 },
  point: null,
  observation: null,
  ...overrides,
})

// α (left, 60 %) at x = 0.2 and β (right, 40 %) at x = 0.8
export const lever_rule: LeverRuleResult = {
  left_phase: `A`,
  right_phase: `B`,
  left_composition: 0.2,
  right_composition: 0.8,
  fraction_left: 0.6,
  fraction_right: 0.4,
}
