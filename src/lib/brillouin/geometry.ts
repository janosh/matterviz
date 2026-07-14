import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three'

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

// Cartesian → fractional via transposed row-vector inverse; null if missing/singular
export function k_lattice_inverse(k_lattice: Matrix3x3 | undefined): Matrix3x3 | null {
  if (!k_lattice) return null
  try {
    return math.create_cart_to_frac_matrix(k_lattice)
  } catch {
    return null
  }
}

// Convert Cartesian k-coordinates to fractional (reciprocal lattice units); null if the (pre-computed) lattice inverse is unavailable
export const cartesian_to_fractional = (
  k_lattice_inv: Matrix3x3 | null,
  cart: Vec3,
): Vec3 | null => k_lattice_inv && math.mat3x3_vec3_multiply(k_lattice_inv, cart)

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

// Default camera position scaled to the scene size
export const default_camera_position = (size: number): Vec3 =>
  [10, 3, 8].map((coord) => coord * Math.max(1, size)) as Vec3
