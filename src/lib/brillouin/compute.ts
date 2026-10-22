// Brillouin zone generation via convex hull

import { format_num } from '#lib/labels.js'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { Vector3 } from 'three/webgpu'
import { ConvexHull, type VertexNode } from 'three/examples/jsm/math/ConvexHull.js'
import type { BrillouinZoneData, ConvexHullData, IrreducibleBZData } from './types'

const TOL = 1e-8
// Three unit normals whose parallelepiped volume is below this are treated as linearly
// dependent (same scale-invariant cutoff math.matrix_inverse_3x3 applies to unit rows)
const PARALLEL_TOL = 1e-10

// Convert fractional rotation W to Cartesian k-space rotation. k_lattice stores reciprocal
// vectors as ROWS (k_cart = Bᵀ·q) and reciprocal fractional rotation is q' = W^{-T}·q, so
// R_cart = Bᵀ·W^{-T}·B^{-T}. For non-orthogonal lattices W^{-1} ≠ Wᵀ, so the transpose matters.
// Throws (via matrix_inverse_3x3) for a singular W or k_lattice: rotation matrices are
// never singular, so that always means corrupt input rather than something to paper over.
export function fractional_to_cartesian_rotation(
  rotation_matrix: Matrix3x3,
  k_lattice: Matrix3x3,
): Matrix3x3 {
  const B_T = math.transpose_3x3_matrix(k_lattice)
  const W_inv_T = math.transpose_3x3_matrix(math.matrix_inverse_3x3(rotation_matrix))
  // R_cart = Bᵀ · W^{-T} · B^{-T}, where B^{-T} is the reciprocal of B
  return math.dot(math.dot(B_T, W_inv_T), math.reciprocal_lattice(k_lattice))
}

// Bragg plane of reciprocal lattice vector G: its perpendicular bisector n·x = |G|/2
type BraggPlane = { normal: Vec3; dist: number }

// Bragg planes of the non-zero reciprocal lattice vectors G = Σᵢ nᵢ·bᵢ with |nᵢ| ≤ rangeᵢ and
// |G| ≤ max_len, nearest first; `key` is the integer index triple. To enumerate a radius
// exactly, callers pass ranges = ⌊max_len·|cᵢ|⌋ with cᵢ the dual rows (bᵢ·cⱼ = δᵢⱼ):
// nᵢ = G·cᵢ, so |nᵢ| ≤ |G|·|cᵢ| bounds the index search.
function bragg_planes(
  k_lattice: Matrix3x3,
  ranges: Vec3,
  max_len = Infinity,
): (BraggPlane & { key: string })[] {
  const [value_b_1, value_b_2, value_b_3] = k_lattice
  const planes: (BraggPlane & { key: string; len_sq: number })[] = []
  for (let count_1 = -ranges[0]; count_1 <= ranges[0]; count_1++) {
    for (let count = -ranges[1]; count <= ranges[1]; count++) {
      for (let count_3 = -ranges[2]; count_3 <= ranges[2]; count_3++) {
        if (count_1 === 0 && count === 0 && count_3 === 0) continue
        const g_vec: Vec3 = [0, 1, 2].map(
          (axis) =>
            count_1 * value_b_1[axis] + count * value_b_2[axis] + count_3 * value_b_3[axis],
        ) as Vec3
        const len_sq = g_vec[0] ** 2 + g_vec[1] ** 2 + g_vec[2] ** 2
        if (len_sq > max_len ** 2) continue
        const len = Math.hypot(...g_vec)
        const normal: Vec3 = [g_vec[0] / len, g_vec[1] / len, g_vec[2] / len]
        planes.push({ normal, dist: len / 2, key: `${count_1},${count},${count_3}`, len_sq })
      }
    }
  }
  return planes.toSorted((plane_a, plane_b) => plane_a.len_sq - plane_b.len_sq)
}

// Spatial-hash cell edge; insert()'s neighbor probe relies on it being well over 4·TOL
const DEDUP_CELL = TOL * 10

// O(1) duplicate vertex detection using spatial hashing
class VertexDeduplicator {
  private readonly grid = new Map<string, Vec3[]>()

  // Adds `vertex` unless a stored one lies within TOL per axis; returns whether it was new
  insert(vertex: Vec3): boolean {
    // A match within TOL can only sit in a neighbor cell when the vertex lies near that
    // boundary, so probe neighbors within 2·TOL of it, not all 27 cells
    const cells = vertex.map((val) => {
      const base = Math.floor(val / DEDUP_CELL)
      const offset = val - base * DEDUP_CELL
      return [base, offset < 2 * TOL ? -1 : 0, offset > DEDUP_CELL - 2 * TOL ? 1 : 0]
    })
    const [[base_x, lo_x, hi_x], [base_y, lo_y, hi_y], [base_z, lo_z, hi_z]] = cells

    for (let delta_x = lo_x; delta_x <= hi_x; delta_x++) {
      for (let delta_y = lo_y; delta_y <= hi_y; delta_y++) {
        for (let delta_z = lo_z; delta_z <= hi_z; delta_z++) {
          const neighbors = this.grid.get(
            `${base_x + delta_x},${base_y + delta_y},${base_z + delta_z}`,
          )
          if (
            neighbors?.some(
              ([vector_1, vector_2, vector_3]) =>
                Math.abs(vector_1 - vertex[0]) < TOL &&
                Math.abs(vector_2 - vertex[1]) < TOL &&
                Math.abs(vector_3 - vertex[2]) < TOL,
            )
          )
            return false
        }
      }
    }
    const key = `${base_x},${base_y},${base_z}`
    const cell = this.grid.get(key)
    if (cell) cell.push(vertex)
    else this.grid.set(key, [vertex])
    return true
  }
}

// Order-independent key of the edge between two vertex indices
const edge_key = (idx_a: number, idx_b: number): string =>
  idx_a < idx_b ? `${idx_a},${idx_b}` : `${idx_b},${idx_a}`

// Vertices of the nth-order zone: every three-plane intersection that lies beyond fewer
// than `order` Bragg planes. Cramer's rule with cached pairwise cross products,
// v = (dᵢ·nⱼ×nₖ + dⱼ·nₖ×nᵢ + dₖ·nᵢ×nⱼ) / nᵢ·(nⱼ×nₖ), keeps the O(n³) loop allocation-free.
function intersect_bragg_planes(planes: BraggPlane[], order: number): Vec3[] {
  const n_planes = planes.length
  const normals = planes.map((plane) => plane.normal)
  const distances = planes.map((plane) => plane.dist)
  // Flat [n_x, n_y, n_z, dist + TOL] rows for the beyond-count scan, the O(n⁴) hot loop:
  // indexing a typed array there runs ~2x faster than destructuring Vec3 tuples
  const beyond_rows = new Float64Array(n_planes * 4)
  for (let idx = 0; idx < n_planes; idx++) {
    beyond_rows.set(normals[idx], idx * 4)
    beyond_rows[idx * 4 + 3] = distances[idx] + TOL
  }

  // cross[(j·n + k)·3 + axis] = (nⱼ × nₖ)[axis] for j < k
  const cross = new Float64Array(n_planes * n_planes * 3)
  for (let idx_j = 0; idx_j < n_planes; idx_j++) {
    for (let idx_k = idx_j + 1; idx_k < n_planes; idx_k++) {
      const [center_x, center_y, center_z] = math.cross_3d(normals[idx_j], normals[idx_k])
      const offset = (idx_j * n_planes + idx_k) * 3
      cross[offset] = center_x
      cross[offset + 1] = center_y
      cross[offset + 2] = center_z
    }
  }

  const dedup = new VertexDeduplicator()
  const vertices: Vec3[] = []

  for (let idx_i = 0; idx_i < n_planes; idx_i++) {
    const [normal_x, normal_y, normal_z] = normals[idx_i]
    const dist_i = distances[idx_i]
    for (let idx_j = idx_i + 1; idx_j < n_planes; idx_j++) {
      const dist_j = distances[idx_j]
      const off_ij = (idx_i * n_planes + idx_j) * 3
      for (let idx_k = idx_j + 1; idx_k < n_planes; idx_k++) {
        const off_jk = (idx_j * n_planes + idx_k) * 3
        const det =
          normal_x * cross[off_jk] +
          normal_y * cross[off_jk + 1] +
          normal_z * cross[off_jk + 2]
        if (Math.abs(det) <= PARALLEL_TOL) continue // (near-)parallel normals: no unique point

        const dist_k = distances[idx_k]
        const off_ik = (idx_i * n_planes + idx_k) * 3 // nₖ × nᵢ = −(nᵢ × nₖ)
        const vector_x =
          (dist_i * cross[off_jk] - dist_j * cross[off_ik] + dist_k * cross[off_ij]) / det
        const vector_y =
          (dist_i * cross[off_jk + 1] -
            dist_j * cross[off_ik + 1] +
            dist_k * cross[off_ij + 1]) /
          det
        const vector_z =
          (dist_i * cross[off_jk + 2] -
            dist_j * cross[off_ik + 2] +
            dist_k * cross[off_ij + 2]) /
          det

        // Count how many planes this vertex is beyond (with early termination)
        let beyond_count = 0
        for (let row = 0; row < beyond_rows.length; row += 4) {
          if (
            vector_x * beyond_rows[row] +
              vector_y * beyond_rows[row + 1] +
              vector_z * beyond_rows[row + 2] >
            beyond_rows[row + 3]
          ) {
            beyond_count++
            if (beyond_count >= order) break
          }
        }
        if (beyond_count >= order) continue

        const vertex: Vec3 = [vector_x, vector_y, vector_z]
        if (dedup.insert(vertex)) vertices.push(vertex)
      }
    }
  }

  return vertices
}

// Exact first zone (Wigner-Seitz cell of the reciprocal lattice). Pass 1 uses the ±1 index
// shell: ±b₁, ±b₂, ±b₃ alone bound a parallelepiped, so it always yields a bounded cell that
// contains the true one. Its faces need not come from that shell though — a non-reduced basis
// (long, nearly parallel bᵢ) has Wigner-Seitz faces from G with |nᵢ| ≥ 2. A Bragg plane can
// only cut a cell whose farthest vertex is at radius R if |G|/2 ≤ R, so every G inside 2R is
// checked against the current vertices; the cell is exact once none of them cuts it. Planes
// that do cut are added nearest-first in small batches: a Wigner-Seitz cell has at most 14
// faces, all from short G, so a batch collapses the cell (and with it the radius-bounded
// candidate set), whereas intersecting every candidate at once is O(n³) in thousands of
// planes for a non-reduced basis.
const MAX_NEW_PLANES_PER_PASS = 32
function first_bz_vertices(k_lattice: Matrix3x3, dual: Matrix3x3): Vec3[] {
  const dual_norms = dual.map((row) => Math.hypot(...row))
  const planes = bragg_planes(k_lattice, [1, 1, 1])
  for (let pass = 0; pass < 256; pass++) {
    const vertices = intersect_bragg_planes(planes, 1)
    if (vertices.length < 4) {
      throw new Error(
        `Brillouin zone has ${vertices.length} vertices (need ≥4) for k_lattice ${JSON.stringify(k_lattice)}`,
      )
    }
    const radius = math.array_max(vertices.map((vertex) => Math.hypot(...vertex)))
    const max_len = 2 * radius * (1 + 1e-9)
    const ranges = dual_norms.map((norm) => Math.floor(max_len * norm)) as Vec3
    const have = new Set(planes.map((plane) => plane.key))
    const cutting = bragg_planes(k_lattice, ranges, max_len).filter(
      ({ key, normal, dist }) =>
        !have.has(key) && vertices.some((vertex) => math.dot(vertex, normal) > dist + TOL),
    )
    if (cutting.length === 0) return vertices
    planes.push(...cutting.slice(0, MAX_NEW_PLANES_PER_PASS))
  }
  throw new Error(
    `Brillouin zone plane set did not converge for k_lattice ${JSON.stringify(k_lattice)}`,
  )
}

// Bragg plane caps for orders 2 and 3 (order 1 is exact): the O(n³) intersection loop bounds
// the count
const MAX_PLANES_BY_ORDER = { 2: 80, 3: 150 } as const

// Generate BZ vertices for nth-order zone via three-plane intersections. Order 1 is exact for
// any lattice; orders 2 and 3 use the ±order index shell truncated to the nearest
// MAX_PLANES_BY_ORDER[order] Bragg planes.
export function generate_bz_vertices(k_lattice: Matrix3x3, order: 1 | 2 | 3 = 1): Vec3[] {
  const clamped_order = Math.min(order, 3) as typeof order
  // Vertices are Cartesian, so any basis of the same lattice gives the same zones; a
  // reduced one keeps the index shells small and meaningful
  const basis = math.reduce_basis(k_lattice)
  const dual = math.reciprocal_lattice(basis) // throws for a singular k_lattice
  if (clamped_order === 1) return first_bz_vertices(basis, dual)

  const ranges: Vec3 = [clamped_order, clamped_order, clamped_order]
  return intersect_bragg_planes(
    bragg_planes(basis, ranges).slice(0, MAX_PLANES_BY_ORDER[clamped_order]),
    clamped_order,
  )
}

// Hull with edges as vertex pairs and its volume via the divergence theorem (sum of signed
// tetrahedral volumes). Faces always come from compute_convex_hull, so each is a valid triangle.
const hull_geometry = ({ vertices, faces, edges }: ConvexHullData): IrreducibleBZData => ({
  vertices,
  faces,
  edges: edges.map(([index_1, index_2]) => [vertices[index_1], vertices[index_2]]),
  volume: Math.abs(
    faces.reduce((sum, face) => {
      const [vector_0, vector_1, vector_2] = face.slice(0, 3).map((idx) => vertices[idx])
      const area_normal = math.scale(
        math.cross_3d(math.subtract(vector_1, vector_0), math.subtract(vector_2, vector_0)),
        0.5,
      )
      return sum + math.dot(vector_0, area_normal) / 3
    }, 0),
  ),
})

// Every point on one line through the first: the longest offset from it defines the axis, and
// a point off that axis has a cross product with it proportional to its distance away
const points_are_collinear = (points: Vec3[]): boolean => {
  const [origin] = points
  const offset = (point: Vec3): Vec3 => [
    point[0] - origin[0],
    point[1] - origin[1],
    point[2] - origin[2],
  ]
  let axis: Vec3 = [0, 0, 0]
  let axis_len = 0
  for (const point of points) {
    const len = math.euclidean_dist(point, origin)
    if (len > axis_len) [axis_len, axis] = [len, offset(point)]
  }
  if (axis_len <= TOL) return true // every point coincides with the first
  return points.every(
    (point) => Math.hypot(...math.cross_3d(offset(point), axis)) <= TOL * axis_len,
  )
}

// Build convex hull from vertices and extract topology. Runs three's quickhull on the f64
// points directly (ConvexGeometry would round them through a Float32Array, costing ~1e-7
// relative in every vertex and volume) and keeps only the points that end up on the hull.
export function compute_convex_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg = 5, // Angle threshold for edge detection: edges between faces with angle > this are rendered
): ConvexHullData {
  if (vertices.length < 4) {
    throw new Error(`Need ≥4 vertices for convex hull, got ${vertices.length}`)
  }

  // Merge near-coincident inputs (IBZ clipping can produce them) before quickhull sees them
  const dedup = new VertexDeduplicator()
  const distinct = vertices.filter((vertex) => dedup.insert(vertex))

  // Rank checks belong after dedup: counting raw vertices let 4 coincident points through as a
  // silently empty hull, and 4 collinear ones through to a bare three.js TypeError from inside
  // ConvexHull ("Cannot read properties of undefined (reading 'point')"). A clip that leaves a
  // degenerate vertex set should say so, not surface as either of those.
  if (distinct.length < 4) {
    throw new Error(
      `Need ≥4 distinct vertices for convex hull, got ${distinct.length} of ${vertices.length}`,
    )
  }
  if (points_are_collinear(distinct)) {
    throw new Error(
      `Convex hull needs vertices spanning 3D, got ${distinct.length} collinear ones`,
    )
  }

  const hull = new ConvexHull().setFromPoints(distinct.map((vertex) => new Vector3(...vertex)))

  // Compact to the vertices referenced by some face, in first-seen order
  const unique_verts: Vec3[] = []
  const node_to_unique = new Map<VertexNode, number>()
  const faces: number[][] = hull.faces.map((face) => {
    const tri: number[] = []
    let half_edge = face.edge
    do {
      const node = half_edge.head()
      let unique_idx = node_to_unique.get(node)
      if (unique_idx === undefined) {
        const { x: coord_x, y: coord_y, z: coord_z } = node.point
        unique_idx = unique_verts.push([coord_x, coord_y, coord_z]) - 1
        node_to_unique.set(node, unique_idx)
      }
      tri.push(unique_idx)
      half_edge = half_edge.next
    } while (half_edge !== face.edge)
    return tri
  })

  // Compute face normals and build edge-to-face adjacency
  const face_normals = faces.map((face) => {
    const [vector_0, vector_1, vector_2] = face
      .slice(0, 3)
      .map((vertex_idx) => unique_verts[vertex_idx])
    return math.normalize_vec(
      math.cross_3d(math.subtract(vector_1, vector_0), math.subtract(vector_2, vector_0)),
      [0, 0, 0],
    )
  })

  // A point inside a hull face or edge is no corner, but quickhull keeps whichever one round-off
  // pushes outward, so one of a ±v pair could survive alone and bias the vertex centroid (fcc
  // order-2 zone: 0.29 1/A off Γ). Corners meet ≥3 face planes; re-hull those alone.
  const vertex_normals: Vec3[][] = unique_verts.map(() => [])
  faces.forEach((face, face_idx) => {
    const normal = face_normals[face_idx]
    for (const normals of face.map((vertex_idx) => vertex_normals[vertex_idx])) {
      if (!normals.some((other) => math.dot(other, normal) > 1 - 1e-9)) normals.push(normal)
    }
  })
  const corners = unique_verts.filter(
    (_, vertex_idx) => vertex_normals[vertex_idx].length >= 3,
  )
  if (corners.length >= 4 && corners.length < unique_verts.length)
    return compute_convex_hull(corners, edge_sharp_angle_deg)

  const edge_to_faces = new Map<string, number[]>()
  faces.forEach((face, face_idx) => {
    face.forEach((from_vertex_idx, idx) => {
      const key = edge_key(from_vertex_idx, face[(idx + 1) % face.length])
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

  return { vertices: unique_verts, faces, edges }
}

// Compute complete Brillouin zone with topology and volume. Order 1 is the exact Wigner-Seitz
// cell; orders 2 and 3 return the convex hull of zones 1..n (the union itself is not convex),
// so their `volume` is that hull's volume rather than n·V₁.
export function compute_brillouin_zone(
  k_lattice: Matrix3x3,
  order: 1 | 2 | 3 = 1,
): BrillouinZoneData {
  if (k_lattice.some((row) => row.some((val) => !Number.isFinite(val)))) {
    throw new Error(`Reciprocal lattice has non-finite entries: ${JSON.stringify(k_lattice)}`)
  }
  // too few vertices throw in first_bz_vertices (order 1) or compute_convex_hull
  return {
    order: Math.min(order, 3),
    ...hull_geometry(compute_convex_hull(generate_bz_vertices(k_lattice, order))),
    k_lattice,
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

  const edge_set = new Set<string>()
  for (const face of faces) {
    for (const [idx, vertex_idx] of face.entries()) {
      edge_set.add(edge_key(vertex_idx, face[(idx + 1) % face.length]))
    }
  }

  // Add intersection points where edges cross the plane
  for (const key of edge_set) {
    const [index_1, index_2] = key.split(`,`).map(Number)
    const distance_1 = signed_dists[index_1]
    const distance_2 = signed_dists[index_2]

    // Edge crosses plane if exactly one endpoint is inside the half-space
    const inside1 = distance_1 <= TOL
    const inside2 = distance_2 <= TOL
    if (inside1 !== inside2) {
      const denom = distance_1 - distance_2
      // Skip if denominator too small (tighter than TOL for numerical stability)
      if (Math.abs(denom) < 1e-12) continue
      const frac = distance_1 / denom
      // Only add intersection if it's not at an endpoint (which is already kept)
      if (frac > TOL && frac < 1 - TOL) {
        result.push(math.lerp_vec3(vertices[index_1], vertices[index_2], frac))
      }
    }
  }

  return result
}

// Compute the irreducible Brillouin zone by clipping the full BZ with symmetry planes.
// time_reversal (default on): E(k) = E(−k) without magnetic order, so the k-space symmetry is
// the Laue group (point group plus inversion), as VASP/QE k-point reduction and standard
// band paths assume. Pass false for magnetically ordered systems (spin-orbit coupling alone
// keeps time reversal: Kramers pairs still give E(k) = E(−k)).
export function compute_irreducible_bz(
  bz_data: BrillouinZoneData,
  point_group_ops: Matrix3x3[],
  { time_reversal = true } = {},
): IrreducibleBZData {
  const ops = time_reversal
    ? [
        ...point_group_ops,
        ...point_group_ops.map((rot) => rot.map((row) => row.map((val) => -val)) as Matrix3x3),
      ]
    : point_group_ops
  // Duplicates (−R already in a centrosymmetric group) collapse onto one plane below
  const cartesian_ops = ops.map((rotation_matrix) =>
    fractional_to_cartesian_rotation(rotation_matrix, bz_data.k_lattice),
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
    // Fewer than 4 vertices (or a degenerate hull) means the plane did not cut the polyhedron
    // the way a symmetry plane must; skipping it would yield a wrong IBZ volume and
    // multiplicity, so this throws instead
    if (clipped.length < 4) {
      throw new Error(
        `IBZ clipping by plane n=[${plane.normal.map((val) => format_num(val)).join(`, `)}] left ${clipped.length} vertices (need ≥ 4 for a polyhedron)`,
      )
    }
    const hull = compute_convex_hull(clipped)
    current_vertices = hull.vertices
    current_faces = hull.faces
  }

  return hull_geometry(compute_convex_hull(current_vertices))
}
