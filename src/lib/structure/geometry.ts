// Three.js orientation helpers shared by 3D components (Arrow, Cylinder, Lattice,
// SymmetryElements). Kept out of #lib/math, which is pure TS with no three.js dependency.
import { add, EPS, type Matrix3x3, scale, subtract, type Vec3 } from '#lib/math.js'
import { DEFAULTS } from '#lib/settings.js'
import { resolve_arrow_size } from './vectors'
import { Euler, Quaternion, Vector3 } from 'three/webgpu'

const UP_VECTOR = new Vector3(0, 1, 0)

// Start of the lattice-vector arrows, √3 Å along -(a+b+c): all-negative fractional
// coordinates keep it and its a/b/c arrows outside the cell whatever the vectors' signs
export function cell_vector_origin(matrix: Matrix3x3): Vec3 {
  const diagonal = add(...matrix)
  const length = Math.hypot(...diagonal)
  return length < EPS ? [0, 0, 0] : scale(diagonal, -Math.sqrt(3) / length) // a+b+c = 0 only for a degenerate cell
}

// Absolute shaft/head sizes shared by all three lattice-vector arrows, taken from the
// shortest scaled vector. Per-arrow relative sizes would make a long axis (e.g. a slab's
// vacuum direction) proportionally fatter instead of just longer.
export function cell_vector_arrow_sizes(matrix: Matrix3x3 | undefined, vector_scale: number) {
  const ref_len = matrix
    ? vector_scale * Math.min(...matrix.map((vec) => Math.hypot(...vec)))
    : 0
  const { vector_shaft_radius, vector_arrow_head_radius, vector_arrow_head_length } =
    DEFAULTS.structure
  return {
    shaft_radius: resolve_arrow_size(vector_shaft_radius, ref_len),
    arrow_head_radius: resolve_arrow_size(vector_arrow_head_radius, ref_len),
    arrow_head_length: resolve_arrow_size(vector_arrow_head_length, ref_len),
  }
}

// Quaternion rotating the +Y axis onto `direction` (zero-length → identity). Cylinder and
// cone geometries run along +Y, so this orients them toward an arbitrary direction.
export function quaternion_from_direction(direction: Vec3): Quaternion {
  const vec = new Vector3(...direction)
  if (vec.lengthSq() < EPS * EPS) return new Quaternion() // ~zero length → no rotation
  return new Quaternion().setFromUnitVectors(UP_VECTOR, vec.normalize())
}

// Same orientation as an Euler rotation tuple, for Threlte `rotation` props
export function rotation_from_direction(direction: Vec3): Vec3 {
  const {
    x: coord_x,
    y: coord_y,
    z: coord_z,
  } = new Euler().setFromQuaternion(quaternion_from_direction(direction))
  return [coord_x, coord_y, coord_z]
}

export function arrow_axis_geometry(
  vector: Vec3,
  vector_scale: number,
  arrow_head_length: number,
) {
  const scaled_length = Math.hypot(...vector) * vector_scale
  const vector_length =
    Number.isFinite(scaled_length) && scaled_length > EPS ? scaled_length : 0
  const head_length =
    vector_length === 0 ? 0 : resolve_arrow_size(arrow_head_length, vector_length)
  const shaft_length = Math.max(0, vector_length - head_length * 0.5)
  const rotation: Vec3 = vector_length === 0 ? [0, 0, 0] : rotation_from_direction(vector)
  return {
    head_length,
    shaft_length,
    shaft_center: shaft_length * 0.5,
    head_center: shaft_length + head_length * 0.5,
    rotation,
  }
}

// Transform placing a +Y-aligned cylinder so it spans start→end: midpoint position,
// orientation, and length (coincident points → length 0, identity rotation).
export function cylinder_between(
  start: Vec3,
  end: Vec3,
): { position: Vec3; rotation: Vec3; length: number } {
  const delta = subtract(end, start)
  const position = add(start, scale(delta, 0.5))
  const rotation = rotation_from_direction(delta)
  const length = Math.hypot(...delta)
  return { position, rotation, length }
}
