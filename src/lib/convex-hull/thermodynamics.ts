import { sort_by_electronegativity } from '$lib/composition/format'
import { is_elem_symbol } from '$lib/element/helpers'
import { count_atoms_in_composition } from '$lib/composition/reduce'
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import { composition_to_barycentric_nd } from './barycentric-coords'
import { get_arity, HULL_STABILITY_TOL, is_on_hull, is_unary_entry } from './entry-stability'
import type { ConvexHullEntry, PhaseData, PhaseStats, ProcessedPhaseData } from './types'

// A pymatgen species key as emitted by Composition.as_dict(): an element symbol with optional
// oxidation state ("Fe3+", "O2-", "Fe2.5+") and optional spin ("Fe2+,spin=5")
const SPECIES_KEY_REGEX = /^(?<symbol>[A-Z][a-z]?)(?:\d*\.?\d*[+-])?(?:,spin=[-+\d.]+)?$/
// Hydrogen isotopes pymatgen treats as their own species
const ISOTOPE_TO_ELEMENT: Record<string, ElementSymbol> = { D: `H`, T: `H` }

// Normalize convex hull composition keys by stripping oxidation states and spins (e.g.
// "V4+" -> "V", "Fe2+,spin=5" -> "Fe"), mapping D/T to H and merging amounts for keys that map
// to the same element. Filters non-positive amounts. pymatgen DummySpecies ("X0+", "Xa") carry
// no element and are skipped with a warning. Throws on keys that are not a single element
// species ("Fe2O3", "12345"): silently mapping a compound key to its first element would
// corrupt every downstream formation energy. With `components` (pseudo-components such as
// precursor formulas for a pseudo-binary/ternary hull) keys must instead match one of them exactly.
export function normalize_hull_composition_keys(
  composition: Record<string, number>,
  components?: readonly string[],
): Partial<Record<ElementSymbol, number>> {
  const normalized: Partial<Record<ElementSymbol, number>> = {}
  for (const [key, amount] of Object.entries(composition)) {
    if (typeof amount !== `number` || !Number.isFinite(amount) || amount <= 0) continue
    if (components) {
      if (!components.includes(key)) {
        throw new Error(
          `Unrecognized composition key "${key}" in ${JSON.stringify(composition)}: expected one of the components ${components.join(`, `)}`,
        )
      }
      normalized[key as ElementSymbol] = (normalized[key as ElementSymbol] ?? 0) + amount
      continue
    }
    const raw_symbol = SPECIES_KEY_REGEX.exec(key)?.groups?.symbol ?? ``
    const symbol = ISOTOPE_TO_ELEMENT[raw_symbol] ?? raw_symbol
    if (is_elem_symbol(symbol)) normalized[symbol] = (normalized[symbol] ?? 0) + amount
    // DummySpecies symbols start with X and are not real elements (Xe is)
    else if (raw_symbol.startsWith(`X`)) {
      console.warn(
        `Skipping pymatgen DummySpecies key "${key}" in ${JSON.stringify(composition)}: it carries no element`,
      )
    } else {
      throw new Error(
        `Unrecognized composition key "${key}" in ${JSON.stringify(composition)}: expected an element symbol with optional oxidation state (e.g. "Fe", "Fe3+")`,
      )
    }
  }
  return normalized
}

// Sorted element symbols present in a set of (normalized) entries
export const collect_hull_elements = (entries: PhaseData[]): ElementSymbol[] =>
  [
    ...new Set(entries.flatMap((entry) => Object.keys(entry.composition))),
  ].toSorted() as ElementSymbol[]

// Normalize composition keys and drop entries whose composition normalizes to {}.
export function process_hull_entries(
  entries: PhaseData[],
  components?: readonly string[],
): ProcessedPhaseData {
  const normalized = entries
    .map((entry) => ({
      ...entry,
      composition: normalize_hull_composition_keys(entry.composition, components),
    }))
    .filter((entry) => Object.keys(entry.composition).length > 0)
  return { entries: normalized, elements: collect_hull_elements(normalized) }
}

// Energy per atom with the (total-energy, eV) correction applied — the Materials Project
// convention — falling back to raw energy_per_atom/energy.
export function get_energy_per_atom(entry: PhaseData): number {
  // Math.max instead of || so pathological non-positive totals can't flip the sign
  const atoms = Math.max(count_atoms_in_composition(entry.composition), 1e-12)
  if (typeof entry.correction === `number`) {
    const total =
      typeof entry.energy_per_atom === `number`
        ? entry.energy_per_atom * atoms
        : (entry.energy ?? 0)
    return (total + entry.correction) / atoms
  }
  return entry.energy_per_atom ?? (entry.energy ?? 0) / atoms
}

// `e_above_hull_distances` prefers a cached e_form_per_atom over recomputing one, so any
// transformation that changes energies or references must clear these or the stale cache
// outranks the new energies.
export const drop_cached_hull_data = <Entry extends PhaseData>(entry: Entry): Entry => ({
  ...entry,
  e_form_per_atom: undefined,
  e_above_hull: undefined,
  is_stable: undefined,
})

// Formation energy per atom against elemental references (eV/atom), or null when a reference
// is missing or an energy is non-finite — never E = 0, which is a formation energy against a
// fictitious element. Zero-amount elements need no reference.
export function compute_e_form_per_atom(
  entry: PhaseData,
  el_refs: Record<string, PhaseData>,
): number | null {
  const atoms = count_atoms_in_composition(entry.composition)
  const energy_per_atom = get_energy_per_atom(entry)
  if (!(atoms > 0) || !Number.isFinite(energy_per_atom)) return null
  let ref_sum = 0
  for (const [el, amount] of Object.entries(entry.composition)) {
    if (!(amount > 0)) continue
    const ref_epa = el_refs[el] ? get_energy_per_atom(el_refs[el]) : Number.NaN
    if (!Number.isFinite(ref_epa)) return null
    ref_sum += (amount / atoms) * ref_epa
  }
  return energy_per_atom - ref_sum
}

export function find_lowest_energy_unary_refs(
  entries: PhaseData[],
): Record<string, PhaseData> {
  const refs: Record<string, PhaseData> = {}
  for (const entry of entries) {
    if (!is_unary_entry(entry)) continue
    const el = Object.keys(entry.composition).find(
      (key) => (entry.composition[key as ElementSymbol] ?? 0) > 0,
    )
    if (!el) continue
    const current = refs[el]
    if (!current || get_energy_per_atom(entry) < get_energy_per_atom(current)) {
      refs[el] = entry
    }
  }
  return refs
}

// Result key of the batch calculate_e_above_hull: entry_id, else composition|energy|structure.
// Composition alone collides for same-stoichiometry polymorphs (last distance would win),
// so add energy + structure.
const id_of = (entry: PhaseData): string => {
  if (entry.entry_id) return entry.entry_id
  const structure_hash = entry.structure ? JSON.stringify(entry.structure) : ``
  return `${JSON.stringify(entry.composition)}|${entry.energy}|${structure_hash}`
}

// Energy above hull (eV/atom, clamped to >= 0) of `entries` against the hull of
// reference_entries, aligned with `entries`. Formation energies come from e_form_per_atom
// when present, else from the lowest-energy unary references; pure elements without a
// reference default to E_form = 0. Entries that can't be placed (missing reference element,
// zero atoms) get NaN.
function e_above_hull_distances(
  entries: PhaseData[],
  reference_entries: PhaseData[],
): number[] {
  if (reference_entries.length === 0) {
    throw new Error(`Reference entries cannot be empty`)
  }
  // The geometry runs on normalized copies so oxidation-state keys ("Fe3+") line up with the
  // reference system. Zero-atom entries are kept (they yield NaN below) rather than dropped
  // like process_hull_entries would.
  const normalize = (entry: PhaseData): PhaseData => ({
    ...entry,
    composition: normalize_hull_composition_keys(entry.composition),
  })
  const entries_of_interest = entries.map(normalize)
  reference_entries = reference_entries.map(normalize)

  const elements = collect_hull_elements(reference_entries)
  const element_set = new Set<string>(elements)
  for (const entry of entries_of_interest) {
    for (const el of Object.keys(entry.composition)) {
      if (!element_set.has(el)) {
        throw new Error(
          `Entry contains element ${el} not present in reference system: ${elements.join(`-`)}`,
        )
      }
    }
  }

  const refs = find_lowest_energy_unary_refs(reference_entries)
  const e_form_of = (entry: PhaseData): number | null =>
    typeof entry.e_form_per_atom === `number`
      ? entry.e_form_per_atom
      : compute_e_form_per_atom(entry, refs)
  // Clamp raw distances to >= 0 (NaN stays NaN)
  const clamp_dists = (distances: number[]): number[] =>
    distances.map((dist) => Math.max(0, dist))

  const arity = elements.length
  // The stable element sits at E_form = 0, so E_form is the hull distance
  if (arity === 1)
    return clamp_dists(entries_of_interest.map((entry) => e_form_of(entry) ?? NaN))

  // Hull points: reduced barycentric coords (first dropped — all N sum to 1 and would
  // confine the points to an affine subspace) + E_form. NaN E_form marks unplaceable.
  const to_point = (entry: PhaseData): number[] => {
    const e_form = e_form_of(entry)
    // A zero-atom composition with an explicit e_form_per_atom skips the null check above
    // and would make composition_to_barycentric_nd throw instead of yielding NaN
    if (e_form === null || count_atoms_in_composition(entry.composition) <= 0) {
      return Array(arity).fill(NaN)
    }
    return [...composition_to_barycentric_nd(entry.composition, elements).slice(1), e_form]
  }

  const ref_points = reference_entries
    .filter((ref) => !ref.exclude_from_hull) // shown but not part of the hull
    .map(to_point)
    .filter((point) => point.every(Number.isFinite))
  // Missing pure-element corners default to E_form = 0. In reduced coordinates element 0 is
  // the origin and element k > 0 has (k-1)th coordinate 1.
  for (let el_idx = 0; el_idx < arity; el_idx++) {
    const corner: number[] = Array(arity).fill(0)
    if (el_idx > 0) corner[el_idx - 1] = 1
    const present = ref_points.some((pt) =>
      pt.slice(0, -1).every((val, dim) => Math.abs(val - corner[dim]) <= HULL_EPS),
    )
    if (!present) ref_points.push(corner)
  }

  const facets = compute_lower_hull_nd(ref_points)
  const query_points = entries_of_interest.map(to_point)
  // With every corner present, the points are co-hyperplanar only when all E_form are 0,
  // so the hull is the plane E = 0 and the distance is E_form itself.
  return clamp_dists(
    facets.length === 0
      ? query_points.map((point) => point.at(-1) ?? NaN)
      : compute_e_above_hull_nd(query_points, facets, ref_points),
  )
}

// Energy above hull of one entry, or of many keyed by id_of (see e_above_hull_distances)
export function calculate_e_above_hull(
  entry: PhaseData,
  reference_entries: PhaseData[],
): number
export function calculate_e_above_hull(
  entries: PhaseData[],
  reference_entries: PhaseData[],
): Record<string, number>
export function calculate_e_above_hull(
  input: PhaseData | PhaseData[],
  reference_entries: PhaseData[],
): number | Record<string, number> {
  if (!Array.isArray(input)) return e_above_hull_distances([input], reference_entries)[0]
  if (input.length === 0) return {} // Empty input → empty result (not an error)
  const distances = e_above_hull_distances(input, reference_entries)
  return Object.fromEntries(input.map((entry, idx) => [id_of(entry), distances[idx]]))
}

export function get_convex_hull_stats(
  processed_entries: PhaseData[],
  elements: ElementSymbol[],
  max_arity: number = 4,
): PhaseStats | null {
  if (processed_entries.length === 0) return null
  max_arity = Math.max(1, max_arity)

  const arity_counts = [0, 0, 0, 0, 0, 0] // index = arity (5 = quinary+)
  for (const entry of processed_entries) arity_counts[Math.min(5, get_arity(entry))]++
  const [, unary, binary, ternary, quaternary, quinary_plus] = arity_counts
  const stable = processed_entries.filter((entry) => is_on_hull(entry)).length

  // E_form only: falling back to absolute DFT energies puts ~-8 and ~-1 eV/atom in one stat
  const e_forms = processed_entries
    .map((entry) => entry.e_form_per_atom)
    .filter((val): val is number => typeof val === `number` && Number.isFinite(val))
  const [min_e_form, max_e_form] = math.array_extent(e_forms)
  const hull_distances = processed_entries
    .map((entry) => entry.e_above_hull)
    .filter((val): val is number => typeof val === `number` && val >= 0)

  return {
    total: processed_entries.length,
    unary,
    // Zero out counts beyond system dimensionality for cleaner display (quinary_plus is the
    // catch-all and is naturally 0 for systems with fewer than 5 elements)
    binary: max_arity >= 2 ? binary : 0,
    ternary: max_arity >= 3 ? ternary : 0,
    quaternary: max_arity >= 4 ? quaternary : 0,
    quinary_plus,
    stable,
    unstable: processed_entries.length - stable,
    e_form_range:
      e_forms.length > 0
        ? { min: min_e_form, max: max_e_form, avg: math.mean(e_forms) }
        : null,
    hull_distance:
      hull_distances.length > 0
        ? { max: math.array_max(hull_distances), avg: math.mean(hull_distances) }
        : { max: 0, avg: 0 },
    elements: elements.length,
    chemical_system: sort_by_electronegativity([...elements]).join(`-`),
    max_arity,
  }
}

export interface HighDimHullResult {
  stable_entries: ConvexHullEntry[]
  unstable_entries: ConvexHullEntry[]
  phase_stats: PhaseStats | null
}

// Stats for systems the ConvexHull components can't render (5+ elements): computes
// formation energies, hull distances and stability. Returns null when nothing is usable.
// `elements` scopes the chemical system; defaults to the elements found in the entries.
export function process_hull_for_stats(
  entries: PhaseData[],
  elements?: ElementSymbol[],
): HighDimHullResult | null {
  const processed = process_hull_entries(entries)
  if (processed.entries.length === 0) return null
  const hull_elements = elements ?? processed.elements

  const el_refs = find_lowest_energy_unary_refs(processed.entries)
  const with_e_form = processed.entries.map((entry) => ({
    ...entry,
    e_form_per_atom:
      entry.e_form_per_atom ?? compute_e_form_per_atom(entry, el_refs) ?? undefined,
  }))
  const hull_distances = e_above_hull_distances(with_e_form, with_e_form)
  // x/y/z default to 0 since high-dim systems aren't plotted
  const hull_entries = with_e_form.map((entry, idx): ConvexHullEntry => {
    const dist = hull_distances[idx]
    const known = Number.isFinite(dist)
    return {
      ...entry,
      e_above_hull: known ? dist : undefined,
      is_stable: known ? dist < HULL_STABILITY_TOL : undefined,
      is_element: is_unary_entry(entry),
      x: 0,
      y: 0,
      z: 0,
    }
  })
  return {
    stable_entries: hull_entries.filter((entry) => is_on_hull(entry)),
    unstable_entries: hull_entries.filter((entry) => !is_on_hull(entry)),
    phase_stats: get_convex_hull_stats(hull_entries, hull_elements, hull_elements.length),
  }
}

// === N-dimensional convex hull (quickhull) ===

// Geometric tolerance for hull construction (coordinates are compositions in [0, 1] and
// energies in eV/atom)
const HULL_EPS = 1e-9

// Facet budget for the incremental construction below (a running tally: nothing cheap predicts
// the count up front). Measured on points in convex position: 6D/1000 builds ~300k facets in
// 10 s but 7D/1000 needs 610k in 72 s, so 500k keeps every tractable case and aborts the rest
// in 12-14 s. Plotted hulls are 2D-4D, so this only fires on the arity-5+ stats path.
const MAX_HULL_FACETS = 500_000

// Facet of an N-dimensional hull: an (N-1)-simplex of N vertices (indices into the input
// points) on the hyperplane normal · x + offset = 0, normal pointing out of the hull.
export interface HullFacet {
  vertex_indices: number[]
  normal: number[]
  offset: number
}

// Working facet during construction: the unclaimed points outside it and the farthest one
interface WorkFacet extends HullFacet {
  outside: number[]
  farthest_idx: number
  farthest_dist: number
}

// Signed distance of a point to a facet's hyperplane (> 0 outside). The one hot kernel of
// quickhull, so it's a bare loop rather than math.dot (no shape checks, no allocation).
function signed_distance(facet: HullFacet, point: number[]): number {
  const { normal } = facet
  let sum = facet.offset
  for (let idx = 0; idx < normal.length; idx++) sum += normal[idx] * point[idx]
  return sum
}

// Hyperplane through dim points in dim-D space: the normal's components are the signed
// cofactors of the (dim-1)×dim edge matrix (a generalized cross product).
function hyperplane(points: number[][]): { normal: number[]; offset: number } {
  const dim = points[0].length
  const edges = points.slice(1).map((pt) => math.subtract(pt, points[0]))
  const normal = math.normalize_vec(
    Array.from({ length: dim }, (_, col) => {
      const minor = edges.map((edge) => edge.toSpliced(col, 1))
      return (col % 2 === 0 ? 1 : -1) * math.det_nxn(minor)
    }),
  )
  return { normal, offset: -math.dot(normal, points[0]) }
}

// Facet through the given vertices, oriented so `interior` is on its negative side
function make_facet(
  points: number[][],
  vertex_indices: number[],
  interior: number[],
): WorkFacet {
  const { normal, offset } = hyperplane(vertex_indices.map((idx) => points[idx]))
  const facet: WorkFacet = {
    vertex_indices,
    normal,
    offset,
    outside: [],
    farthest_idx: -1,
    farthest_dist: HULL_EPS,
  }
  if (signed_distance(facet, interior) > 0) {
    facet.normal = normal.map((val) => -val)
    facet.offset = -offset
  }
  return facet
}

// Give each candidate point to the facet it lies farthest outside of (if any), tracking
// that facet's farthest point so the main loop never rescans outside sets.
function claim_outside_points(points: number[][], candidates: number[], facets: WorkFacet[]) {
  for (const pt_idx of candidates) {
    const point = points[pt_idx]
    let best: WorkFacet | null = null
    let best_dist = HULL_EPS
    for (const facet of facets) {
      const dist = signed_distance(facet, point)
      if (dist > best_dist) [best, best_dist] = [facet, dist]
    }
    if (!best) continue
    best.outside.push(pt_idx)
    if (best_dist > best.farthest_dist) {
      best.farthest_dist = best_dist
      best.farthest_idx = pt_idx
    }
  }
}

// Cap on the O(n²) farthest-pair search that seeds the initial simplex
const INITIAL_SIMPLEX_SAMPLE_SIZE = 100

// dim + 1 affinely independent points (greedy farthest-from-current-affine-hull via an
// incremental orthonormal basis), or null when the points are degenerate.
function initial_simplex(points: number[][]): number[] | null {
  const dim = points[0].length
  const sample_size = Math.min(points.length, INITIAL_SIMPLEX_SAMPLE_SIZE)
  const stride = points.length / sample_size
  const sample = Array.from({ length: sample_size }, (_, idx) => Math.floor(idx * stride))
  let [first, second, best_dist] = [0, 1, -1]
  for (const idx_a of sample) {
    for (const idx_b of sample) {
      if (idx_a >= idx_b) continue
      const dist = math.euclidean_dist(points[idx_a], points[idx_b])
      if (dist > best_dist) [first, second, best_dist] = [idx_a, idx_b, dist]
    }
  }
  if (best_dist < HULL_EPS) return null

  const chosen = [first, second]
  const origin = points[first]
  const basis = [math.normalize_vec(math.subtract(points[second], origin))]
  while (chosen.length < dim + 1) {
    let [best_idx, best_norm] = [-1, HULL_EPS]
    let best_residual: number[] = []
    for (let idx = 0; idx < points.length; idx++) {
      if (chosen.includes(idx)) continue
      // Component of (point - origin) orthogonal to the span of the chosen points
      let residual = math.subtract(points[idx], origin)
      for (const vec of basis) {
        residual = math.subtract(residual, math.scale(vec, math.dot(residual, vec)))
      }
      const norm = Math.hypot(...residual)
      if (norm > best_norm) [best_idx, best_norm, best_residual] = [idx, norm, residual]
    }
    if (best_idx === -1) return null
    chosen.push(best_idx)
    basis.push(math.scale(best_residual, 1 / best_norm))
  }
  return chosen
}

// Horizon of a set of visible facets: the (N-2)-ridges that belong to exactly one of them
function horizon_ridges(visible: WorkFacet[]): number[][] {
  const ridges = new Map<string, number[] | null>() // null = interior (seen twice)
  for (const facet of visible) {
    for (let skip = 0; skip < facet.vertex_indices.length; skip++) {
      const ridge = facet.vertex_indices.toSpliced(skip, 1)
      const key = ridge.toSorted((idx_a, idx_b) => idx_a - idx_b).join(`,`)
      ridges.set(key, ridges.has(key) ? null : ridge)
    }
  }
  return [...ridges.values()].filter((ridge) => ridge !== null)
}

// Convex hull of points in N dimensions (quickhull). Returns [] for fewer than N+1 points
// or degenerate (co-hyperplanar) input; throws on mixed dimensions or on passing
// `max_facets` (see MAX_HULL_FACETS).
export function compute_quickhull_nd(
  points: number[][],
  max_facets = MAX_HULL_FACETS,
): HullFacet[] {
  if (points.length === 0) return []
  const dim = points[0].length
  for (const pt of points) {
    if (pt.length !== dim) throw new Error(`Vector dimension mismatch: ${pt.length} vs ${dim}`)
  }
  if (points.length < dim + 1) return []
  const initial = initial_simplex(points)
  if (!initial) return []

  const interior = Array.from(
    { length: dim },
    (_, dim_idx) =>
      initial.reduce((sum, idx) => sum + points[idx][dim_idx], 0) / initial.length,
  )
  let facets = initial.map((_, skip) =>
    make_facet(points, initial.toSpliced(skip, 1), interior),
  )
  claim_outside_points(
    points,
    points.map((_, idx) => idx).filter((idx) => !initial.includes(idx)),
    facets,
  )
  let facets_built = facets.length

  while (true) {
    let eye_facet: WorkFacet | null = null
    for (const facet of facets) {
      if (
        facet.farthest_idx !== -1 &&
        facet.farthest_dist > (eye_facet?.farthest_dist ?? -1)
      ) {
        eye_facet = facet
      }
    }
    if (!eye_facet) break // every point is inside
    const eye_idx = eye_facet.farthest_idx
    const eye = points[eye_idx]

    const visible: WorkFacet[] = []
    const kept: WorkFacet[] = []
    for (const facet of facets)
      (signed_distance(facet, eye) > HULL_EPS ? visible : kept).push(facet)
    const new_facets = horizon_ridges(visible).map((ridge) =>
      make_facet(points, [...ridge, eye_idx], interior),
    )
    facets_built += new_facets.length
    if (facets_built > max_facets) {
      throw new Error(
        `compute_quickhull_nd: ${points.length} points in ${dim}D built ${facets_built} facets, ` +
          `past the ${max_facets} budget. Reduce the entry count or the chemical system size.`,
      )
    }
    const orphans = new Set(visible.flatMap((facet) => facet.outside))
    orphans.delete(eye_idx)
    claim_outside_points(points, [...orphans], new_facets)
    facets = kept.concat(new_facets)
  }
  return facets.map(({ vertex_indices, normal, offset }) => ({
    vertex_indices,
    normal,
    offset,
  }))
}

// Lower hull of points whose last coordinate is energy: facets whose normal points down
export const compute_lower_hull_nd = (points: number[][]): HullFacet[] =>
  compute_quickhull_nd(points).filter((facet) => (facet.normal.at(-1) ?? 0) < -HULL_EPS)

// Energy above the lower hull for each query point (last coordinate = energy), unclamped.
// The lower hull is a convex function of the spatial coordinates, so its value is the max
// over the facets' hyperplanes; the maximizing facet is then checked to actually contain the
// query's projection, and queries outside the hull's composition domain get NaN.
export function compute_e_above_hull_nd(
  query_points: number[][],
  facets: HullFacet[],
  hull_points: number[][],
): number[] {
  const spatial_dim = (hull_points[0]?.length ?? 1) - 1
  return query_points.map((query) => {
    if (!query.every(Number.isFinite)) return NaN
    let best: HullFacet | null = null
    let e_hull = -Infinity
    for (const facet of facets) {
      // Solve normal · (x, e) + offset = 0 for e
      let sum = facet.offset
      for (let dim = 0; dim < spatial_dim; dim++) sum += facet.normal[dim] * query[dim]
      const e_facet = -sum / facet.normal[spatial_dim]
      if (e_facet > e_hull) [best, e_hull] = [facet, e_facet]
    }
    if (!best) return NaN
    // Barycentric coordinates of the query's projection in the facet's projected simplex:
    // [v1-v0 … vn-v0] · λ = x - v0, λ0 = 1 - Σλ
    const verts = best.vertex_indices.map((idx) => hull_points[idx])
    const matrix = Array.from({ length: spatial_dim }, (_, row) =>
      verts.slice(1).map((vert) => vert[row] - verts[0][row]),
    )
    const rhs = Array.from({ length: spatial_dim }, (_, row) => query[row] - verts[0][row])
    const lambda = math.solve_linear_system(matrix, rhs)
    if (!lambda) return NaN
    const inside =
      lambda.every((val) => val >= -HULL_EPS) &&
      1 - lambda.reduce((sum, val) => sum + val, 0) >= -HULL_EPS
    return inside ? query[spatial_dim] - e_hull : NaN
  })
}
