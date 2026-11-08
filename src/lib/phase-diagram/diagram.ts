// Semantics of the binary-phase-diagram/2 format: validation, phase labels and colors, marked
// points, boundary styles, and the observation layer drawn on top of a diagram

import { add_alpha } from '#lib/colors/index.js'
import { humanize } from '#lib/labels.js'
import type { Vec2 } from '#lib/math.js'
import {
  BINARY_DIAGRAM_FORMAT,
  type BinaryPhaseDiagram,
  type BoundaryKind,
  type DiagramBoundary,
  type DiagramPoint,
  type DiagramRegion,
  type ObservationMarker,
  type ObservationStatus,
  type PhaseObservation,
} from './types'
import { LIQUID_COLOR, SOLID_PHASE_PALETTE } from './utils'

// Stroke style of each boundary kind
export const BOUNDARY_STYLES: Readonly<
  Record<BoundaryKind, { color: string; width: number; dash?: string }>
> = {
  liquidus: { color: `#1565c0`, width: 2.5 },
  solidus: { color: `#2e7d32`, width: 2 },
  solvus: { color: `#7b1fa2`, width: 1.5, dash: `5,3` },
  transus: { color: `#ef6c00`, width: 1.5, dash: `2,3` },
  invariant: { color: `#d32f2f`, width: 2 },
  miscibility_gap: { color: `#6d4c41`, width: 2, dash: `6,3` },
}
// Every boundary of an overlay diagram shares one dashed stroke in the overlay color
export const OVERLAY_DASH = `7,4`

// Marker label of each invariant kind
const INVARIANT_LABELS: Readonly<Record<string, string>> = {
  eutectic: `E`,
  eutectoid: `Ed`,
  monotectic: `M`,
  metatectic: `Mt`,
  peritectic: `P`,
  peritectoid: `Pd`,
  syntectic: `S`,
}

// Problems that keep a value from rendering as a binary-phase-diagram/2 (empty when valid).
// Phase ids are checked everywhere they are referenced, so lookups by id never miss.
export function diagram_errors(data: BinaryPhaseDiagram): string[] {
  if (data.format !== BINARY_DIAGRAM_FORMAT) {
    return [`format is ${JSON.stringify(data.format)}, expected "${BINARY_DIAGRAM_FORMAT}"`]
  }
  const errors: string[] = []
  const { components, temperature_range, phases } = data
  if (components?.length !== 2 || !components.every((comp) => typeof comp === `string`)) {
    errors.push(`components must be two strings, got ${JSON.stringify(components)}`)
  }
  const [t_min, t_max] = temperature_range ?? []
  if (!(Number.isFinite(t_min) && Number.isFinite(t_max) && t_min < t_max)) {
    errors.push(
      `temperature_range must be [min, max] K, got ${JSON.stringify(temperature_range)}`,
    )
  }
  if (data.regions !== undefined && !Array.isArray(data.regions)) {
    errors.push(`regions must be an array when present`)
  }
  for (const key of [
    `phases`,
    `boundaries`,
    `invariants`,
    `congruent_points`,
    `critical_points`,
    `unary_transitions`,
  ] as const) {
    if (!Array.isArray(data[key])) errors.push(`${key} must be an array`)
  }
  if (errors.length) return errors

  const ids = phases.map(({ id }) => id)
  const repeat = ids.find((id, idx) => ids.indexOf(id) !== idx)
  if (repeat !== undefined) errors.push(`duplicate phase id "${repeat}"`)
  const known = new Set(ids)
  const check_ids = (where: string, refs: readonly string[]) => {
    const unknown = refs.filter((ref) => !known.has(ref))
    if (unknown.length) errors.push(`${where} references unknown phase ${unknown.join(`, `)}`)
  }
  diagram_regions(data).forEach(({ phases: refs, vertices }, idx) => {
    check_ids(`regions[${idx}]`, refs)
    if (vertices.length < 3) errors.push(`regions[${idx}] has ${vertices.length} vertices`)
  })
  data.boundaries.forEach(({ kind, phases: refs, side, points }, idx) => {
    check_ids(`boundaries[${idx}]`, refs)
    if (side != null && !refs.includes(side)) {
      errors.push(`boundaries[${idx}] side "${side}" is not one of its phases`)
    }
    if (!(kind in BOUNDARY_STYLES))
      errors.push(`boundaries[${idx}] has unknown kind "${kind}"`)
    if (points.length < 2) errors.push(`boundaries[${idx}] has ${points.length} points`)
  })
  data.invariants.forEach(({ phases: refs, compositions, reaction }, idx) => {
    check_ids(`invariants[${idx}]`, [...refs, ...reaction_phase_ids(reaction)])
    if (compositions.length !== refs.length) {
      errors.push(
        `invariants[${idx}] has ${refs.length} phases but ${compositions.length} compositions`,
      )
    }
  })
  data.congruent_points.forEach(({ phases: refs }, idx) =>
    check_ids(`congruent_points[${idx}]`, refs),
  )
  data.critical_points.forEach(({ phase }, idx) =>
    check_ids(`critical_points[${idx}]`, [phase]),
  )
  data.unary_transitions.forEach(({ component, above, below }, idx) => {
    check_ids(`unary_transitions[${idx}]`, [above, below])
    if (!components.includes(component)) {
      errors.push(
        `unary_transitions[${idx}] component "${component}" is not a diagram component`,
      )
    }
  })
  return errors
}

// Regions of a diagram (none until the emitter derives them)
export const diagram_regions = ({ regions }: BinaryPhaseDiagram): DiagramRegion[] =>
  regions ?? []

// Description of a boundary edge from its side and phases, e.g. `L edge of (Ag) + L`
export function boundary_description(
  { kind, phases, side }: DiagramBoundary,
  label_of: (id: string) => string,
): string {
  const field = phases.map(label_of).join(` + `)
  if (!field) return kind
  return side ? `${kind} (${label_of(side)} edge of ${field})` : `${kind} of ${field}`
}

// Caption of a diagram's provenance: source, assessment and license, plus a warning for data
// not cleared for redistribution
export function provenance_caption({ provenance }: BinaryPhaseDiagram): string {
  const { source, assessment, license, redistribution } = provenance
  return [
    source,
    assessment && `assessment: ${assessment}`,
    license && `license: ${license}`,
    redistribution === `not_cleared` && `not cleared for redistribution`,
  ]
    .filter(Boolean)
    .join(`; `)
}

// Phase ids of a reaction string like `LIQUID -> FCC_A1#1 + FCC_A1#2`
const reaction_phase_ids = (reaction: string): string[] =>
  reaction
    .split(`->`)
    .flatMap((side) => side.split(`+`))
    .map((token) => token.trim())
    .filter(Boolean)

// Reaction with phase labels instead of ids, e.g. `L → (Ag) + (Cu)`
export const format_reaction = (reaction: string, label_of: (id: string) => string): string =>
  reaction
    .split(`->`)
    .map((side) =>
      side
        .split(`+`)
        .map((token) => label_of(token.trim()))
        .join(` + `),
    )
    .join(` → `)

// Phase id -> label lookup (ids are validated, so a miss is a caller bug)
export function phase_labeler(data: BinaryPhaseDiagram): (id: string) => string {
  const labels = new Map(data.phases.map(({ id, label }) => [id, label]))
  return (id) => {
    const label = labels.get(id)
    if (label === undefined) throw new Error(`Unknown phase id "${id}"`)
    return label
  }
}

// Region label from its phases' labels, e.g. `L + (Ag)`
export const region_label = (
  region: DiagramRegion | null,
  label_of: (id: string) => string,
): string => (region ? region.phases.map(label_of).join(` + `) || `?` : `–`)

// 32-bit FNV-1a hash
function hash_string(text: string): number {
  let hash = 0x811c9dc5
  for (let idx = 0; idx < text.length; idx++) {
    hash ^= text.charCodeAt(idx)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// Opaque color per phase id, a pure function of the phase list: the first liquid is sky blue,
// every other phase takes the palette slot its model phase hashes to (the next free slot on a
// collision, visiting phases in id order). The same phases give the same colors in every
// diagram, and a miscibility gap's composition sets get distinct neighboring slots.
export function phase_colors(phases: BinaryPhaseDiagram[`phases`]): Map<string, string> {
  const colors = new Map<string, string>()
  const taken = new Set<number>()
  let liquid_taken = false
  const n_slots = SOLID_PHASE_PALETTE.length
  for (const { id, kind, model_phase } of phases.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    if (kind === `liquid` && !liquid_taken) {
      liquid_taken = true
      colors.set(id, LIQUID_COLOR)
      continue
    }
    let slot = hash_string(model_phase) % n_slots
    for (let tries = 0; taken.has(slot) && tries < n_slots; tries++)
      slot = (slot + 1) % n_slots
    taken.add(slot)
    colors.set(id, SOLID_PHASE_PALETTE[slot])
  }
  return colors
}

// Translucent fill of a single-phase region
export const region_fill_color = (hex: string): string => add_alpha(hex, 0.55)

// Invariant, congruent, critical and pure-component points with labels and descriptions
export function diagram_points(data: BinaryPhaseDiagram): DiagramPoint[] {
  const label_of = phase_labeler(data)
  const is_liquid = new Set(
    data.phases.filter(({ kind }) => kind === `liquid`).map(({ id }) => id),
  )
  return [
    ...data.invariants.map(({ kind, temperature, compositions, reaction }): DiagramPoint => ({
      category: `invariant`,
      kind,
      // phases are in order of increasing x: the middle one reacts (eutectic-type) or forms
      // (peritectic-type)
      composition: compositions[Math.floor(compositions.length / 2)],
      temperature,
      marker_label: INVARIANT_LABELS[kind] ?? ``,
      description: format_reaction(reaction, label_of),
    })),
    ...data.congruent_points.map(({ temperature, composition, phases }): DiagramPoint => ({
      category: `congruent`,
      kind: `congruent`,
      composition,
      temperature,
      marker_label: ``,
      description: `${phases.map(label_of).join(` ⇌ `)} without composition change`,
    })),
    ...data.critical_points.map(({ temperature, composition, phase }): DiagramPoint => ({
      category: `critical`,
      kind: `critical`,
      composition,
      temperature,
      marker_label: ``,
      description: `${label_of(phase)} miscibility gap closes`,
    })),
    ...data.unary_transitions.map(({ component, temperature, above, below }): DiagramPoint => {
      const melting = is_liquid.has(above)
      return {
        category: `unary`,
        kind: melting ? `melting` : `transition`,
        composition: data.components.indexOf(component),
        temperature,
        marker_label: melting ? `Tₘ(${component})` : ``,
        description: `${component}: ${label_of(above)} → ${label_of(below)}`,
      }
    }),
  ]
}

// Badge text of a marked point in tooltips
export const point_badge = ({ category, kind }: DiagramPoint): string =>
  category === `unary` ? humanize(`${kind}_point`) : humanize(kind)

// Legend name of a diagram from its provenance, e.g. `Assessment`, `Model: demo-model`
export const diagram_name = ({ provenance }: BinaryPhaseDiagram): string =>
  provenance.model
    ? `${humanize(provenance.kind)}: ${provenance.model}`
    : humanize(provenance.kind)

// Temperature window (K) spanning every given diagram's computed range
export function temperature_extent(diagrams: readonly BinaryPhaseDiagram[]): Vec2 {
  const ranges = diagrams.map(({ temperature_range }) => temperature_range)
  return [
    Math.min(...ranges.map(([t_min]) => t_min)),
    Math.max(...ranges.map(([, t_max]) => t_max)),
  ]
}

// Marker color of each observation status
export const OBSERVATION_STATUS_COLORS: Readonly<Record<ObservationStatus, string>> = {
  ok: `#2e7d32`,
  needs_verification: `#ef6c00`,
  needs_value: `#757575`,
}

// Drawable markers of observation rows: one per phase with a composition, at the row's
// temperature (so an invariant's phases share one isotherm). A row without phases whose system
// is one of the components (a pure-component melting point) sits on that composition edge.
// Rows without a temperature or composition are not drawn.
export function observation_markers(
  rows: readonly PhaseObservation[],
  components: readonly string[],
): ObservationMarker[] {
  return rows.flatMap((row): ObservationMarker[] => {
    const { T_K: temperature, phases = [], system } = row
    if (temperature == null || !Number.isFinite(temperature)) return []
    if (phases.length === 0) {
      const edge = system === undefined ? -1 : components.indexOf(system)
      return edge === -1 ? [] : [{ row, phase: null, composition: edge, temperature }]
    }
    return phases.flatMap((phase) =>
      phase.x == null || !Number.isFinite(phase.x)
        ? []
        : [{ row, phase, composition: phase.x, temperature }],
    )
  })
}
