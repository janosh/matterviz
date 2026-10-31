import { sort_by_electronegativity } from '#lib/composition/format.js'
import { is_elem_symbol } from '#lib/element/helpers.js'
import { count_atoms_in_composition } from '#lib/composition/reduce.js'
import type { ElementSymbol } from '#lib/element/index.js'
import * as math from '#lib/math.js'
import { first_duplicate } from '#lib/utils.js'
import { composition_to_barycentric_nd } from './barycentric-coords'
import {
  compute_hull_stability,
  get_arity,
  is_on_hull,
  is_unary_entry,
} from './entry-stability'
import type { ConvexHullEntry, PhaseData, PhaseStats, ProcessedPhaseData } from './types'

// A pymatgen species key as emitted by Composition.as_dict(): an element symbol with optional
// oxidation state ("Fe3+", "O2-", "Fe2.5+") and optional spin ("Fe2+,spin=5")
const SPECIES_KEY_REGEX = /^(?<symbol>[A-Z][a-z]?)(?:\d*\.?\d*[+-])?(?:,spin=[-+\d.]+)?$/
// Hydrogen isotopes pymatgen treats as their own species
const ISOTOPE_TO_ELEMENT: Record<string, ElementSymbol> = { D: `H`, T: `H` }

// Element of a pymatgen species key ("Fe2+,spin=5" -> "Fe", "D" -> "H"), else null
export function species_key_element(key: string): ElementSymbol | null {
  // Plain element keys (the common case) skip the regex
  if (is_elem_symbol(key)) return key
  const raw_symbol = SPECIES_KEY_REGEX.exec(key)?.groups?.symbol ?? ``
  const symbol = ISOTOPE_TO_ELEMENT[raw_symbol] ?? raw_symbol
  return is_elem_symbol(symbol) ? symbol : null
}

// Normalize hull composition keys: strip oxidation states and spins ("Fe2+,spin=5" -> "Fe"),
// map D/T to H, merge amounts per element and drop non-positive ones. pymatgen DummySpecies
// ("X0+", "Xa") are skipped with a warning. Throws on non-species keys ("Fe2O3"), which would
// otherwise corrupt every downstream formation energy. With `components` (pseudo-components
// of a pseudo-binary/ternary hull) keys must instead match one of them exactly.
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
    const symbol = species_key_element(key)
    if (symbol) normalized[symbol] = (normalized[symbol] ?? 0) + amount
    // DummySpecies symbols start with X and are not real elements (Xe is)
    else if (key.startsWith(`X`) && SPECIES_KEY_REGEX.test(key)) {
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
const collect_hull_elements = (entries: PhaseData[]): ElementSymbol[] =>
  [
    ...new Set(entries.flatMap((entry) => Object.keys(entry.composition))),
  ].toSorted() as ElementSymbol[]

// Normalize composition keys and drop entries whose composition normalizes to {}.
export function process_hull_entries(
  entries: readonly PhaseData[],
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

// Energy per atom with the (total-energy, eV) MP correction applied, else raw energy
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

// Whether an entry carries an absolute energy rather than E_form only (no energy, or a 0 eV
// placeholder next to a nonzero e_form_per_atom: real totals are never exactly 0 eV)
export const has_absolute_energy = (entry: PhaseData): boolean =>
  typeof entry.energy_per_atom === `number` ||
  (typeof entry.energy === `number` &&
    !(
      entry.energy === 0 &&
      typeof entry.e_form_per_atom === `number` &&
      Number.isFinite(entry.e_form_per_atom) &&
      entry.e_form_per_atom !== 0
    ))

// Absolute energy per atom: the entry's own, else E_form + Σ x_e E_e on the references'
// scale. NaN when the entry has neither or an element lacks a reference.
export function absolute_energy_per_atom(
  entry: PhaseData,
  unary_refs: Record<string, PhaseData>,
): number {
  if (has_absolute_energy(entry)) return get_energy_per_atom(entry)
  const { e_form_per_atom: e_form } = entry
  const atoms = count_atoms_in_composition(entry.composition)
  if (typeof e_form !== `number` || !Number.isFinite(e_form) || !(atoms > 0)) return NaN
  let energy = e_form
  for (const [element, amount] of Object.entries(entry.composition)) {
    if (!(amount > 0)) continue
    const ref = unary_refs[element]
    if (!ref) return NaN
    if (ref !== entry) energy += (amount / atoms) * absolute_energy_per_atom(ref, unary_refs)
  }
  return energy
}

// Check if an entry has valid temperature-dependent data (matching array lengths, non-empty)
export function entry_has_temp_data(entry: PhaseData): boolean {
  const { temperatures, free_energies } = entry
  return Boolean(
    temperatures?.length &&
    free_energies?.length &&
    temperatures.length === free_energies.length,
  )
}

// e_above_hull_distances prefers a cached e_form_per_atom, so transformations that change
// energies or references must clear these
export const drop_cached_hull_data = <Entry extends PhaseData>(entry: Entry): Entry => ({
  ...entry,
  e_form_per_atom: undefined,
  e_above_hull: undefined,
  is_stable: undefined,
})

// Formation energy per atom (eV/atom) against elemental references, or null when a reference
// is missing or an energy is non-finite (never a fictitious 0 eV reference)
export function compute_e_form_per_atom(
  entry: PhaseData,
  el_refs: Record<string, PhaseData>,
): number | null {
  const atoms = count_atoms_in_composition(entry.composition)
  const energy_per_atom = get_energy_per_atom(entry)
  if (!(atoms > 0) || !Number.isFinite(energy_per_atom)) return null
  let ref_sum = 0
  for (const [element, amount] of Object.entries(entry.composition)) {
    if (!(amount > 0)) continue
    const ref_epa = el_refs[element] ? get_energy_per_atom(el_refs[element]) : Number.NaN
    if (!Number.isFinite(ref_epa)) return null
    ref_sum += (amount / atoms) * ref_epa
  }
  return energy_per_atom - ref_sum
}

// Score a unary competes on for its element's reference: absolute energy per atom, else
// e_form_per_atom for E_form-only unaries
export const unary_ref_score = (entry: PhaseData): number =>
  has_absolute_energy(entry) ? get_energy_per_atom(entry) : (entry.e_form_per_atom ?? NaN)

// Lowest-energy unary entry per element by absolute energy per atom. E_form-only unaries rank
// by e_form_per_atom, and only for elements without absolute-energy unaries. exclude_from_hull
// unaries are never references. `score_shifts` (per entry, eV/atom) ranks the unaries as if
// their energies had moved by it.
export function find_lowest_energy_unary_refs(
  entries: PhaseData[],
  score_shifts?: readonly number[],
): Record<string, PhaseData> {
  type Ref = { entry: PhaseData; score: number; absolute: boolean }
  const refs: Record<string, Ref> = {}
  for (const [idx, entry] of entries.entries()) {
    if (!is_unary_entry(entry) || entry.exclude_from_hull) continue
    const absolute = has_absolute_energy(entry)
    const score = unary_ref_score(entry) + (score_shifts?.[idx] ?? 0)
    if (!Number.isFinite(score)) continue
    const element = Object.keys(entry.composition).find(
      (key) => (entry.composition[key as ElementSymbol] ?? 0) > 0,
    )
    if (!element) continue
    const current = refs[element]
    if (!current || (absolute === current.absolute ? score < current.score : absolute))
      refs[element] = { entry, score, absolute }
  }
  return Object.fromEntries(
    Object.entries(refs).map(([element, { entry }]) => [element, entry]),
  )
}

// Result key of the batch calculate_e_above_hull: entry_id, else composition|energy|structure
// (composition alone collides for polymorphs)
const id_of = (entry: PhaseData): string => {
  if (entry.entry_id) return entry.entry_id
  const structure_hash = entry.structure ? JSON.stringify(entry.structure) : ``
  return `${JSON.stringify(entry.composition)}|${entry.energy}|${structure_hash}`
}

// Unclamped energy above hull (eV/atom) of `entries` against the hull of reference_entries.
// E_form comes from e_form_per_atom, else the lowest-energy unary references; unreferenced
// pure elements default to 0. Unplaceable entries (missing reference, zero atoms) get NaN.
// `components` as in normalize_hull_composition_keys, for pseudo-component hulls.
export function e_above_hull_distances(
  entries: PhaseData[],
  reference_entries: PhaseData[],
  components?: readonly string[],
): number[] {
  if (reference_entries.length === 0) {
    throw new Error(`Reference entries cannot be empty`)
  }
  // Normalized copies so "Fe3+" keys match the references; zero-atom entries stay (NaN below)
  const normalize = (entry: PhaseData): PhaseData => ({
    ...entry,
    composition: normalize_hull_composition_keys(entry.composition, components),
  })
  const entries_of_interest = entries.map(normalize)
  // Hull distances of a set against itself are the common call: normalize and place once
  const same_entries = entries === reference_entries
  reference_entries = same_entries ? entries_of_interest : reference_entries.map(normalize)

  const elements = collect_hull_elements(reference_entries)
  const element_set = new Set<string>(elements)
  for (const entry of entries_of_interest) {
    for (const element of Object.keys(entry.composition)) {
      if (!element_set.has(element)) {
        throw new Error(
          `Entry contains element ${element} not present in reference system: ${elements.join(`-`)}`,
        )
      }
    }
  }

  const refs = find_lowest_energy_unary_refs(reference_entries)
  const e_form_of = (entry: PhaseData): number | null =>
    typeof entry.e_form_per_atom === `number`
      ? entry.e_form_per_atom
      : compute_e_form_per_atom(entry, refs)
  const arity = elements.length
  // Hull points: barycentric coords minus the first (they sum to 1) + E_form (NaN unplaceable)
  const to_point = (entry: PhaseData): number[] => {
    const e_form = e_form_of(entry)
    // zero atoms with explicit e_form_per_atom would make composition_to_barycentric_nd throw
    if (e_form === null || count_atoms_in_composition(entry.composition) <= 0) {
      return Array(arity).fill(NaN)
    }
    if (arity === 1) return [e_form]
    return [...composition_to_barycentric_nd(entry.composition, elements).slice(1), e_form]
  }

  const query_points = entries_of_interest.map(to_point)
  const ref_points = (same_entries ? query_points : reference_entries.map(to_point)).filter(
    // exclude_from_hull entries are shown but not part of the hull
    (point, idx) => !reference_entries[idx].exclude_from_hull && point.every(Number.isFinite),
  )
  // Lowest E_form at each pure-element corner, else 0 (then added as a hull point). Element 0
  // is the origin, element k > 0 has (k-1)th coordinate 1.
  const corner_energies = elements.map((_, el_idx) => {
    const corner: number[] = Array(arity).fill(0)
    if (el_idx > 0) corner[el_idx - 1] = 1
    const energies = ref_points
      .filter((point) =>
        point.slice(0, -1).every((val, dim) => Math.abs(val - corner[dim]) <= HULL_EPS),
      )
      .map((point) => point[arity - 1])
    if (energies.length > 0) return Math.min(...energies)
    ref_points.push(corner)
    return 0
  })

  const facets = arity > 1 ? compute_lower_hull_nd(ref_points) : []
  if (facets.length > 0) return compute_e_above_hull_nd(query_points, facets, ref_points)
  // No facets (unary, or all points on one hyperplane): E_hull = Σ x_k E_corner_k
  return query_points.map((point) => {
    const coords = point.slice(0, -1)
    const first = 1 - coords.reduce((sum, val) => sum + val, 0)
    const corner_sum = [first, ...coords].reduce(
      (sum, frac, el_idx) => sum + frac * corner_energies[el_idx],
      0,
    )
    return point[arity - 1] - corner_sum
  })
}

// Energy above hull (clamped to >= 0) of one entry, or of many keyed by id_of
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
  const clamped = (entries: PhaseData[]) =>
    e_above_hull_distances(entries, reference_entries).map((dist) => Math.max(0, dist))
  if (!Array.isArray(input)) return clamped([input])[0]
  if (input.length === 0) return {} // Empty input → empty result (not an error)
  const distances = clamped(input)
  const repeat = first_duplicate(input.map(({ entry_id }) => entry_id).filter(Boolean))
  if (repeat) console.warn(`calculate_e_above_hull: duplicate entry_id "${repeat}", last wins`)
  return Object.fromEntries(input.map((entry, idx) => [id_of(entry), distances[idx]]))
}

export function get_convex_hull_stats(
  entries: (PhaseData & { is_synthetic?: boolean })[],
  elements: ElementSymbol[],
  max_arity: number,
): PhaseStats | null {
  const processed_entries = entries.filter((entry) => !entry.is_synthetic) // not data phases
  if (processed_entries.length === 0) return null

  const arity_counts = [0, 0, 0, 0, 0, 0] // index = arity (5 = quinary+)
  for (const entry of processed_entries) arity_counts[Math.min(5, get_arity(entry))]++
  const [, unary, binary, ternary, quaternary, quinary_plus] = arity_counts
  const stable = processed_entries.filter((entry) => is_on_hull(entry)).length

  // E_form only: absolute computed energies would put ~-8 and ~-1 eV/atom in one stat
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
    // Zero out counts beyond the system's dimensionality
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
  entries: ConvexHullEntry[]
  phase_stats: PhaseStats | null
}

// Formation energies, hull distances and stability for 5+ element systems (not renderable)
export function process_hull_for_stats(entries: PhaseData[]): HighDimHullResult | null {
  const processed = process_hull_entries(entries)
  if (processed.entries.length === 0) return null
  const hull_elements = processed.elements

  const el_refs = find_lowest_energy_unary_refs(processed.entries)
  const with_e_form = processed.entries.map((entry) => ({
    ...entry,
    e_form_per_atom:
      entry.e_form_per_atom ?? compute_e_form_per_atom(entry, el_refs) ?? undefined,
  }))
  const hull_distances = e_above_hull_distances(with_e_form, with_e_form)
  // x/y/z are 0 since high-dim systems aren't plotted. Clamped, unlike the 2-4D model
  const hull_entries = with_e_form.map((entry, idx): ConvexHullEntry => ({
    ...entry,
    ...compute_hull_stability(Math.max(0, hull_distances[idx]), entry.exclude_from_hull),
    is_element: is_unary_entry(entry),
    x: 0,
    y: 0,
    z: 0,
  }))
  return {
    entries: hull_entries,
    phase_stats: get_convex_hull_stats(hull_entries, hull_elements, hull_elements.length),
  }
}

// === N-dimensional convex hull (quickhull) ===

// Hull construction tolerance (compositions in [0, 1], energies in eV/atom)
const HULL_EPS = 1e-9

// Facet budget for quickhull (running tally). Points in convex position: 6D/1000 builds ~300k
// facets in 10 s, 7D/1000 610k in 72 s, so 500k keeps tractable cases and aborts the rest in
// 12-14 s. Only reachable on the arity-5+ stats path.
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

// Signed distance of a point to a facet's hyperplane (> 0 outside). Hot kernel: bare loop
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
  const edges = points.slice(1).map((point) => math.subtract(point, points[0]))
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

// Give each candidate point to the facet it lies farthest outside of, tracking each facet's
// farthest point so the main loop never rescans outside sets
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
  const is_chosen = new Uint8Array(points.length)
  is_chosen[first] = 1
  is_chosen[second] = 1
  const origin = points[first]
  const basis = [math.normalize_vec(math.subtract(points[second], origin))]
  // Component of (point - origin) orthogonal to the span of the chosen points, written into
  // one reused array: this scan over every point allocated three arrays per point and basis
  // vector, most of a 50k-point hull build
  const residual: number[] = Array(dim).fill(0)
  const project_residual = (point: number[]): number[] => {
    for (let axis = 0; axis < dim; axis++) residual[axis] = point[axis] - origin[axis]
    for (const vec of basis) {
      let proj = 0
      for (let axis = 0; axis < dim; axis++) proj += residual[axis] * vec[axis]
      for (let axis = 0; axis < dim; axis++) residual[axis] -= vec[axis] * proj
    }
    return residual
  }
  while (chosen.length < dim + 1) {
    let [best_idx, best_norm] = [-1, HULL_EPS]
    for (let idx = 0; idx < points.length; idx++) {
      if (is_chosen[idx]) continue
      const norm = Math.hypot(...project_residual(points[idx]))
      if (norm > best_norm) [best_idx, best_norm] = [idx, norm]
    }
    if (best_idx === -1) return null
    chosen.push(best_idx)
    is_chosen[best_idx] = 1
    basis.push(project_residual(points[best_idx]).map((val) => val * (1 / best_norm)))
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

// N-dimensional quickhull. [] for fewer than N+1 points or degenerate input; throws on mixed
// dimensions or past `max_facets`.
export function compute_quickhull_nd(
  points: number[][],
  max_facets = MAX_HULL_FACETS,
): HullFacet[] {
  if (points.length === 0) return []
  const dim = points[0].length
  for (const point of points) {
    if (point.length !== dim)
      throw new Error(`Vector dimension mismatch: ${point.length} vs ${dim}`)
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

// Unclamped energy above the lower hull per query point (last coordinate = energy): the plane
// of a facet whose projection contains the query. Facets at the max over all planes go
// first; a sliver facet's plane can overshoot, so then planes are tried from the top. Queries
// outside the composition domain get NaN.
export function compute_e_above_hull_nd(
  query_points: number[][],
  facets: HullFacet[],
  hull_points: number[][],
): number[] {
  const spatial_dim = (hull_points[0]?.length ?? 1) - 1
  // Solve normal · (x, e) + offset = 0 for e
  const facet_energy = (facet: HullFacet, query: number[]): number => {
    let sum = facet.offset
    for (let dim = 0; dim < spatial_dim; dim++) sum += facet.normal[dim] * query[dim]
    return -sum / facet.normal[spatial_dim]
  }
  // Barycentric coordinates of the query's projection in the facet's projected simplex:
  // [v1-v0 … vn-v0] · λ = x - v0, λ0 = 1 - Σλ
  const contains = (facet: HullFacet, query: number[]): boolean => {
    const verts = facet.vertex_indices.map((idx) => hull_points[idx])
    const matrix = Array.from({ length: spatial_dim }, (_, row) =>
      verts.slice(1).map((vert) => vert[row] - verts[0][row]),
    )
    const rhs = Array.from({ length: spatial_dim }, (_, row) => query[row] - verts[0][row])
    const lambda = math.solve_linear_system(matrix, rhs)
    return Boolean(
      lambda?.every((val) => val >= -HULL_EPS) &&
      1 - lambda.reduce((sum, val) => sum + val, 0) >= -HULL_EPS,
    )
  }
  const hull_energy = (query: number[]): number => {
    const energies = facets.map((facet) => facet_energy(facet, query))
    const covers = (idx: number) =>
      Number.isFinite(energies[idx]) && contains(facets[idx], query)
    const e_max = energies.reduce((max, energy) => (energy > max ? energy : max), -Infinity)
    const near_max = energies.findIndex(
      (energy, idx) => energy >= e_max - HULL_EPS && covers(idx),
    )
    const covering =
      near_max !== -1
        ? near_max
        : energies
            .map((_, idx) => idx)
            .toSorted((idx_a, idx_b) => energies[idx_b] - energies[idx_a])
            .find(covers)
    return covering === undefined ? NaN : energies[covering]
  }
  // The hull energy depends only on the composition coordinates: polymorphs and repeated
  // compositions share one facet scan
  const hull_energies = new Map<string, number>()
  return query_points.map((query) => {
    if (!query.every(Number.isFinite)) return NaN
    const key = query.slice(0, spatial_dim).join(`,`)
    let energy = hull_energies.get(key)
    if (energy === undefined) {
      energy = hull_energy(query)
      hull_energies.set(key, energy)
    }
    return query[spatial_dim] - energy
  })
}

// === Decomposition ===

const MIXTURE_COEFF_TOL = 1e-7

export interface LowestEnergyMixture<Phase> {
  energy: number // eV/atom of the lowest-energy mixture at the query composition
  decomposition: { phase: Phase; atom_fraction: number }[] // largest fraction first
}

// Lower hull of `phases` at atom `fractions` (shared element order) via an LP, null if unmixable
export function lowest_energy_mixture<
  Phase extends { fractions: readonly number[]; energy_per_atom: number },
>(fractions: readonly number[], phases: readonly Phase[]): LowestEnergyMixture<Phase> | null {
  const candidates = phases.filter((phase) =>
    phase.fractions.every((fraction, el_idx) => fraction === 0 || fractions[el_idx] > 0),
  )
  if (candidates.length === 0) return null
  const active_rows = fractions.flatMap((fraction, el_idx) => (fraction > 0 ? [el_idx] : []))
  const result = math.solve_linear_program(
    candidates.map((phase) => phase.energy_per_atom),
    active_rows.map((el_idx) => candidates.map((phase) => phase.fractions[el_idx])),
    active_rows.map((el_idx) => fractions[el_idx]),
  )
  if (result.status !== `optimal`) return null
  const decomposition = result.solution
    .map((atom_fraction, idx) => ({ phase: candidates[idx], atom_fraction }))
    .filter(({ atom_fraction }) => atom_fraction > MIXTURE_COEFF_TOL)
    .toSorted((item_a, item_b) => item_b.atom_fraction - item_a.atom_fraction)
  return { energy: result.objective, decomposition }
}

// Atom fractions of a composition over `elements`, null when empty or partly outside them
export function system_fractions(
  composition: PhaseData[`composition`],
  elements: readonly ElementSymbol[],
): number[] | null {
  const total = count_atoms_in_composition(composition)
  const in_system = elements.reduce((sum, element) => sum + (composition[element] ?? 0), 0)
  if (!(total > 0) || Math.abs(in_system - total) > 1e-9 * total) return null
  return elements.map((element) => (composition[element] ?? 0) / total)
}

// Hull vertices an above-hull entry decomposes into (null on the hull, no E_form or outside)
export function get_hull_decomposition<Entry extends PhaseData>(
  entry: PhaseData,
  entries: readonly Entry[],
  elements: readonly ElementSymbol[],
): LowestEnergyMixture<Entry> | null {
  if (is_on_hull(entry) || !Number.isFinite(entry.e_form_per_atom)) return null
  const fractions = system_fractions(entry.composition, elements)
  if (!fractions) return null
  const vertices = entries.flatMap((vertex) => {
    const vertex_fractions =
      is_on_hull(vertex) && system_fractions(vertex.composition, elements)
    const energy_per_atom = vertex.e_form_per_atom
    return vertex_fractions && typeof energy_per_atom === `number`
      ? [{ vertex, fractions: vertex_fractions, energy_per_atom }]
      : []
  })
  const mixture = lowest_energy_mixture(fractions, vertices)
  if (!mixture) return null
  const decomposition = mixture.decomposition.map(({ phase, atom_fraction }) => ({
    phase: phase.vertex,
    atom_fraction,
  }))
  return { energy: mixture.energy, decomposition }
}
