// Semantics of the binary-phase-diagram/2 format: validation, phase labels and colors, marked
// points, boundary styles, and the observation layer drawn on top of a diagram

import { hsl } from 'd3-color'
import { format_num, humanize } from '#lib/labels.js'
import type { Vec2 } from '#lib/math.js'
import {
  BINARY_DIAGRAM_FORMAT,
  type BinaryPhaseDiagram,
  type BoundaryKind,
  type CompUnit,
  type DiagramBoundary,
  type DiagramHit,
  type DiagramPoint,
  type DiagramRegion,
  type InvariantKind,
  type LeverRuleResult,
  type ObservationMarker,
  type ObservationPrediction,
  type ObservedPhase,
  type ObservationStatus,
  type PhaseHoverInfo,
  type PhaseObservation,
  type PointRef,
  type TempUnit,
} from './types'
import {
  calculate_lever_rule,
  find_region_at,
  format_composition,
  format_temperature,
  LIQUID_COLOR,
  SOLID_PHASE_PALETTE,
} from './utils'

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
  magnetic: { color: `#455a64`, width: 1.5, dash: `8,3,2,3` },
  polymorphic: { color: `#00838f`, width: 1.5, dash: `1,3` },
}
// Every boundary of an overlay diagram shares one dashed stroke in that overlay's color: the
// first overlay takes config.colors.overlay, later ones step through these
const OVERLAY_DASH = `7,4`
const OVERLAY_STYLES = [
  { color: `#e6007e`, dash: OVERLAY_DASH },
  { color: `#ef6c00`, dash: `3,3` },
  { color: `#00838f`, dash: `10,3,2,3` },
  { color: `#6a1b9a`, dash: `5,2` },
  { color: `#558b2f`, dash: `2,2,6,2` },
] as const
export const overlay_style = (idx: number, first_color: string) => {
  const { color, dash } = OVERLAY_STYLES[idx % OVERLAY_STYLES.length]
  return { color: idx ? color : first_color, dash }
}

// Marker color and legend label of a scored observation's verdict
export const VERDICT_STYLES = {
  pass: { color: `#2e7d32`, label: `Observed, model passes` },
  fail: { color: `#d32f2f`, label: `Observed, model fails` },
} as const

// Marker label of each invariant kind
const INVARIANT_LABELS: Readonly<Record<InvariantKind, string>> = {
  eutectic: `E`,
  eutectoid: `Ed`,
  monotectic: `M`,
  metatectic: `Mt`,
  peritectic: `P`,
  peritectoid: `Pd`,
  syntectic: `S`,
  inverse_melting: `IM`,
}

const PHASE_KINDS: readonly string[] = [`liquid`, `solid`, `gas`]
const PROVENANCE_KINDS: readonly string[] = [`assessment`, `model`, `sketch`]
const finite = (val: unknown): val is number => Number.isFinite(val)
const is_point = (point: unknown): boolean =>
  Array.isArray(point) && point.length === 2 && point.every(finite)
const length = (list: unknown): number => (Array.isArray(list) ? list.length : 0)
const in_unit = (val: unknown): boolean => finite(val) && val >= 0 && val <= 1
const non_negative = (val: unknown): boolean => finite(val) && val >= 0
const increasing = (list: unknown): boolean =>
  Array.isArray(list) &&
  list.length >= 2 &&
  list.every((val, idx) => finite(val) && (!idx || list[idx - 1] < val))
// region and boundary x may stray past [0, 1] by float noise, not by more
const X_TOL = 1e-9
const in_x_range = ([x_val]: Vec2): boolean => x_val >= -X_TOL && x_val <= 1 + X_TOL

// Problems that keep a value from rendering as a binary-phase-diagram/2 (empty when valid).
// Takes untrusted JSON and never throws: element shapes are checked before their fields are
// read, phase ids everywhere they are referenced (so lookups by id never miss), and every
// coordinate the renderer scales is a finite number (x a mole fraction in [0, 1]).
export function diagram_errors(value: unknown): string[] {
  if (typeof value !== `object` || value === null || Array.isArray(value)) {
    return [`a diagram is a JSON object, got ${JSON.stringify(value)}`]
  }
  // fields are read through checks that accept any value, so this cast never trusts them
  const data = value as BinaryPhaseDiagram & { error?: unknown }
  if (typeof data.error === `string`) return [`emitter failure record: ${data.error}`]
  if (data.format !== BINARY_DIAGRAM_FORMAT) {
    return [`format is ${JSON.stringify(data.format)}, expected "${BINARY_DIAGRAM_FORMAT}"`]
  }
  const errors: string[] = []
  const { components, temperature_range, phases, provenance } = data
  if (
    !Array.isArray(components) ||
    components.length !== 2 ||
    !components.every((comp) => typeof comp === `string`) ||
    components[0] === components[1]
  ) {
    errors.push(`components must be two distinct strings, got ${JSON.stringify(components)}`)
  }
  if (
    !is_point(temperature_range) ||
    !(0 <= temperature_range[0] && temperature_range[0] < temperature_range[1])
  ) {
    errors.push(
      `temperature_range must be [min, max] K, got ${JSON.stringify(temperature_range)}`,
    )
  }
  if (!PROVENANCE_KINDS.includes(provenance?.kind)) {
    errors.push(`provenance must be an object with kind ${PROVENANCE_KINDS.join(` | `)}`)
  }
  const lists = [
    `phases`,
    `boundaries`,
    `invariants`,
    `congruent_points`,
    `critical_points`,
    `unary_transitions`,
    `regions`,
    `polymorphic_transitions`,
  ] as const
  for (const key of lists) {
    const list: unknown = data[key]
    if (!Array.isArray(list)) errors.push(`${key} must be an array`)
    else if (list.some((item) => typeof item !== `object` || item === null)) {
      errors.push(`${key} must hold objects`)
    }
  }
  if (errors.length) return errors

  phases.forEach(({ id, label, model_phase, kind }, idx) => {
    if (![id, label, model_phase].every((field) => typeof field === `string`)) {
      errors.push(`phases[${idx}] needs string id, label and model_phase`)
    }
    if (!PHASE_KINDS.includes(kind)) {
      errors.push(`phases[${idx}] kind must be ${PHASE_KINDS.join(` | `)}, got "${kind}"`)
    }
  })
  const ids = phases.map(({ id }) => id)
  const repeat = ids.find((id, idx) => ids.indexOf(id) !== idx)
  if (repeat !== undefined) errors.push(`duplicate phase id "${repeat}"`)
  const known = new Set<unknown>(ids)
  const check_ids = (where: string, refs: unknown) => {
    if (!Array.isArray(refs)) errors.push(`${where} phases must be an array of ids`)
    else if (refs.some((ref) => !known.has(ref))) {
      const unknown = refs.filter((ref) => !known.has(ref))
      errors.push(`${where} references unknown phase ${unknown.join(`, `)}`)
    }
  }
  const check_points = (where: string, points: unknown, min: number, noun: string) => {
    if (length(points) < min) errors.push(`${where} has ${length(points)} ${noun}`)
    else if (!(points as unknown[]).every(is_point)) {
      errors.push(`${where} ${noun} must be [x, T] number pairs`)
    } else if (!(points as Vec2[]).every(in_x_range)) {
      errors.push(`${where} ${noun} need x in [0, 1]`)
    }
  }
  // marked points sit at a finite T and a mole fraction in [0, 1]
  const check_position = (where: string, temperature: unknown, compositions: unknown[]) => {
    if (!finite(temperature) || !compositions.every(in_unit)) {
      errors.push(`${where} needs a finite temperature and compositions in [0, 1]`)
    }
  }
  data.regions.forEach(({ phases: refs, vertices }, idx) => {
    const where = `regions[${idx}]`
    check_ids(where, refs)
    if (![1, 2].includes(length(refs)) || new Set(refs).size !== length(refs)) {
      errors.push(`${where} needs one phase or two distinct phases`)
    }
    check_points(where, vertices, 3, `vertices`)
  })
  data.boundaries.forEach(({ kind, phases: refs, side, points }, idx) => {
    const where = `boundaries[${idx}]`
    check_ids(where, refs)
    if (side != null && !(Array.isArray(refs) && refs.includes(side))) {
      errors.push(`${where} side "${side}" is not one of its phases`)
    }
    if (!Object.hasOwn(BOUNDARY_STYLES, kind))
      errors.push(`${where} has unknown kind "${kind}"`)
    if (kind === `magnetic` && (length(refs) !== 1 || side != null)) {
      errors.push(`${where} is magnetic: one phase and no side`)
    }
    if (
      (kind === `polymorphic` || kind === `invariant`) &&
      (length(refs) !== 3 || side != null)
    ) {
      errors.push(`${where} is ${kind}: three phases and no side`)
    }
    check_points(where, points, 2, `points`)
    const { sigma_T } = data.boundaries[idx]
    if (
      sigma_T !== undefined &&
      !(
        Array.isArray(sigma_T) &&
        sigma_T.length === length(points) &&
        sigma_T.every(non_negative)
      )
    ) {
      errors.push(`${where} sigma_T needs one non-negative number per point`)
    }
  })
  const point_lists = [`invariants`, `congruent_points`, `unary_transitions`] as const
  for (const key of point_lists) {
    data[key].forEach(({ sigma_T }, idx) => {
      if (sigma_T !== undefined && !non_negative(sigma_T)) {
        errors.push(`${key}[${idx}] sigma_T must be a non-negative number`)
      }
    })
  }
  if (data.gibbs_energy !== undefined) {
    const model_phases = new Set<unknown>(phases.map(({ model_phase }) => model_phase))
    errors.push(...gibbs_errors(data.gibbs_energy, model_phases))
  }
  data.invariants.forEach(
    ({ kind, temperature, phases: refs, compositions, reaction }, idx) => {
      const where = `invariants[${idx}]`
      if (!Object.hasOwn(INVARIANT_LABELS, kind))
        errors.push(`${where} has unknown kind "${kind}"`)
      const sides = typeof reaction === `string` ? reaction_sides(reaction) : []
      if (sides.length !== 2 || sides.flat().some((token) => !token)) {
        errors.push(
          `${where} reaction must read "A [+ B] -> C [+ D]", got ${JSON.stringify(reaction)}`,
        )
      } else check_ids(`${where} reaction`, sides.flat())
      check_ids(where, refs)
      if (length(refs) !== 3 || length(compositions) !== 3) {
        errors.push(
          `${where} needs 3 phases and 3 compositions, got ${length(refs)} and ${length(compositions)}`,
        )
      } else {
        check_position(where, temperature, compositions)
        if (
          !compositions.every(
            (comp, comp_idx) => !comp_idx || compositions[comp_idx - 1] <= comp,
          )
        ) {
          errors.push(`${where} compositions must increase with x`)
        }
      }
    },
  )
  data.congruent_points.forEach(({ phases: refs, temperature, composition }, idx) => {
    check_ids(`congruent_points[${idx}]`, refs)
    check_position(`congruent_points[${idx}]`, temperature, [composition])
  })
  data.critical_points.forEach(({ phase, temperature, composition }, idx) => {
    check_ids(`critical_points[${idx}]`, [phase])
    check_position(`critical_points[${idx}]`, temperature, [composition])
  })
  data.unary_transitions.forEach(({ component, temperature, above, below }, idx) => {
    check_ids(`unary_transitions[${idx}]`, [above, below])
    check_position(`unary_transitions[${idx}]`, temperature, [])
    if (!components.includes(component)) {
      errors.push(
        `unary_transitions[${idx}] component "${component}" is not a diagram component`,
      )
    }
  })
  data.polymorphic_transitions.forEach(({ temperature, composition, above, below }, idx) => {
    check_ids(`polymorphic_transitions[${idx}]`, [above, below])
    check_position(`polymorphic_transitions[${idx}]`, temperature, [composition])
  })
  return errors
}

// Problems of an optional gibbs_energy grid: increasing axes, known model phases and one
// finite-or-null value per grid node
function gibbs_errors(grid: unknown, model_phases: Set<unknown>): string[] {
  const where = `gibbs_energy`
  if (typeof grid !== `object` || grid === null) return [`${where} must be an object`]
  const { temperatures, compositions, phases } = grid as Record<string, unknown>
  if (!increasing(temperatures) || !increasing(compositions)) {
    return [`${where} temperatures and compositions must be increasing number arrays`]
  }
  // ΔG_mix subtracts the line joining the hull's ends, so the grid spans both pure components
  const comps = compositions as number[]
  if (comps[0] !== 0 || comps.at(-1) !== 1) {
    return [`${where} compositions must run from 0 to 1, got ${comps[0]} to ${comps.at(-1)}`]
  }
  if (!Array.isArray(phases)) return [`${where} phases must be an array`]
  const names = phases.map(
    (phase: unknown) => (phase as { model_phase?: unknown })?.model_phase,
  )
  const repeat = names.find((name, idx) => names.indexOf(name) !== idx)
  if (repeat !== undefined) {
    return [`${where} has duplicate model_phase ${JSON.stringify(repeat)}`]
  }
  const [n_temps, n_comps] = [length(temperatures), length(compositions)]
  return phases.flatMap((phase: unknown, idx) => {
    const { model_phase, values } = (phase ?? {}) as Record<string, unknown>
    if (!model_phases.has(model_phase)) {
      return [`${where}.phases[${idx}] references unknown model phase ${model_phase}`]
    }
    const shaped =
      length(values) === n_temps &&
      (values as unknown[]).every(
        (row) =>
          length(row) === n_comps &&
          (row as unknown[]).every((val) => val === null || finite(val)),
      )
    return shaped
      ? []
      : [`${where}.phases[${idx}] values must be ${n_temps} x ${n_comps} numbers or nulls`]
  })
}

// Value as a binary-phase-diagram/2, throwing its joined diagram_errors when invalid
export function parse_diagram(value: unknown): BinaryPhaseDiagram {
  const errors = diagram_errors(value)
  if (errors.length) throw new Error(`Invalid phase diagram: ${errors.join(`; `)}`)
  return value as BinaryPhaseDiagram
}

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

// Phase ids on each side of a reaction string like `LIQUID -> FCC_A1#1 + FCC_A1#2`
const reaction_sides = (reaction: string): string[][] =>
  reaction.split(`->`).map((side) => side.split(`+`).map((token) => token.trim()))

// Reaction with phase labels instead of ids, e.g. `L → (Ag) + (Cu)`
export const format_reaction = (reaction: string, label_of: (id: string) => string): string =>
  reaction_sides(reaction)
    .map((side) => side.map(label_of).join(` + `))
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
): string => (region ? region.phases.map(label_of).join(` + `) : `–`)

// 32-bit FNV-1a hash
function hash_string(text: string): number {
  let hash = 0x811c9dc5
  for (let idx = 0; idx < text.length; idx++) {
    hash ^= text.charCodeAt(idx)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// Sorted unique model phases of the given diagrams: pass the same list as `phase_color_keys`
// to every diagram of a comparison so a shared model phase gets one color in all of them
export const model_phase_keys = (diagrams: readonly BinaryPhaseDiagram[]): string[] =>
  [
    ...new Set(diagrams.flatMap(({ phases }) => phases.map(({ model_phase }) => model_phase))),
  ].toSorted()

// Lightness (HSL) drop per composition-set index: FCC_A1 keeps the base color, FCC_A1#1 and
// FCC_A1#2 get progressively darker shades of the same hue, so (Ag) | (Ag) + (Cu) | (Cu) and
// a gap inside a wrapping fcc field stay distinguishable while reading as one phase.
// Shades go darker, not lighter, since the palette's pastels already sit near white.
const COMPOSITION_SET_SHADE = 0.09
const GOLDEN_ANGLE_DEG = 137.508

// Opaque color per phase id, a function of model_phase and the color keys only: the color keys
// (the diagram's own model phases plus any `color_keys`, sorted) each take the palette slot
// they hash to, the next free slot on a collision. Liquid phases are sky blue (their keys
// still take a slot, so no slot depends on which diagram knows a key's kind). Ids sharing a
// model phase share its hue, a `#n` composition set shaded n steps darker. Diagrams given the
// same `color_keys` (e.g. model_phase_keys of all compared diagrams) color shared model phases
// identically, whatever phases only one of them has.
export function phase_colors(
  phases: BinaryPhaseDiagram[`phases`],
  color_keys: readonly string[] = [],
): Map<string, string> {
  const keys = new Set([...color_keys, ...phases.map(({ model_phase }) => model_phase)])
  const n_slots = SOLID_PHASE_PALETTE.length
  const taken = new Set<number>()
  const key_colors = new Map<string, string>()
  for (const [key_idx, key] of [...keys].toSorted().entries()) {
    // past the palette, further keys step around the hue circle by the golden angle
    if (key_idx >= n_slots) {
      const hue = ((key_idx - n_slots) * GOLDEN_ANGLE_DEG) % 360
      key_colors.set(key, hsl(hue, 0.5, 0.78).formatHex())
      continue
    }
    let slot = hash_string(key) % n_slots
    while (taken.has(slot)) slot = (slot + 1) % n_slots
    taken.add(slot)
    key_colors.set(key, SOLID_PHASE_PALETTE[slot])
  }
  return new Map(
    phases.map(({ id, kind, model_phase }) => {
      const base = kind === `liquid` ? LIQUID_COLOR : key_colors.get(model_phase)
      if (base === undefined) throw new Error(`No color key for model phase "${model_phase}"`)
      const set_idx = Number(/#(?<set>\d+)$/.exec(id)?.groups?.set ?? 0)
      if (!set_idx) return [id, base]
      const shade = hsl(base)
      shade.l = Math.max(0, shade.l - COMPOSITION_SET_SHADE * set_idx)
      return [id, shade.formatHex()]
    }),
  )
}

// Invariant, congruent, critical, pure-component and polymorphic points with labels and descriptions
export function diagram_points(data: BinaryPhaseDiagram): DiagramPoint[] {
  const label_of = phase_labeler(data)
  const is_liquid = new Set(
    data.phases.filter(({ kind }) => kind === `liquid`).map(({ id }) => id),
  )
  return [
    ...data.invariants.map(
      ({ kind, temperature, compositions, reaction, phases, sigma_T = 0 }): DiagramPoint => ({
        category: `invariant`,
        phases,
        kind,
        // phases are in order of increasing x: the middle one reacts (eutectic-type) or forms
        // (peritectic-type)
        composition: compositions[Math.floor(compositions.length / 2)],
        temperature,
        marker_label: INVARIANT_LABELS[kind],
        description: format_reaction(reaction, label_of),
        sigma_T,
      }),
    ),
    ...data.congruent_points.map(
      ({ temperature, composition, phases, sigma_T = 0 }): DiagramPoint => ({
        category: `congruent`,
        phases,
        kind: `congruent`,
        composition,
        temperature,
        marker_label: ``,
        description: `${phases.map(label_of).join(` ⇌ `)} without composition change`,
        sigma_T,
      }),
    ),
    ...data.critical_points.map(({ temperature, composition, phase }): DiagramPoint => ({
      category: `critical`,
      phases: [phase],
      kind: `critical`,
      composition,
      temperature,
      marker_label: ``,
      description: `${label_of(phase)} miscibility gap closes`,
      sigma_T: 0,
    })),
    ...data.unary_transitions.map(
      ({ component, temperature, above, below, sigma_T = 0 }): DiagramPoint => {
        const melting = is_liquid.has(above)
        return {
          category: `unary`,
          phases: [above, below],
          kind: melting ? `melting` : `transition`,
          composition: data.components.indexOf(component),
          temperature,
          marker_label: melting ? `Tₘ(${component})` : ``,
          description: `${component}: ${label_of(above)} → ${label_of(below)}`,
          sigma_T,
        }
      },
    ),
    ...data.polymorphic_transitions.map(
      ({ temperature, composition, above, below }): DiagramPoint => ({
        category: `polymorphic`,
        phases: [above, below],
        kind: `polymorphic`,
        composition,
        temperature,
        marker_label: ``,
        description: `${label_of(above)} → ${label_of(below)} at fixed composition`,
        sigma_T: 0,
      }),
    ),
  ]
}

// The point a PointRef names among `points`: of its category, the one sharing the largest
// share of its phases, then of its kind, then nearest by distance in x and in T scaled by
// `t_span` (K), so the pairing doesn't depend on plot size or zoom. `names_of` gives a phase
// id's names (model phase, label, stand-in target). Null when no point shares the category.
export function match_point(
  points: readonly DiagramPoint[],
  { category, kind, at: [x_ref, t_ref], phases = [] }: PointRef,
  t_span: number,
  names_of: (id: string) => readonly string[],
): DiagramPoint | null {
  const wanted = new Set(phases)
  // most shared phases first, then fewest extra ones (counts, since a ref names each phase
  // by model phase and label)
  const ranked = points
    .filter((point) => point.category === category)
    .map((point) => {
      const shared = point.phases.filter((id) =>
        names_of(id).some((name) => wanted.has(name)),
      ).length
      return {
        point,
        shared,
        extra: point.phases.length - shared,
        same_kind: point.kind === kind ? 1 : 0,
        dist: Math.hypot(point.composition - x_ref, (point.temperature - t_ref) / t_span),
      }
    })
    .toSorted(
      (rank_a, rank_b) =>
        rank_b.shared - rank_a.shared ||
        rank_a.extra - rank_b.extra ||
        rank_b.same_kind - rank_a.same_kind ||
        rank_a.dist - rank_b.dist,
    )
  return ranked[0]?.point ?? null
}

// A point's PointRef as a diagram writes it into the bound highlight, its phases named by
// model phase and label
export function point_ref(point: DiagramPoint, data: BinaryPhaseDiagram): PointRef {
  const by_id = new Map(data.phases.map((phase) => [phase.id, phase]))
  const { category, kind, composition, temperature } = point
  const phases = point.phases.flatMap((id) => {
    const phase = by_id.get(id)
    return phase ? [phase.model_phase, phase.label] : [id]
  })
  return { category, kind, at: [composition, temperature], phases: [...new Set(phases)] }
}

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

// Marker color and legend label of each observation status
const OBSERVATION_STATUS: Readonly<
  Record<ObservationStatus, { color: string; label: string }>
> = {
  ok: { color: `#2e7d32`, label: `Observed` },
  needs_verification: { color: `#ef6c00`, label: `Observed (unverified)` },
  needs_value: { color: `#757575`, label: `Observed (incomplete)` },
}
// Observation rows are untyped JSON: a status outside the known ones is drawn gray
export const status_color = (status: string): string =>
  OBSERVATION_STATUS[status as ObservationStatus]?.color ?? `#757575`
export const status_label = (status: string): string =>
  OBSERVATION_STATUS[status as ObservationStatus]?.label ?? `Observed (${status})`

// Drawable markers of the observation rows of this binary: one per phase with a composition,
// at the row's temperature (so an invariant's phases share one isotherm). Rows of the reversed
// system (B-A on an A-B diagram) have their compositions mirrored; a row without phases whose
// system is one component (a pure-component melting point) sits on that composition edge.
// Rows of other systems, and rows without a temperature or composition, are not drawn.
// A prediction of a row (matched by id) gives each marker its predicted x and T (null where
// it predicts none) and the verdict.
export function observation_markers(
  rows: readonly PhaseObservation[],
  [comp_a, comp_b]: readonly string[],
  predictions: readonly ObservationPrediction[] = [],
): ObservationMarker[] {
  const by_id = new Map(predictions.map((prediction) => [prediction.id, prediction]))
  return rows.flatMap((row): ObservationMarker[] => {
    const { T_K: temperature, phases = [], system } = row
    if (!finite(temperature)) return []
    const { T_K, x: predicted_xs = [], pass = null } = by_id.get(row.id) ?? {}
    const predicted_t = finite(T_K) ? T_K : null
    const marker = (
      phase: ObservedPhase | null,
      composition: number,
      predicted_x: number | null,
    ): ObservationMarker => ({
      row,
      phase,
      composition,
      temperature,
      predicted_x,
      predicted_t,
      pass,
    })
    if (phases.length === 0) {
      const edge = [comp_a, comp_b].indexOf(system)
      return edge === -1 ? [] : [marker(null, edge, null)]
    }
    const mirrored = system === `${comp_b}-${comp_a}`
    if (!mirrored && system !== `${comp_a}-${comp_b}`) return []
    const orient = (x_val: number) => (mirrored ? 1 - x_val : x_val)
    return phases.flatMap((phase, idx) => {
      if (!finite(phase.x)) return []
      const model_x = predicted_xs[idx]
      return [marker(phase, orient(phase.x), finite(model_x) ? orient(model_x) : null)]
    })
  })
}

// Region and lever rule of a diagram at (composition, temperature)
export function diagram_hit(
  { regions }: BinaryPhaseDiagram,
  composition: number,
  temperature: number,
): DiagramHit {
  const region = find_region_at(regions, composition, temperature)
  return {
    region,
    lever_rule: region && calculate_lever_rule(region, composition, temperature),
  }
}

// Lever rule as one [phase label, phase fraction, tie-line end composition] row per end
export function lever_rule_rows(
  lever_rule: LeverRuleResult,
  label_of: (id: string) => string,
): [string, number, number][] {
  const { left_phase, right_phase, fraction_left, fraction_right } = lever_rule
  const { left_composition, right_composition } = lever_rule
  return [
    [label_of(left_phase), fraction_left, left_composition],
    [label_of(right_phase), fraction_right, right_composition],
  ]
}

// Hover info as copyable text for the clipboard, with each shown overlay's phase set at the
// same (x, T) (info.overlay_hits, so it matches the tooltip, pinned snapshots included)
export function format_hover_info_text(
  info: PhaseHoverInfo,
  data: BinaryPhaseDiagram,
  {
    overlays = [],
    temp_unit = `K`,
    comp_unit = `at%`,
  }: {
    // in info.overlay_hits order, null for a hidden one
    overlays?: readonly (BinaryPhaseDiagram | null)[]
    temp_unit?: TempUnit
    comp_unit?: CompUnit
  } = {},
): string {
  const label_of = phase_labeler(data)
  const [component_a, component_b] = data.components
  const { composition, temperature } = info
  const comp = (value: number) => format_composition(value, comp_unit)
  const lines: string[] = [
    `Phase: ${region_label(info.region, label_of)}`,
    ...overlays.flatMap((overlay, idx) => {
      const hit = info.overlay_hits[idx]
      if (!overlay || !hit) return []
      // named like the tooltip: `Overlay` alone, each overlay's name among several
      const name = overlays.length > 1 ? diagram_name(overlay) : `Overlay`
      return [`${name} phase: ${region_label(hit.region, phase_labeler(overlay))}`]
    }),
    `Temperature: ${format_temperature(temperature, temp_unit)}`,
    `Composition: ${comp(composition)} ${component_b} (${comp(1 - composition)} ${component_a})`,
  ]
  if (info.lever_rule) {
    lines.push(``, `Lever Rule:`)
    for (const [phase, fraction, location] of lever_rule_rows(info.lever_rule, label_of)) {
      lines.push(`  ${phase}: ${format_num(fraction * 100, `.1f`)}% (at ${comp(location)})`)
    }
  }
  return lines.join(`\n`)
}
