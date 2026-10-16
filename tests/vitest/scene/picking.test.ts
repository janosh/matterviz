import { front_hit } from '#lib/scene/picking.js'
import { Object3D, Plane, Vector3 } from 'three/webgpu'
import { describe, expect, test } from 'vitest'

// Raycaster hits come sorted nearest first; each hit is labelled by its distance along z
const hit = (z_coord: number, pick_rank?: number) => {
  const object = new Object3D()
  if (pick_rank !== undefined) object.userData.pick_rank = pick_rank
  return { point: new Vector3(0, 0, z_coord), object, z_coord }
}
const picked = (hits: ReturnType<typeof hit>[], clip_plane?: Plane | null) =>
  front_hit(hits, clip_plane).map(({ z_coord }) => z_coord)

describe(`front_hit`, () => {
  test.each([
    [`keeps only the nearest of equal ranks`, [hit(1), hit(2), hit(3)], [1]],
    [`an empty ray picks nothing`, [], []],
    [`a ranked hit beats nearer unranked ones`, [hit(1), hit(2, 1), hit(3)], [2]],
    [`the nearest of the top rank wins`, [hit(1), hit(2, 2), hit(3, 1), hit(4, 2)], [2]],
    [`a negative rank only wins on its own`, [hit(1, -1), hit(2)], [2]],
    [`a negative rank alone is still picked`, [hit(1, -1)], [1]],
  ])(`%s`, (_desc, hits, expected) => {
    expect(picked(hits)).toEqual(expected)
  })

  test(`skips hits on the clipped-off side before ranking`, () => {
    const keeps_positive_z = new Plane(new Vector3(0, 0, 1), 0)
    expect(picked([hit(-2, 5), hit(-1), hit(1), hit(2)], keeps_positive_z)).toEqual([1])
    expect(picked([hit(-2), hit(-1)], keeps_positive_z)).toEqual([])
    expect(picked([hit(-2), hit(1)], null)).toEqual([-2])
  })
})
