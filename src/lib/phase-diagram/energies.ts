import type { ElementSymbol } from '$lib'
import { is_elemental_entry } from './arity'
import type { ConvexHullTriangle, PhaseDiagramData, PhaseEntry, Point3D } from './types'

// Process phase diagram data to extract elements and categorize entries as (un-)stable
export function process_pd_entries(entries: PhaseEntry[]): PhaseDiagramData {
  const eps = 1e-6
  const stable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity // infinity fallback assumes unstable if e_above_hull undefined
    return e_hull <= eps
  })
  const unstable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return !entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity // infinity fallback assumes unstable if e_above_hull undefined
    return e_hull > eps
  })

  // Extract unique elements and sort them for consistent ordering
  const elements = Array.from(
    new Set(entries.flatMap((entry) => Object.keys(entry.composition))),
  ).sort() as ElementSymbol[]

  // Find elemental references (pure element entries)
  const el_refs = Object.fromEntries(
    stable_entries
      .filter(is_elemental_entry)
      .map((entry) => [Object.keys(entry.composition)[0], entry]),
  )

  return { entries, stable_entries, unstable_entries, elements, el_refs }
}

// Corrected energy per atom using optional `correction` term if present
function get_corrected_energy_per_atom(entry: PhaseEntry): number | null {
  const atoms = Object.values(entry.composition).reduce((s, v) => s + v, 0)
  if (atoms <= 0) return null
  // Prefer energy_per_atom if present; otherwise use total energy
  const base_total_energy = typeof entry.energy_per_atom === `number`
    ? entry.energy_per_atom * atoms
    : (typeof entry.energy === `number` ? entry.energy : null)
  if (base_total_energy === null) return null
  return (base_total_energy + (entry.correction ?? 0)) / atoms
}

// Compute formation energy per atom for an entry from elemental references
export function compute_formation_energy_per_atom(
  entry: PhaseEntry,
  el_refs: Record<string, PhaseEntry>,
): number | null {
  const atoms = Object.values(entry.composition).reduce((s, v) => s + v, 0)
  if (atoms <= 0) return null
  const e_pa = get_corrected_energy_per_atom(entry) ??
    (typeof entry.energy_per_atom === `number`
      ? entry.energy_per_atom
      : entry.energy / atoms)
  let ref_sum = 0
  for (const [el, amt] of Object.entries(entry.composition)) {
    const ref = el_refs[el]
    if (!ref) return null
    const ref_atoms = Object.values(ref.composition).reduce((s, v) => s + v, 0)
    const ref_e_pa = get_corrected_energy_per_atom(ref) ??
      (typeof ref.energy_per_atom === `number`
        ? ref.energy_per_atom
        : (ref.energy as number) / Math.max(1e-12, ref_atoms))
    ref_sum += (amt / atoms) * ref_e_pa
  }
  return e_pa - ref_sum
}

// Find lowest-energy unary reference for each element
export function find_lowest_energy_unary_refs(
  entries: PhaseEntry[],
): Record<string, PhaseEntry> {
  const refs: Record<string, PhaseEntry> = {}
  for (const entry of entries) {
    if (!is_elemental_entry(entry)) continue
    const el = Object.keys(entry.composition).find((k) => entry.composition[k] > 0)
    if (!el) continue
    const atoms = Object.values(entry.composition).reduce((s, v) => s + v, 0)
    const e_pa = get_corrected_energy_per_atom(entry) ??
      (typeof entry.energy_per_atom === `number`
        ? entry.energy_per_atom
        : entry.energy / Math.max(1e-12, atoms))
    const current = refs[el]
    if (!current) {
      refs[el] = entry
    } else {
      const c_atoms = Object.values(current.composition).reduce((s, v) => s + v, 0)
      const c_e_pa = get_corrected_energy_per_atom(current) ??
        (typeof current.energy_per_atom === `number`
          ? current.energy_per_atom
          : (current.energy ?? 0) / Math.max(1e-12, c_atoms))
      if (e_pa < c_e_pa) refs[el] = entry
    }
  }
  return refs
}

// ---------- On-the-fly energy-above-hull helpers ----------

// Preprocessed face model for fast z(x, y) evaluation and point-in-triangle tests
export interface HullFaceModel {
  // z = a*x + b*y + c over the face
  a: number
  b: number
  c: number
  // 2D triangle vertices (xy-plane) and bounding box for quick reject
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
  // Denominator for barycentric coordinates
  denom: number
}

function build_plane_from_triangle(
  p1: Point3D,
  p2: Point3D,
  p3: Point3D,
): { a: number; b: number; c: number } {
  // Solve z = a*x + b*y + c from three points using Cramer's rule
  const x1 = p1.x
  const y1 = p1.y
  const z1 = p1.z
  const x2 = p2.x
  const y2 = p2.y
  const z2 = p2.z
  const x3 = p3.x
  const y3 = p3.y
  const z3 = p3.z

  const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
  if (Math.abs(det) < 1e-12) return { a: 0, b: 0, c: (z1 + z2 + z3) / 3 }

  const a = (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / det
  const b = (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / det
  const c = (z1 * (x2 * y3 - x3 * y2) + z2 * (x3 * y1 - x1 * y3) +
    z3 * (x1 * y2 - x2 * y1)) /
    det
  return { a, b, c }
}

export function build_lower_hull_model(faces: ConvexHullTriangle[]): HullFaceModel[] {
  return faces.map((tri) => {
    const [p1, p2, p3] = tri.vertices
    const { a, b, c } = build_plane_from_triangle(p1, p2, p3)
    const [min_x, _mid_x, max_x] = [p1.x, p2.x, p3.x].sort()
    const [min_y, _mid_y, max_y] = [p1.y, p2.y, p3.y].sort()
    const { x: x1, y: y1 } = p1
    const { x: x2, y: y2 } = p2
    const { x: x3, y: y3 } = p3
    const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    return { a, b, c, x1, y1, x2, y2, x3, y3, min_x, max_x, min_y, max_y, denom }
  })
}

function point_in_triangle_xy(model: HullFaceModel, x: number, y: number): boolean {
  // Barycentric coordinate check in XY plane
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

export function compute_e_above_hull_for_points(
  points: Point3D[],
  models: HullFaceModel[],
): number[] {
  return points.map((p) => {
    const z_hull = e_hull_at_xy(models, p.x, p.y)
    if (z_hull === null) return 0
    const e_above_hull = p.z - z_hull
    return e_above_hull > 1e-9 ? e_above_hull : 0
  })
}
