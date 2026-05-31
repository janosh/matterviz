import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  choose_site_label_offset,
  label_screen_position,
  make_label_position_calculator,
} from '$lib/structure/label-placement'
import { Object3D, OrthographicCamera } from 'three'
import { describe, expect, test } from 'vitest'

const expect_vec_close = (actual: Vec3, expected: Vec3): void => {
  for (const [idx, val] of actual.entries()) {
    expect(val).toBeCloseTo(expected[idx])
  }
}

describe(`label placement`, () => {
  test(`keeps configured label offset when site has no bonds`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]

    expect(choose_site_label_offset([], base_offset)).toBe(base_offset)
  })

  test(`moves label away from a bond aligned with the default upward offset`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]
    const bond_directions: Vec3[] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]

    const offset = choose_site_label_offset(bond_directions, base_offset)

    expect_vec_close(offset, [0, -0.5, 0])
  })

  test(`preserves label offset length when choosing another direction`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]
    const bond_directions: Vec3[] = [[0, 1, 0]]

    const offset = choose_site_label_offset(bond_directions, base_offset)

    expect(Math.hypot(...offset)).toBeCloseTo(Math.hypot(...base_offset))
    expect(math.dot(math.normalize_vec(offset), [0, 1, 0])).toBeLessThan(0.5)
  })

  test(`label position calculator reads updated label offset`, () => {
    const atom_position: Vec3 = [0, 0, 0]
    let label_offset: Vec3 = [0, 0.5, 0]
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const size = { width: 100, height: 100 }
    const calculator = make_label_position_calculator(atom_position, () => label_offset, 0, 0)

    label_offset = [0.5, 0, 0]

    expect(calculator(new Object3D(), camera, size)).toEqual(
      label_screen_position(atom_position, label_offset, 0, 0, camera, size),
    )
  })
})
