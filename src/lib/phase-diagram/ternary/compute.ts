// Ternary T-x phase diagram from convex-hull entries: lower hulls of dG_f(T) over the Gibbs
// triangle at sampled temperatures, exact transition temperatures by bisection of hull topology
// changes, the balanced reactions behind each transition, and O(n) sections at any T in between.
import { format_composition_formula, sort_by_electronegativity } from '$lib/composition/format'
import { count_atoms_in_composition, get_reduced_formula } from '$lib/composition/reduce'
import {
  composition_to_barycentric_nd,
  TRIANGLE_VERTICES,
} from '$lib/convex-hull/barycentric-coords'
import { is_unary_entry } from '$lib/convex-hull/helpers'
import { compute_lower_hull_nd, process_hull_entries } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import type { Vec2, Vec3 } from '$lib/math'
import { build_free_energy_model, default_t_range } from './free-energy'
import type {
  Decomposition,
  DiagramPhase,
  DiagramProgress,
  IsothermalSection,
  PhaseEvent,
  PhaseFreeEnergy,
  Reaction,
  ReactionSide,
  TernaryPhaseDiagram,
  TernaryPhaseDiagramOptions,
} from './types'

const EPS = 1e-9
const WEIGHT_EPS = 1e-7
export const DEFAULT_N_SAMPLES = 64
export const DEFAULT_EVENT_TOLERANCE = 0.5 // K

// === Model ===

// Everything needed to evaluate a section at any temperature (cheap to build on any thread)
export interface DiagramModel {
  elements: [ElementSymbol, ElementSymbol, ElementSymbol]
  phases: DiagramPhase[]
  free_energies: PhaseFreeEnergy[]
  in_hull: boolean[] // false for exclude_from_hull entries (shown, never hull vertices)
  t_range: Vec2
}

export function prepare_diagram(
  entries: PhaseData[],
  options: TernaryPhaseDiagramOptions = {},
): DiagramModel {
  const normalized = entries.map((entry, idx) => {
    const composition = process_hull_entries([entry]).entries[0]?.composition
    if (!composition) {
      throw new Error(
        `Entry ${entry.entry_id ?? idx} has no recognizable elements in ${JSON.stringify(entry.composition)}`,
      )
    }
    return { ...entry, composition }
  })
  const found = [
    ...new Set(normalized.flatMap((entry) => Object.keys(entry.composition))),
  ] as ElementSymbol[]
  const elements = options.elements ?? sort_by_electronegativity(found)
  if (elements.length !== 3) {
    throw new Error(
      `Ternary phase diagram needs exactly 3 elements, got ${elements.length}: ${elements.join(`-`)}`,
    )
  }
  const foreign = found.filter((el) => !elements.includes(el))
  if (foreign.length > 0)
    throw new Error(
      `Entries contain ${foreign.join(`, `)} outside the ${elements.join(`-`)} system`,
    )
  // Synthetic corners for elements without a reference entry (dG_f = 0 by definition)
  for (const el of elements) {
    if (!normalized.some((entry) => is_unary_entry(entry) && entry.composition[el])) {
      normalized.push({
        composition: { [el]: 1 },
        energy: 0,
        entry_id: `synthetic-element:${el}`,
        reduced_formula: el,
      })
    }
  }
  const model = build_free_energy_model(normalized, elements, options.free_energy)
  const [el_a, el_b, el_c] = elements
  return {
    elements: [el_a, el_b, el_c],
    phases: normalized.map((entry, idx): DiagramPhase => {
      const barycentric = composition_to_barycentric_nd(entry.composition, elements) as Vec3
      const reduced = get_reduced_formula(entry.composition)
      return {
        idx,
        entry,
        label:
          entry.reduced_formula ??
          format_composition_formula(reduced, sort_by_electronegativity, true, ``),
        barycentric,
        xy: [0, 1].map((axis) =>
          barycentric.reduce(
            (sum, frac, corner) => sum + frac * TRIANGLE_VERTICES[corner][axis],
            0,
          ),
        ) as Vec2,
        n_atoms: count_atoms_in_composition(reduced),
        is_element: is_unary_entry(entry),
        source: model.phases[idx].source,
        t_range: model.phases[idx].t_range,
      }
    }),
    free_energies: model.phases,
    in_hull: normalized.map((entry) => !entry.exclude_from_hull),
    t_range: options.t_range ?? default_t_range(model),
  }
}

// === Hull at one temperature ===

interface HullTopology {
  temperature: number
  dg_form: Float64Array
  facets: number[][] // tie-triangles as phase-index triples
  stable: number[]
  edges: Vec2[]
  valid: boolean // false when an elemental reference is undefined at this temperature
}

const edge_key = ([idx_a, idx_b]: Vec2): number => idx_a * 1_000_003 + idx_b

function facet_edges(facets: number[][]): Vec2[] {
  const edges = new Map<number, Vec2>()
  for (const facet of facets) {
    for (const [pos, idx_a] of facet.entries()) {
      for (const idx_b of facet.slice(pos + 1)) {
        const edge: Vec2 = idx_a < idx_b ? [idx_a, idx_b] : [idx_b, idx_a]
        edges.set(edge_key(edge), edge)
      }
    }
  }
  return [...edges.values()].toSorted((lhs, rhs) => lhs[0] - rhs[0] || lhs[1] - rhs[1])
}

// Formation energies of every phase at T (NaN where undefined)
function dg_form_at(model: DiagramModel, temperature: number): Float64Array {
  return Float64Array.from(model.free_energies, ({ dg_form }) => {
    const value = dg_form(temperature)
    return Number.isFinite(value) ? value : NaN
  })
}

// Lower hull over `candidates` (phase indices, default all hull-eligible phases)
function hull_topology(
  model: DiagramModel,
  temperature: number,
  candidates?: number[],
): HullTopology {
  const { phases, in_hull } = model
  const dg_form = dg_form_at(model, temperature)
  const usable = (candidates ?? phases.map((_, idx) => idx)).filter(
    (idx) => in_hull[idx] && Number.isFinite(dg_form[idx]),
  )
  // Every corner needs a finite reference, else formation energies are meaningless here
  const corners = [0, 1, 2].map((corner) =>
    usable
      .filter((idx) => phases[idx].barycentric[corner] >= 1 - EPS)
      .reduce((best, idx) => (best === -1 || dg_form[idx] < dg_form[best] ? idx : best), -1),
  )
  if (corners.includes(-1))
    return { temperature, dg_form, facets: [], stable: [], edges: [], valid: false }
  const points = usable.map((idx) => [
    phases[idx].barycentric[1],
    phases[idx].barycentric[2],
    dg_form[idx],
  ])
  const hull = compute_lower_hull_nd(points).map((facet) =>
    facet.vertex_indices.map((vertex) => usable[vertex]),
  )
  // Coplanar input (only the corners, or everything at dG_f = 0): the hull is one triangle
  const facets = hull.length > 0 ? hull : [corners]
  const stable = [...new Set(facets.flat())].toSorted((lhs, rhs) => lhs - rhs)
  return { temperature, dg_form, facets, stable, edges: facet_edges(facets), valid: true }
}

// Barycentric weights of a point in a facet's projected triangle, written into `out` (hot path)
function facet_weights(
  phases: DiagramPhase[],
  facet: number[],
  x_pos: number,
  y_pos: number,
  out: Float64Array,
): boolean {
  const [pt_a, pt_b, pt_c] = [phases[facet[0]].xy, phases[facet[1]].xy, phases[facet[2]].xy]
  const det =
    (pt_b[1] - pt_c[1]) * (pt_a[0] - pt_c[0]) + (pt_c[0] - pt_b[0]) * (pt_a[1] - pt_c[1])
  if (Math.abs(det) < 1e-12) return false
  const w_a =
    ((pt_b[1] - pt_c[1]) * (x_pos - pt_c[0]) + (pt_c[0] - pt_b[0]) * (y_pos - pt_c[1])) / det
  const w_b =
    ((pt_c[1] - pt_a[1]) * (x_pos - pt_c[0]) + (pt_a[0] - pt_c[0]) * (y_pos - pt_c[1])) / det
  const w_c = 1 - w_a - w_b
  if (w_a < -WEIGHT_EPS || w_b < -WEIGHT_EPS || w_c < -WEIGHT_EPS) return false
  out.set([w_a, w_b, w_c])
  return true
}

// Which tie-triangle contains each composition and with what weights: independent of T, so
// computed once per topology and reused for every temperature in the interval
export interface FacetAssignment {
  facets: number[][]
  facet_of: Int32Array // -1 when outside the hull's domain
  weights: Float64Array // 3 per phase
}

export function assign_facets(
  model: Pick<DiagramModel, `phases`>,
  facets: number[][],
): FacetAssignment {
  const { phases } = model
  const facet_of = new Int32Array(phases.length).fill(-1)
  const weights = new Float64Array(3 * phases.length)
  const scratch = new Float64Array(3)
  for (const [idx, { xy }] of phases.entries()) {
    const facet_idx = facets.findIndex((facet) =>
      facet_weights(phases, facet, xy[0], xy[1], scratch),
    )
    if (facet_idx === -1) continue
    facet_of[idx] = facet_idx
    weights.set(scratch, 3 * idx)
  }
  return { facets, facet_of, weights }
}

function decomposition_of(facet: number[], weights: ArrayLike<number>): Decomposition {
  const members = facet
    .map((phase, pos) => ({ phase, weight: weights[pos] }))
    .filter(({ weight }) => weight > WEIGHT_EPS)
    .toSorted((lhs, rhs) => lhs.phase - rhs.phase)
  const total = members.reduce((sum, { weight }) => sum + weight, 0)
  return {
    phases: members.map(({ phase }) => phase),
    fractions: members.map(({ weight }) => weight / total),
  }
}

// Equilibrium assemblage of a composition in a section
export function decompose_composition(
  model: Pick<DiagramModel, `phases`>,
  section: Pick<IsothermalSection, `facets`>,
  xy: Vec2,
): Decomposition | null {
  const scratch = new Float64Array(3)
  const facet = section.facets.find((candidate) =>
    facet_weights(model.phases, candidate, xy[0], xy[1], scratch),
  )
  return facet ? decomposition_of(facet, scratch) : null
}

// Hull assemblage of a phase (stable phases decompose into themselves)
export function decompose_phase(
  model: Pick<DiagramModel, `phases`>,
  section: IsothermalSection,
  phase: number,
): Decomposition | null {
  if (!Number.isFinite(section.e_above_hull[phase])) return null
  if (section.stable.includes(phase)) return { phases: [phase], fractions: [1] }
  return decompose_composition(model, section, model.phases[phase].xy)
}

// Energy above the hull of every phase: dG - sum_k w_k dG_k over its containing facet
function e_above_hull_of(
  assignment: FacetAssignment,
  dg_form: Float64Array,
  stable: number[],
): Float64Array {
  const { facets, facet_of, weights } = assignment
  const out = new Float64Array(dg_form.length).fill(NaN)
  for (let idx = 0; idx < dg_form.length; idx++) {
    const facet = facets[facet_of[idx]]
    if (!facet || !Number.isFinite(dg_form[idx])) continue
    const dist =
      dg_form[idx] -
      facet.reduce((sum, vertex, pos) => sum + weights[3 * idx + pos] * dg_form[vertex], 0)
    out[idx] = Math.abs(dist) < EPS ? 0 : dist
  }
  for (const idx of stable) out[idx] = 0
  return out
}

function section_from_topology(
  model: DiagramModel,
  { temperature, dg_form, stable, facets, edges, valid }: HullTopology,
): IsothermalSection {
  const e_above_hull = valid
    ? e_above_hull_of(assign_facets(model, facets), dg_form, stable)
    : new Float64Array(dg_form.length).fill(NaN)
  return { temperature, dg_form, e_above_hull, stable, facets, edges }
}

// Full isothermal section at T, from scratch (one hull computation)
export const compute_section = (model: DiagramModel, temperature: number): IsothermalSection =>
  section_from_topology(model, hull_topology(model, temperature))

// Sections at arbitrary temperatures without recomputing the hull: the sweep found every
// transition, so the topology inside each interval is known and only the energies move
export function create_section_evaluator(
  model: DiagramModel,
  { events, sections }: TernaryPhaseDiagram,
) {
  const intervals = new Map<
    number,
    { assignment: FacetAssignment; stable: number[]; edges: Vec2[] }
  >()
  return {
    section_at(temperature: number): IsothermalSection {
      // Interval k holds [events[k-1].T, events[k].T); k = 0 is below the first transition
      let lo = 0
      let hi = events.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (events[mid].temperature <= temperature) lo = mid + 1
        else hi = mid
      }
      let interval = intervals.get(lo)
      if (!interval) {
        const { stable, facets } =
          lo === 0
            ? sections[0]
            : { stable: events[lo - 1].stable_after, facets: events[lo - 1].facets_after }
        interval = {
          assignment: assign_facets(model, facets),
          stable,
          edges: lo === 0 ? sections[0].edges : facet_edges(facets),
        }
        intervals.set(lo, interval)
      }
      const dg_form = dg_form_at(model, temperature)
      const { assignment, stable, edges } = interval
      return {
        temperature,
        dg_form,
        e_above_hull: e_above_hull_of(assignment, dg_form, stable),
        stable,
        facets: assignment.facets,
        edges,
      }
    },
  }
}

// Energy above hull of a phase at any T, linearly interpolated between sampled sections
export function e_above_hull_at(
  { temperatures, sections }: TernaryPhaseDiagram,
  phase: number,
  temperature: number,
): number {
  const above = temperatures.findIndex((sample) => sample >= temperature)
  const hi = above === -1 ? temperatures.length - 1 : Math.max(1, above) // clamp past t_max
  const lo = hi - 1
  const [e_lo, e_hi] = [sections[lo].e_above_hull[phase], sections[hi].e_above_hull[phase]]
  if (!Number.isFinite(e_lo) || !Number.isFinite(e_hi)) return e_hi
  return (
    e_lo +
    ((temperature - temperatures[lo]) / (temperatures[hi] - temperatures[lo])) * (e_hi - e_lo)
  )
}

// === Events ===

const signature = (topology: HullTopology): string =>
  topology.valid
    ? `${topology.stable.join(`,`)}|${topology.edges.map((edge) => edge.join(`-`)).join(`,`)}`
    : `invalid`

const without = <T>(
  from: readonly T[],
  minus: readonly T[],
  key: (item: T) => unknown = (item) => item,
): T[] => {
  const drop = new Set(minus.map(key))
  return from.filter((item) => !drop.has(key(item)))
}

// Normalize so the smallest coefficient is 1, then scale to small integers (up to ×24) if that
// makes every coefficient near-integer
function balance(
  reactants: ReactionSide,
  products: ReactionSide,
): [ReactionSide, ReactionSide] {
  const all = [...reactants, ...products]
  const base = Math.min(...all.map(({ coeff }) => coeff).filter((coeff) => coeff > 0)) || 1
  let coeffs = all.map(({ coeff }) => coeff / base)
  for (let mult = 1; mult <= 24; mult++) {
    const scaled = coeffs.map((coeff) => coeff * mult)
    if (scaled.every((val) => Math.abs(val - Math.round(val)) < 1e-3 * mult)) {
      coeffs = scaled.map(Math.round)
      break
    }
  }
  const apply = (side: ReactionSide, offset: number) =>
    side.map(({ phase }, pos) => ({ phase, coeff: coeffs[offset + pos] }))
  return [apply(reactants, 0), apply(products, reactants.length)]
}

// Atom fractions of `phases` → formula-unit coefficients relative to `n_atoms` atoms
const formula_units = (
  model: DiagramModel,
  phases: number[],
  fractions: number[],
  n_atoms: number,
): ReactionSide =>
  phases.map((phase, pos) => ({
    phase,
    coeff: (fractions[pos] * n_atoms) / model.phases[phase].n_atoms,
  }))

// Crossing of two tie-lines as parameters along each, or null
function crossing([pt_p, pt_q]: [Vec2, Vec2], [pt_r, pt_s]: [Vec2, Vec2]): Vec2 | null {
  const d_pq = [pt_q[0] - pt_p[0], pt_q[1] - pt_p[1]]
  const d_rs = [pt_s[0] - pt_r[0], pt_s[1] - pt_r[1]]
  const d_pr = [pt_r[0] - pt_p[0], pt_r[1] - pt_p[1]]
  const denom = d_pq[0] * d_rs[1] - d_pq[1] * d_rs[0]
  if (Math.abs(denom) < 1e-12) return null
  const t_pq = (d_pr[0] * d_rs[1] - d_pr[1] * d_rs[0]) / denom
  const t_rs = (d_pr[0] * d_pq[1] - d_pr[1] * d_pq[0]) / denom
  const inside = (val: number) => val > WEIGHT_EPS && val < 1 - WEIGHT_EPS
  return inside(t_pq) && inside(t_rs) ? [t_pq, t_rs] : null
}

function make_event(
  model: DiagramModel,
  temperature: number,
  before: HullTopology,
  after: HullTopology,
): PhaseEvent {
  const { phases } = model
  const appeared = without(after.stable, before.stable)
  const vanished = without(before.stable, after.stable)
  const edges_added = without(after.edges, before.edges, edge_key)
  const edges_removed = without(before.edges, after.edges, edge_key)
  const reactions: Reaction[] = []
  // A vanished phase replaced by an appearing one of the same composition is a polymorph
  // transition, not a decomposition
  const unpaired = [...appeared]
  const decomposed: number[] = []
  for (const old_phase of vanished) {
    const pos = unpaired.findIndex((idx) =>
      phases[old_phase].barycentric.every(
        (frac, axis) => Math.abs(frac - phases[idx].barycentric[axis]) < EPS,
      ),
    )
    if (pos === -1) decomposed.push(old_phase)
    else {
      const [new_phase] = unpaired.splice(pos, 1)
      reactions.push({
        kind: `polymorph`,
        phase: new_phase,
        reactants: [{ phase: old_phase, coeff: 1 }],
        products: [{ phase: new_phase, coeff: 1 }],
      })
    }
  }
  for (const [kind, list, topology] of [
    [`vanish`, decomposed, after],
    [`appear`, unpaired, before],
  ] as const) {
    for (const phase of list) {
      const hit = decompose_composition(model, topology, phases[phase].xy)
      if (!hit) continue
      const self: ReactionSide = [{ phase, coeff: 1 }]
      const others = formula_units(model, hit.phases, hit.fractions, phases[phase].n_atoms)
      const [reactants, products] =
        kind === `vanish` ? balance(self, others) : balance(others, self)
      reactions.push({ kind, phase, reactants, products })
    }
  }
  // Tie-line flips: a removed tie-line crossed by an added one is a four-phase reaction
  const changed = new Set([...appeared, ...vanished])
  const untouched = (edge: Vec2) => !changed.has(edge[0]) && !changed.has(edge[1])
  const candidates = edges_added.filter(untouched)
  for (const [idx_p, idx_q] of edges_removed.filter(untouched)) {
    const seg_pq: [Vec2, Vec2] = [phases[idx_p].xy, phases[idx_q].xy]
    const pos = candidates.findIndex(([idx_r, idx_s]) =>
      crossing(seg_pq, [phases[idx_r].xy, phases[idx_s].xy]),
    )
    if (pos === -1) continue
    const [idx_r, idx_s] = candidates.splice(pos, 1)[0]
    const [t_pq, t_rs] = crossing(seg_pq, [phases[idx_r].xy, phases[idx_s].xy]) ?? [0.5, 0.5]
    const [reactants, products] = balance(
      formula_units(model, [idx_p, idx_q], [1 - t_pq, t_pq], 1),
      formula_units(model, [idx_r, idx_s], [1 - t_rs, t_rs], 1),
    )
    reactions.push({ kind: `tie_line_flip`, reactants, products })
  }
  const kind = decomposed.length
    ? `vanish`
    : unpaired.length
      ? `appear`
      : vanished.length
        ? `polymorph`
        : `tie_line_flip`
  return {
    temperature,
    kind,
    appeared,
    vanished,
    edges_added,
    edges_removed,
    reactions,
    stable_after: after.stable,
    facets_after: after.facets,
  }
}

// Phases that could join the hull between two sampled sections: stable at either end or within
// a margin of it, where the margin bounds how far any hull distance can move given the largest
// dG_f change of any phase over the interval. Phases whose data starts/ends inside stay in.
function interval_candidates(
  model: DiagramModel,
  lo: IsothermalSection,
  hi: IsothermalSection,
): number[] {
  const shifts = lo.dg_form
    .map((value, idx) => Math.abs(hi.dg_form[idx] - value))
    .filter(Number.isFinite)
  const margin = 3 * Math.max(0, ...shifts) + 1e-6
  return model.phases
    .filter(({ idx, is_element }) => {
      const near = Math.min(
        ...[lo.e_above_hull[idx], hi.e_above_hull[idx]].filter(Number.isFinite),
      )
      return (
        is_element ||
        near <= margin ||
        Number.isFinite(lo.dg_form[idx]) !== Number.isFinite(hi.dg_form[idx])
      )
    })
    .map(({ idx }) => idx)
}

function locate_events(
  model: DiagramModel,
  lo: HullTopology,
  hi: HullTopology,
  candidates: number[],
  tolerance: number,
  events: PhaseEvent[],
): void {
  if (signature(lo) === signature(hi)) return
  const mid_t = (lo.temperature + hi.temperature) / 2
  if (!lo.valid || !hi.valid) return
  if (hi.temperature - lo.temperature <= tolerance) {
    events.push(make_event(model, mid_t, lo, hi))
    return
  }
  const mid = hull_topology(model, mid_t, candidates)
  locate_events(model, lo, mid, candidates, tolerance, events)
  locate_events(model, mid, hi, candidates, tolerance, events)
}

// === Sweep ===

function sample_temperatures(
  model: DiagramModel,
  options: TernaryPhaseDiagramOptions,
): number[] {
  const [t_min, t_max] = model.t_range
  if (!(t_max > t_min))
    throw new Error(`Temperature range must be increasing, got [${t_min}, ${t_max}]`)
  const n_samples = Math.max(2, options.n_samples ?? DEFAULT_N_SAMPLES)
  const samples = options.temperatures ?? [
    ...Array.from(
      { length: n_samples },
      (_, idx) => t_min + ((t_max - t_min) * idx) / (n_samples - 1),
    ),
    // Tabulated knots keep piecewise-linear G(T) exact between samples
    ...model.phases.flatMap((phase) => phase.entry.temperatures ?? []),
  ]
  return [
    ...new Set([t_min, t_max, ...samples.filter((temp) => temp >= t_min && temp <= t_max)]),
  ].toSorted((lhs, rhs) => lhs - rhs)
}

// Per phase: maximal [T_lo, T_hi] intervals on the hull, from the first valid section and the
// events after it
function stability_windows(
  n_phases: number,
  t_max: number,
  first: IsothermalSection | undefined,
  events: PhaseEvent[],
): Vec2[][] {
  const windows: Vec2[][] = Array.from({ length: n_phases }, () => [])
  const open = new Map(
    (first?.stable ?? []).map((phase) => [phase, first?.temperature ?? t_max]),
  )
  const close = (phase: number, temperature: number) => {
    const start = open.get(phase)
    if (start !== undefined) windows[phase].push([start, temperature])
    open.delete(phase)
  }
  for (const event of events) {
    for (const phase of event.vanished) close(phase, event.temperature)
    for (const phase of event.appeared) open.set(phase, event.temperature)
  }
  for (const phase of open.keys()) close(phase, t_max)
  return windows
}

// The whole diagram: sections at every sample temperature, bisected transitions and per-phase
// stability windows. `on_progress` is called after each section.
export function compute_ternary_phase_diagram(
  entries: PhaseData[],
  options: TernaryPhaseDiagramOptions = {},
  on_progress?: (progress: DiagramProgress) => void,
): TernaryPhaseDiagram {
  const model = prepare_diagram(entries, options)
  const temperatures = sample_temperatures(model, options)
  const topologies = temperatures.map((temperature, idx) => {
    const topology = hull_topology(model, temperature)
    on_progress?.({ done: idx + 1, total: temperatures.length })
    return topology
  })
  const sections = topologies.map((topology) => section_from_topology(model, topology))
  const tolerance = options.event_tolerance ?? DEFAULT_EVENT_TOLERANCE
  const events: PhaseEvent[] = []
  for (let idx = 0; idx + 1 < topologies.length; idx++) {
    const [lo, hi] = [topologies[idx], topologies[idx + 1]]
    if (tolerance > 0)
      locate_events(
        model,
        lo,
        hi,
        interval_candidates(model, sections[idx], sections[idx + 1]),
        tolerance,
        events,
      )
    else if (lo.valid && hi.valid && signature(lo) !== signature(hi))
      events.push(make_event(model, (lo.temperature + hi.temperature) / 2, lo, hi))
  }
  return {
    elements: model.elements,
    phases: model.phases,
    temperatures,
    sections,
    events,
    stability_windows: stability_windows(
      model.phases.length,
      model.t_range[1],
      sections.find((section) => section.stable.length > 0),
      events,
    ),
    t_range: model.t_range,
    sources: [...new Set(model.free_energies.map((phase) => phase.source))],
  }
}

// === Formatting ===

// Phase label, disambiguated by entry id when another phase in the reaction shares it
export function reaction_phase_label(
  diagram: Pick<TernaryPhaseDiagram, `phases`>,
  reaction: Reaction,
  phase: number,
): string {
  const { label, entry } = diagram.phases[phase]
  const twin = [...reaction.reactants, ...reaction.products].some(
    (item) => item.phase !== phase && diagram.phases[item.phase].label === label,
  )
  return twin ? `${label} (${entry.entry_id ?? `#${phase}`})` : label
}

// "Li2CO3 → Li2O + CO2" style plain-text reaction (heating direction)
export function format_reaction(
  diagram: Pick<TernaryPhaseDiagram, `phases`>,
  reaction: Reaction,
): string {
  const coeff_text = (coeff: number) =>
    Math.abs(coeff - 1) < 1e-6 ? `` : `${Number(coeff.toPrecision(3))} `
  const side = (items: ReactionSide) =>
    items
      .map(
        ({ phase, coeff }) =>
          `${coeff_text(coeff)}${reaction_phase_label(diagram, reaction, phase)}`,
      )
      .join(` + `)
  return `${side(reaction.reactants)} → ${side(reaction.products)}`
}
