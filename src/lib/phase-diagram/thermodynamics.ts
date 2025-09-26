import type { ElementSymbol } from '$lib'
import { sort_by_electronegativity } from '$lib/composition/parse'
import type {
  ConvexHullFace,
  ConvexHullTriangle,
  PhaseDiagramData,
  PhaseEntry,
  Plane,
  Point3D,
} from './types.ts'
import { is_unary_entry } from './types.ts'

// ================= Thermodynamics & metadata =================

export function process_pd_entries(entries: PhaseEntry[]): PhaseDiagramData {
  const eps = 1e-6
  const stable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity
    return e_hull <= eps
  })
  const unstable_entries = entries.filter((entry) => {
    if (typeof entry.is_stable === `boolean`) return !entry.is_stable
    const e_hull = entry.e_above_hull ?? Infinity
    return e_hull > eps
  })

  const elements = Array.from(
    new Set(entries.flatMap((entry) => Object.keys(entry.composition))),
  ).sort() as ElementSymbol[]

  const el_refs = Object.fromEntries(
    stable_entries
      .filter(is_unary_entry)
      .map((entry) => [Object.keys(entry.composition)[0], entry]),
  )

  return { entries, stable_entries, unstable_entries, elements, el_refs }
}

function get_corrected_energy_per_atom(entry: PhaseEntry): number | null {
  const atoms = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
  if (atoms <= 0) return null
  const base_total_energy = typeof entry.energy_per_atom === `number`
    ? entry.energy_per_atom * atoms
    : (typeof entry.energy === `number` ? entry.energy : null)
  if (base_total_energy === null) return null
  return (base_total_energy + (entry.correction ?? 0)) / atoms
}

export function compute_e_form_per_atom(
  entry: PhaseEntry,
  el_refs: Record<string, PhaseEntry>,
): number | null {
  const atoms = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
  if (atoms <= 0) return null
  const e_pa = get_corrected_energy_per_atom(entry) ??
    (typeof entry.energy_per_atom === `number`
      ? entry.energy_per_atom
      : entry.energy / atoms)
  let ref_sum = 0
  for (const [el, amt] of Object.entries(entry.composition)) {
    const ref = el_refs[el]
    if (!ref) return null
    const ref_atoms = Object.values(ref.composition).reduce((sum, amt) => sum + amt, 0)
    const ref_e_pa = get_corrected_energy_per_atom(ref) ??
      (typeof ref.energy_per_atom === `number`
        ? ref.energy_per_atom
        : (ref.energy as number) / Math.max(1e-12, ref_atoms))
    ref_sum += (amt / atoms) * ref_e_pa
  }
  return e_pa - ref_sum
}

export function find_lowest_energy_unary_refs(
  entries: PhaseEntry[],
): Record<string, PhaseEntry> {
  const refs: Record<string, PhaseEntry> = {}
  for (const entry of entries) {
    if (!is_unary_entry(entry)) continue
    const el = Object.keys(entry.composition).find((k) => entry.composition[k] > 0)
    if (!el) continue
    const atoms = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
    const e_pa = get_corrected_energy_per_atom(entry) ??
      (typeof entry.energy_per_atom === `number`
        ? entry.energy_per_atom
        : entry.energy / Math.max(1e-12, atoms))
    const current = refs[el]
    if (!current) {
      refs[el] = entry
    } else {
      const c_atoms = Object.values(current.composition).reduce(
        (sum, amt) => sum + amt,
        0,
      )
      const c_e_pa = get_corrected_energy_per_atom(current) ??
        (typeof current.energy_per_atom === `number`
          ? current.energy_per_atom
          : (current.energy ?? 0) / Math.max(1e-12, c_atoms))
      if (e_pa < c_e_pa) refs[el] = entry
    }
  }
  return refs
}

export function get_phase_diagram_stats(
  processed_entries: PhaseEntry[],
  elements: ElementSymbol[],
  max_arity: 3 | 4,
): {
  total: number
  unary: number
  binary: number
  ternary: number
  quaternary: number
  stable: number
  unstable: number
  energy_range: { min: number; max: number; avg: number }
  hull_distance: { max: number; avg: number }
  elements: number
  chemical_system: string
} | null {
  if (!processed_entries || processed_entries.length === 0) return null

  const composition_counts = (max_arity === 4 ? [1, 2, 3, 4] : [1, 2, 3]).map((target) =>
    processed_entries.filter((entry) =>
      Object.keys(entry.composition).filter((el) => entry.composition[el] > 0).length ===
        target
    ).length
  )
  const [unary, binary, ternary, quaternaryMaybe] = composition_counts as [
    number,
    number,
    number,
    number?,
  ]
  const quaternary = max_arity === 4 ? (quaternaryMaybe ?? 0) : 0

  const stable_count = processed_entries.filter((e) =>
    e.is_stable === true ||
    (typeof e.e_above_hull === `number` && e.e_above_hull < 1e-6)
  ).length
  const unstable_count = processed_entries.length - stable_count

  const energies = processed_entries
    .map((e) => e.e_form_per_atom ?? e.energy_per_atom)
    .filter((v): v is number => typeof v === `number` && Number.isFinite(v))

  const energy_range = energies.length > 0
    ? {
      min: Math.min(...energies),
      max: Math.max(...energies),
      avg: energies.reduce((a, b) => a + b, 0) / energies.length,
    }
    : { min: 0, max: 0, avg: 0 }

  const hull_distances = processed_entries
    .map((e) => e.e_above_hull)
    .filter((v): v is number => typeof v === `number` && v >= 0)
  const hull_distance = hull_distances.length > 0
    ? {
      max: Math.max(...hull_distances),
      avg: hull_distances.reduce((a, b) => a + b, 0) / hull_distances.length,
    }
    : { max: 0, avg: 0 }

  return {
    total: processed_entries.length,
    unary,
    binary,
    ternary,
    quaternary,
    stable: stable_count,
    unstable: unstable_count,
    energy_range,
    hull_distance,
    elements: elements.length,
    chemical_system: sort_by_electronegativity([...elements]).join(`-`),
  }
}

// ================= Convex hull geometry =================

const EPS = 1e-9

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Point3D, b: Point3D): Point3D {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function norm(a: Point3D): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
}

function normalize(v: Point3D): Point3D {
  const length = norm(v)
  if (length < EPS) return { x: 0, y: 0, z: 0 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function compute_plane(a: Point3D, b: Point3D, c: Point3D): Plane {
  const ab = subtract(b, a)
  const ac = subtract(c, a)
  const n = normalize(cross(ab, ac))
  const offset = -(n.x * a.x + n.y * a.y + n.z * a.z)
  return { normal: n, offset }
}

function point_plane_signed_distance(plane: Plane, p: Point3D): number {
  return plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z + plane.offset
}

function compute_centroid(a: Point3D, b: Point3D, c: Point3D): Point3D {
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 }
}

function distance_point_to_line(a: Point3D, b: Point3D, p: Point3D): number {
  const ab = subtract(b, a)
  const ap = subtract(p, a)
  const cross_prod = cross(ab, ap)
  const ab_len = norm(ab)
  if (ab_len < EPS) return 0
  return norm(cross_prod) / ab_len
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

export function build_lower_hull_model(
  faces: ConvexHullTriangle[],
): HullFaceModel[] {
  return faces.map((tri) => {
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
}

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
