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

// One edge of a two-phase region (phases in composition order, `side` the phase whose
// composition the edge traces, e.g. LIQUID for a liquidus), an invariant line (3 phases, no
// side), or a magnetic (Curie/Néel) line inside one phase (`phases: [id]`, no side)
export interface DiagramBoundary {
  kind: BoundaryKind
  phases: string[]
  side?: string | null
  points: Vec2[] // polyline of [x, T]
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
}

export interface CongruentPoint {
  temperature: number
  composition: number
  phases: string[]
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
  regions?: DiagramRegion[] // absent until the emitter derives them: boundaries and points still render
  boundaries: DiagramBoundary[]
  invariants: InvariantReaction[]
  congruent_points: CongruentPoint[]
  critical_points: CriticalPoint[]
  unary_transitions: UnaryTransition[]
  provenance: DiagramProvenance
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
  source: ObservationSource
  system: string // `A-B` for a binary row, one component for a pure-component row
  reaction?: string | null
}

// === Rendering ===

// Marked point of a diagram (invariant, congruent, critical or pure-component transition)
export interface DiagramPoint {
  category: `invariant` | `congruent` | `critical` | `unary`
  kind: string // invariant kind, `congruent`, `critical`, or `melting`/`transition`
  composition: number
  temperature: number
  marker_label: string // short label next to the marker (E, P, Tm(Ag)), may be empty
  description: string // human-readable reaction with phase labels
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
}

// Hover state in data units (x mole fraction, T in K). An overlay diagram's phase set at the
// same point is diagram_hit(overlay, composition, temperature), derived where it is shown so a
// pinned snapshot never outlives an overlay change.
export interface PhaseHoverInfo extends DiagramHit {
  composition: number
  temperature: number
  position: Point2D // client coordinates
  point: DiagramPoint | null
  observation: ObservationMarker | null
}

// Shared cursor of synchronized diagrams, in data units
export interface DiagramCursor {
  composition: number
  temperature: number
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
