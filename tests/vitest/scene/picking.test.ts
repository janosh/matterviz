import { front_hit } from '#lib/scene/picking.js'
import { Object3D, Plane, Vector3 } from 'three/webgpu'
import { expect, test } from 'vitest'

// Raycaster hits come sorted nearest first; each hit is labelled by its distance along z
const hit = (z_coord: number, pick_rank?: number) => {
  const object = new Object3D()
  if (pick_rank !== undefined) object.userData.pick_rank = pick_rank
  return { point: new Vector3(0, 0, z_coord), object, z_coord }
}

// clipped-off hits (z < 0) are skipped before ranking
const keeps_positive_z = new Plane(new Vector3(0, 0, 1), 0)

test.each([
  [`keeps only the nearest of equal ranks`, [hit(1), hit(2), hit(3)], null, [1]],
  [`an empty ray picks nothing`, [], null, []],
  [`a ranked hit beats nearer unranked ones`, [hit(1), hit(2, 1), hit(3)], null, [2]],
  [`the nearest of the top rank wins`, [hit(1), hit(2, 2), hit(3, 1), hit(4, 2)], null, [2]],
  [`a negative rank only wins on its own`, [hit(1, -1), hit(2)], null, [2]],
  [`a negative rank alone is still picked`, [hit(1, -1)], null, [1]],
  [`a clipped ranked hit loses`, [hit(-2, 5), hit(-1), hit(1), hit(2)], keeps_positive_z, [1]],
  [`all hits clipped picks nothing`, [hit(-2), hit(-1)], keeps_positive_z, []],
])(`front_hit: %s`, (_desc, hits, clip_plane, expected) => {
  expect(front_hit(hits, clip_plane).map(({ z_coord }) => z_coord)).toEqual(expected)
})
