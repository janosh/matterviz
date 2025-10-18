// Brillouin zone generation via convex hull

import type { Matrix3x3, Vec3 } from '$lib'
import * as math from '$lib/math'
import { Vector3 } from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { BrillouinZoneData, ConvexHullData } from './types'

const normalize = (vec: Vec3): Vec3 => {
  const mag = Math.hypot(...vec)
  return mag < 1e-10 ? [0, 0, 0] : [vec[0] / mag, vec[1] / mag, vec[2] / mag]
}

// Compute reciprocal lattice: k = inv(real).T * 2π
export function reciprocal_lattice(real_lattice: Matrix3x3): Matrix3x3 {
  const inv = math.matrix_inverse_3x3(real_lattice)
  const transposed = math.transpose_3x3_matrix(inv)
  return transposed.map((row) => math.scale(row, 2 * Math.PI)) as Matrix3x3
}

// Generate k-space grid with size based on BZ order
function generate_k_space_grid(k_lattice: Matrix3x3, order: number): Vec3[] {
  const points: Vec3[] = []
  // For order n, we need to include points up to ±n to capture all nearest neighbors
  const range = Math.max(1, order)
  for (let idx_i = -range; idx_i <= range; idx_i++) {
    for (let idx_j = -range; idx_j <= range; idx_j++) {
      for (let idx_k = -range; idx_k <= range; idx_k++) {
        const point = math.add(
          math.scale(k_lattice[0], idx_i),
          math.scale(k_lattice[1], idx_j),
          math.scale(k_lattice[2], idx_k),
        ) as Vec3
        points.push(point)
      }
    }
  }
  return points
}

const TOL = 1e-8

// O(1) duplicate vertex detection using spatial hashing
class VertexDeduplicator {
  private grid = new Map<string, Vec3[]>()
  private cell_size: number

  constructor(cell_size: number) {
    this.cell_size = cell_size
  }

  has_duplicate(vertex: Vec3): boolean {
    const [base_x, base_y, base_z] = vertex.map((val) => Math.floor(val / this.cell_size))

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const neighbors = this.grid.get(`${base_x + dx},${base_y + dy},${base_z + dz}`)
          if (
            neighbors?.some((v) =>
              Math.abs(v[0] - vertex[0]) < TOL &&
              Math.abs(v[1] - vertex[1]) < TOL &&
              Math.abs(v[2] - vertex[2]) < TOL
            )
          ) return true
        }
      }
    }
    return false
  }

  add(vertex: Vec3): void {
    const key = vertex.map((v) => Math.floor(v / this.cell_size)).join(`,`)
    const cell = this.grid.get(key)
    if (cell) cell.push(vertex)
    else this.grid.set(key, [vertex])
  }
}

// Find intersection of three Bragg planes by solving N·v = d
function intersect_planes(
  p1: { normal: Vec3; dist: number },
  p2: { normal: Vec3; dist: number },
  p3: { normal: Vec3; dist: number },
): Vec3 | null {
  try {
    const matrix: Matrix3x3 = [p1.normal, p2.normal, p3.normal]
    const distances: Vec3 = [p1.dist, p2.dist, p3.dist]
    return math.mat3x3_vec3_multiply(math.matrix_inverse_3x3(matrix), distances)
  } catch {
    return null
  }
}

// Generate BZ vertices for nth-order zone via three-plane intersections
export function generate_bz_vertices(
  k_lattice: Matrix3x3,
  order: 1 | 2 | 3 = 1,
  // Maximum number of Bragg planes to consider for each BZ order.
  // Limits the number of three-plane intersections tested (O(n³) operation).
  // Higher values give more accurate zones but increase computation time significantly.
  // Default values: 26 (1st order), 80 (2nd order), 150 (3rd+ order)
  max_planes_by_order: Record<1 | 2 | 3, number> = { 1: 26, 2: 80, 3: 150 },
): Vec3[] {
  if (order > 3) order = 3 // Performance limit

  const k_points = generate_k_space_grid(k_lattice, order)
  const center_idx = Math.floor(k_points.length / 2)

  // Determine max planes for this order (default to highest value for orders > 3)
  const max_planes = max_planes_by_order[order] ?? 150

  // Create Bragg planes (perpendicular bisectors of k-points)
  const planes = k_points
    .map((pt, idx) => {
      if (idx === center_idx) return null
      const dist_sq = pt[0] ** 2 + pt[1] ** 2 + pt[2] ** 2
      return { normal: normalize(pt), dist: Math.sqrt(dist_sq) / 2, dist_sq }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.dist_sq - b.dist_sq)
    .slice(0, max_planes)

  // Pre-compute plane data for fast access
  const normals = planes.map((p) => p.normal)
  const distances = planes.map((p) => p.dist)

  const dedup = new VertexDeduplicator(TOL * 10)
  const vertices: Vec3[] = []

  // Test all three-plane intersections
  for (let idx_i = 0; idx_i < planes.length; idx_i++) {
    for (let idx_j = idx_i + 1; idx_j < planes.length; idx_j++) {
      for (let idx_k = idx_j + 1; idx_k < planes.length; idx_k++) {
        const vertex = intersect_planes(planes[idx_i], planes[idx_j], planes[idx_k])
        if (!vertex) continue

        // Count how many planes this vertex is beyond (with early termination)
        let beyond_count = 0
        for (let p_idx = 0; p_idx < normals.length; p_idx++) {
          const dot = vertex[0] * normals[p_idx][0] + vertex[1] * normals[p_idx][1] +
            vertex[2] * normals[p_idx][2]
          if (dot > distances[p_idx] + TOL) {
            beyond_count++
            if (beyond_count >= order) break
          }
        }

        // Vertex belongs to nth BZ if it's beyond fewer than n planes
        if (beyond_count < order && !dedup.has_duplicate(vertex)) {
          vertices.push(vertex)
          dedup.add(vertex)
        }
      }
    }
  }

  return vertices
}

// Build convex hull from vertices and extract topology
export function compute_convex_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg = 5, // Angle threshold for edge detection: edges between faces with angle > this are rendered
): ConvexHullData {
  if (vertices.length < 4) {
    throw new Error(`Need ≥4 vertices for convex hull, got ${vertices.length}`)
  }

  const geometry = new ConvexGeometry(vertices.map((v) => new Vector3(...v)))
  const pos = geometry.getAttribute(`position`)
  const idx = geometry.index

  // Deduplicate vertices from Three.js geometry
  const unique_verts: Vec3[] = []
  const vert_map = new Map<number, number>()

  for (let idx_vertex = 0; idx_vertex < pos.count; idx_vertex++) {
    const vert: Vec3 = [pos.getX(idx_vertex), pos.getY(idx_vertex), pos.getZ(idx_vertex)]
    const existing_idx = unique_verts.findIndex(
      (u) =>
        Math.abs(u[0] - vert[0]) < TOL && Math.abs(u[1] - vert[1]) < TOL &&
        Math.abs(u[2] - vert[2]) < TOL,
    )
    vert_map.set(
      idx_vertex,
      existing_idx === -1 ? (unique_verts.push(vert) - 1) : existing_idx,
    )
  }

  // Build faces with deduplicated vertex indices
  const faces: number[][] = []
  const n_faces = idx ? idx.count / 3 : pos.count / 3

  for (let idx_face = 0; idx_face < n_faces; idx_face++) {
    const tri = idx
      ? [idx.getX(idx_face * 3), idx.getX(idx_face * 3 + 1), idx.getX(idx_face * 3 + 2)]
      : [idx_face * 3, idx_face * 3 + 1, idx_face * 3 + 2]
    faces.push(tri.map((j) => {
      const mapped = vert_map.get(j)
      if (mapped === undefined) throw new Error(`Vertex ${j} not mapped`)
      return mapped
    }))
  }

  // Compute face normals and build edge-to-face adjacency
  const face_normals = faces.map((face) => {
    const [v0, v1, v2] = face.slice(0, 3).map((vi) => unique_verts[vi])
    return normalize(math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0)))
  })

  const edge_to_faces = new Map<string, number[]>()
  faces.forEach((face, face_idx) => {
    face.forEach((v1, idx) => {
      const v2 = face[(idx + 1) % face.length]
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`
      const adj = edge_to_faces.get(key)
      if (adj) adj.push(face_idx)
      else edge_to_faces.set(key, [face_idx])
    })
  })

  // Extract edges: keep boundary edges or sharp angles
  const cos_threshold = Math.cos((edge_sharp_angle_deg * Math.PI) / 180)
  const edges: [number, number][] = []

  for (const [key, adj] of edge_to_faces) {
    const is_sharp = adj.length === 1 ||
      (adj.length === 2 &&
        (math.dot(face_normals[adj[0]], face_normals[adj[1]]) as number) < cos_threshold)
    if (is_sharp) edges.push(key.split(`,`).map(Number) as [number, number])
  }

  geometry.dispose()
  return { vertices: unique_verts, faces, edges }
}

// Compute complete Brillouin zone with topology and volume
export function compute_brillouin_zone(
  k_lattice: Matrix3x3,
  order: 1 | 2 | 3 = 1,
  edge_sharp_angle_deg = 5, // Angle threshold for edge extraction (default 5°, increase for fewer edges, decrease for more)
  max_planes_by_order: Record<number, number> = { 1: 26, 2: 80, 3: 150 }, // Customize plane count limits per BZ order
): BrillouinZoneData {
  const vertices = generate_bz_vertices(k_lattice, order, max_planes_by_order)
  if (vertices.length < 4) {
    throw new Error(`Insufficient vertices for BZ (got ${vertices.length}, need ≥4)`)
  }

  const hull = compute_convex_hull(vertices, edge_sharp_angle_deg)

  // Compute volume via divergence theorem (sum of signed tetrahedral volumes)
  const volume = Math.abs(
    hull.faces.reduce((sum, face) => {
      if (face.length < 3) return sum
      const [v0, v1, v2] = face.slice(0, 3).map((idx) => hull.vertices[idx])
      const area_normal = math.scale(
        math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0)),
        0.5,
      ) as Vec3
      return sum + (math.dot(v0, area_normal) as number) / 3
    }, 0),
  )

  return {
    order,
    vertices: hull.vertices,
    faces: hull.faces,
    edges: hull.edges.map(([i1, i2]) => [hull.vertices[i1], hull.vertices[i2]]),
    k_lattice,
    volume,
  }
}
