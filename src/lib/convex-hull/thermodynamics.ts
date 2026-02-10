import {
  count_atoms_in_composition,
  extract_formula_elements,
  sort_by_electronegativity,
} from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import * as math from '$lib/math'
import {
  barycentric_to_ternary_xyz,
  barycentric_to_tetrahedral,
  composition_to_barycentric_3d,
  composition_to_barycentric_4d,
  composition_to_barycentric_nd,
} from './barycentric-coords'
import type {
  ConvexHullEntry,
  ConvexHullFace,
  ConvexHullTriangle,
  PhaseData,
  PhaseStats,
  Plane,
  Point2D,
  Point3D,
  ProcessedPhaseData,
} from './types'
import { get_arity, HULL_STABILITY_TOL, is_on_hull, is_unary_entry } from './types'

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
    normalized[elem] = (normalized[elem] || 0) + amount
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
    const stable = typeof entry.is_stable === `boolean`
      ? entry.is_stable
      : (entry.e_above_hull ?? Infinity) <= 1e-6
    ;(stable ? stable_entries : unstable_entries).push(entry)
  }

  // Extract unique element symbols from normalized compositions
  const elements = Array.from(
    new Set(normalized_entries.flatMap((entry) => Object.keys(entry.composition))),
  ).sort() as ElementSymbol[]

  const el_refs = Object.fromEntries(
    stable_entries
      .filter(is_unary_entry)
      .map((entry) => [Object.keys(entry.composition)[0], entry]),
  )

  return {
    entries: normalized_entries,
    stable_entries,
    unstable_entries,
    elements,
    el_refs,
  }
}

// Get energy per atom with correction applied, or fallback to raw energy_per_atom/energy.
// Note: correction is expected to be a total-entry value (eV), not per-atom.
// This matches the Materials Project convention where corrections are applied to total energies.
function get_energy_per_atom(entry: PhaseData): number {
  // Use Math.max instead of || to prevent pathological negative totals from flipping sign
  const atoms = Math.max(count_atoms_in_composition(entry.composition), 1e-12)
  if (typeof entry.correction === `number`) {
    const total = typeof entry.energy_per_atom === `number`
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
  ).sort() as ElementSymbol[]

  // 2. Validate subset
  const element_set = new Set(elements)
  for (const entry of entries_of_interest) {
    for (const el of Object.keys(entry.composition)) {
      if (!element_set.has(el as ElementSymbol)) {
        throw new Error(
          `Entry contains element ${el} not present in reference system: ${
            elements.join(`-`)
          }`,
        )
      }
    }
  }

  // 3. Compute formation energies
  const refs = find_lowest_energy_unary_refs(reference_entries)
  const compute_e_form = (e: PhaseData) =>
    typeof e.e_form_per_atom === `number`
      ? e.e_form_per_atom
      : compute_e_form_per_atom(e, refs)

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
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
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
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      const total = count_atoms_in_composition(ref.composition)
      if (total <= 0) continue
      const x = (ref.composition[el2] || 0) / total
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
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
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
      const x = (entry.composition[el2] || 0) / total
      const y_hull = interpolate_hull_2d(lower_hull, x)
      results[id] = y_hull === null ? NaN : Math.max(0, e_form - y_hull)
    }
  } else if (arity === 3) {
    // Ternary system
    const ref_points: Point3D[] = []
    for (const ref of reference_entries) {
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      try {
        const bary = composition_to_barycentric_3d(ref.composition, elements)
        const p = barycentric_to_ternary_xyz(bary, e_form)
        ref_points.push(p)
      } catch {
        // Ignore invalid compositions
      }
    }
    // Ensure corner points (pure elements default to e_form = 0)
    for (const el of elements) {
      const corner = barycentric_to_ternary_xyz(
        composition_to_barycentric_3d({ [el]: 1 }, elements),
        0,
      )
      if (
        !ref_points.some((p) =>
          Math.hypot(p.x - corner.x, p.y - corner.y, p.z - corner.z) < 1e-9
        )
      ) {
        ref_points.push(corner)
      }
    }

    const hull_triangles = compute_lower_hull_triangles(ref_points)
    const hull_models = build_lower_hull_model(hull_triangles)

    for (const { entry, e_form } of interest_data) {
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
      if (typeof e_form !== `number`) {
        results[id] = NaN
        continue
      }
      try {
        const bary = composition_to_barycentric_3d(entry.composition, elements)
        const p = barycentric_to_ternary_xyz(bary, e_form)
        const z_hull = e_hull_at_xy(hull_models, p.x, p.y)
        results[id] = z_hull === null ? NaN : Math.max(0, p.z - z_hull)
      } catch {
        results[id] = NaN
      }
    }
  } else if (arity === 4) {
    // Quaternary system
    const ref_points: Point4D[] = []
    for (const ref of reference_entries) {
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      try {
        const bary = composition_to_barycentric_4d(ref.composition, elements)
        const tet = barycentric_to_tetrahedral(bary)
        ref_points.push({ ...tet, w: e_form })
      } catch {
        // Ignore invalid
      }
    }

    // Ensure corner points (pure elements default to e_form = 0)
    for (const el of elements) {
      const tet = barycentric_to_tetrahedral(
        composition_to_barycentric_4d({ [el]: 1 }, elements),
      )
      const corner = { ...tet, w: 0 }
      const dist = (p: Point4D) =>
        Math.hypot(p.x - corner.x, p.y - corner.y, p.z - corner.z, p.w)
      if (!ref_points.some((p) => dist(p) < 1e-9)) ref_points.push(corner)
    }

    const hull_tetrahedra = compute_lower_hull_4d(ref_points)
    const interest_points: Point4D[] = []
    const interest_indices: number[] = []

    interest_data.forEach(({ entry, e_form }, idx) => {
      if (typeof e_form === `number`) {
        try {
          const bary = composition_to_barycentric_4d(entry.composition, elements)
          const tet = barycentric_to_tetrahedral(bary)
          interest_points.push({ ...tet, w: e_form })
          interest_indices.push(idx)
        } catch {
          // Skip
        }
      }
    })

    const distances = compute_e_above_hull_4d(interest_points, hull_tetrahedra)

    // Build reverse lookup for O(1) access
    const idx_to_point_idx = new Map<number, number>()
    interest_indices.forEach((original_idx, point_idx) => {
      idx_to_point_idx.set(original_idx, point_idx)
    })

    // Map back
    for (let idx = 0; idx < interest_data.length; idx++) {
      const { entry } = interest_data[idx]
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
      const point_idx = idx_to_point_idx.get(idx) ?? -1
      if (point_idx !== -1) {
        results[id] = Math.max(0, distances[point_idx])
      } else {
        results[id] = NaN
      }
    }
  } else {
    // Arity 5+ uses generalized N-dimensional convex hull
    // Helper to convert entry to hull point, returns null on expected errors
    const to_hull_point = (entry: PhaseData, e_form: number): number[] | null => {
      try {
        return [...composition_to_barycentric_nd(entry.composition, elements), e_form]
      } catch (err) {
        // Skip expected errors (missing elements), warn on unexpected
        if (
          err instanceof Error && !err.message.includes(`no elements from the system`)
        ) {
          console.warn(`Skipping entry: ${err.message}`)
        }
        return null
      }
    }

    // Build reference points
    const ref_points: number[][] = []
    for (const ref of reference_entries) {
      const e_form = compute_e_form(ref)
      if (typeof e_form !== `number`) continue
      const point = to_hull_point(ref, e_form)
      if (point) ref_points.push(point)
    }

    // Ensure corner points (pure elements default to e_form = 0)
    for (let el_idx = 0; el_idx < arity; el_idx++) {
      const corner = new Array(arity + 1).fill(0)
      corner[el_idx] = 1 // ith barycentric coord = 1
      if (!ref_points.some((pt) => norm_nd(subtract_nd(pt, corner)) < EPS)) {
        ref_points.push(corner)
      }
    }

    const hull_facets = compute_lower_hull_nd(compute_quickhull_nd(ref_points))

    // Warn if hull is degenerate (all points coplanar or insufficient spread)
    if (hull_facets.length === 0 && ref_points.length >= arity + 1) {
      console.warn(
        `N-dimensional hull for ${arity}-element system is degenerate. ` +
          `Falling back to tie-hyperplane at energy 0. ` +
          `Consider using pymatgen for complex high-dimensional phase diagrams.`,
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
    const distances = hull_facets.length > 0
      ? compute_e_above_hull_nd(interest_points, hull_facets, ref_points)
      : []

    // Map results back to entries
    for (let idx = 0; idx < interest_data.length; idx++) {
      const { entry, e_form } = interest_data[idx]
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
      const point_idx = idx_to_point_idx.get(idx)

      if (point_idx === undefined) {
        results[id] = NaN
      } else if (hull_facets.length === 0 && typeof e_form === `number`) {
        // Degenerate case: hull is tie-hyperplane at energy 0
        results[id] = Math.max(0, e_form)
      } else {
        results[id] = Math.max(0, distances[point_idx])
      }
    }
  }

  if (is_single) {
    const id = entries_of_interest[0].entry_id ??
      JSON.stringify(entries_of_interest[0].composition)
    return results[id]
  }
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
  if (max_arity < 4) quaternary = 0
  if (max_arity < 3) ternary = 0
  if (max_arity < 2) binary = 0

  const stable_count = processed_entries.filter((entry) => is_on_hull(entry)).length
  const unstable_count = processed_entries.length - stable_count

  const energies = processed_entries
    .map((entry) =>
      entry.e_form_per_atom ??
        entry.energy_per_atom ??
        (typeof entry.energy === `number` ? get_energy_per_atom(entry) : undefined)
    )
    .filter((val): val is number => typeof val === `number` && Number.isFinite(val))

  // Use reduce instead of Math.min/max(...arr) to avoid stack overflow on large datasets
  const energy_range = energies.length > 0
    ? {
      min: energies.reduce((min, val) => val < min ? val : min, Infinity),
      max: energies.reduce((max, val) => val > max ? val : max, -Infinity),
      avg: energies.reduce((sum, val) => sum + val, 0) / energies.length,
    }
    : { min: 0, max: 0, avg: 0 }

  const hull_distances = processed_entries
    .map((entry) => entry.e_above_hull)
    .filter((val): val is number => typeof val === `number` && val >= 0)
  const hull_distance = hull_distances.length > 0
    ? {
      max: hull_distances.reduce((max, val) => val > max ? val : max, -Infinity),
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
function to_hull_entry(entry: PhaseData): ConvexHullEntry {
  return {
    ...entry,
    visible: true,
    is_element: get_arity(entry) === 1,
    x: 0,
    y: 0,
    z: 0,
  }
}

// Process raw hull entries for high-dimensional systems (5+ elements) where the
// ConvexHull visual component can't render. Computes formation energies, hull distances,
// stable/unstable classification, and phase stats. Returns null on failure.
// Optionally accepts `elements` to scope the chemical system; if omitted, elements
// are derived from the entries' compositions.
export function process_hull_for_stats(
  entries: PhaseData[],
  elements?: ElementSymbol[],
): HighDimHullResult | null {
  if (!entries.length) return null

  const processed = process_hull_entries(entries)
  if (!processed.entries.length) return null
  const hull_elements = elements ?? processed.elements

  // Compute formation energies
  const el_refs = find_lowest_energy_unary_refs(processed.entries)
  for (const entry of processed.entries) {
    if (entry.e_form_per_atom === undefined) {
      const e_form = compute_e_form_per_atom(entry, el_refs)
      if (e_form !== null) entry.e_form_per_atom = e_form
    }
  }

  // Compute hull distances, using index-based IDs to avoid polymorph collisions
  // when multiple entries share the same composition but have no entry_id
  try {
    const hull_distances = calculate_e_above_hull(
      processed.entries,
      processed.entries,
    )

    for (let idx = 0; idx < processed.entries.length; idx++) {
      const entry = processed.entries[idx]
      const id = entry.entry_id ?? JSON.stringify(entry.composition)
      const dist = hull_distances[id]
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
    phase_stats: get_convex_hull_stats(processed.entries, hull_elements),
  }
}

// --- 2D Convex Hull (Binary Phase Diagrams) ---

export function compute_lower_hull_2d(points: Point2D[]): Point2D[] {
  // Andrew's monotone chain for lower hull
  // Sort by x then y
  const sorted = [...points].sort((p1, p2) => (p1.x - p2.x) || (p1.y - p2.y))
  const lower: Point2D[] = []
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) lower.pop()
    lower.push(p)
  }
  return lower
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
      const t = (x - p1.x) / Math.max(1e-12, p2.x - p1.x)
      return p1.y * (1 - t) + p2.y * t
    }
  }
  return null
}

// --- Convex hull geometry ---

const EPS = 1e-9

const subtract = (pt1: Point3D, pt2: Point3D): Point3D => ({
  x: pt1.x - pt2.x,
  y: pt1.y - pt2.y,
  z: pt1.z - pt2.z,
})

const cross = (vec1: Point3D, vec2: Point3D): Point3D => ({
  x: vec1.y * vec2.z - vec1.z * vec2.y,
  y: vec1.z * vec2.x - vec1.x * vec2.z,
  z: vec1.x * vec2.y - vec1.y * vec2.x,
})

const norm = (point: Point3D): number =>
  Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z)

function normalize(point: Point3D): Point3D {
  const length = norm(point)
  if (length < EPS) return { x: 0, y: 0, z: 0 }
  return { x: point.x / length, y: point.y / length, z: point.z / length }
}

function compute_plane(p1: Point3D, p2: Point3D, p3: Point3D): Plane {
  const edge_12 = subtract(p2, p1)
  const edge_13 = subtract(p3, p1)
  const normal = normalize(cross(edge_12, edge_13))
  const offset = -(normal.x * p1.x + normal.y * p1.y + normal.z * p1.z)
  return { normal, offset }
}

const point_plane_signed_distance = (plane: Plane, point: Point3D): number =>
  plane.normal.x * point.x + plane.normal.y * point.y + plane.normal.z * point.z +
  plane.offset

const compute_centroid = (p1: Point3D, p2: Point3D, p3: Point3D): Point3D => ({
  x: (p1.x + p2.x + p3.x) / 3,
  y: (p1.y + p2.y + p3.y) / 3,
  z: (p1.z + p2.z + p3.z) / 3,
})

function distance_point_to_line(
  line_start: Point3D,
  line_end: Point3D,
  point: Point3D,
): number {
  const line_vec = subtract(line_end, line_start)
  const to_point = subtract(point, line_start)
  const cross_prod = cross(line_vec, to_point)
  const line_len = norm(line_vec)
  if (line_len < EPS) return 0
  return norm(cross_prod) / line_len
}

function choose_initial_tetrahedron(
  points: Point3D[],
): [number, number, number, number] | null {
  if (points.length < 4) return null
  let idx_min_x = 0
  let idx_max_x = 0
  for (let idx = 1; idx < points.length; idx++) {
    if (points[idx].x < points[idx_min_x].x) idx_min_x = idx
    if (points[idx].x > points[idx_max_x].x) idx_max_x = idx
  }
  if (idx_min_x === idx_max_x) return null
  let idx_far_line = -1
  let best_dist_line = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === idx_min_x || idx === idx_max_x) continue
    const dist = distance_point_to_line(points[idx_min_x], points[idx_max_x], points[idx])
    if (dist > best_dist_line) {
      best_dist_line = dist
      idx_far_line = idx
    }
  }
  if (idx_far_line === -1 || best_dist_line < EPS) return null
  const plane0 = compute_plane(points[idx_min_x], points[idx_max_x], points[idx_far_line])
  let idx_far_plane = -1
  let best_dist_plane = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === idx_min_x || idx === idx_max_x || idx === idx_far_line) continue
    const dist = Math.abs(point_plane_signed_distance(plane0, points[idx]))
    if (dist > best_dist_plane) {
      best_dist_plane = dist
      idx_far_plane = idx
    }
  }
  if (idx_far_plane === -1 || best_dist_plane < EPS) return null
  return [idx_min_x, idx_max_x, idx_far_line, idx_far_plane]
}

function make_face(
  points: Point3D[],
  a: number,
  b: number,
  c: number,
  interior_point: Point3D,
): ConvexHullFace {
  let plane = compute_plane(points[a], points[b], points[c])
  let centroid = compute_centroid(points[a], points[b], points[c])
  const dist_interior = point_plane_signed_distance(plane, interior_point)
  if (dist_interior > 0) {
    plane = compute_plane(points[a], points[c], points[b])
    centroid = compute_centroid(points[a], points[c], points[b])
    return { vertices: [a, c, b], plane, centroid, outside_points: new Set<number>() }
  }
  return { vertices: [a, b, c], plane, centroid, outside_points: new Set<number>() }
}

function assign_outside_points(
  face: ConvexHullFace,
  points: Point3D[],
  candidate_indices: number[],
): void {
  face.outside_points.clear()
  for (const idx of candidate_indices) {
    const distance = point_plane_signed_distance(face.plane, points[idx])
    if (distance > EPS) face.outside_points.add(idx)
  }
}

function collect_candidate_points(faces: ConvexHullFace[]): number[] {
  const set = new Set<number>()
  for (const face of faces) for (const idx of face.outside_points) set.add(idx)
  return Array.from(set)
}

function farthest_point_for_face(
  points: Point3D[],
  face: ConvexHullFace,
): { idx: number; distance: number } | null {
  let best_idx = -1
  let best_distance = -1
  for (const idx of face.outside_points) {
    const distance = point_plane_signed_distance(face.plane, points[idx])
    if (distance > best_distance) {
      best_distance = distance
      best_idx = idx
    }
  }
  if (best_idx === -1) return null
  return { idx: best_idx, distance: best_distance }
}

function build_horizon(
  faces: ConvexHullFace[],
  visible_face_indices: Set<number>,
): [number, number][] {
  const edge_count = new Map<string, [number, number]>()
  for (const face_idx of visible_face_indices) {
    const face = faces[face_idx]
    const [a, b, c] = face.vertices
    const edges: [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [u, v] of edges) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`
      if (!edge_count.has(key)) edge_count.set(key, [u, v])
      else edge_count.set(key, [Number.NaN, Number.NaN])
    }
  }
  const horizon: [number, number][] = []
  for (const uv of edge_count.values()) {
    if (Number.isNaN(uv[0])) continue
    horizon.push(uv)
  }
  return horizon
}

export function compute_quickhull_triangles(points: Point3D[]): ConvexHullTriangle[] {
  if (points.length < 4) return [] // hull needs at least 4 non-coplanar points, bail if not provided
  const initial = choose_initial_tetrahedron(points)
  if (!initial) return []
  const [i0, i1, i2, i3] = initial
  const interior_point = {
    x: (points[i0].x + points[i1].x + points[i2].x + points[i3].x) / 4,
    y: (points[i0].y + points[i1].y + points[i2].y + points[i3].y) / 4,
    z: (points[i0].z + points[i1].z + points[i2].z + points[i3].z) / 4,
  }
  const faces: ConvexHullFace[] = [
    make_face(points, i0, i1, i2, interior_point),
    make_face(points, i0, i2, i3, interior_point),
    make_face(points, i0, i3, i1, interior_point),
    make_face(points, i1, i3, i2, interior_point),
  ]
  const all_indices: number[] = []
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === i0 || idx === i1 || idx === i2 || idx === i3) continue
    all_indices.push(idx)
  }
  for (const face of faces) assign_outside_points(face, points, all_indices)
  while (true) {
    let chosen_face_idx = -1
    let chosen_point_idx = -1
    let max_distance = -1
    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      if (face.outside_points.size === 0) continue
      const far = farthest_point_for_face(points, face)
      if (far && far.distance > max_distance) {
        max_distance = far.distance
        chosen_face_idx = face_idx
        chosen_point_idx = far.idx
      }
    }
    if (chosen_face_idx === -1) break
    const eye_idx = chosen_point_idx
    const visible_face_indices = new Set<number>()
    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      const dist = point_plane_signed_distance(face.plane, points[eye_idx])
      if (dist > EPS) visible_face_indices.add(face_idx)
    }
    const horizon_edges = build_horizon(faces, visible_face_indices)
    const visible_faces = Array.from(visible_face_indices).sort((a, b) => b - a)
    const candidate_points = collect_candidate_points(
      visible_faces.map((idx) => faces[idx]),
    )
    for (const idx of visible_faces) faces.splice(idx, 1)
    const new_faces: ConvexHullFace[] = []
    for (const [u, v] of horizon_edges) {
      const new_face = make_face(points, u, v, eye_idx, interior_point)
      new_faces.push(new_face)
    }
    for (const face of new_faces) face.outside_points.clear()
    for (const idx of candidate_points) {
      if (idx === eye_idx) continue
      let best_face: ConvexHullFace | null = null
      let best_distance = EPS
      for (const face of new_faces) {
        const dist = point_plane_signed_distance(face.plane, points[idx])
        if (dist > best_distance) {
          best_distance = dist
          best_face = face
        }
      }
      if (best_face) best_face.outside_points.add(idx)
    }
    faces.push(...new_faces)
  }
  return faces.map((face) => {
    const [a, b, c] = face.vertices
    const normal = face.plane.normal
    const centroid = face.centroid
    return {
      vertices: [points[a], points[b], points[c]] as [Point3D, Point3D, Point3D],
      normal,
      centroid,
    }
  })
}

export function compute_lower_hull_triangles(points: Point3D[]): ConvexHullTriangle[] {
  const all_faces = compute_quickhull_triangles(points)
  return all_faces.filter((face) => face.normal.z < 0 - EPS)
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

export const build_lower_hull_model = (
  faces: ConvexHullTriangle[],
): HullFaceModel[] =>
  faces.map((tri) => {
    const [p1, p2, p3] = tri.vertices
    const plane = (() => {
      const x1 = p1.x, y1 = p1.y, z1 = p1.z
      const x2 = p2.x, y2 = p2.y, z2 = p2.z
      const x3 = p3.x, y3 = p3.y, z3 = p3.z
      const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
      if (Math.abs(det) < 1e-12) return { a: 0, b: 0, c: (z1 + z2 + z3) / 3 }
      const a = (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / det
      const b = (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / det
      const c =
        (z1 * (x2 * y3 - x3 * y2) + z2 * (x3 * y1 - x1 * y3) + z3 * (x1 * y2 - x2 * y1)) /
        det
      return { a, b, c }
    })()
    const [min_x, _mx, max_x] = [p1.x, p2.x, p3.x].sort((a, b) => a - b)
    const [min_y, _my, max_y] = [p1.y, p2.y, p3.y].sort((a, b) => a - b)
    const { x: x1, y: y1 } = p1
    const { x: x2, y: y2 } = p2
    const { x: x3, y: y3 } = p3
    const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    return {
      a: plane.a,
      b: plane.b,
      c: plane.c,
      x1,
      y1,
      x2,
      y2,
      x3,
      y3,
      min_x,
      max_x,
      min_y,
      max_y,
      denom,
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
  for (const m of models) {
    if (
      x < m.min_x - 1e-9 || x > m.max_x + 1e-9 || y < m.min_y - 1e-9 || y > m.max_y + 1e-9
    ) continue
    if (!point_in_triangle_xy(m, x, y)) continue
    const z_face = m.a * x + m.b * y + m.c
    z = z === null ? z_face : Math.min(z, z_face)
  }
  return z
}

export const compute_e_above_hull_for_points = (
  points: Point3D[],
  models: HullFaceModel[],
) =>
  points.map((p) => {
    const z_hull = e_hull_at_xy(models, p.x, p.y)
    if (z_hull === null) return 0
    const e_above_hull = p.z - z_hull
    return e_above_hull > EPS ? e_above_hull : 0
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

interface ConvexHullFace4D {
  vertices: [number, number, number, number] // indices
  plane: Plane4D
  centroid: Point4D
  outside_points: Set<number>
}

interface Plane4D {
  normal: Point4D
  offset: number
}

const subtract_4d = (pt1: Point4D, pt2: Point4D): Point4D => ({
  x: pt1.x - pt2.x,
  y: pt1.y - pt2.y,
  z: pt1.z - pt2.z,
  w: pt1.w - pt2.w,
})

const dot_4d = (vec_a: Point4D, vec_b: Point4D): number =>
  vec_a.x * vec_b.x + vec_a.y * vec_b.y + vec_a.z * vec_b.z + vec_a.w * vec_b.w

const norm_4d = (point: Point4D): number =>
  Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z + point.w * point.w)

function normalize_4d(point: Point4D): Point4D {
  const length = norm_4d(point)
  if (length < EPS) return { x: 0, y: 0, z: 0, w: 0 }
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
    w: point.w / length,
  }
}

// Compute normal to a 3D hyperplane in 4D space defined by 4 points
//
// Mathematical Background:
// A 3D hyperplane (tetrahedral facet) in 4D is defined by 4 points. The normal vector
// must be orthogonal to all three edge vectors spanning the hyperplane. This is the
// 4D analog of computing a cross product of two vectors in 3D.
//
// Approach:
// 1. Form three edge vectors v1, v2, v3 from point p1
// 2. Find vector n such that: n · v1 = 0, n · v2 = 0, n · v3 = 0
// 3. This is equivalent to finding the null space of the 3×4 matrix [v1; v2; v3]
//
// Implementation:
// The normal components (nx, ny, nz, nw) are computed using Laplace expansion
// (cofactor method) along each column of the matrix. Each component is the determinant
// of the 3×3 submatrix obtained by removing that column, with alternating signs.
//
// References:
// - Barber et al. (1996) "The Quickhull Algorithm for Convex Hulls"
// - https://en.wikipedia.org/wiki/Cross_product#Multilinear_algebra
// - https://mathworld.wolfram.com/Nullspace.html
function compute_plane_4d(p1: Point4D, p2: Point4D, p3: Point4D, p4: Point4D): Plane4D {
  // Three edge vectors from p1
  const v1 = subtract_4d(p2, p1)
  const v2 = subtract_4d(p3, p1)
  const v3 = subtract_4d(p4, p1)

  // Build matrix [v1; v2; v3] and compute normal via cofactor expansion
  const matrix = [
    [v1.x, v1.y, v1.z, v1.w],
    [v2.x, v2.y, v2.z, v2.w],
    [v3.x, v3.y, v3.z, v3.w],
  ]

  // Helper: extract 3×3 submatrix by removing column col_skip, then compute determinant
  const det_submatrix = (col_skip: number): number => {
    const cols = [0, 1, 2, 3].filter((col) => col !== col_skip)
    const submatrix: math.Matrix3x3 = [
      [matrix[0][cols[0]], matrix[0][cols[1]], matrix[0][cols[2]]],
      [matrix[1][cols[0]], matrix[1][cols[1]], matrix[1][cols[2]]],
      [matrix[2][cols[0]], matrix[2][cols[1]], matrix[2][cols[2]]],
    ]
    return math.det_3x3(submatrix)
  }

  // Compute normal components using Laplace expansion along each column
  // Alternating signs: +, -, +, -
  const signs = [1, -1, 1, -1]
  const normal_components = [0, 1, 2, 3].map(
    (col_idx) => signs[col_idx] * det_submatrix(col_idx),
  )

  const [x, y, z, w] = normal_components
  const normal = normalize_4d({ x, y, z, w })

  // Guard against degenerate (nearly co-planar) points
  const normal_magnitude = Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) +
    Math.abs(normal.w)
  if (normal_magnitude < EPS) {
    return { normal: { x: 0, y: 0, z: 0, w: 0 }, offset: 0 }
  }

  const offset = -dot_4d(normal, p1)

  return { normal, offset }
}

const point_plane_signed_distance_4d = (plane: Plane4D, point: Point4D): number =>
  dot_4d(plane.normal, point) + plane.offset

const compute_centroid_4d = (
  p1: Point4D,
  p2: Point4D,
  p3: Point4D,
  p4: Point4D,
): Point4D => ({
  x: (p1.x + p2.x + p3.x + p4.x) / 4,
  y: (p1.y + p2.y + p3.y + p4.y) / 4,
  z: (p1.z + p2.z + p3.z + p4.z) / 4,
  w: (p1.w + p2.w + p3.w + p4.w) / 4,
})

function distance_point_to_hyperplane_4d(
  p1: Point4D,
  p2: Point4D,
  p3: Point4D,
  point: Point4D,
): number {
  // Distance from point to the 2D hyperplane spanned by p1, p2, p3
  const v1 = subtract_4d(p2, p1)
  const v2 = subtract_4d(p3, p1)
  const vp = subtract_4d(point, p1)

  // Project vp onto the plane spanned by v1 and v2
  // Use Gram-Schmidt to find orthogonal component
  const v1_norm_sq = dot_4d(v1, v1)
  const v2_norm_sq = dot_4d(v2, v2)
  const v1_dot_v2 = dot_4d(v1, v2)

  if (v1_norm_sq < EPS || v2_norm_sq < EPS) return 0

  const vp_dot_v1 = dot_4d(vp, v1)
  const vp_dot_v2 = dot_4d(vp, v2)

  // Solve linear system for projection coefficients
  const det = v1_norm_sq * v2_norm_sq - v1_dot_v2 * v1_dot_v2
  if (Math.abs(det) < EPS) return 0

  const alpha = (v2_norm_sq * vp_dot_v1 - v1_dot_v2 * vp_dot_v2) / det
  const beta = (v1_norm_sq * vp_dot_v2 - v1_dot_v2 * vp_dot_v1) / det

  // Compute projection
  const proj_x = p1.x + alpha * v1.x + beta * v2.x
  const proj_y = p1.y + alpha * v1.y + beta * v2.y
  const proj_z = p1.z + alpha * v1.z + beta * v2.z
  const proj_w = p1.w + alpha * v1.w + beta * v2.w

  // Distance is the length of (point - projection)
  const dx = point.x - proj_x
  const dy = point.y - proj_y
  const dz = point.z - proj_z
  const dw = point.w - proj_w

  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw)
}

// Distance from point to line in 4D
function distance_point_to_line_4d(a: Point4D, b: Point4D, p: Point4D): number {
  const ab = subtract_4d(b, a)
  const ap = subtract_4d(p, a)

  const ab_len_sq = dot_4d(ab, ab)
  if (ab_len_sq < EPS) return norm_4d(ap)

  // Project ap onto ab
  const t = dot_4d(ap, ab) / ab_len_sq
  const projection = {
    x: a.x + t * ab.x,
    y: a.y + t * ab.y,
    z: a.z + t * ab.z,
    w: a.w + t * ab.w,
  }

  return norm_4d(subtract_4d(p, projection))
}

// Maximum sample size for initial simplex selection in 4D hulls (avoids O(n²) for large datasets)
const INITIAL_SIMPLEX_SAMPLE_SIZE = 100

function choose_initial_4_simplex(
  points: Point4D[],
): [number, number, number, number, number] | null {
  if (points.length < 5) return null

  // Find two points farthest apart across all dimensions for better numerical stability
  // Sample a small subset if dataset is large to avoid O(n²) scaling
  const sample_size = Math.min(points.length, INITIAL_SIMPLEX_SAMPLE_SIZE)
  const sample_indices = points.length <= sample_size
    ? points.map((_, idx) => idx)
    : Array.from({ length: sample_size }, (_, idx) =>
      Math.floor((idx * points.length) / sample_size))

  let idx_far_a = 0
  let idx_far_b = 0
  let max_dist_sq = -1

  for (const idx_a of sample_indices) {
    for (const idx_b of sample_indices) {
      if (idx_a >= idx_b) continue
      const pa = points[idx_a]
      const pb = points[idx_b]
      const dist_sq = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2 +
        (pa.w - pb.w) ** 2
      if (dist_sq > max_dist_sq) {
        max_dist_sq = dist_sq
        idx_far_a = idx_a
        idx_far_b = idx_b
      }
    }
  }
  if (idx_far_a === idx_far_b || max_dist_sq < EPS) return null

  // Find point farthest from line through idx_far_a and idx_far_b
  let idx_far_line = -1
  let best_dist_line = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === idx_far_a || idx === idx_far_b) continue
    const dist = distance_point_to_line_4d(
      points[idx_far_a],
      points[idx_far_b],
      points[idx],
    )
    if (dist > best_dist_line) {
      best_dist_line = dist
      idx_far_line = idx
    }
  }
  if (idx_far_line === -1 || best_dist_line < EPS) return null

  // Find point farthest from 2D plane through first three points
  let idx_far_plane = -1
  let best_dist_plane = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === idx_far_a || idx === idx_far_b || idx === idx_far_line) continue
    const dist = distance_point_to_hyperplane_4d(
      points[idx_far_a],
      points[idx_far_b],
      points[idx_far_line],
      points[idx],
    )
    if (dist > best_dist_plane) {
      best_dist_plane = dist
      idx_far_plane = idx
    }
  }
  if (idx_far_plane === -1 || best_dist_plane < EPS) return null

  // Find point farthest from 3D hyperplane through first four points
  const plane0 = compute_plane_4d(
    points[idx_far_a],
    points[idx_far_b],
    points[idx_far_line],
    points[idx_far_plane],
  )
  let idx_far_hyperplane = -1
  let best_dist_hyperplane = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (
      idx === idx_far_a || idx === idx_far_b || idx === idx_far_line ||
      idx === idx_far_plane
    ) continue
    const dist = Math.abs(point_plane_signed_distance_4d(plane0, points[idx]))
    if (dist > best_dist_hyperplane) {
      best_dist_hyperplane = dist
      idx_far_hyperplane = idx
    }
  }
  if (idx_far_hyperplane === -1 || best_dist_hyperplane < EPS) return null

  return [idx_far_a, idx_far_b, idx_far_line, idx_far_plane, idx_far_hyperplane]
}

function make_face_4d(
  points: Point4D[],
  a: number,
  b: number,
  c: number,
  d: number,
  interior_point: Point4D,
): ConvexHullFace4D {
  let plane = compute_plane_4d(points[a], points[b], points[c], points[d])
  let centroid = compute_centroid_4d(points[a], points[b], points[c], points[d])

  const dist_interior = point_plane_signed_distance_4d(plane, interior_point)

  // Ensure normal points outward (away from interior)
  if (dist_interior > 0) {
    // Swap two vertices to flip normal
    plane = compute_plane_4d(points[a], points[c], points[b], points[d])
    centroid = compute_centroid_4d(points[a], points[c], points[b], points[d])
    return { vertices: [a, c, b, d], plane, centroid, outside_points: new Set<number>() }
  }

  return { vertices: [a, b, c, d], plane, centroid, outside_points: new Set<number>() }
}

function assign_outside_points_4d(
  face: ConvexHullFace4D,
  points: Point4D[],
  candidate_indices: number[],
): void {
  face.outside_points.clear()
  for (const idx of candidate_indices) {
    const distance = point_plane_signed_distance_4d(face.plane, points[idx])
    if (distance > EPS) face.outside_points.add(idx)
  }
}

function collect_candidate_points_4d(faces: ConvexHullFace4D[]): number[] {
  const set = new Set<number>()
  for (const face of faces) {
    for (const idx of face.outside_points) set.add(idx)
  }
  return Array.from(set)
}

function farthest_point_for_face_4d(
  points: Point4D[],
  face: ConvexHullFace4D,
): { idx: number; distance: number } | null {
  let best_idx = -1
  let best_distance = -1
  for (const idx of face.outside_points) {
    const distance = point_plane_signed_distance_4d(face.plane, points[idx])
    if (distance > best_distance) {
      best_distance = distance
      best_idx = idx
    }
  }
  if (best_idx === -1) return null
  return { idx: best_idx, distance: best_distance }
}

function build_horizon_4d(
  faces: ConvexHullFace4D[],
  visible_face_indices: Set<number>,
): math.Vec3[] {
  // In 4D, horizon "ridges" are triangles (3 vertices)
  const ridge_count = new Map<string, math.Vec3>()

  for (const face_idx of visible_face_indices) {
    const face = faces[face_idx]
    const [a, b, c, d] = face.vertices

    // Each tetrahedron face has 4 triangular ridges
    const ridges: math.Vec3[] = [[a, b, c], [a, b, d], [a, c, d], [b, c, d]]

    for (const ridge of ridges) {
      const sorted = ridge.slice().sort((x, y) => x - y)
      const key = sorted.join(`|`)

      if (!ridge_count.has(key)) {
        ridge_count.set(key, ridge)
      } else {
        // Mark as seen twice (internal ridge)
        ridge_count.set(key, [Number.NaN, Number.NaN, Number.NaN])
      }
    }
  }

  const horizon: math.Vec3[] = []
  for (const ridge of ridge_count.values()) {
    if (!Number.isNaN(ridge[0])) {
      horizon.push(ridge)
    }
  }

  return horizon
}

export function compute_quickhull_4d(points: Point4D[]): ConvexHullTetrahedron[] {
  if (points.length < 5) return [] // Need at least 5 non-coplanar points for 4D hull

  const initial = choose_initial_4_simplex(points)
  if (!initial) return []

  const [i0, i1, i2, i3, i4] = initial

  // Interior point for orientation
  const interior_point = {
    x: (points[i0].x + points[i1].x + points[i2].x + points[i3].x + points[i4].x) / 5,
    y: (points[i0].y + points[i1].y + points[i2].y + points[i3].y + points[i4].y) / 5,
    z: (points[i0].z + points[i1].z + points[i2].z + points[i3].z + points[i4].z) / 5,
    w: (points[i0].w + points[i1].w + points[i2].w + points[i3].w + points[i4].w) / 5,
  }

  // Initial 4-simplex has 5 tetrahedral faces
  const faces: ConvexHullFace4D[] = [
    make_face_4d(points, i0, i1, i2, i3, interior_point),
    make_face_4d(points, i0, i1, i2, i4, interior_point),
    make_face_4d(points, i0, i1, i3, i4, interior_point),
    make_face_4d(points, i0, i2, i3, i4, interior_point),
    make_face_4d(points, i1, i2, i3, i4, interior_point),
  ]

  const all_indices: number[] = []
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === i0 || idx === i1 || idx === i2 || idx === i3 || idx === i4) continue
    all_indices.push(idx)
  }

  for (const face of faces) {
    assign_outside_points_4d(face, points, all_indices)
  }

  // Main Quick Hull iteration
  while (true) {
    // Step 1: Find face with farthest outside point (the "eye" point)
    let chosen_face_idx = -1
    let chosen_point_idx = -1
    let max_distance = -1

    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      if (face.outside_points.size === 0) continue

      const far = farthest_point_for_face_4d(points, face)
      if (far && far.distance > max_distance) {
        max_distance = far.distance
        chosen_face_idx = face_idx
        chosen_point_idx = far.idx
      }
    }

    if (chosen_face_idx === -1) break // All points processed

    const eye_idx = chosen_point_idx

    // Step 2: Find all faces visible from the eye point
    const visible_face_indices = new Set<number>()
    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      const dist = point_plane_signed_distance_4d(face.plane, points[eye_idx])
      if (dist > EPS) visible_face_indices.add(face_idx)
    }

    // Step 3: Build horizon ridges (boundary between visible and non-visible faces)
    const horizon_ridges = build_horizon_4d(faces, visible_face_indices)
    const visible_faces = Array.from(visible_face_indices).sort((a, b) => b - a)
    const candidate_points = collect_candidate_points_4d(
      visible_faces.map((idx) => faces[idx]),
    )

    // Step 4: Remove visible faces (they'll be replaced by new ones through eye point)
    for (const idx of visible_faces) {
      faces.splice(idx, 1)
    }

    // Step 5: Create new faces connecting horizon ridges to eye point
    const new_faces: ConvexHullFace4D[] = []
    for (const [u, v, w] of horizon_ridges) {
      const new_face = make_face_4d(points, u, v, w, eye_idx, interior_point)
      new_faces.push(new_face)
    }

    // Step 6: Reassign outside points from removed faces to new faces
    for (const face of new_faces) face.outside_points.clear()

    for (const idx of candidate_points) {
      if (idx === eye_idx) continue

      let best_face: ConvexHullFace4D | null = null
      let best_distance = EPS

      for (const face of new_faces) {
        const dist = point_plane_signed_distance_4d(face.plane, points[idx])
        if (dist > best_distance) {
          best_distance = dist
          best_face = face
        }
      }

      if (best_face) best_face.outside_points.add(idx)
    }

    faces.push(...new_faces)
  }

  return faces.map((face) => {
    const [a, b, c, d] = face.vertices
    return {
      vertices: [points[a], points[b], points[c], points[d]] as [
        Point4D,
        Point4D,
        Point4D,
        Point4D,
      ],
      normal: face.plane.normal,
      centroid: face.centroid,
    }
  })
}

export function compute_lower_hull_4d(points: Point4D[]): ConvexHullTetrahedron[] {
  const all_faces = compute_quickhull_4d(points)
  // Filter for "lower" faces: those with normal pointing down in w direction
  return all_faces.filter((face) => face.normal.w < 0 - EPS)
}

// Check if 3D point (x,y,z) is inside 3D tetrahedron using barycentric coordinates
function point_in_tetrahedron_3d(
  p0: Point3D,
  p1: Point3D,
  p2: Point3D,
  p3: Point3D,
  point: Point3D,
): { inside: boolean; bary: [number, number, number, number] } {
  // Solve for barycentric coordinates: point = l0*p0 + l1*p1 + l2*p2 + l3*p3
  // with l0 + l1 + l2 + l3 = 1
  // Build the linear system
  const matrix: math.Matrix4x4 = [
    [p0.x, p1.x, p2.x, p3.x],
    [p0.y, p1.y, p2.y, p3.y],
    [p0.z, p1.z, p2.z, p3.z],
    [1, 1, 1, 1],
  ]
  const rhs = [point.x, point.y, point.z, 1]

  // Solve using Cramer's rule with 4x4 determinants
  const det_main = math.det_4x4(matrix)
  if (Math.abs(det_main) < EPS) {
    return { inside: false, bary: [0, 0, 0, 0] }
  }

  // Compute barycentric coordinates using Cramer's rule
  const bary: [number, number, number, number] = [0, 0, 0, 0]
  for (let idx = 0; idx < 4; idx++) {
    const m_i = matrix.map((row) => [...row]) as math.Matrix4x4
    for (let row = 0; row < 4; row++) {
      m_i[row][idx] = rhs[row]
    }
    bary[idx] = math.det_4x4(m_i) / det_main
  }

  // Check if inside: all barycentric coords must be >= 0 and sum to 1
  const eps_bary = -1e-9
  const inside = bary.every((l) => l >= eps_bary) &&
    Math.abs(bary.reduce((s, l) => s + l, 0) - 1) < 1e-6

  return { inside, bary }
}

// Precomputed bounding box for fast 3D containment checks
// Speed boost: 6 cheap comparisons (bounding box) vs expensive matrix solve (barycentric)
// helps filter out most tetrahedra for containment checks before doing the slow calculation
interface TetrahedronModel {
  vertices: [Point4D, Point4D, Point4D, Point4D]
  vertices_3d: [Point3D, Point3D, Point3D, Point3D]
  min_x: number
  max_x: number
  min_y: number
  max_y: number
  min_z: number
  max_z: number
}

const build_tetrahedron_models = (
  hull_tetrahedra: ConvexHullTetrahedron[],
): TetrahedronModel[] =>
  hull_tetrahedra.map((tet) => {
    const [p0, p1, p2, p3] = tet.vertices
    const vertices_3d: [Point3D, Point3D, Point3D, Point3D] = [
      { x: p0.x, y: p0.y, z: p0.z },
      { x: p1.x, y: p1.y, z: p1.z },
      { x: p2.x, y: p2.y, z: p2.z },
      { x: p3.x, y: p3.y, z: p3.z },
    ]
    const xs = [p0.x, p1.x, p2.x, p3.x]
    const ys = [p0.y, p1.y, p2.y, p3.y]
    const zs = [p0.z, p1.z, p2.z, p3.z]
    return {
      vertices: tet.vertices,
      vertices_3d,
      min_x: Math.min(...xs),
      max_x: Math.max(...xs),
      min_y: Math.min(...ys),
      max_y: Math.max(...ys),
      min_z: Math.min(...zs),
      max_z: Math.max(...zs),
    }
  })

// Compute distance from point to lower hull in 4D
export const compute_e_above_hull_4d = (
  points: Point4D[],
  hull_tetrahedra: ConvexHullTetrahedron[],
) => {
  // Precompute bounding boxes for fast prefiltering
  const models = build_tetrahedron_models(hull_tetrahedra)

  return points.map(({ x, y, z, w }) => {
    let hull_w: number | null = null

    for (const model of models) {
      // Fast bounding box prefilter
      if (
        x < model.min_x - EPS || x > model.max_x + EPS ||
        y < model.min_y - EPS || y > model.max_y + EPS ||
        z < model.min_z - EPS || z > model.max_z + EPS
      ) continue

      // Check if point's (x,y,z) is inside the 3D projection of the tetrahedron
      const { inside, bary } = point_in_tetrahedron_3d(
        model.vertices_3d[0],
        model.vertices_3d[1],
        model.vertices_3d[2],
        model.vertices_3d[3],
        { x, y, z },
      )

      if (inside) {
        // Compute w on the hull at this (x,y,z) using barycentric interpolation
        const [p0, p1, p2, p3] = model.vertices
        const w_on_hull = bary[0] * p0.w + bary[1] * p1.w + bary[2] * p2.w +
          bary[3] * p3.w
        hull_w = hull_w === null ? w_on_hull : Math.min(hull_w, w_on_hull)
      }
    }

    // If no tetrahedron contains this point's spatial projection, it's outside the valid
    // composition domain. Return NaN to indicate invalid input.
    if (hull_w === null) return NaN
    const distance = w - hull_w
    return distance > EPS ? distance : 0
  })
}

// --- N-Dimensional Convex Hull (for 5+ element systems) ---

// N-dimensional vector operations with dimension validation
const subtract_nd = (vec_a: number[], vec_b: number[]): number[] => {
  if (vec_a.length !== vec_b.length) {
    throw new Error(
      `Vector dimension mismatch: ${vec_a.length} vs ${vec_b.length}`,
    )
  }
  return vec_a.map((val, idx) => val - vec_b[idx])
}

const dot_nd = (vec_a: number[], vec_b: number[]): number => {
  if (vec_a.length !== vec_b.length) {
    throw new Error(
      `Vector dimension mismatch: ${vec_a.length} vs ${vec_b.length}`,
    )
  }
  return vec_a.reduce((sum, val, idx) => sum + val * vec_b[idx], 0)
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
  const n = points.length
  if (n < 2) return { normal: [], offset: 0 }

  // Build (N-1) edge vectors from points[0]
  const edges = points.slice(1).map((pt) => subtract_nd(pt, points[0]))

  // Compute normal via cofactors of the (N-1)×N edge matrix
  // Each component is ±det of (N-1)×(N-1) submatrix with that column removed
  const dim = points[0].length
  const normal_components: number[] = []

  for (let col = 0; col < dim; col++) {
    // Build (N-1)×(N-1) submatrix by removing column col
    const submatrix = edges.map((row) => [
      ...row.slice(0, col),
      ...row.slice(col + 1),
    ])
    const sign = col % 2 === 0 ? 1 : -1
    normal_components.push(sign * math.det_nxn(submatrix))
  }

  const normal = normalize_nd(normal_components)

  // Degenerate case: co-hyperplanar points produce zero normal
  if (norm_nd(normal) < EPS) return { normal, offset: 0 }

  const offset = -dot_nd(normal, points[0])
  return { normal, offset }
}

const point_hyperplane_signed_distance_nd = (
  plane: HyperplaneND,
  point: number[],
): number => dot_nd(plane.normal, point) + plane.offset

const compute_centroid_nd = (points: number[][]): number[] => {
  if (points.length === 0) return []
  const dim = points[0].length
  return Array.from(
    { length: dim },
    (_, idx) => points.reduce((sum, pt) => sum + pt[idx], 0) / points.length,
  )
}

// Find N+1 points that span N dimensions (initial simplex for quickhull)
function choose_initial_simplex_nd(points: number[][]): number[] | null {
  const n = points[0]?.length
  if (!n || points.length < n + 1) return null

  const chosen: number[] = []

  // Greedily pick points that maximize distance from current affine hull
  // Start with two points that are farthest apart
  let [best_i, best_j, best_dist] = [0, 1, -1]
  const sample_size = Math.min(points.length, 100)
  const sample_indices = points.length <= sample_size
    ? points.map((_, idx) => idx)
    : Array.from({ length: sample_size }, (_, idx) =>
      Math.floor((idx * points.length) / sample_size))

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
  while (chosen.length < n + 1) {
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
    const t = dot_nd(ap, ab) / ab_len_sq
    const proj = pt_a.map((val, idx) => val + t * ab[idx])
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

  // Solve Gram * coeffs = rhs using simple Gaussian elimination
  const coeffs = solve_linear_system(gram, rhs)
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
  const proj = origin.map((val, dim) =>
    val + coeffs.reduce((sum, coeff, idx) => sum + coeff * edges[idx][dim], 0)
  )
  return norm_nd(subtract_nd(point, proj))
}

// Solve linear system Ax = b using Gaussian elimination with partial pivoting
function solve_linear_system(matrix_a: number[][], vec_b: number[]): number[] | null {
  const n = matrix_a.length
  if (n === 0) return []
  if (vec_b.length !== n) return null // Dimension mismatch

  // Augmented matrix
  const aug = matrix_a.map((row, idx) => [...row, vec_b[idx]])

  for (let col = 0; col < n; col++) {
    // Find pivot
    let max_row = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[max_row][col])) {
        max_row = row
      }
    }

    if (Math.abs(aug[max_row][col]) < EPS) return null // Singular

    // Swap rows if needed
    if (max_row !== col) {
      const temp = aug[col]
      aug[col] = aug[max_row]
      aug[max_row] = temp
    }

    // Eliminate
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let elim_col = col; elim_col <= n; elim_col++) {
        aug[row][elim_col] -= factor * aug[col][elim_col]
      }
    }
  }

  // Back substitution
  const result = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n]
    for (let col = row + 1; col < n; col++) {
      sum -= aug[row][col] * result[col]
    }
    result[row] = sum / aug[row][row]
  }

  return result
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
function build_horizon_nd(
  faces: SimplexFaceND[],
  visible_indices: Set<number>,
): number[][] {
  const ridge_count = new Map<string, number[]>()

  for (const face_idx of visible_indices) {
    const face = faces[face_idx]
    const verts = face.vertex_indices
    const n = verts.length

    // Each face has n ridges, each ridge omits one vertex
    for (let skip = 0; skip < n; skip++) {
      const ridge = verts.filter((_, idx) => idx !== skip)
      const sorted = [...ridge].sort((a, b) => a - b)
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
  const n = points[0].length
  if (points.length < n + 1) return []

  // Find initial n-simplex
  const initial = choose_initial_simplex_nd(points)
  if (!initial) return []

  // Interior point for normal orientation
  const interior = compute_centroid_nd(initial.map((idx) => points[idx]))

  // Create initial n+1 facets (each omits one vertex from the simplex)
  const faces: SimplexFaceND[] = []
  for (let skip = 0; skip <= n; skip++) {
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
      const dist = point_hyperplane_signed_distance_nd(
        faces[face_idx].plane,
        points[eye_idx],
      )
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
    const sorted_visible = Array.from(visible_indices).sort((a, b) => b - a)
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

function build_simplex_models_nd(
  faces: SimplexFaceND[],
  points: number[][],
): SimplexModelND[] {
  return faces.map((face) => {
    const vertices = face.vertex_indices.map((idx) => points[idx])
    const n = vertices[0].length
    // Spatial coords are all except last (energy)
    const vertices_spatial = vertices.map((pt) => pt.slice(0, n - 1))

    // Compute bounding box in spatial dimensions
    const spatial_dim = n - 1
    const bbox_min = Array.from(
      { length: spatial_dim },
      (_, idx) => Math.min(...vertices_spatial.map((pt) => pt[idx])),
    )
    const bbox_max = Array.from(
      { length: spatial_dim },
      (_, idx) => Math.max(...vertices_spatial.map((pt) => pt[idx])),
    )

    return { vertices, vertices_spatial, bbox_min, bbox_max }
  })
}

// Check if point is inside simplex and return barycentric coordinates
// Uses linear system solution: point = sum(bary[i] * vertex[i]) with sum(bary) = 1
function point_in_simplex_nd(
  point: number[],
  simplex_vertices: number[][],
): number[] | null {
  const n = simplex_vertices.length // Number of vertices = spatial_dim + 1
  if (n === 0) return null

  const dim = point.length
  if (dim !== n - 1) return null // Spatial dim should be one less than vertex count

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

  const coeffs = solve_linear_system(matrix, rhs)
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
  const models = build_simplex_models_nd(hull_facets, all_points)

  return query_points.map((query) => {
    const n = query.length
    const spatial = query.slice(0, n - 1) // All but last coord
    const energy = query[n - 1]

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
        (sum, coeff, idx) => sum + coeff * model.vertices[idx][n - 1],
        0,
      )
      hull_energy = hull_energy === null ? e_hull : Math.min(hull_energy, e_hull)
    }

    // If no facet contains this point's spatial projection, it's outside the valid
    // composition domain. Return NaN to indicate invalid input rather than 0 (which
    // would falsely imply the point is stable/on-hull).
    if (hull_energy === null) return NaN
    const distance = energy - hull_energy
    return distance > EPS ? distance : 0
  })
}
