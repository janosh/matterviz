// Brillouin zone generation via convex hull

import { format_num } from '$lib/labels'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { mat3_from_flat_col_major } from '$lib/symmetry/symmetry-elements'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { Vector3 } from 'three/webgpu'
import { ConvexHull, type VertexNode } from 'three/examples/jsm/math/ConvexHull.js'
import type { BrillouinZoneData, ConvexHullData, IrreducibleBZData } from './types'

const TOL = 1e-8
// Three unit normals whose parallelepiped volume is below this are treated as linearly
// dependent (same scale-invariant cutoff math.matrix_inverse_3x3 applies to unit rows)
const PARALLEL_TOL = 1e-10

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

    unique_rotations.push(mat3_from_flat_col_major(rotation))
  }

  return unique_rotations
}

// Convert fractional rotation W to Cartesian k-space rotation. k_lattice stores reciprocal
// vectors as ROWS (k_cart = Bᵀ·q) and reciprocal fractional rotation is q' = W^{-T}·q, so
// R_cart = Bᵀ·W^{-T}·B^{-T}. For non-orthogonal lattices W^{-1} ≠ Wᵀ, so the transpose matters.
// Throws (via matrix_inverse_3x3) for a singular W or k_lattice: rotation matrices are
// never singular, so that always means corrupt input rather than something to paper over.
export function fractional_to_cartesian_rotation(
  W: Matrix3x3,
  k_lattice: Matrix3x3,
): Matrix3x3 {
  const B_T = math.transpose_3x3_matrix(k_lattice)
  const W_inv_T = math.transpose_3x3_matrix(math.matrix_inverse_3x3(W))
  // R_cart = Bᵀ · W^{-T} · B^{-T}
  return math.dot(math.dot(B_T, W_inv_T), math.matrix_inverse_3x3(B_T))
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
  const [b1, b2, b3] = k_lattice
  const planes: (BraggPlane & { key: string; len_sq: number })[] = []
  for (let n1 = -ranges[0]; n1 <= ranges[0]; n1++) {
    for (let n2 = -ranges[1]; n2 <= ranges[1]; n2++) {
      for (let n3 = -ranges[2]; n3 <= ranges[2]; n3++) {
        if (n1 === 0 && n2 === 0 && n3 === 0) continue
        const g_vec: Vec3 = [0, 1, 2].map(
          (axis) => n1 * b1[axis] + n2 * b2[axis] + n3 * b3[axis],
        ) as Vec3
        const len_sq = g_vec[0] ** 2 + g_vec[1] ** 2 + g_vec[2] ** 2
        if (len_sq > max_len ** 2) continue
        const len = Math.hypot(...g_vec)
        const normal: Vec3 = [g_vec[0] / len, g_vec[1] / len, g_vec[2] / len]
        planes.push({ normal, dist: len / 2, key: `${n1},${n2},${n3}`, len_sq })
      }
    }
  }
  return planes.toSorted((plane_a, plane_b) => plane_a.len_sq - plane_b.len_sq)
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

// Vertices of the nth-order zone: every three-plane intersection that lies beyond fewer
// than `order` Bragg planes. Cramer's rule with cached pairwise cross products,
// v = (dᵢ·nⱼ×nₖ + dⱼ·nₖ×nᵢ + dₖ·nᵢ×nⱼ) / nᵢ·(nⱼ×nₖ), keeps the O(n³) loop allocation-free.
function intersect_bragg_planes(planes: BraggPlane[], order: number): Vec3[] {
  const n_planes = planes.length
  const normals = planes.map((plane) => plane.normal)
  const distances = planes.map((plane) => plane.dist)

  // cross[(j·n + k)·3 + axis] = (nⱼ × nₖ)[axis] for j < k
  const cross = new Float64Array(n_planes * n_planes * 3)
  for (let idx_j = 0; idx_j < n_planes; idx_j++) {
    for (let idx_k = idx_j + 1; idx_k < n_planes; idx_k++) {
      const [cx, cy, cz] = math.cross_3d(normals[idx_j], normals[idx_k])
      const offset = (idx_j * n_planes + idx_k) * 3
      cross[offset] = cx
      cross[offset + 1] = cy
      cross[offset + 2] = cz
    }
  }

  const dedup = new VertexDeduplicator(TOL * 10)
  const vertices: Vec3[] = []

  for (let idx_i = 0; idx_i < n_planes; idx_i++) {
    const [nx, ny, nz] = normals[idx_i]
    const dist_i = distances[idx_i]
    for (let idx_j = idx_i + 1; idx_j < n_planes; idx_j++) {
      const dist_j = distances[idx_j]
      const off_ij = (idx_i * n_planes + idx_j) * 3
      for (let idx_k = idx_j + 1; idx_k < n_planes; idx_k++) {
        const off_jk = (idx_j * n_planes + idx_k) * 3
        const det = nx * cross[off_jk] + ny * cross[off_jk + 1] + nz * cross[off_jk + 2]
        if (Math.abs(det) <= PARALLEL_TOL) continue // (near-)parallel normals: no unique point

        const dist_k = distances[idx_k]
        const off_ik = (idx_i * n_planes + idx_k) * 3 // nₖ × nᵢ = −(nᵢ × nₖ)
        const vx =
          (dist_i * cross[off_jk] - dist_j * cross[off_ik] + dist_k * cross[off_ij]) / det
        const vy =
          (dist_i * cross[off_jk + 1] -
            dist_j * cross[off_ik + 1] +
            dist_k * cross[off_ij + 1]) /
          det
        const vz =
          (dist_i * cross[off_jk + 2] -
            dist_j * cross[off_ik + 2] +
            dist_k * cross[off_ij + 2]) /
          det

        // Count how many planes this vertex is beyond (with early termination)
        let beyond_count = 0
        for (let p_idx = 0; p_idx < n_planes; p_idx++) {
          const [px, py, pz] = normals[p_idx]
          if (vx * px + vy * py + vz * pz > distances[p_idx] + TOL) {
            beyond_count++
            if (beyond_count >= order) break
          }
        }
        if (beyond_count >= order) continue

        const vertex: Vec3 = [vx, vy, vz]
        if (!dedup.has_duplicate(vertex)) {
          vertices.push(vertex)
          dedup.add(vertex)
        }
      }
    }
  }

  return vertices
}

// Pairwise (Lagrange–Gauss) size reduction of a lattice basis: subtract the nearest integer
// multiple of one vector from another while that shortens it. Every step is unimodular, so
// the lattice (and its Wigner-Seitz cell) is unchanged, but the ±1 index shell of the result
// bounds a cell close to the true one. Without it a sheared basis (e.g. the reciprocal of a
// [[1,0,0],[s,1,0],[0,0,1]] supercell) starts from a sliver of radius ~s², and the radius-bounded
// G enumeration below grows as s⁴ (47 s at s = 3, out of memory by s = 30). Also used by
// lattice_point_group_matrices, whose {-1,0,1} integer-matrix search assumes a reduced basis.
export function reduce_basis(basis: Matrix3x3): Matrix3x3 {
  const reduced = basis.map((row) => [...row]) as Matrix3x3
  for (let iter = 0; iter < 64; iter++) {
    let changed = false
    for (let idx_i = 0; idx_i < 3; idx_i++) {
      for (let idx_j = 0; idx_j < 3; idx_j++) {
        if (idx_i === idx_j) continue
        const len_sq_j = math.dot(reduced[idx_j], reduced[idx_j])
        const coeff = Math.round(math.dot(reduced[idx_i], reduced[idx_j]) / len_sq_j)
        if (coeff === 0) continue
        const candidate = math.subtract(reduced[idx_i], math.scale(reduced[idx_j], coeff))
        const len_sq_i = math.dot(reduced[idx_i], reduced[idx_i])
        if (math.dot(candidate, candidate) < len_sq_i * (1 - 1e-12)) {
          reduced[idx_i] = candidate
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return reduced
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

// Generate BZ vertices for nth-order zone via three-plane intersections. Order 1 is exact for
// any lattice; orders 2 and 3 use the ±order index shell truncated to the nearest
// `max_planes_by_order[order]` Bragg planes (the O(n³) intersection loop bounds the count).
export function generate_bz_vertices(
  k_lattice: Matrix3x3,
  order: 1 | 2 | 3 = 1,
  max_planes_by_order: Record<number, number> = { 2: 80, 3: 150 },
): Vec3[] {
  const clamped_order = Math.min(order, 3) as typeof order
  // Vertices are Cartesian, so any basis of the same lattice gives the same zones; a
  // reduced one keeps the index shells small and meaningful
  const basis = reduce_basis(k_lattice)
  const dual = math.reciprocal_lattice(basis) // throws for a singular k_lattice
  if (clamped_order === 1) return first_bz_vertices(basis, dual)

  const max_planes = max_planes_by_order[clamped_order] ?? 150
  const ranges: Vec3 = [clamped_order, clamped_order, clamped_order]
  return intersect_bragg_planes(
    bragg_planes(basis, ranges).slice(0, max_planes),
    clamped_order,
  )
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

// Build convex hull from vertices and extract topology. Runs three's quickhull on the f64
// points directly (ConvexGeometry would round them through a Float32Array, costing ~1e-7
// relative in every vertex and volume) and keeps only the points that end up on the hull.
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

export function compute_convex_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg = 5, // Angle threshold for edge detection: edges between faces with angle > this are rendered
): ConvexHullData {
  if (vertices.length < 4) {
    throw new Error(`Need ≥4 vertices for convex hull, got ${vertices.length}`)
  }

  // Merge near-coincident inputs (IBZ clipping can produce them) before quickhull sees them
  const dedup = new VertexDeduplicator(TOL * 10)
  const distinct: Vec3[] = []
  for (const vertex of vertices) {
    if (dedup.has_duplicate(vertex)) continue
    dedup.add(vertex)
    distinct.push(vertex)
  }

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
        const { x, y, z } = node.point
        unique_idx = unique_verts.push([x, y, z]) - 1
        node_to_unique.set(node, unique_idx)
      }
      tri.push(unique_idx)
      half_edge = half_edge.next
    } while (half_edge !== face.edge)
    return tri
  })

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

  return { vertices: unique_verts, faces, edges }
}

// Compute complete Brillouin zone with topology and volume. Order 1 is the exact Wigner-Seitz
// cell; orders 2 and 3 return the convex hull of zones 1..n (the union itself is not convex),
// so their `volume` is that hull's volume rather than n·V₁.
export function compute_brillouin_zone(
  k_lattice: Matrix3x3,
  order: 1 | 2 | 3 = 1,
  edge_sharp_angle_deg = 5, // Angle threshold for edge extraction (default 5°, increase for fewer edges, decrease for more)
  max_planes_by_order: Record<number, number> = { 2: 80, 3: 150 }, // Bragg plane caps for orders 2 and 3 (order 1 is exact)
): BrillouinZoneData {
  if (k_lattice.some((row) => row.some((val) => !Number.isFinite(val)))) {
    throw new Error(`Reciprocal lattice has non-finite entries: ${JSON.stringify(k_lattice)}`)
  }
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
        result.push(math.lerp_vec3(vertices[i1], vertices[i2], frac))
      }
    }
  }

  return result
}

// Hull of a clipped vertex set. Fewer than 4 vertices (or a degenerate hull) means the clip
// plane did not cut the polyhedron the way a symmetry plane must; a skipped plane would
// yield a wrong IBZ volume and multiplicity, so this throws instead.
function clipped_hull(
  vertices: Vec3[],
  edge_sharp_angle_deg: number,
  plane: ClippingPlane,
): ConvexHullData {
  if (vertices.length < 4) {
    throw new Error(
      `IBZ clipping by plane n=[${plane.normal.map((val) => format_num(val)).join(`, `)}] left ${vertices.length} vertices (need ≥ 4 for a polyhedron)`,
    )
  }
  return compute_convex_hull(vertices, edge_sharp_angle_deg)
}

// Compute the irreducible Brillouin zone by clipping the full BZ with symmetry planes
export function compute_irreducible_bz(
  bz_data: BrillouinZoneData,
  point_group_ops: Matrix3x3[],
  edge_sharp_angle_deg = 5,
): IrreducibleBZData {
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
    const hull = clipped_hull(clipped, edge_sharp_angle_deg, plane)
    current_vertices = hull.vertices
    current_faces = hull.faces
  }

  const hull = compute_convex_hull(current_vertices, edge_sharp_angle_deg)

  return {
    vertices: hull.vertices,
    faces: hull.faces,
    edges: hull.edges.map(([i1, i2]) => [hull.vertices[i1], hull.vertices[i2]]),
    volume: compute_hull_volume(hull.vertices, hull.faces),
  }
}
