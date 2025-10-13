import type { ElementSymbol } from '$lib'
import { sort_by_electronegativity } from '$lib/composition/parse'
import * as math from '$lib/math'
import type {
  ConvexHullFace,
  ConvexHullTriangle,
  PhaseDiagramData,
  PhaseEntry,
  Plane,
  Point3D,
} from './types'
import { is_unary_entry } from './types'

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
    const el = Object.keys(entry.composition).find(
      (el) => entry.composition[el as ElementSymbol] > 0,
    )
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
      Object.keys(entry.composition).filter(
        (el) => entry.composition[el as ElementSymbol] > 0,
      ).length === target
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

// ================= 4D Convex Hull (Quaternary Phase Diagrams) =================

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

function subtract_4d(a: Point4D, b: Point4D): Point4D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, w: a.w - b.w }
}

function dot_4d(a: Point4D, b: Point4D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
}

function norm_4d(v: Point4D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w)
}

function normalize_4d(v: Point4D): Point4D {
  const length = norm_4d(v)
  if (length < EPS) return { x: 0, y: 0, z: 0, w: 0 }
  return { x: v.x / length, y: v.y / length, z: v.z / length, w: v.w / length }
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

function point_plane_signed_distance_4d(plane: Plane4D, p: Point4D): number {
  return dot_4d(plane.normal, p) + plane.offset
}

function compute_centroid_4d(
  p1: Point4D,
  p2: Point4D,
  p3: Point4D,
  p4: Point4D,
): Point4D {
  return {
    x: (p1.x + p2.x + p3.x + p4.x) / 4,
    y: (p1.y + p2.y + p3.y + p4.y) / 4,
    z: (p1.z + p2.z + p3.z + p4.z) / 4,
    w: (p1.w + p2.w + p3.w + p4.w) / 4,
  }
}

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

function choose_initial_4_simplex(
  points: Point4D[],
): [number, number, number, number, number] | null {
  if (points.length < 5) return null

  // Find two points farthest apart across all dimensions for better numerical stability
  // Sample a small subset if dataset is large to avoid O(n²) scaling
  const sample_size = Math.min(points.length, 100)
  const sample_indices = points.length <= sample_size
    ? points.map((_, idx) => idx)
    : Array.from({ length: sample_size }, (_, idx) =>
      Math.floor((idx * points.length) / sample_size))

  let idx_min_x = 0
  let idx_max_x = 0
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
        idx_min_x = idx_a
        idx_max_x = idx_b
      }
    }
  }
  if (idx_min_x === idx_max_x || max_dist_sq < EPS) return null

  // Find point farthest from line through idx_min_x and idx_max_x
  let idx_far_line = -1
  let best_dist_line = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === idx_min_x || idx === idx_max_x) continue
    const dist = distance_point_to_line_4d(
      points[idx_min_x],
      points[idx_max_x],
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
    if (idx === idx_min_x || idx === idx_max_x || idx === idx_far_line) continue
    const dist = distance_point_to_hyperplane_4d(
      points[idx_min_x],
      points[idx_max_x],
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
    points[idx_min_x],
    points[idx_max_x],
    points[idx_far_line],
    points[idx_far_plane],
  )
  let idx_far_hyperplane = -1
  let best_dist_hyperplane = -1
  for (let idx = 0; idx < points.length; idx++) {
    if (
      idx === idx_min_x || idx === idx_max_x || idx === idx_far_line ||
      idx === idx_far_plane
    ) continue
    const dist = Math.abs(point_plane_signed_distance_4d(plane0, points[idx]))
    if (dist > best_dist_hyperplane) {
      best_dist_hyperplane = dist
      idx_far_hyperplane = idx
    }
  }
  if (idx_far_hyperplane === -1 || best_dist_hyperplane < EPS) return null

  return [idx_min_x, idx_max_x, idx_far_line, idx_far_plane, idx_far_hyperplane]
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
): [number, number, number][] {
  // In 4D, horizon "ridges" are triangles (3 vertices)
  const ridge_count = new Map<string, [number, number, number]>()

  for (const face_idx of visible_face_indices) {
    const face = faces[face_idx]
    const [a, b, c, d] = face.vertices

    // Each tetrahedron face has 4 triangular ridges
    const ridges: [number, number, number][] = [
      [a, b, c],
      [a, b, d],
      [a, c, d],
      [b, c, d],
    ]

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

  const horizon: [number, number, number][] = []
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

    if (chosen_face_idx === -1) break

    const eye_idx = chosen_point_idx
    const visible_face_indices = new Set<number>()

    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      const dist = point_plane_signed_distance_4d(face.plane, points[eye_idx])
      if (dist > EPS) visible_face_indices.add(face_idx)
    }

    const horizon_ridges = build_horizon_4d(faces, visible_face_indices)
    const visible_faces = Array.from(visible_face_indices).sort((a, b) => b - a)
    const candidate_points = collect_candidate_points_4d(
      visible_faces.map((idx) => faces[idx]),
    )

    for (const idx of visible_faces) {
      faces.splice(idx, 1)
    }

    const new_faces: ConvexHullFace4D[] = []
    for (const [u, v, w] of horizon_ridges) {
      const new_face = make_face_4d(points, u, v, w, eye_idx, interior_point)
      new_faces.push(new_face)
    }

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
  const matrix = [
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
    const m_i = matrix.map((row) => [...row])
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

function build_tetrahedron_models(
  hull_tetrahedra: ConvexHullTetrahedron[],
): TetrahedronModel[] {
  return hull_tetrahedra.map((tet) => {
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
}

// Compute distance from point to lower hull in 4D
export const compute_e_above_hull_4d = (
  points: Point4D[],
  hull_tetrahedra: ConvexHullTetrahedron[],
) => {
  // Precompute bounding boxes for fast prefiltering
  const models = build_tetrahedron_models(hull_tetrahedra)

  return points.map((point) => {
    let hull_w: number | null = null
    const point_3d: Point3D = { x: point.x, y: point.y, z: point.z }

    for (const model of models) {
      // Fast bounding box prefilter
      if (
        point.x < model.min_x - EPS || point.x > model.max_x + EPS ||
        point.y < model.min_y - EPS || point.y > model.max_y + EPS ||
        point.z < model.min_z - EPS || point.z > model.max_z + EPS
      ) {
        continue
      }

      // Check if point's (x,y,z) is inside the 3D projection of the tetrahedron
      const { inside, bary } = point_in_tetrahedron_3d(
        model.vertices_3d[0],
        model.vertices_3d[1],
        model.vertices_3d[2],
        model.vertices_3d[3],
        point_3d,
      )

      if (inside) {
        // Compute w on the hull at this (x,y,z) using barycentric interpolation
        const [p0, p1, p2, p3] = model.vertices
        const w_on_hull = bary[0] * p0.w + bary[1] * p1.w + bary[2] * p2.w +
          bary[3] * p3.w
        hull_w = hull_w === null ? w_on_hull : Math.min(hull_w, w_on_hull)
      }
    }

    if (hull_w === null) return 0
    const distance = point.w - hull_w
    return distance > EPS ? distance : 0
  })
}
