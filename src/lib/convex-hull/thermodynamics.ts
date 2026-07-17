import {
  count_atoms_in_composition,
  extract_formula_elements,
  sort_by_electronegativity,
} from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import type { Point2D, Point3D, Vec2 } from '$lib/math'
import { composition_to_barycentric_nd } from './barycentric-coords'
import type {
  ConvexHullEntry,
  ConvexHullTriangle,
  PhaseData,
  PhaseStats,
  ProcessedPhaseData,
} from './types'
import {
  array_max,
  array_min,
  get_arity,
  HULL_STABILITY_TOL,
  is_on_hull,
  is_unary_entry,
} from './helpers'

// Track warned keys to avoid log spam on large datasets with repeated invalid keys
const warned_keys = new Set<string>()

// Normalize convex hull composition keys by stripping oxidation states (e.g. "V4+" -> "V")
// and merging amounts for keys that map to the same element. Filters non-positive amounts.
// Only extracts FIRST valid element from each key (e.g. "Fe2O3" -> "Fe", not both Fe and O).
export function normalize_hull_composition_keys(
  composition: Record<string, number>,
): Partial<Record<ElementSymbol, number>> {
  const normalized: Partial<Record<ElementSymbol, number>> = {}
  for (const [key, amount] of Object.entries(composition)) {
    if (typeof amount !== `number` || !Number.isFinite(amount) || amount <= 0) continue
    // Extract first valid element symbol from key (handles oxidation states like "V4+", "Fe2+")
    const elem = extract_formula_elements(key, { unique: false })[0]
    if (!elem) {
      // Dedupe warnings to avoid log spam on large datasets
      if (!warned_keys.has(key)) {
        warned_keys.add(key)
        console.warn(`Skipping unrecognized composition key: "${key}"`)
      }
      continue
    }
    normalized[elem] = (normalized[elem] ?? 0) + amount
  }
  return normalized
}

export function process_hull_entries(entries: PhaseData[]): ProcessedPhaseData {
  // Normalize composition keys to strip oxidation states (e.g. "Fe3+" -> "Fe")
  // Filter out entries whose composition normalizes to {} (all keys invalid or non-positive)
  const normalized_entries = entries
    .map((entry) => ({
      ...entry,
      composition: normalize_hull_composition_keys(entry.composition),
    }))
    .filter((entry) => Object.keys(entry.composition).length > 0)

  // Single-pass partition instead of two filter passes
  const stable_entries: PhaseData[] = []
  const unstable_entries: PhaseData[] = []
  for (const entry of normalized_entries) {
    const stable =
      typeof entry.is_stable === `boolean`
        ? entry.is_stable
        : (entry.e_above_hull ?? Infinity) <= HULL_STABILITY_TOL
    ;(stable ? stable_entries : unstable_entries).push(entry)
  }

  // Extract unique element symbols from normalized compositions
  const elements = Array.from(
    new Set(normalized_entries.flatMap((entry) => Object.keys(entry.composition))),
  ).toSorted() as ElementSymbol[]

  const el_refs = Object.fromEntries(
    stable_entries
      .filter(is_unary_entry)
      .map((entry) => [Object.keys(entry.composition)[0], entry]),
  )

  return { entries: normalized_entries, stable_entries, unstable_entries, elements, el_refs }
}

// Get energy per atom with correction applied, or fallback to raw energy_per_atom/energy.
// Note: correction is expected to be a total-entry value (eV), not per-atom.
// This matches the Materials Project convention where corrections are applied to total energies.
function get_energy_per_atom(entry: PhaseData): number {
  // Use Math.max instead of || to prevent pathological negative totals from flipping sign
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

export function compute_e_form_per_atom(
  entry: PhaseData,
  el_refs: Record<string, PhaseData>,
): number | null {
  const atoms = count_atoms_in_composition(entry.composition)
  if (atoms <= 0) return null
  let ref_sum = 0
  for (const [el, amt] of Object.entries(entry.composition)) {
    const ref = el_refs[el]
    if (!ref) return null
    ref_sum += (amt / atoms) * get_energy_per_atom(ref)
  }
  return get_energy_per_atom(entry) - ref_sum
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

// Result key: entry_id, else composition|energy|structure. Composition alone collides for
// same-stoichiometry polymorphs (last distance would win), so add energy + structure.
const id_of = (entry: PhaseData): string => {
  if (entry.entry_id) return entry.entry_id
  const structure_hash = entry.structure ? JSON.stringify(entry.structure) : ``
  return `${JSON.stringify(entry.composition)}|${entry.energy}|${structure_hash}`
}

// Calculate energy above hull (eV/atom). Missing pure element refs default to E_form = 0.
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
  const is_single = !Array.isArray(input)
  const entries_of_interest = is_single ? [input] : input

  if (entries_of_interest.length === 0) return {} // Empty input → empty result (not an error)
  if (reference_entries.length === 0) {
    throw new Error(`Reference entries cannot be empty`)
  }

  // 1. Identify chemical system
  const elements = Array.from(
    new Set(reference_entries.flatMap((entry) => Object.keys(entry.composition))),
  ).toSorted() as ElementSymbol[]

  // 2. Validate subset
  const element_set = new Set(elements)
  for (const entry of entries_of_interest) {
    for (const el of Object.keys(entry.composition)) {
      if (!element_set.has(el as ElementSymbol)) {
        throw new Error(
          `Entry contains element ${el} not present in reference system: ${elements.join(`-`)}`,
        )
      }
    }
  }

  // 3. Compute formation energies
  const refs = find_lowest_energy_unary_refs(reference_entries)
  const compute_e_form = (entry: PhaseData) =>
    typeof entry.e_form_per_atom === `number`
      ? entry.e_form_per_atom
      : compute_e_form_per_atom(entry, refs)

  const interest_data = entries_of_interest.map((entry) => ({
    entry,
    e_form: compute_e_form(entry),
  }))

  // 4. Branch by arity
  const arity = elements.length
  const results: Record<string, number> = {}

  if (arity === 1) {
    // Unary system
    for (const { entry, e_form } of interest_data) {
      const id = id_of(entry)
      // For unary, e_above_hull is simply e_form (since stable state is 0)
      // Unless we have multiple polymorphs, in which case the hull is at min(e_form) which should be 0
      // But compute_e_form_per_atom already subtracts the stable unary reference energy.
      // So e_form IS e_above_hull for unary systems if correction logic holds.
      results[id] = e_form ?? NaN
    }
  } else if (arity === 2) {
    // Binary system
    const [_el1, el2] = elements
    // Build hull points from references
    const hull_input_map = new Map<number, number>() // x -> min_e_form

    for (const ref of reference_entries) {
      if (ref.exclude_from_hull) continue // Shown but not used in hull construction
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      const total = count_atoms_in_composition(ref.composition)
      if (total <= 0) continue
      const x = (ref.composition[el2] ?? 0) / total
      const current = hull_input_map.get(x)
      if (current === undefined || e_form < current) {
        hull_input_map.set(x, e_form)
      }
    }
    // Ensure endpoints (pure elements default to e_form = 0)
    if (!hull_input_map.has(0)) hull_input_map.set(0, 0)
    if (!hull_input_map.has(1)) hull_input_map.set(1, 0)

    const hull_points: Point2D[] = Array.from(hull_input_map, ([x, y]) => ({ x, y }))
    const lower_hull = compute_lower_hull_2d(hull_points)

    for (const { entry, e_form } of interest_data) {
      const id = id_of(entry)
      if (typeof e_form !== `number`) {
        results[id] = NaN
        continue
      }
      const total = count_atoms_in_composition(entry.composition)
      // Guard for degenerate compositions (mirror the refs loop check)
      if (total <= 0) {
        results[id] = NaN
        continue
      }
      const x = (entry.composition[el2] ?? 0) / total
      const y_hull = interpolate_hull_2d(lower_hull, x)
      results[id] = y_hull === null ? NaN : Math.max(0, e_form - y_hull)
    }
  } else {
    // Arity 3+ uses the generalized N-dimensional convex hull in reduced barycentric coords
    // Helper to convert entry to hull point, returns null on expected errors.
    // Barycentric coords sum to 1, so the first is dropped: keeping all N would confine
    // points to an (N-1)-dim affine subspace, leaving the hull permanently degenerate.
    const to_hull_point = (entry: PhaseData, e_form: number): number[] | null => {
      try {
        const bary = composition_to_barycentric_nd(entry.composition, elements)
        return [...bary.slice(1), e_form]
      } catch (err) {
        // Skip expected errors (missing elements), warn on unexpected
        if (err instanceof Error && !err.message.includes(`no elements from the system`)) {
          console.warn(`Skipping entry: ${err.message}`)
        }
        return null
      }
    }

    // Build reference points
    const ref_points: number[][] = []
    for (const ref of reference_entries) {
      if (ref.exclude_from_hull) continue // Shown but not used in hull construction
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      const point = to_hull_point(ref, e_form)
      if (point) ref_points.push(point)
    }

    // Ensure corner points (pure elements default to e_form = 0). In reduced
    // coordinates, element 0 is the origin; element k > 0 has (k-1)th coord = 1.
    for (let el_idx = 0; el_idx < arity; el_idx++) {
      const corner = Array(arity).fill(0)
      if (el_idx > 0) corner[el_idx - 1] = 1
      if (!ref_points.some((pt) => norm_nd(subtract_nd(pt, corner)) < EPS)) {
        ref_points.push(corner)
      }
    }

    const hull_facets = compute_lower_hull_nd(compute_quickhull_nd(ref_points))

    // Degenerate hull (all refs co-hyperplanar, e.g. all e_form = 0): tie-plane fallback is exact
    if (hull_facets.length === 0 && ref_points.length >= arity + 1) {
      console.warn(
        `N-dimensional hull for ${arity}-element system is degenerate ` +
          `(all reference points co-hyperplanar). Falling back to tie-hyperplane at energy 0.`,
      )
    }

    // Build query points with mapping back to original indices
    const interest_points: number[][] = []
    const idx_to_point_idx = new Map<number, number>()

    for (let idx = 0; idx < interest_data.length; idx++) {
      const { entry, e_form } = interest_data[idx]
      if (typeof e_form !== `number`) continue
      const point = to_hull_point(entry, e_form)
      if (point) {
        idx_to_point_idx.set(idx, interest_points.length)
        interest_points.push(point)
      }
    }

    // Compute hull distances (empty array if degenerate hull)
    const distances =
      hull_facets.length > 0
        ? compute_e_above_hull_nd(interest_points, hull_facets, ref_points)
        : []

    // Map results back to entries (degenerate hull → tie-hyperplane at energy 0)
    for (let idx = 0; idx < interest_data.length; idx++) {
      const { entry, e_form } = interest_data[idx]
      const id = id_of(entry)
      const point_idx = idx_to_point_idx.get(idx)
      const on_tie_plane = hull_facets.length === 0 && typeof e_form === `number`
      if (point_idx === undefined) results[id] = NaN
      else results[id] = Math.max(0, on_tie_plane ? e_form : distances[point_idx])
    }
  }

  if (is_single) return results[id_of(entries_of_interest[0])]
  return results
}

export function get_convex_hull_stats(
  processed_entries: PhaseData[],
  elements: ElementSymbol[],
  max_arity: number = 4,
): PhaseStats | null {
  if (processed_entries.length === 0) return null
  max_arity = Math.max(1, max_arity)

  let unary = 0
  let binary = 0
  let ternary = 0
  let quaternary = 0
  let quinary_plus = 0
  for (const entry of processed_entries) {
    const arity = get_arity(entry)
    if (arity === 1) unary++
    else if (arity === 2) binary++
    else if (arity === 3) ternary++
    else if (arity === 4) quaternary++
    else if (arity >= 5) quinary_plus++
  }
  // Zero out counts beyond system dimensionality for cleaner display
  // quinary_plus is intentionally not zeroed — it's a catch-all bucket that
  // is naturally 0 for systems with fewer than 5 elements
  if (max_arity < 4) quaternary = 0
  if (max_arity < 3) ternary = 0
  if (max_arity < 2) binary = 0

  const stable_count = processed_entries.filter((entry) => is_on_hull(entry)).length
  const unstable_count = processed_entries.length - stable_count

  const energies = processed_entries
    .map(
      (entry) => entry.e_form_per_atom ?? entry.energy_per_atom ?? get_energy_per_atom(entry),
    )
    .filter(Number.isFinite)

  // array_min/array_max reduce instead of Math.min/max(...arr) to avoid stack
  // overflow on large datasets
  const energy_range =
    energies.length > 0
      ? {
          min: array_min(energies),
          max: array_max(energies),
          avg: energies.reduce((sum, val) => sum + val, 0) / energies.length,
        }
      : { min: 0, max: 0, avg: 0 }

  const hull_distances = processed_entries
    .map((entry) => entry.e_above_hull)
    .filter((val): val is number => typeof val === `number` && val >= 0)
  const hull_distance =
    hull_distances.length > 0
      ? {
          max: array_max(hull_distances),
          avg: hull_distances.reduce((sum, val) => sum + val, 0) / hull_distances.length,
        }
      : { max: 0, avg: 0 }

  return {
    total: processed_entries.length,
    unary,
    binary,
    ternary,
    quaternary,
    quinary_plus,
    stable: stable_count,
    unstable: unstable_count,
    energy_range,
    hull_distance,
    elements: elements.length,
    chemical_system: sort_by_electronegativity([...elements]).join(`-`),
    max_arity,
  }
}

// Result type for process_hull_for_stats
export interface HighDimHullResult {
  stable_entries: ConvexHullEntry[]
  unstable_entries: ConvexHullEntry[]
  phase_stats: PhaseStats | null
}

// Convert a PhaseData entry to a ConvexHullEntry with default visual fields.
// x/y/z default to 0 since high-dim systems aren't visually plotted.
const to_hull_entry = (entry: PhaseData): ConvexHullEntry => ({
  ...entry,
  is_element: get_arity(entry) === 1,
  x: 0,
  y: 0,
  z: 0,
})

// Process raw hull entries for high-dimensional systems (5+ elements) where the
// ConvexHull visual component can't render. Computes formation energies, hull distances,
// stable/unstable classification, and phase stats. Returns null on failure.
// Optionally accepts `elements` to scope the chemical system; if omitted, elements
// are derived from the entries' compositions.
export function process_hull_for_stats(
  entries: PhaseData[],
  elements?: ElementSymbol[],
): HighDimHullResult | null {
  if (entries.length === 0) return null

  const processed = process_hull_entries(entries)
  if (processed.entries.length === 0) return null
  const hull_elements = elements ?? processed.elements

  // Compute formation energies
  const el_refs = find_lowest_energy_unary_refs(processed.entries)
  for (const entry of processed.entries) {
    if (entry.e_form_per_atom === undefined) {
      const e_form = compute_e_form_per_atom(entry, el_refs)
      if (e_form !== null) entry.e_form_per_atom = e_form
    }
  }

  // Compute hull distances. Note: entries without entry_id are keyed by
  // JSON.stringify(composition), so polymorphs at the same composition
  // collide — the last-processed entry's distance wins for all of them.
  try {
    const hull_distances = calculate_e_above_hull(processed.entries, processed.entries)

    for (const entry of processed.entries) {
      const dist = hull_distances[id_of(entry)]
      if (typeof dist === `number` && Number.isFinite(dist)) {
        entry.e_above_hull = dist
        entry.is_stable = dist < HULL_STABILITY_TOL
      } else {
        // Clear stale hull metadata so previous values don't persist
        entry.e_above_hull = undefined
        entry.is_stable = undefined
      }
    }
  } catch (err) {
    console.warn(`Failed to compute high-dim hull:`, err)
    return null
  }

  const hull_entries = processed.entries.map(to_hull_entry)
  return {
    stable_entries: hull_entries.filter((entry) => is_on_hull(entry)),
    unstable_entries: hull_entries.filter((entry) => !is_on_hull(entry)),
    phase_stats: get_convex_hull_stats(processed.entries, hull_elements, hull_elements.length),
  }
}

// --- 2D Convex Hull (Binary Phase Diagrams) ---

export function compute_lower_hull_2d(points: Point2D[]): Point2D[] {
  // Andrew's monotone chain lower hull (Point2D adapter over math.monotone_chain)
  const sorted = points
    .map((pt): Vec2 => [pt.x, pt.y])
    // map() returns a fresh array.
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1])
  return math.monotone_chain(sorted).map(([x, y]) => ({ x, y }))
}

export function interpolate_hull_2d(hull: Point2D[], x: number): number | null {
  if (hull.length < 2) return null
  // Handle out of bounds by clamping to endpoints
  if (x <= hull[0].x) return hull[0].y
  if (x >= hull[hull.length - 1].x) return hull[hull.length - 1].y

  for (let idx = 0; idx < hull.length - 1; idx++) {
    const p1 = hull[idx]
    const p2 = hull[idx + 1]
    if (x >= p1.x && x <= p2.x) {
      const frac = (x - p1.x) / Math.max(1e-12, p2.x - p1.x)
      return p1.y * (1 - frac) + p2.y * frac
    }
  }
  return null
}

// --- Convex hull geometry ---

const EPS = 1e-9

// Point conversions between object-shaped public API points and ND number[] points
const p3_to_nd = (pt: Point3D): number[] => [pt.x, pt.y, pt.z]
const p4_to_nd = (pt: Point4D): number[] => [pt.x, pt.y, pt.z, pt.w]

// Map an ND facet (vertex indices into `points`) back to the public triangle shape
const facet_to_triangle = (facet: SimplexFaceND, points: Point3D[]): ConvexHullTriangle => ({
  vertices: facet.vertex_indices.map((idx) => points[idx]) as [Point3D, Point3D, Point3D],
  normal: { x: facet.plane.normal[0], y: facet.plane.normal[1], z: facet.plane.normal[2] },
  centroid: { x: facet.centroid[0], y: facet.centroid[1], z: facet.centroid[2] },
})

// 3D quickhull (thin adapter over the N-dimensional implementation)
export function compute_quickhull_triangles(points: Point3D[]): ConvexHullTriangle[] {
  const facets = compute_quickhull_nd(points.map(p3_to_nd))
  return facets.map((facet) => facet_to_triangle(facet, points))
}

export function compute_lower_hull_triangles(points: Point3D[]): ConvexHullTriangle[] {
  // Lower hull faces point "down" in the z (energy) direction
  return compute_quickhull_triangles(points).filter((face) => face.normal.z < 0 - EPS)
}

// ---------- Lower hull face models and energy-above-hull ----------

export interface HullFaceModel {
  a: number
  b: number
  c: number
  x1: number
  y1: number
  x2: number
  y2: number
  x3: number
  y3: number
  min_x: number
  max_x: number
  min_y: number
  max_y: number
  denom: number
}

export const build_lower_hull_model = (faces: ConvexHullTriangle[]): HullFaceModel[] =>
  faces.map((tri) => {
    const [{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }, { x: x3, y: y3, z: z3 }] =
      tri.vertices
    // Fit plane z = a*x + b*y + c through the three vertices (flat fallback if degenerate)
    const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
    const plane =
      Math.abs(det) < 1e-12
        ? { a: 0, b: 0, c: (z1 + z2 + z3) / 3 }
        : {
            a: (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / det,
            b: (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / det,
            c:
              (z1 * (x2 * y3 - x3 * y2) +
                z2 * (x3 * y1 - x1 * y3) +
                z3 * (x1 * y2 - x2 * y1)) /
              det,
          }
    return {
      ...plane,
      x1,
      y1,
      x2,
      y2,
      x3,
      y3,
      min_x: Math.min(x1, x2, x3),
      max_x: Math.max(x1, x2, x3),
      min_y: Math.min(y1, y2, y3),
      max_y: Math.max(y1, y2, y3),
      denom: det,
    }
  })

function point_in_triangle_xy(model: HullFaceModel, x: number, y: number): boolean {
  const { x1, y1, x2, y2, x3, y3, denom } = model
  if (Math.abs(denom) < 1e-14) return false
  const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denom
  const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denom
  const l3 = 1 - l1 - l2
  const eps = -1e-9
  return l1 >= eps && l2 >= eps && l3 >= eps
}

export function e_hull_at_xy(models: HullFaceModel[], x: number, y: number) {
  let z: number | null = null
  for (const model of models) {
    if (
      x < model.min_x - 1e-9 ||
      x > model.max_x + 1e-9 ||
      y < model.min_y - 1e-9 ||
      y > model.max_y + 1e-9
    )
      continue
    if (!point_in_triangle_xy(model, x, y)) continue
    const z_face = model.a * x + model.b * y + model.c
    z = z === null ? z_face : Math.min(z, z_face)
  }
  return z
}

export const compute_e_above_hull_for_points = (points: Point3D[], models: HullFaceModel[]) =>
  points.map((point) => {
    const z_hull = e_hull_at_xy(models, point.x, point.y)
    if (z_hull === null) return NaN // unknown: no hull face covers this point
    return Math.max(0, point.z - z_hull)
  })

// --- 4D Convex Hull (Quaternary Phase Diagrams) ---

export interface Point4D {
  x: number
  y: number
  z: number
  w: number // formation energy dimension
}

export interface ConvexHullTetrahedron {
  vertices: [Point4D, Point4D, Point4D, Point4D]
  normal: Point4D // 4D normal vector
  centroid: Point4D
}

// Map an ND facet (vertex indices into `points`) back to the public tetrahedron shape
const facet_to_tetrahedron = (
  facet: SimplexFaceND,
  points: Point4D[],
): ConvexHullTetrahedron => {
  const [nx, ny, nz, nw] = facet.plane.normal
  const [cx, cy, cz, cw] = facet.centroid
  return {
    vertices: facet.vertex_indices.map((idx) => points[idx]) as [
      Point4D,
      Point4D,
      Point4D,
      Point4D,
    ],
    normal: { x: nx, y: ny, z: nz, w: nw },
    centroid: { x: cx, y: cy, z: cz, w: cw },
  }
}

// 4D quickhull (thin adapter over the N-dimensional implementation)
export function compute_quickhull_4d(points: Point4D[]): ConvexHullTetrahedron[] {
  const facets = compute_quickhull_nd(points.map(p4_to_nd))
  return facets.map((facet) => facet_to_tetrahedron(facet, points))
}

export function compute_lower_hull_4d(points: Point4D[]): ConvexHullTetrahedron[] {
  // Filter for "lower" faces: those with normal pointing down in w (energy) direction
  return compute_quickhull_4d(points).filter((tet) => tet.normal.w < 0 - EPS)
}

// Compute distance from point to lower hull in 4D (w is the energy dimension).
// Returns raw (unclamped) distances; NaN for points outside the composition domain.
export const compute_e_above_hull_4d = (
  points: Point4D[],
  hull_tetrahedra: ConvexHullTetrahedron[],
): number[] =>
  e_above_hull_from_simplices(
    points.map(p4_to_nd),
    hull_tetrahedra.map((tet) => tet.vertices.map(p4_to_nd)),
  )

// --- N-Dimensional Convex Hull (single quickhull core; the 3D/4D APIs above adapt to it) ---

// N-dimensional vector operations. These run in quickhull's hot loops, so dimension
// agreement is validated once per compute_quickhull_nd call instead of per operation.
const subtract_nd = (vec_a: number[], vec_b: number[]): number[] =>
  vec_a.map((val, idx) => val - vec_b[idx])

const dot_nd = (vec_a: number[], vec_b: number[]): number => {
  let sum = 0
  for (let idx = 0; idx < vec_a.length; idx++) sum += vec_a[idx] * vec_b[idx]
  return sum
}

const norm_nd = (vec: number[]): number => Math.sqrt(dot_nd(vec, vec))

const normalize_nd = (vec: number[]): number[] => {
  const len = norm_nd(vec)
  if (len < EPS) return vec.map(() => 0)
  return vec.map((val) => val / len)
}

// Hyperplane in N dimensions: normal · x + offset = 0
interface HyperplaneND {
  normal: number[]
  offset: number
}

// Simplex facet of the convex hull (N vertices in N-dimensional space)
export interface SimplexFaceND {
  vertex_indices: number[]
  plane: HyperplaneND
  centroid: number[]
  outside_points: Set<number>
}

// Compute normal to hyperplane through N points in N-dimensional space
// Uses null space computation via cofactor expansion
function compute_hyperplane_nd(points: number[][]): HyperplaneND {
  const n_points = points.length
  if (n_points < 2) return { normal: [], offset: 0 }

  // Build (N-1) edge vectors from points[0]
  const edges = points.slice(1).map((pt) => subtract_nd(pt, points[0]))

  // Compute normal via cofactors of the (N-1)×N edge matrix
  // Each component is ±det of (N-1)×(N-1) submatrix with that column removed
  const dim = points[0].length
  const normal_components: number[] = []

  for (let col = 0; col < dim; col++) {
    // Build (N-1)×(N-1) submatrix by removing column col
    const submatrix = edges.map((row) => [...row.slice(0, col), ...row.slice(col + 1)])
    const sign = col % 2 === 0 ? 1 : -1
    normal_components.push(sign * math.det_nxn(submatrix))
  }

  const normal = normalize_nd(normal_components)

  // Degenerate case: co-hyperplanar points produce zero normal
  if (norm_nd(normal) < EPS) return { normal, offset: 0 }

  const offset = -dot_nd(normal, points[0])
  return { normal, offset }
}

const point_hyperplane_signed_distance_nd = (plane: HyperplaneND, point: number[]): number =>
  dot_nd(plane.normal, point) + plane.offset

const compute_centroid_nd = (points: number[][]): number[] => {
  if (points.length === 0) return []
  const dim = points[0].length
  return Array.from(
    { length: dim },
    (_, idx) => points.reduce((sum, pt) => sum + pt[idx], 0) / points.length,
  )
}

// Maximum sample size for initial simplex selection (avoids O(n²) for large datasets)
const INITIAL_SIMPLEX_SAMPLE_SIZE = 100

// Find N+1 points that span N dimensions (initial simplex for quickhull)
function choose_initial_simplex_nd(points: number[][]): number[] | null {
  const dim = points[0]?.length
  if (!dim || points.length < dim + 1) return null

  const chosen: number[] = []

  // Greedily pick points that maximize distance from current affine hull
  // Start with two points that are farthest apart
  let [best_i, best_j, best_dist] = [0, 1, -1]
  const sample_size = Math.min(points.length, INITIAL_SIMPLEX_SAMPLE_SIZE)
  const sample_indices =
    points.length <= sample_size
      ? points.map((_, idx) => idx)
      : Array.from({ length: sample_size }, (_, idx) =>
          Math.floor((idx * points.length) / sample_size),
        )

  for (const idx_a of sample_indices) {
    for (const idx_b of sample_indices) {
      if (idx_a >= idx_b) continue
      const dist = norm_nd(subtract_nd(points[idx_a], points[idx_b]))
      if (dist > best_dist) {
        best_dist = dist
        best_i = idx_a
        best_j = idx_b
      }
    }
  }

  if (best_dist < EPS) return null
  chosen.push(best_i, best_j)
  const chosen_set = new Set(chosen)

  // Add remaining points to span higher dimensions
  while (chosen.length < dim + 1) {
    let [best_idx, best_distance] = [-1, -1]
    // Hoist chosen_points computation outside inner loop for O(n) instead of O(n²)
    const chosen_points = chosen.map((idx_c) => points[idx_c])

    for (let idx = 0; idx < points.length; idx++) {
      if (chosen_set.has(idx)) continue

      // Compute distance from point to affine hull of chosen points
      const dist = distance_to_affine_hull_nd(points[idx], chosen_points)

      if (dist > best_distance) {
        best_distance = dist
        best_idx = idx
      }
    }

    if (best_idx === -1 || best_distance < EPS) return null
    chosen.push(best_idx)
    chosen_set.add(best_idx)
  }

  return chosen
}

// Distance from point to affine hull spanned by given points
function distance_to_affine_hull_nd(point: number[], hull_points: number[][]): number {
  if (hull_points.length === 1) {
    return norm_nd(subtract_nd(point, hull_points[0]))
  }

  if (hull_points.length === 2) {
    // Distance to line
    const [pt_a, pt_b] = hull_points
    const ab = subtract_nd(pt_b, pt_a)
    const ap = subtract_nd(point, pt_a)
    const ab_len_sq = dot_nd(ab, ab)
    if (ab_len_sq < EPS) return norm_nd(ap)
    const proj_frac = dot_nd(ap, ab) / ab_len_sq
    const proj = pt_a.map((val, idx) => val + proj_frac * ab[idx])
    return norm_nd(subtract_nd(point, proj))
  }

  // For 3+ points, use orthogonal projection
  // Build edge vectors from hull_points[0]
  const origin = hull_points[0]
  const edges = hull_points.slice(1).map((pt) => subtract_nd(pt, origin))
  const vp = subtract_nd(point, origin)

  // Solve least squares using Gram matrix G[i][j] = dot(edge_i, edge_j)
  const gram = edges.map((edge_i) => edges.map((edge_j) => dot_nd(edge_i, edge_j)))
  const rhs = edges.map((edge) => dot_nd(edge, vp))

  // Solve Gram * coeffs = rhs
  const coeffs = math.solve_linear_system(gram, rhs)
  if (!coeffs) {
    // Fallback: Gram-Schmidt when Gram matrix is singular (linearly dependent edges)
    // Build orthogonal basis and accumulate projection in single pass
    const ortho_basis: number[][] = []
    let projection = vp.map(() => 0)

    for (const edge of edges) {
      // Orthogonalize edge against existing basis
      let ortho = [...edge]
      for (const basis of ortho_basis) {
        const norm_sq = dot_nd(basis, basis)
        if (norm_sq > EPS) {
          const coeff = dot_nd(ortho, basis) / norm_sq
          ortho = ortho.map((val, idx) => val - coeff * basis[idx])
        }
      }

      // Add to basis and update projection if linearly independent
      const ortho_norm_sq = dot_nd(ortho, ortho)
      if (ortho_norm_sq > EPS) {
        ortho_basis.push(ortho)
        const proj_coeff = dot_nd(vp, ortho) / ortho_norm_sq
        projection = projection.map((val, idx) => val + proj_coeff * ortho[idx])
      }
    }

    return norm_nd(subtract_nd(vp, projection))
  }

  // Compute projection: origin + sum(coeffs[i] * edges[i])
  const proj = origin.map(
    (val, dim) => val + coeffs.reduce((sum, coeff, idx) => sum + coeff * edges[idx][dim], 0),
  )
  return norm_nd(subtract_nd(point, proj))
}

// Create a simplex face with correct normal orientation (outward from interior)
function make_face_nd(
  points: number[][],
  vertex_indices: number[],
  interior_point: number[],
): SimplexFaceND {
  const face_points = vertex_indices.map((idx) => points[idx])
  const plane = compute_hyperplane_nd(face_points)
  const centroid = compute_centroid_nd(face_points)

  // Flip normal if it points toward interior instead of away
  const dist_interior = point_hyperplane_signed_distance_nd(plane, interior_point)
  if (dist_interior > 0) {
    plane.normal = plane.normal.map((val) => -val)
    plane.offset = -plane.offset
  }

  return { vertex_indices, plane, centroid, outside_points: new Set() }
}

function assign_outside_points_nd(
  face: SimplexFaceND,
  points: number[][],
  candidate_indices: number[],
): void {
  face.outside_points.clear()
  for (const idx of candidate_indices) {
    const dist = point_hyperplane_signed_distance_nd(face.plane, points[idx])
    if (dist > EPS) face.outside_points.add(idx)
  }
}

function farthest_outside_point_nd(
  points: number[][],
  face: SimplexFaceND,
): { idx: number; distance: number } | null {
  let best: { idx: number; distance: number } | null = null
  for (const idx of face.outside_points) {
    const distance = point_hyperplane_signed_distance_nd(face.plane, points[idx])
    if (!best || distance > best.distance) best = { idx, distance }
  }
  return best
}

// Build horizon ridges (boundary between visible and non-visible faces)
// In N dimensions, ridges are (N-2)-simplices with (N-1) vertices
function build_horizon_nd(faces: SimplexFaceND[], visible_indices: Set<number>): number[][] {
  const ridge_count = new Map<string, number[]>()

  for (const face_idx of visible_indices) {
    const face = faces[face_idx]
    const verts = face.vertex_indices
    const n_verts = verts.length

    // Each face has n_verts ridges, each ridge omits one vertex
    for (let skip = 0; skip < n_verts; skip++) {
      const ridge = verts.filter((_, idx) => idx !== skip)
      const sorted = [...ridge].toSorted((a, b) => a - b)
      const key = sorted.join(`|`)

      if (!ridge_count.has(key)) {
        ridge_count.set(key, ridge)
      } else {
        // Mark as internal (seen twice)
        ridge_count.set(key, [])
      }
    }
  }

  // Return only boundary ridges (seen exactly once, not marked empty)
  return [...ridge_count.values()].filter((ridge) => ridge.length > 0)
}

// N-dimensional quickhull algorithm
export function compute_quickhull_nd(points: number[][]): SimplexFaceND[] {
  if (points.length === 0) return []
  const dim = points[0].length
  // Validate dimensions once up front; vector ops in the hot loops assume agreement
  for (const pt of points) {
    if (pt.length !== dim) {
      throw new Error(`Vector dimension mismatch: ${pt.length} vs ${dim}`)
    }
  }
  if (points.length < dim + 1) return []

  // Find initial n-simplex
  const initial = choose_initial_simplex_nd(points)
  if (!initial) return []

  // Interior point for normal orientation
  const interior = compute_centroid_nd(initial.map((idx) => points[idx]))

  // Create initial dim+1 facets (each omits one vertex from the simplex)
  const faces: SimplexFaceND[] = []
  for (let skip = 0; skip <= dim; skip++) {
    const verts = initial.filter((_, idx) => idx !== skip)
    faces.push(make_face_nd(points, verts, interior))
  }

  // Assign outside points to initial faces
  const remaining = points.map((_, idx) => idx).filter((idx) => !initial.includes(idx))
  for (const face of faces) {
    assign_outside_points_nd(face, points, remaining)
  }

  // Main quickhull loop
  while (true) {
    // Find face with farthest outside point
    let [chosen_face_idx, chosen_point_idx, max_distance] = [-1, -1, -1]

    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      if (face.outside_points.size === 0) continue

      const far = farthest_outside_point_nd(points, face)
      if (far && far.distance > max_distance) {
        max_distance = far.distance
        chosen_face_idx = face_idx
        chosen_point_idx = far.idx
      }
    }

    if (chosen_face_idx === -1) break // All points processed

    const eye_idx = chosen_point_idx

    // Find all faces visible from eye point
    const visible_indices = new Set<number>()
    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const dist = point_hyperplane_signed_distance_nd(faces[face_idx].plane, points[eye_idx])
      if (dist > EPS) visible_indices.add(face_idx)
    }

    // Build horizon ridges
    const horizon = build_horizon_nd(faces, visible_indices)

    // Collect candidate points from visible faces
    const candidates = new Set<number>()
    for (const face_idx of visible_indices) {
      for (const pt_idx of faces[face_idx].outside_points) {
        candidates.add(pt_idx)
      }
    }

    // Remove visible faces (in reverse order to maintain indices)
    const sorted_visible = Array.from(visible_indices)
    // Array.from() returns a fresh array.
    sorted_visible.sort((a, b) => b - a)
    for (const idx of sorted_visible) {
      faces.splice(idx, 1)
    }

    // Create new faces from horizon ridges to eye point
    const new_faces: SimplexFaceND[] = []
    for (const ridge of horizon) {
      const new_verts = [...ridge, eye_idx]
      new_faces.push(make_face_nd(points, new_verts, interior))
    }

    // Reassign candidate points to new faces
    for (const face of new_faces) face.outside_points.clear()

    for (const pt_idx of candidates) {
      if (pt_idx === eye_idx) continue

      let best_face: SimplexFaceND | null = null
      let best_dist = EPS

      for (const face of new_faces) {
        const dist = point_hyperplane_signed_distance_nd(face.plane, points[pt_idx])
        if (dist > best_dist) {
          best_dist = dist
          best_face = face
        }
      }

      if (best_face) best_face.outside_points.add(pt_idx)
    }

    faces.push(...new_faces)
  }

  return faces
}

// Filter for lower hull facets (normal pointing "down" in energy dimension)
export function compute_lower_hull_nd(faces: SimplexFaceND[]): SimplexFaceND[] {
  // Last dimension is energy; negative normal means "downward"
  return faces.filter((face) => (face.plane.normal.at(-1) ?? 0) < -EPS)
}

// Precomputed model for fast containment checks
interface SimplexModelND {
  vertices: number[][]
  vertices_spatial: number[][] // Without energy dimension
  bbox_min: number[]
  bbox_max: number[]
}

const build_simplex_models_nd = (simplices: number[][][]): SimplexModelND[] =>
  simplices.map((vertices) => {
    const dim = vertices[0].length
    // Spatial coords are all except last (energy)
    const vertices_spatial = vertices.map((pt) => pt.slice(0, dim - 1))

    // Compute bounding box in spatial dimensions
    const spatial_dim = dim - 1
    const bbox_min = Array.from({ length: spatial_dim }, (_, idx) =>
      array_min(vertices_spatial.map((pt) => pt[idx])),
    )
    const bbox_max = Array.from({ length: spatial_dim }, (_, idx) =>
      array_max(vertices_spatial.map((pt) => pt[idx])),
    )

    return { vertices, vertices_spatial, bbox_min, bbox_max }
  })

// Check if point is inside simplex and return barycentric coordinates
// Uses linear system solution: point = sum(bary[i] * vertex[i]) with sum(bary) = 1
function point_in_simplex_nd(point: number[], simplex_vertices: number[][]): number[] | null {
  const n_verts = simplex_vertices.length // Number of vertices = spatial_dim + 1
  if (n_verts === 0) return null

  const dim = point.length
  if (dim !== n_verts - 1) return null // Spatial dim should be one less than vertex count

  // Build linear system: [v1-v0, v2-v0, ..., vn-v0] * [b1, b2, ..., bn] = point - v0
  // Then b0 = 1 - sum(b1..bn)
  const v0 = simplex_vertices[0]
  const edges = simplex_vertices.slice(1).map((vert) => subtract_nd(vert, v0))
  const rhs = subtract_nd(point, v0)

  // For square system (dim == n-1), solve directly
  // Build matrix where each column is an edge vector
  const matrix: number[][] = []
  for (let row = 0; row < dim; row++) {
    matrix.push(edges.map((edge) => edge[row]))
  }

  const coeffs = math.solve_linear_system(matrix, rhs)
  if (!coeffs) return null

  // Compute b0 = 1 - sum(coeffs), ensuring sum(bary) = 1 by construction
  const sum_coeffs = coeffs.reduce((sum, val) => sum + val, 0)
  const bary = [1 - sum_coeffs, ...coeffs]

  // Point is inside simplex if all barycentric coords are non-negative
  return bary.every((val) => val >= -EPS) ? bary : null
}

// Compute energy above hull for N-dimensional points
export function compute_e_above_hull_nd(
  query_points: number[][],
  hull_facets: SimplexFaceND[],
  all_points: number[][],
): number[] {
  return e_above_hull_from_simplices(
    query_points,
    hull_facets.map((facet) => facet.vertex_indices.map((idx) => all_points[idx])),
  )
}

// Shared e-above-hull core: query points against hull simplices given as vertex
// coordinate lists (last coordinate = energy). Returns raw (unclamped) distances;
// NaN for queries whose spatial projection lies outside all simplices.
function e_above_hull_from_simplices(
  query_points: number[][],
  simplices: number[][][],
): number[] {
  const models = build_simplex_models_nd(simplices)

  return query_points.map((query) => {
    const dim = query.length
    const spatial = query.slice(0, dim - 1) // All but last coord
    const energy = query[dim - 1]

    let hull_energy: number | null = null

    for (const model of models) {
      // Fast bounding box rejection
      let outside_bbox = false
      for (let idx = 0; idx < spatial.length; idx++) {
        if (
          spatial[idx] < model.bbox_min[idx] - EPS ||
          spatial[idx] > model.bbox_max[idx] + EPS
        ) {
          outside_bbox = true
          break
        }
      }
      if (outside_bbox) continue

      // Check if spatial coords are inside simplex projection
      const bary = point_in_simplex_nd(spatial, model.vertices_spatial)
      if (!bary) continue

      // Interpolate energy using barycentric coords
      const e_hull = bary.reduce(
        (sum, coeff, idx) => sum + coeff * model.vertices[idx][dim - 1],
        0,
      )
      hull_energy = hull_energy === null ? e_hull : Math.min(hull_energy, e_hull)
    }

    // If no facet contains this point's spatial projection, it's outside the valid
    // composition domain. Return NaN to indicate invalid input rather than 0 (which
    // would falsely imply the point is stable/on-hull).
    if (hull_energy === null) return NaN
    return energy - hull_energy
  })
}
