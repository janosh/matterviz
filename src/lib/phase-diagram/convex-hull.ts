import type { ConvexHullFace, ConvexHullTriangle, Plane, Point3D } from './types'

const EPS = 1e-9

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
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
  // plane.normal is normalized, so this is the signed distance
  return plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z +
    plane.offset
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

  // 1) most separated by x
  let idx_min_x = 0
  let idx_max_x = 0
  for (let idx = 1; idx < points.length; idx++) {
    if (points[idx].x < points[idx_min_x].x) idx_min_x = idx
    if (points[idx].x > points[idx_max_x].x) idx_max_x = idx
  }
  if (idx_min_x === idx_max_x) return null

  // 2) farthest from line (min_x, max_x)
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

  // 3) farthest from plane formed by the three points
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

  if (idx_far_plane === -1 || best_dist_plane < EPS) return null // coplanar

  return [idx_min_x, idx_max_x, idx_far_line, idx_far_plane]
}

function make_face(
  points: Point3D[],
  a: number,
  b: number,
  c: number,
  interior_point: Point3D,
): ConvexHullFace {
  // orientation: ensure normal points outward (away from interior)
  let plane = compute_plane(points[a], points[b], points[c])
  let centroid = compute_centroid(points[a], points[b], points[c])
  const dist_interior = point_plane_signed_distance(plane, interior_point)
  if (dist_interior > 0) {
    // flip orientation
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
): Array<[number, number]> {
  // Return undirected edges (u, v) that border the visible region
  const edge_count = new Map<string, [number, number]>()
  for (const face_idx of visible_face_indices) {
    const face = faces[face_idx]
    const [a, b, c] = face.vertices
    const edges: Array<[number, number]> = [
      [a, b],
      [b, c],
      [c, a],
    ]
    for (const [u, v] of edges) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`
      if (!edge_count.has(key)) edge_count.set(key, [u, v])
      else edge_count.set(key, [Number.NaN, Number.NaN]) // mark shared within visible region
    }
  }

  const horizon: Array<[number, number]> = []
  for (const uv of edge_count.values()) {
    if (Number.isNaN(uv[0])) continue // shared by two visible faces -> interior edge, skip
    // Confirm that the edge belongs to exactly one visible face and one non-visible face
    horizon.push(uv)
  }
  return horizon
}

// Public API: compute convex hull triangles using Quickhull. Returns lower- and upper-hull faces.
export function compute_quickhull_triangles(
  points: Point3D[],
): ConvexHullTriangle[] {
  if (points.length < 3) return []

  const initial = choose_initial_tetrahedron(points)
  if (!initial) return []
  const [i0, i1, i2, i3] = initial

  // Interior reference point: average of the tetra vertices
  const interior_point = {
    x: (points[i0].x + points[i1].x + points[i2].x + points[i3].x) / 4,
    y: (points[i0].y + points[i1].y + points[i2].y + points[i3].y) / 4,
    z: (points[i0].z + points[i1].z + points[i2].z + points[i3].z) / 4,
  }

  // Create initial hull faces (tetrahedron)
  const faces: ConvexHullFace[] = [
    make_face(points, i0, i1, i2, interior_point),
    make_face(points, i0, i2, i3, interior_point),
    make_face(points, i0, i3, i1, interior_point),
    make_face(points, i1, i3, i2, interior_point),
  ]

  // Assign outside points for each face
  const all_indices: number[] = []
  for (let idx = 0; idx < points.length; idx++) {
    if (idx === i0 || idx === i1 || idx === i2 || idx === i3) continue
    all_indices.push(idx)
  }
  for (const face of faces) assign_outside_points(face, points, all_indices)

  // Main loop
  while (true) {
    // Select face with a farthest outside point
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

    if (chosen_face_idx === -1) break // no face has outside points

    const eye_idx = chosen_point_idx

    // Identify faces visible from the eye point
    const visible_face_indices = new Set<number>()
    for (let face_idx = 0; face_idx < faces.length; face_idx++) {
      const face = faces[face_idx]
      const dist = point_plane_signed_distance(face.plane, points[eye_idx])
      if (dist > EPS) visible_face_indices.add(face_idx)
    }

    // Build horizon (edges bordering visible and non-visible faces)
    const horizon_edges = build_horizon(faces, visible_face_indices)

    // Collect candidate outside points from visible faces to reassign later
    const visible_faces = Array.from(visible_face_indices).sort((a, b) => b - a) // sort desc for safe removal
    const candidate_points = collect_candidate_points(
      visible_faces.map((idx) => faces[idx]),
    )

    // Remove visible faces from hull
    for (const idx of visible_faces) faces.splice(idx, 1)

    // Create new faces from horizon to the eye point
    const new_faces: ConvexHullFace[] = []
    for (const [u, v] of horizon_edges) {
      // Orientation will be corrected against interior_point
      const new_face = make_face(points, u, v, eye_idx, interior_point)
      new_faces.push(new_face)
    }

    // Assign candidate points to new faces
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

    // Add new faces to hull
    faces.push(...new_faces)
  }

  // Convert to coordinate triangles
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

// Helper to filter only the lower hull (faces whose outward normal points downwards in z)
export function compute_lower_hull_triangles(
  points: Point3D[],
): ConvexHullTriangle[] {
  const all_faces = compute_quickhull_triangles(points)
  return all_faces.filter((face) => face.normal.z < 0 - EPS)
}
