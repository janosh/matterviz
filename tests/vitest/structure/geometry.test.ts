import type { Vec3 } from '$lib/math'
import { compute_bond_transform } from '$lib/structure/bonding'
import {
  cylinder_between,
  quaternion_from_direction,
  rotation_from_direction,
} from '$lib/structure/geometry'
import { Euler, Matrix4, Vector3 } from 'three'
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

describe(`cylinder_between`, () => {
  test.each([
    [[0, 0, 0], [0, 4, 0], [0, 2, 0], 4],
    [[0, 0, 0], [3, 4, 0], [1.5, 2, 0], 5], // 3-4-5 triangle
    [[1, 2, 3], [1, 2, 3], [1, 2, 3], 0], // coincident → zero length
  ] as [Vec3, Vec3, Vec3, number][])(
    `%j → %j: midpoint %j, length %d`,
    (from, to, mid, len) => {
      const { position, length } = cylinder_between(from, to)
      position.forEach((val, idx) => expect(val).toBeCloseTo(mid[idx], 10))
      expect(length).toBeCloseTo(len, 10)
    },
  )

  test(`coincident endpoints yield identity rotation (no NaN)`, () => {
    cylinder_between([1, 2, 3], [1, 2, 3]).rotation.forEach((val) =>
      expect(val).toBeCloseTo(0, 12),
    )
  })

  test(`full transform places a +Y cylinder spanning from→to`, () => {
    const [from, to]: [Vec3, Vec3] = [
      [2, 0, 1],
      [2, 3, 5],
    ]
    const { position, rotation, length } = cylinder_between(from, to)
    // a unit +Y segment scaled to `length`, euler-rotated, then centered at `position`
    const half = new Vector3(0, length / 2, 0).applyEuler(new Euler(...rotation))
    const center = new Vector3(...position)
    const [end_a, end_b] = [center.clone().sub(half), center.clone().add(half)]
    const [from_v, to_v] = [new Vector3(...from), new Vector3(...to)]
    const spans =
      (end_a.distanceTo(from_v) < 1e-9 && end_b.distanceTo(to_v) < 1e-9) ||
      (end_a.distanceTo(to_v) < 1e-9 && end_b.distanceTo(from_v) < 1e-9)
    expect(spans).toBe(true)
  })
})

// compute_bond_transform (bonding.ts) is a separate, three.js-object-free "+Y → direction"
// implementation for the instanced-bond hot loop. Guard against convention drift: its
// transform must orient a +Y unit vector the same way as quaternion_from_direction(b − a).
describe(`compute_bond_transform vs quaternion_from_direction`, () => {
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
    const mat = new Matrix4().fromArray(compute_bond_transform(start, end))
    const bond_dir = new Vector3(0, 1, 0).transformDirection(mat)
    const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
    const helper_dir = new Vector3(0, 1, 0).applyQuaternion(quaternion_from_direction(delta))
    expect(bond_dir.distanceTo(helper_dir)).toBeCloseTo(0, 10)
  })
})
