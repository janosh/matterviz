import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { BufferAttribute, BufferGeometry } from 'three'

// Build a renderable mesh from polyhedron vertices + polygonal faces via fan
// triangulation with flat per-face normals. Shared by BrillouinZoneScene (BZ + IBZ
// meshes) and FermiSurfaceScene (BZ overlay). Caller owns disposal.
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
      const [v0, v1, v2] = indices.map((idx) => vertices[idx])
      positions.push(...v0, ...v1, ...v2)

      const e1: Vec3 = math.subtract(v1, v0)
      const e2: Vec3 = math.subtract(v2, v0)
      const normal_vec = math.cross_3d(e1, e2)
      const len = Math.hypot(...normal_vec)
      const norm = len > 1e-10 ? normal_vec.map((coord) => coord / len) : [0, 0, 0]
      normals.push(...norm, ...norm, ...norm)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute(`position`, new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute(`normal`, new BufferAttribute(new Float32Array(normals), 3))
  geometry.computeBoundingSphere()
  return geometry
}

// Inverse of the reciprocal lattice for Cartesian -> fractional conversion.
// Returns null if the lattice is missing or singular.
export function k_lattice_inverse(k_lattice: Matrix3x3 | undefined): Matrix3x3 | null {
  if (!k_lattice) return null
  try {
    return math.matrix_inverse_3x3(k_lattice)
  } catch {
    return null
  }
}

// Convert Cartesian k-coordinates to fractional (reciprocal lattice units).
// Returns null if the (pre-computed) lattice inverse is unavailable.
export const cartesian_to_fractional = (
  k_lattice_inv: Matrix3x3 | null,
  cart: Vec3,
): Vec3 | null => k_lattice_inv && math.mat3x3_vec3_multiply(k_lattice_inv, cart)
