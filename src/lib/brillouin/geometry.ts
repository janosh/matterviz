import type { Matrix3x3, Point2D, Vec3 } from '#lib/math.js'
import type { BrillouinZoneData, BZHoverData, KPathData } from './types'
import * as math from '#lib/math.js'
import { faces_centroid } from '#lib/scene/geometry.svelte.js'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'

// Build a renderable mesh from polyhedron vertices + polygonal faces via fan triangulation with flat per-face normals. Assumes convex faces (true for BZ/IBZ polyhedra); non-convex faces would triangulate incorrectly. Shared by BrillouinZoneScene (BZ + IBZ meshes) and FermiSurfaceScene (BZ overlay). Caller owns disposal.
export function polyhedron_geometry(
  vertices: Vec3[],
  faces: number[][],
): BufferGeometry | null {
  if (faces.length === 0) return null

  const positions: number[] = []
  const normals: number[] = []

  for (const face of faces) {
    if (face.length < 3) continue
    for (let face_idx = 1; face_idx < face.length - 1; face_idx++) {
      const indices = [face[0], face[face_idx], face[face_idx + 1]]
      if (indices.some((idx) => idx < 0 || idx >= vertices.length)) continue
      const [vertex_a, vertex_b, vertex_c] = indices.map((idx) => vertices[idx])
      positions.push(...vertex_a, ...vertex_b, ...vertex_c)

      const edge_ab = math.subtract(vertex_b, vertex_a)
      const edge_ac = math.subtract(vertex_c, vertex_a)
      const face_normal = math.cross_3d(edge_ab, edge_ac)
      const normal_length = Math.hypot(...face_normal)
      const unit_normal =
        normal_length > 1e-10 ? face_normal.map((coord) => coord / normal_length) : [0, 0, 0]
      normals.push(...unit_normal, ...unit_normal, ...unit_normal)
    }
  }
  // All faces degenerate or out-of-range -> no triangles, so return null instead of an empty geometry
  if (positions.length === 0) return null

  const geometry = new BufferGeometry()
  geometry.setAttribute(`position`, new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute(`normal`, new BufferAttribute(new Float32Array(normals), 3))
  geometry.computeBoundingSphere()
  return geometry
}

// Each polygon face of a polyhedron (bz_data faces may come pre-triangulated): its triangles
// in polyhedron_geometry (a pointer event's faceIndex there), the first of them and its
// centroid, e.g. where a keyboard walk hovers the face
type FaceAnchor = { centroid: Vec3; triangle: number; triangles: number[] }
export function face_anchors({
  vertices,
  faces,
}: Pick<BrillouinZoneData, `vertices` | `faces`>): FaceAnchor[] {
  const geometry = polyhedron_geometry(vertices, faces)
  if (!geometry) return []
  const anchors: FaceAnchor[] = []
  const covered = new Set<number>()
  for (let triangle = 0; triangle < geometry.getAttribute(`position`).count / 3; triangle++) {
    if (covered.has(triangle)) continue
    const triangles = polygon_triangles(geometry, triangle)
    for (const idx of triangles) covered.add(idx)
    anchors.push({ centroid: faces_centroid(geometry, triangles), triangle, triangles })
  }
  geometry.dispose()
  return anchors
}

// Triangles of the polygon face that triangle `face_idx` of a polyhedron_geometry lies in: a
// convex polyhedron has one face per outward normal, so they are the triangles sharing its
// flat normal
export function polygon_triangles(geometry: BufferGeometry, face_idx: number): number[] {
  const normals = geometry.getAttribute(`normal`)
  const normal_of = (tri_idx: number) =>
    [normals.getX(3 * tri_idx), normals.getY(3 * tri_idx), normals.getZ(3 * tri_idx)] as const
  const hovered = normal_of(face_idx)
  return Array.from({ length: normals.count / 3 }, (_, tri_idx) => tri_idx).filter((tri_idx) =>
    normal_of(tri_idx).every((coord, axis) => Math.abs(coord - hovered[axis]) < 1e-4),
  )
}

// Cartesian → fractional via transposed row-vector inverse; null if missing/singular
export function k_lattice_inverse(k_lattice: Matrix3x3 | undefined): Matrix3x3 | null {
  if (!k_lattice) return null
  try {
    return math.reciprocal_lattice(k_lattice)
  } catch {
    return null
  }
}

// Convert Cartesian k-coordinates to fractional (reciprocal lattice units); null if the (pre-computed) lattice inverse is unavailable
export const cartesian_to_fractional = (
  k_lattice_inv: Matrix3x3 | null,
  cart: Vec3,
): Vec3 | null => k_lattice_inv && math.mat3x3_vec3_multiply(k_lattice_inv, cart)

// Tooltip record for a k-point hovered on the zone, its IBZ wedge or a k-path
export function bz_hover_data(
  { order, volume }: Pick<BrillouinZoneData, `order` | `volume`>,
  k_lattice_inv: Matrix3x3 | null,
  position_cartesian: Vec3,
  screen_position: Point2D,
  { is_ibz = false, ibz_volume = null }: { is_ibz?: boolean; ibz_volume?: number | null } = {},
): BZHoverData {
  return {
    position_cartesian,
    position_fractional: cartesian_to_fractional(k_lattice_inv, position_cartesian),
    screen_position,
    is_ibz,
    bz_order: order,
    bz_volume: volume,
    ibz_volume,
    // the point group order
    symmetry_multiplicity:
      ibz_volume !== null && ibz_volume > 0 ? Math.round(volume / ibz_volume) : null,
  }
}

// Centroid of polyhedron vertices, used as orbit/rotation target by BZ + Fermi scenes
export const polyhedron_centroid = (vertices: Vec3[] | undefined): Vec3 =>
  vertices?.length
    ? math.scale(
        vertices.reduce<Vec3>((acc, vert) => math.add(acc, vert), [0, 0, 0]),
        1 / vertices.length,
      )
    : [0, 0, 0]

// Mean reciprocal-lattice vector magnitude: characteristic scene size for camera placement
// and arrow scaling. Fallback 10 (upper end of typical |b_i| ~ 2pi/a in 1/A) keeps the
// camera at a sensible distance while no data is loaded.
export const k_space_size = (k_lattice: Matrix3x3 | undefined): number =>
  k_lattice ? k_lattice.reduce((sum, vec) => sum + Math.hypot(...vec), 0) / 3 : 10

// K-path segments to draw (point pairs with the index of the first): every nonzero step inside
// a branch. Continuity comes from the band data's branches, never from step lengths: in
// anisotropic cells (c/a ≫ 1) one real segment's steps can exceed another's many times over.
export function k_path_segments({ points, labels, branches }: KPathData) {
  if (labels.length !== points.length)
    throw new Error(`k-path has ${labels.length} labels for ${points.length} points`)
  return branches.flatMap(([start, end]) => {
    const in_range = 0 <= start && start <= end && end < points.length
    if (!(in_range && Number.isInteger(start) && Number.isInteger(end)))
      throw new Error(
        `k-path branch [${start}, ${end}] is no index range into ${points.length} points`,
      )
    return points.slice(start, end).flatMap((from, offset) => {
      const [idx, to] = [start + offset, points[start + offset + 1]]
      return math.euclidean_dist(from, to) > 0 ? [{ idx, from, to }] : []
    })
  })
}

// Labeled points merged by position: paths revisit symmetry points and stacked translucent chips
// turn opaque. Labels at one spot join like the bands' `K | U` ticks; the first q-point is kept.
export function k_path_sym_points({ points, labels }: KPathData, tolerance: number) {
  const merged: { position: Vec3; labels: string[]; qpoint_idx: number }[] = []
  for (const [qpoint_idx, position] of points.entries()) {
    const label = labels[qpoint_idx]
    if (!label) continue
    const known = merged.find((sym) => math.euclidean_dist(sym.position, position) < tolerance)
    if (!known) merged.push({ position, labels: [label], qpoint_idx })
    else if (!known.labels.includes(label)) known.labels.push(label)
  }
  return merged
}

// path, hovered-segment and highlighted-stretch tints; host hover tooltips match `hover`
export const KPATH_COLORS = { base: `#ffcc00`, hover: `#ff6b35`, range: `#ff9a3c` } as const

// Line and marker sizes scale with `bz_size` so large and small (supercell) zones look alike.
// `edge_width` is a fraction of the zone's half-size ½·bz_size.
export const bz_mark_sizes = (bz_size: number, edge_width: number) => ({
  edge: edge_width * 0.5 * bz_size,
  kpath: 0.006 * bz_size,
  // invisible tube the cursor snaps to the k-path within (~6 px in a 300 px canvas)
  kpath_hover: 0.05 * bz_size,
  sym_point: 0.0075 * bz_size,
  hovered_point: 0.015 * bz_size,
})

// Every size and extent below is a reciprocal-space length in 1/A (|b| ~ 2pi/a, so 0.05 for a
// 120 A cell). A 1 1/A floor exceeded the true extent past a = 11.83 A, framing the zone
// against a constant: 39% of the viewport at 30 A, 10% at 120 A.
export const default_camera_position = (size: number): Vec3 =>
  [10, 3, 8].map((coord) => coord * (size > 0 ? size : k_space_size(undefined))) as Vec3

// Occupy at most 92% of the shorter viewport edge, matching structure_fit_frame's
// DEFAULT_FIT_PADDING (asserted equal in brillouin-compute.test.ts rather than imported, which
// would pull the element data tables into every consumer of this module).
const FIT_PADDING = 1 / 0.92

// Padded diameter of the sphere enclosing the centered parallelepiped k_latticeᵀ·[-0.5, 0.5]³,
// whose half-extent along Cartesian axis j is 0.5·Σᵢ|k_lattice[i][j]|. Marching cubes leaves
// Fermi surfaces in that cell rather than in the Wigner-Seitz zone, and for a skew lattice the
// cell reaches well outside the zone.
export const k_cell_fit_extent = (
  k_lattice: Matrix3x3 | undefined,
  padding = FIT_PADDING,
): number => {
  const half_extent = [0, 1, 2].map(
    (axis) => 0.5 * (k_lattice?.reduce((sum, row) => sum + Math.abs(row[axis]), 0) ?? 0),
  )
  const extent = 2 * Math.hypot(...half_extent) * padding
  // no lattice, or one that spans nothing: treat k_space_size's placeholder as a cubic |b|,
  // whose cell diagonal is sqrt(3)
  return extent > 0 ? extent : Math.sqrt(3) * k_space_size(undefined) * padding
}

// Padded diameter of the sphere enclosing the zone, in the same "fit to the shorter viewport
// edge" currency as structure_fit_frame, so ortho_zoom_for_extent can frame it. Falls back to
// the cell the zone is inscribed in, which for a cubic lattice is the same 92% framing the
// vertices give — so the zoom does not jump the moment the computed vertices arrive.
export const bz_fit_extent = (
  vertices: Vec3[] | undefined,
  k_lattice: Matrix3x3 | undefined,
  padding = FIT_PADDING,
): number => {
  if (!vertices?.length) return k_cell_fit_extent(k_lattice, padding)
  const center = polyhedron_centroid(vertices)
  let max_dist = 0
  for (const vert of vertices) {
    max_dist = Math.max(max_dist, math.euclidean_dist(vert, center))
  }
  // coincident vertices leave nothing to frame; the enclosing cell is the honest fallback
  return max_dist > 0 ? 2 * max_dist * padding : k_cell_fit_extent(k_lattice, padding)
}
