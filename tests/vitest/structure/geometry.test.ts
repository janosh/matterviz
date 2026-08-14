import type { Vec3 } from '$lib/math'
import type { BondOrder, BondPair } from '$lib/structure'
import {
  count_bond_instances,
  write_bond_instance_matrices,
  write_bond_transform,
} from '$lib/structure/bond-rendering'
import {
  arrow_axis_geometry,
  cylinder_between,
  quaternion_from_direction,
  rotation_from_direction,
} from '$lib/structure/geometry'
import { Euler, Matrix4, Vector3 } from 'three/webgpu'
import { describe, expect, test } from 'vitest'

describe(`quaternion_from_direction`, () => {
  test.each([
    [`+Y axis`, [0, 1, 0]],
    [`zero-length → identity`, [0, 0, 0]],
    [`non-unit +Y → normalized to identity`, [0, 5, 0]],
  ] as [string, Vec3][])(`%s`, (_desc, dir) => {
    const quat = quaternion_from_direction(dir)
    expect([quat.x, quat.y, quat.z, quat.w]).toEqual([0, 0, 0, 1])
  })

  test.each([[[1, 0, 0]], [[0, 0, 1]], [[1, 1, 1]], [[-2, 3, -1]]] as [Vec3][])(
    `rotates +Y onto the (normalized) direction %j`,
    (dir) => {
      const rotated = new Vector3(0, 1, 0).applyQuaternion(quaternion_from_direction(dir))
      expect(rotated.distanceTo(new Vector3(...dir).normalize())).toBeCloseTo(0, 10)
    },
  )
})

describe(`rotation_from_direction`, () => {
  test.each([
    [`+Y`, [0, 1, 0]],
    [`zero-length`, [0, 0, 0]],
  ] as [string, Vec3][])(`%s → no rotation`, (_desc, dir) => {
    rotation_from_direction(dir).forEach((val) => expect(val).toBeCloseTo(0, 12))
  })

  test(`euler aligns a +Y vector with the direction`, () => {
    const dir: Vec3 = [1, 2, -2]
    const aligned = new Vector3(0, 1, 0).applyEuler(new Euler(...rotation_from_direction(dir)))
    expect(aligned.distanceTo(new Vector3(...dir).normalize())).toBeCloseTo(0, 10)
  })
})

test.each([
  [[1, 1, 1], 0.5, 0.8],
  [[0, 3, 4], 2, -0.1],
] as [Vec3, number, number][])(
  `arrow shaft and head meet for vector $0`,
  (vector, scale, arrow_head_length) => {
    const { head_center, head_length, shaft_length } = arrow_axis_geometry(
      vector,
      scale,
      arrow_head_length,
    )
    expect(head_center - head_length * 0.5).toBe(shaft_length)
  },
)

test.each([
  [`zero vector`, [0, 0, 0], 1],
  [`zero scale`, [1, 2, 3], 0],
  [`non-finite vector`, [Number.NaN, 0, 0], 1],
  [`non-finite scale`, [1, 2, 3], Number.NaN],
] as [string, Vec3, number][])(`collapses arrow geometry for %s`, (_name, vector, scale) => {
  expect(arrow_axis_geometry(vector, scale, 0.8)).toEqual({
    head_length: 0,
    shaft_length: 0,
    shaft_center: 0,
    head_center: 0,
    rotation: [0, 0, 0],
  })
})

describe(`cylinder_between`, () => {
  test.each([
    [[0, 0, 0], [0, 4, 0], [0, 2, 0], 4],
    [[0, 0, 0], [3, 4, 0], [1.5, 2, 0], 5], // 3-4-5 triangle
    [[1, 2, 3], [1, 2, 3], [1, 2, 3], 0], // coincident → zero length
  ] as [Vec3, Vec3, Vec3, number][])(
    `%j → %j: midpoint %j, length %d`,
    (from, to, mid, len) => {
      const { position, rotation, length } = cylinder_between(from, to)
      position.forEach((val, idx) => expect(val).toBeCloseTo(mid[idx], 10))
      expect(length).toBeCloseTo(len, 10)
      const half = new Vector3(0, length / 2, 0).applyEuler(new Euler(...rotation))
      const center = new Vector3(...position)
      expect(
        center
          .clone()
          .sub(half)
          .distanceTo(new Vector3(...from)),
      ).toBeCloseTo(0, 10)
      expect(
        center
          .clone()
          .add(half)
          .distanceTo(new Vector3(...to)),
      ).toBeCloseTo(0, 10)
    },
  )

  test(`coincident endpoints yield identity rotation (no NaN)`, () => {
    cylinder_between([1, 2, 3], [1, 2, 3]).rotation.forEach((val) =>
      expect(val).toBeCloseTo(0, 12),
    )
  })
})

// The direct buffer writer is a separate, three.js-object-free "+Y → direction"
// implementation for the instanced-bond hot loop. Guard against convention drift.
describe(`write_bond_transform vs quaternion_from_direction`, () => {
  test(`collapses coincident bonds at their shared position`, () => {
    const matrix_buffer = new Float32Array(16)
    write_bond_transform(matrix_buffer, 0, [1, 2, 3], [1, 2, 3])
    expect(Array.from(matrix_buffer)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
  })

  test.each([
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
    ], // +Y special case
    [
      [0, 0, 0],
      [0, -1, 0],
    ], // -Y special case
    [
      [1, 1, 1],
      [2, 3, -1],
    ],
    [
      [-2, 0, 3],
      [-5, -4, 1],
    ],
  ] as [Vec3, Vec3][])(`orients +Y identically for %j → %j`, (start, end) => {
    // image of +Y under the bond transform (transformDirection strips translation + scale)
    const matrix_buffer = new Float32Array(16)
    write_bond_transform(matrix_buffer, 0, start, end)
    const mat = new Matrix4().fromArray(matrix_buffer)
    const bond_dir = new Vector3(0, 1, 0).transformDirection(mat)
    const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
    const helper_dir = new Vector3(0, 1, 0).applyQuaternion(quaternion_from_direction(delta))
    expect(bond_dir.distanceTo(helper_dir)).toBeCloseTo(0, 10)
  })

  test.each([
    { order: undefined, expected_count: 1 },
    { order: 1 as const, expected_count: 1 },
    { order: 2 as const, expected_count: 2 },
    { order: 3 as const, expected_count: 3 },
    { order: 1.5 as const, expected_count: 2 },
    { order: `aromatic` as const, expected_count: 2 },
  ])(
    `packs $order bond order as $expected_count cylinder matrices`,
    ({ order, expected_count }: { order?: BondOrder; expected_count: number }) => {
      const bond: BondPair = {
        pos_1: [0, 0, 0],
        pos_2: [1, 0, 0],
        site_idx_1: 0,
        site_idx_2: 1,
        bond_length: 1,
        strength: 1,
        ...(order === undefined ? {} : { bond_order: order }),
      }
      const matrix_buffer = new Float32Array(3 * 16)

      expect(count_bond_instances([bond])).toBe(expected_count)
      expect(write_bond_instance_matrices(matrix_buffer, [bond], 0.1)).toBe(expected_count)
      if (expected_count > 1) {
        const offsets = Array.from({ length: expected_count }, (_, instance_idx) =>
          [12, 13, 14]
            .map((component_idx) => matrix_buffer[instance_idx * 16 + component_idx])
            .join(`,`),
        )
        expect(new Set(offsets).size).toBeGreaterThan(1)
      }
    },
  )

  test(`fails before writing when the instance buffer is undersized`, () => {
    const bond: BondPair = {
      pos_1: [0, 0, 0],
      pos_2: [1, 0, 0],
      site_idx_1: 0,
      site_idx_2: 1,
      bond_length: 1,
      strength: 1,
      bond_order: 3,
    }
    expect(() => write_bond_instance_matrices(new Float32Array(32), [bond], 0.1)).toThrow(
      `Bond matrix buffer has 32 floats, needs 48`,
    )
  })
})
