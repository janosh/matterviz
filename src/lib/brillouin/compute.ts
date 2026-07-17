// Brillouin zone generation via convex hull

import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { Vector3 } from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { BrillouinZoneData, ConvexHullData, IrreducibleBZData } from './types'

const TOL = 1e-8

// Extract unique point group rotation matrices from space group operations.
// Returns fractional-coordinate rotations (W matrices from spglib convention).
// These must be converted to Cartesian k-space before use in clipping.
export function extract_point_group_from_operations(
  operations: MoyoDataset[`operations`],
): Matrix3x3[] {
  const seen = new Set<string>()
  const unique_rotations: Matrix3x3[] = []

  for (const { rotation } of operations) {
    const key = rotation.map((val) => val.toFixed(6)).join(`,`)
    if (seen.has(key)) continue
    seen.add(key)

    // moyo serializes rotations COLUMN-major; vec9_to_mat3x3 reads row-major → transpose to get W
    const rot = math.transpose_3x3_matrix(math.vec9_to_mat3x3(Array.from(rotation)))
    unique_rotations.push(rot)
  }

  return unique_rotations
}

// Convert fractional rotation W to Cartesian k-space rotation. k_lattice stores reciprocal
// vectors as ROWS (k_cart = Bᵀ·q) and reciprocal fractional rotation is q' = W^{-T}·q, so
// R_cart = Bᵀ·W^{-T}·B^{-T}. For non-orthogonal lattices W^{-1} ≠ Wᵀ, so the transpose matters.
export function fractional_to_cartesian_rotation(
  W: Matrix3x3,
  k_lattice: Matrix3x3,
): Matrix3x3 {
  try {
    const B_T = math.transpose_3x3_matrix(k_lattice)
    const W_inv_T = math.transpose_3x3_matrix(math.matrix_inverse_3x3(W))
    // R_cart = Bᵀ · W^{-T} · B^{-T}
    return math.dot(math.dot(B_T, W_inv_T), math.matrix_inverse_3x3(B_T))
  } catch {
    // Fallback to identity if inversion fails (shouldn't happen for valid rotations)
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  }
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
        )
        points.push(point)
      }
    }
  }
  return points
}

// O(1) duplicate vertex detection using spatial hashing
class VertexDeduplicator {
  private readonly grid = new Map<string, Vec3[]>()
  private readonly cell_size: number
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
            neighbors?.some(
              ([v1, v2, v3]) =>
                Math.abs(v1 - vertex[0]) < TOL &&
                Math.abs(v2 - vertex[1]) < TOL &&
                Math.abs(v3 - vertex[2]) < TOL,
            )
          )
            return true
        }
      }
    }
    return false
  }

  add(vertex: Vec3): void {
    const key = vertex.map((vert) => Math.floor(vert / this.cell_size)).join(`,`)
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
  const clamped_order = Math.min(order, 3) as typeof order
  const k_points = generate_k_space_grid(k_lattice, clamped_order)
  const center_idx = Math.floor(k_points.length / 2)

  // Fallback for partial records passed through compute_brillouin_zone
  const max_planes = max_planes_by_order[clamped_order] ?? 150

  // Create Bragg planes (perpendicular bisectors of k-points)
  const planes = k_points
    .map((pt, idx) => {
      if (idx === center_idx) return null
      const dist_sq = pt[0] ** 2 + pt[1] ** 2 + pt[2] ** 2
      return {
        normal: math.normalize_vec(pt, [0, 0, 0]),
        dist: Math.sqrt(dist_sq) / 2,
        dist_sq,
      }
    })
    .filter((plane): plane is NonNullable<typeof plane> => plane !== null)
    // The filtered plane array is fresh.
    .toSorted((a, b) => a.dist_sq - b.dist_sq)
    .slice(0, max_planes)

  // Pre-compute plane data for fast access
  const normals = planes.map((plane) => plane.normal)
  const distances = planes.map((plane) => plane.dist)

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
          const dot =
            vertex[0] * normals[p_idx][0] +
            vertex[1] * normals[p_idx][1] +
            vertex[2] * normals[p_idx][2]
          if (dot > distances[p_idx] + TOL) {
            beyond_count++
            if (beyond_count >= clamped_order) break
          }
        }

        // Vertex belongs to nth BZ if it's beyond fewer than n planes
        if (beyond_count < clamped_order && !dedup.has_duplicate(vertex)) {
          vertices.push(vertex)
          dedup.add(vertex)
        }
      }
    }
  }

  return vertices
}

// Compute polyhedron volume via divergence theorem (sum of signed tetrahedral volumes).
// Faces always come from compute_convex_hull, so each is a valid triangle.
function compute_hull_volume(vertices: Vec3[], faces: number[][]): number {
  return Math.abs(
    faces.reduce((sum, face) => {
      const [v0, v1, v2] = face.slice(0, 3).map((idx) => vertices[idx])
      const area_normal = math.scale(
        math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0)),
        0.5,
      )
      return sum + math.dot(v0, area_normal) / 3
    }, 0),
  )
}

// Build convex hull from vertices and extract topology
export function compute_convex_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg = 5, // Angle threshold for edge detection: edges between faces with angle > this are rendered
): ConvexHullData {
  if (vertices.length < 4) {
    throw new Error(`Need ≥4 vertices for convex hull, got ${vertices.length}`)
  }

  const geometry = new ConvexGeometry(vertices.map((vertex) => new Vector3(...vertex)))
  const pos = geometry.getAttribute(`position`)
  const geometry_index = geometry.index

  // Deduplicate vertices from Three.js geometry
  const unique_verts: Vec3[] = []
  const vert_map = new Map<number, number>()

  for (let idx_vertex = 0; idx_vertex < pos.count; idx_vertex++) {
    const vert: Vec3 = [pos.getX(idx_vertex), pos.getY(idx_vertex), pos.getZ(idx_vertex)]
    const existing_idx = unique_verts.findIndex(
      (unique_vert) =>
        Math.abs(unique_vert[0] - vert[0]) < TOL &&
        Math.abs(unique_vert[1] - vert[1]) < TOL &&
        Math.abs(unique_vert[2] - vert[2]) < TOL,
    )
    vert_map.set(idx_vertex, existing_idx === -1 ? unique_verts.push(vert) - 1 : existing_idx)
  }

  // Build faces with deduplicated vertex indices
  const faces: number[][] = []
  const n_faces = geometry_index ? geometry_index.count / 3 : pos.count / 3

  for (let idx_face = 0; idx_face < n_faces; idx_face++) {
    const tri = geometry_index
      ? [
          geometry_index.getX(idx_face * 3),
          geometry_index.getX(idx_face * 3 + 1),
          geometry_index.getX(idx_face * 3 + 2),
        ]
      : [idx_face * 3, idx_face * 3 + 1, idx_face * 3 + 2]
    faces.push(
      tri.map((vertex_idx) => {
        const mapped = vert_map.get(vertex_idx)
        if (mapped === undefined) throw new Error(`Vertex ${vertex_idx} not mapped`)
        return mapped
      }),
    )
  }

  // Compute face normals and build edge-to-face adjacency
  const face_normals = faces.map((face) => {
    const [v0, v1, v2] = face.slice(0, 3).map((vertex_idx) => unique_verts[vertex_idx])
    return math.normalize_vec(
      math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0)),
      [0, 0, 0],
    )
  })

  const edge_to_faces = new Map<string, number[]>()
  faces.forEach((face, face_idx) => {
    face.forEach((from_vertex_idx, idx) => {
      const to_vertex_idx = face[(idx + 1) % face.length]
      const key =
        from_vertex_idx < to_vertex_idx
          ? `${from_vertex_idx},${to_vertex_idx}`
          : `${to_vertex_idx},${from_vertex_idx}`
      const adj = edge_to_faces.get(key)
      if (adj) adj.push(face_idx)
      else edge_to_faces.set(key, [face_idx])
    })
  })

  // Extract edges: keep boundary edges or sharp angles
  const cos_threshold = Math.cos((edge_sharp_angle_deg * Math.PI) / 180)
  const edges: Vec2[] = []

  for (const [key, adj] of edge_to_faces) {
    const is_sharp =
      adj.length === 1 ||
      (adj.length === 2 &&
        math.dot(face_normals[adj[0]], face_normals[adj[1]]) < cos_threshold)
    if (is_sharp) edges.push(key.split(`,`).map(Number) as Vec2)
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

  return {
    order: Math.min(order, 3),
    vertices: hull.vertices,
    faces: hull.faces,
    edges: hull.edges.map(([i1, i2]) => [hull.vertices[i1], hull.vertices[i2]]),
    k_lattice,
    volume: compute_hull_volume(hull.vertices, hull.faces),
  }
}

// Clipping plane defined by normal and distance from origin (n·x = d)
type ClippingPlane = { normal: Vec3; dist: number }

// Generic reference directions for the Dirichlet-domain construction. Irrational-ish
// component ratios keep them off every rotation axis and mirror plane of crystallographic
// point groups in practice; the later directions are fallbacks in case a pathological
// Cartesian orientation pins the first onto a symmetry element.
export const IBZ_REFERENCE_DIRECTIONS: Vec3[] = [
  [1, Math.SQRT2 / 3, Math.E / 7],
  [Math.PI / 5, 1, Math.SQRT1_2 / 4],
  [Math.E / 9, Math.LN2, 1],
]

// A reference direction is valid for the Dirichlet construction iff it has a trivial
// stabilizer: no non-identity operation fixes it (R·t ≠ t for every R). Such a direction
// always exists because the fixed-point sets (rotation axes, mirror planes) have measure
// zero. Try the curated generic directions first, then deterministic pseudo-random ones,
// and throw in the (mathematically unreachable) case where none qualify — rather than
// silently using a non-generic direction, which would drop that operation's clipping
// plane and inflate the IBZ volume above V_BZ/|G|.
export function find_ibz_reference_direction(non_identity_ops: Matrix3x3[]): Vec3 {
  const has_trivial_stabilizer = (dir: Vec3): boolean =>
    non_identity_ops.every(
      (rot) => Math.hypot(...math.subtract(math.mat3x3_vec3_multiply(rot, dir), dir)) > TOL,
    )

  const curated = IBZ_REFERENCE_DIRECTIONS.find(has_trivial_stabilizer)
  if (curated) return curated

  // Park-Miller minstd PRNG (safe-integer arithmetic) keeps the rare fallback
  // reproducible across runs while sampling generic directions
  let seed = 16807
  const next_component = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed / 2147483647) * 2 - 1
  }
  for (let attempt = 0; attempt < 128; attempt++) {
    const dir: Vec3 = [next_component(), next_component(), next_component()]
    if (Math.hypot(...dir) > 0.1 && has_trivial_stabilizer(dir)) return dir
  }
  throw new Error(
    `IBZ construction: no generic reference direction found for ${non_identity_ops.length} symmetry operations`,
  )
}

// Compute clipping planes from point group operations via the Dirichlet (Voronoi)
// fundamental-domain construction: pick ONE generic direction t with trivial stabilizer,
// then for every non-identity operation R keep the half-space x·t ≥ x·(R·t), i.e.
// (R·t − t)·x ≤ 0. Intersecting all half-spaces with the BZ yields an irreducible wedge
// of exactly volume(BZ)/|G|. (Using a different reference point per operation — or
// flipping individual planes — does NOT yield a fundamental domain in general.)
export function compute_ibz_clipping_planes(point_group_ops: Matrix3x3[]): ClippingPlane[] {
  const non_identity_ops = point_group_ops.filter(
    (rot) =>
      !rot.every((row, idx) =>
        row.every((val, jdx) => Math.abs(val - (idx === jdx ? 1 : 0)) < TOL),
      ),
  )
  if (non_identity_ops.length === 0) return []

  const ref_dir = find_ibz_reference_direction(non_identity_ops)

  const planes: ClippingPlane[] = []
  const seen_normals = new Set<string>()

  for (const rot of non_identity_ops) {
    const rotated = math.mat3x3_vec3_multiply(rot, ref_dir)
    const diff: Vec3 = math.subtract(rotated, ref_dir)
    // ref_dir has a trivial stabilizer, so every op must move it; a zero diff would
    // silently drop a plane and inflate the IBZ — surface it instead
    if (Math.hypot(...diff) < TOL) {
      throw new Error(
        `IBZ construction: reference direction unexpectedly fixed by an operation`,
      )
    }

    const plane_normal = math.normalize_vec(diff, [0, 0, 0])
    // NOTE: do NOT merge antiparallel normals — n and −n select opposite half-spaces
    const key = plane_normal.map((val) => Math.round(val * 1e6)).join(`,`)
    if (!seen_normals.has(key)) {
      seen_normals.add(key)
      planes.push({ normal: plane_normal, dist: 0 })
    }
  }

  return planes
}

// Clip polyhedron vertices by a half-space, adding intersection points where edges cross
function clip_polyhedron_by_plane(
  vertices: Vec3[],
  faces: number[][],
  plane: ClippingPlane,
): Vec3[] {
  const { normal, dist } = plane
  const signed_dists = vertices.map((vertex) => math.dot(vertex, normal) - dist)

  // Keep vertices inside the half-space
  const result = vertices.filter((_, idx) => signed_dists[idx] <= TOL)

  // Build edge set from faces
  const edge_set = new Set<string>()
  for (const face of faces) {
    for (let idx = 0; idx < face.length; idx++) {
      const i1 = face[idx]
      const i2 = face[(idx + 1) % face.length]
      edge_set.add(i1 < i2 ? `${i1},${i2}` : `${i2},${i1}`)
    }
  }

  // Add intersection points where edges cross the plane
  for (const key of edge_set) {
    const [i1, i2] = key.split(`,`).map(Number)
    const d1 = signed_dists[i1]
    const d2 = signed_dists[i2]

    // Edge crosses plane if exactly one endpoint is inside the half-space
    const inside1 = d1 <= TOL
    const inside2 = d2 <= TOL
    if (inside1 !== inside2) {
      const denom = d1 - d2
      // Skip if denominator too small (tighter than TOL for numerical stability)
      if (Math.abs(denom) < 1e-12) continue
      const frac = d1 / denom
      // Only add intersection if it's not at an endpoint (which is already kept)
      if (frac > TOL && frac < 1 - TOL) {
        const [v1, v2] = [vertices[i1], vertices[i2]]
        result.push([
          v1[0] + frac * (v2[0] - v1[0]),
          v1[1] + frac * (v2[1] - v1[1]),
          v1[2] + frac * (v2[2] - v1[2]),
        ])
      }
    }
  }

  return result
}

// Try to build hull from vertices, returns null on failure
function try_build_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg: number,
): ConvexHullData | null {
  if (vertices.length < 4) return null
  try {
    return compute_convex_hull(vertices, edge_sharp_angle_deg)
  } catch {
    return null
  }
}

// Compute the irreducible Brillouin zone by clipping the full BZ with symmetry planes
export function compute_irreducible_bz(
  bz_data: BrillouinZoneData,
  point_group_ops: Matrix3x3[],
  edge_sharp_angle_deg = 5,
): IrreducibleBZData | null {
  // Convert fractional rotations to Cartesian k-space rotations
  // R_cart = Bᵀ · W^{-T} · B^{-T}, where B is k_lattice (reciprocal vectors as rows)
  const cartesian_ops = point_group_ops.map((W) =>
    fractional_to_cartesian_rotation(W, bz_data.k_lattice),
  )
  const clipping_planes = compute_ibz_clipping_planes(cartesian_ops)

  if (clipping_planes.length === 0) {
    // No symmetry (P1), IBZ = full BZ
    return {
      vertices: [...bz_data.vertices],
      faces: [...bz_data.faces],
      edges: [...bz_data.edges],
      volume: bz_data.volume,
    }
  }

  let current_vertices = [...bz_data.vertices]
  let current_faces = [...bz_data.faces]

  for (const plane of clipping_planes) {
    // Planes from the Dirichlet construction are consistently oriented (the kept side
    // n·x ≤ 0 always contains the reference direction) so clip directly — flipping a
    // plane would select the wrong half-space and break the fundamental-domain property
    const clipped = clip_polyhedron_by_plane(current_vertices, current_faces, plane)
    const hull = try_build_hull(clipped, edge_sharp_angle_deg)
    if (hull) {
      current_vertices = hull.vertices
      current_faces = hull.faces
    } else {
      console.warn(`IBZ clipping: degenerate clip result, skipping plane`)
    }
  }

  const hull = try_build_hull(current_vertices, edge_sharp_angle_deg)
  if (!hull) return null

  return {
    vertices: hull.vertices,
    faces: hull.faces,
    edges: hull.edges.map(([i1, i2]) => [hull.vertices[i1], hull.vertices[i2]]),
    volume: compute_hull_volume(hull.vertices, hull.faces),
  }
}
