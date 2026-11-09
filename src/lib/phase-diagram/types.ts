import type { Point2D, Vec2 } from '#lib/math.js'
import type { Sides } from '#lib/plot/core/layout.js'
import type { TooltipConfig, TooltipProp } from '#lib/tooltip/index.js'

export type TempUnit = `K` | `°C` | `°F`
// Display unit of compositions: mole fraction or at.% (data is always mole fraction)
export type CompUnit = `fraction` | `at%`

// === binary-phase-diagram/2 exchange format ===
// One isobaric binary T-x diagram in physical units: T in K, x = mole fraction of components[1].
// Phases are referenced by id everywhere, labels are presentation only.

export const BINARY_DIAGRAM_FORMAT = `binary-phase-diagram/2`

// A composition set: a miscibility gap gives two ids (FCC_A1#1, FCC_A1#2) for one model phase.
// A single-phase field wrapping around the gap's critical point takes the bare id (FCC_A1).
// Colors follow model_phase, so all ids of one model phase share a hue.
export interface BinaryPhase {
  id: string
  model_phase: string
  label: string
  kind: `liquid` | `solid` | `gas`
}

// Closed counterclockwise polygon of [x, T] vertices (closing vertex not repeated). A
// two-phase region lists its phases left to right (the tie line's low-x end first).
export interface DiagramRegion {
  phases: string[]
  vertices: Vec2[]
}

export type BoundaryKind =
  | `liquidus`
  | `solidus`
  | `solvus`
  | `transus`
  | `invariant`
  | `miscibility_gap`
  | `magnetic`
  | `polymorphic`

// One edge of a two-phase region (phases in composition order, `side` the phase whose
// composition the edge traces, e.g. LIQUID for a liquidus), an invariant line (3 phases, no
// side), a magnetic (Curie/Néel) line inside one phase (`phases: [id]`, no side), or a
// polymorphic line from a neighbor's tie-line end to a line compound changing form
// (`[neighbor, above, below]` or `[above, below, neighbor]`, no side)
export interface DiagramBoundary {
  kind: BoundaryKind
  phases: string[]
  side?: string | null
  points: Vec2[] // polyline of [x, T]
  // 1σ temperature uncertainty (K) at each point, drawn as a band around the line
  sigma_T?: number[]
}

export type InvariantKind =
  | `eutectic`
  | `eutectoid`
  | `monotectic`
  | `metatectic`
  | `peritectic`
  | `peritectoid`
  | `syntectic`
  // a liquid forms from two condensed phases on cooling (some emitters produce it, rare in metals)
  | `inverse_melting`

// Three-phase reaction on cooling; phases and compositions in order of increasing x
export interface InvariantReaction {
  kind: InvariantKind
  temperature: number
  phases: string[]
  compositions: number[]
  reaction: string // phase ids, e.g. `LIQUID -> FCC_A1#1 + FCC_A1#2`
  sigma_T?: number // 1σ temperature uncertainty (K)
}

export interface CongruentPoint {
  temperature: number
  composition: number
  phases: string[]
  sigma_T?: number
}

// Where a miscibility gap closes; `phase` is the bare id (FCC_A1) of the field its two
// composition sets merge into
export interface CriticalPoint {
  temperature: number
  composition: number
  phase: string
}

// Phase transition of a pure component at x = 0 (components[0]) or x = 1 (components[1])
export interface UnaryTransition {
  component: string
  temperature: number
  above: string
  below: string
  sigma_T?: number
}

// A line compound of fixed composition changing from one form to another
export interface PolymorphicTransition {
  temperature: number
  composition: number
  above: string
  below: string
}

export interface DiagramProvenance {
  kind: `assessment` | `model` | `sketch`
  source?: string
  assessment?: string // the assessment publication behind the database
  license?: string
  // `not_cleared` diagrams must not be published
  redistribution?: `permitted_with_attribution` | `not_cleared`
  source_url?: string
  source_sha256?: string
  binary_tdb_sha256?: string
  emitter_build?: string
  model?: string
  head?: string
  checkpoint_sha256?: string
}

export interface BinaryPhaseDiagram {
  format: typeof BINARY_DIAGRAM_FORMAT
  components: [string, string]
  pressure_pa: number
  temperature_range: Vec2 // K, the computed window
  phases: BinaryPhase[]
  regions: DiagramRegion[]
  boundaries: DiagramBoundary[]
  invariants: InvariantReaction[]
  congruent_points: CongruentPoint[]
  critical_points: CriticalPoint[]
  unary_transitions: UnaryTransition[]
  polymorphic_transitions: PolymorphicTransition[]
  provenance: DiagramProvenance
  gibbs_energy?: GibbsEnergyGrid
}

// Molar Gibbs energies (J/mol of atoms, one reference state for all phases) on a (T, x)
// grid, for the free-energy curves and their convex hull at a temperature
export interface GibbsEnergyGrid {
  temperatures: number[] // K, increasing
  compositions: number[] // mole fraction, increasing
  // One curve per model phase (a miscibility gap's composition sets share it).
  // values[T idx][x idx], null where the phase has no value (a line compound is finite at
  // one composition only)
  phases: { model_phase: string; values: (number | null)[][] }[]
}

// === Experimental observations ===
// Rows of a phase-equilibria table. Phase names are free text (not diagram phase ids). A row
// without phases whose `system` is one pure component (a melting point) sits on that edge.

export type ObservationStatus = `ok` | `needs_value` | `needs_verification`

export interface ObservedPhase {
  name: string
  x: number | null
  sigma_x?: number | null
}

export interface ObservationSource {
  kind?: string
  citation: string
  doi?: string
  url?: string
  license?: string
}

export interface PhaseObservation {
  id: string
  kind: string
  T_K: number | null
  sigma_T_K: number | null
  status: ObservationStatus
  phases?: ObservedPhase[]
  source?: ObservationSource // rows are unvalidated JSON, some cite nothing
  system: string // `A-B` for a binary row, one component for a pure-component row
  reaction?: string | null
}

// A diagram's prediction of one observation row, e.g. from a benchmark's scoring
export interface ObservationPrediction {
  id: string // PhaseObservation.id
  T_K?: number | null
  // predicted composition of each observed phase, in the row's phase order and system
  // orientation (null where the diagram predicts none)
  x?: readonly (number | null)[]
  pass?: boolean | null // the check's verdict, null when unscored
}

// Marks to light up, e.g. from a hovered score-table row. The diagram sets it while the
// pointer is on an observation or marked point, so a bound host can light its own rows.
export interface DiagramHighlight {
  observation?: string | null // PhaseObservation.id
  // phase ids, model phases or phase_matches targets: their fields and boundary edges
  phases?: readonly string[]
  point?: PointRef | null
}

// A marked point by meaning, so each diagram can light its own counterpart (see match_point)
export interface PointRef {
  category: DiagramPoint[`category`]
  kind: string // DiagramPoint.kind, e.g. `eutectic`, `melting`
  at: Vec2 // [x, T]
  // names of the phases meeting there: each phase's model phase and label (hosts may give
  // either); a diagram also counts its phase_matches targets as its phases' names
  phases?: readonly string[]
}

// === Rendering ===

// Marked point of a diagram (invariant, congruent, critical or pure-component transition)
export interface DiagramPoint {
  category: `invariant` | `congruent` | `critical` | `unary` | `polymorphic`
  kind: string // invariant kind, `congruent`, `critical`, `polymorphic`, or `melting`/`transition`
  composition: number
  temperature: number
  phases: string[] // ids of the phases meeting there
  marker_label: string // short label next to the marker (E, P, Tm(Ag)), may be empty
  description: string // human-readable reaction with phase labels
  sigma_T: number // 1σ in K, 0 when not given
}

// Lever rule along the isothermal tie line of a two-phase region (phase ids)
export interface LeverRuleResult {
  left_phase: string
  right_phase: string
  left_composition: number
  right_composition: number
  fraction_left: number
  fraction_right: number
}

// Phase set of one diagram at the cursor
export interface DiagramHit {
  region: DiagramRegion | null
  lever_rule: LeverRuleResult | null
}

// Observation marker: one observed phase composition of a row at its temperature
export interface ObservationMarker {
  row: PhaseObservation
  phase: ObservedPhase | null // null for a pure-component row on the composition edge
  composition: number
  temperature: number
  // the diagram's predicted composition and temperature of this point, null where it
  // predicts none
  predicted_x: number | null
  predicted_t: number | null
  pass: boolean | null // the prediction's verdict
}

// Hover state in data units (x mole fraction, T in K), with each overlay's phase set at the
// same point (null for a hidden one). The diagram drops its hover and pin when the overlays
// change, so a snapshot's overlay_hits always line up with the current overlays. Toggling an
// overlay's visibility keeps them: a pin taken while it was hidden names no phase of it.
export interface PhaseHoverInfo extends DiagramHit {
  overlay_hits: (DiagramHit | null)[]
  composition: number
  temperature: number
  position: Point2D // client coordinates
  point: DiagramPoint | null
  observation: ObservationMarker | null
}

// Shared cursor of synchronized diagrams, in data units. `source` names the diagram whose
// pointer set it, so each diagram tells its own cursor from a partner's without tracking
// pointer enter/leave (touch never sends a leave)
export interface DiagramCursor {
  composition: number
  temperature: number
  source: string
}

interface TieLineConfig {
  stroke_width?: number
  endpoint_radius?: number
  cursor_radius?: number
}

export interface PhaseDiagramConfig {
  margin?: Sides
  font_size?: number
  special_point_radius?: number
  tie_line?: TieLineConfig
  colors?: {
    background?: string
    grid?: string
    axis?: string
    text?: string
    special_point?: string
    overlay?: string
  }
}

export type PhaseDiagramTooltipProp = TooltipProp<
  PhaseHoverInfo,
  TooltipConfig<PhaseHoverInfo>
>
