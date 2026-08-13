import type { Vec3 } from '$lib/math'
import type { BondOrder, BondPair } from '$lib/structure'
import type { TypedArray } from 'three/webgpu'

const instance_count_for_order = (order: BondOrder | undefined): number =>
  order === 3 ? 3 : order === 2 || order === 1.5 || order === `aromatic` ? 2 : 1

export function count_bond_instances(bonds: readonly BondPair[]): number {
  let count = 0
  for (const { bond_order } of bonds) count += instance_count_for_order(bond_order)
  return count
}

const RADIAL_MATRIX_COMPONENTS = [0, 1, 2, 8, 9, 10] as const

// Write one Y-up unit-cylinder transform directly into an InstancedMesh matrix buffer.
// Keeping the renderer transform out of BondPair means topology-only consumers no longer
// allocate or calculate 16 floats per bond.
export function write_bond_transform(
  matrix_buffer: TypedArray,
  instance_idx: number,
  pos_1: Vec3,
  pos_2: Vec3,
): void {
  const matrix_offset = instance_idx * 16
  const dx = pos_2[0] - pos_1[0]
  const dy = pos_2[1] - pos_1[1]
  const dz = pos_2[2] - pos_1[2]
  // sqrt is much faster than hypot here; overflow would require coordinates above ~1e154.
  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- see above
  const height = Math.sqrt(dx * dx + dy * dy + dz * dz)

  // The mesh buffer is persistent, so every slot must be reset before sparse matrix writes.
  matrix_buffer.fill(0, matrix_offset, matrix_offset + 16)
  matrix_buffer[matrix_offset + 15] = 1
  if (height < 1e-10) {
    matrix_buffer[matrix_offset] = 1
    matrix_buffer[matrix_offset + 5] = 1
    matrix_buffer[matrix_offset + 10] = 1
    return
  }

  const dir_x = dx / height
  const dir_y = dy / height
  const dir_z = dz / height
  let right_x = 1
  let right_z = 0
  let up_x = 0
  let up_y = 0
  let up_z = 1
  if (Math.abs(dir_y - 1) >= 1e-10 && Math.abs(dir_y + 1) >= 1e-10) {
    const right_raw_x = -dir_z
    const right_raw_z = dir_x
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- see above
    const right_length = Math.sqrt(right_raw_x * right_raw_x + right_raw_z * right_raw_z)
    right_x = right_raw_x / right_length
    right_z = right_raw_z / right_length
    up_x = dir_y * right_z
    up_y = dir_z * right_x - dir_x * right_z
    up_z = -dir_y * right_x
  }

  // Column-major Three.js matrix: right, direction * length, up, midpoint translation.
  matrix_buffer[matrix_offset] = right_x
  matrix_buffer[matrix_offset + 2] = right_z
  matrix_buffer[matrix_offset + 4] = dir_x * height
  matrix_buffer[matrix_offset + 5] = dir_y * height
  matrix_buffer[matrix_offset + 6] = dir_z * height
  matrix_buffer[matrix_offset + 8] = up_x
  matrix_buffer[matrix_offset + 9] = up_y
  matrix_buffer[matrix_offset + 10] = up_z
  matrix_buffer[matrix_offset + 12] = (pos_1[0] + pos_2[0]) / 2
  matrix_buffer[matrix_offset + 13] = (pos_1[1] + pos_2[1]) / 2
  matrix_buffer[matrix_offset + 14] = (pos_1[2] + pos_2[2]) / 2
}

const scale_and_offset_matrix = (
  matrix_buffer: TypedArray,
  instance_idx: number,
  offset: number,
  radius_scale: number,
): void => {
  const matrix_offset = instance_idx * 16
  for (const component_idx of RADIAL_MATRIX_COMPONENTS) {
    matrix_buffer[matrix_offset + component_idx] *= radius_scale
  }

  const right_length =
    Math.hypot(
      matrix_buffer[matrix_offset],
      matrix_buffer[matrix_offset + 1],
      matrix_buffer[matrix_offset + 2],
    ) || 1
  matrix_buffer[matrix_offset + 12] += (matrix_buffer[matrix_offset] / right_length) * offset
  matrix_buffer[matrix_offset + 13] +=
    (matrix_buffer[matrix_offset + 1] / right_length) * offset
  matrix_buffer[matrix_offset + 14] +=
    (matrix_buffer[matrix_offset + 2] / right_length) * offset
}

const copy_matrix = (
  matrix_buffer: TypedArray,
  source_idx: number,
  target_idx: number,
): void => {
  const source_offset = source_idx * 16
  matrix_buffer.copyWithin(target_idx * 16, source_offset, source_offset + 16)
}

// Pack every rendered cylinder into the persistent GPU-facing matrix buffer. Multiple bond
// orders copy one base transform inside that buffer, avoiding per-cylinder arrays and objects.
export function write_bond_instance_matrices(
  matrix_buffer: TypedArray,
  bonds: readonly BondPair[],
  bond_thickness: number,
): number {
  const required_count = count_bond_instances(bonds)
  if (matrix_buffer.length < required_count * 16) {
    throw new RangeError(
      `Bond matrix buffer has ${matrix_buffer.length} floats, needs ${required_count * 16}`,
    )
  }

  let instance_idx = 0
  const gap = bond_thickness * 1.8
  for (const { pos_1, pos_2, bond_order } of bonds) {
    write_bond_transform(matrix_buffer, instance_idx, pos_1, pos_2)
    const instance_count = instance_count_for_order(bond_order)
    for (let copy_idx = 1; copy_idx < instance_count; copy_idx++) {
      copy_matrix(matrix_buffer, instance_idx, instance_idx + copy_idx)
    }

    if (bond_order === 2) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap / 2, 0.65)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, gap / 2, 0.65)
    } else if (bond_order === 3) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap, 0.55)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, 0, 0.55)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 2, gap, 0.55)
    } else if (bond_order === 1.5 || bond_order === `aromatic`) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap / 2, 0.75)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, gap / 2, 0.4)
    }
    instance_idx += instance_count
  }
  return instance_idx
}

export const get_bond_instance_count = (bond: BondPair): number =>
  instance_count_for_order(bond.bond_order)
