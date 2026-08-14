// Three.js orientation helpers shared by 3D components (Arrow, Cylinder, Lattice,
// SymmetryElements). Kept out of $lib/math, which is pure TS with no three.js dependency.
import { add, EPS, scale, subtract, type Vec3 } from '$lib/math'
import { Euler, Quaternion, Vector3 } from 'three/webgpu'

const UP = new Vector3(0, 1, 0)

// Quaternion rotating the +Y axis onto `direction` (zero-length → identity). Cylinder and
// cone geometries run along +Y, so this orients them toward an arbitrary direction.
export function quaternion_from_direction(direction: Vec3): Quaternion {
  const vec = new Vector3(...direction)
  if (vec.lengthSq() < EPS * EPS) return new Quaternion() // ~zero length → no rotation
  return new Quaternion().setFromUnitVectors(UP, vec.normalize())
}

// Same orientation as an Euler rotation tuple, for Threlte `rotation` props
export function rotation_from_direction(direction: Vec3): Vec3 {
  const { x, y, z } = new Euler().setFromQuaternion(quaternion_from_direction(direction))
  return [x, y, z]
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
    vector_length === 0
      ? 0
      : arrow_head_length < 0
        ? vector_length * -arrow_head_length
        : arrow_head_length
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
