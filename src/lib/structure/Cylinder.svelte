<script lang="ts">
  import type { Vec3 } from '$lib'
  import { T } from '@threlte/core'
  import { Euler, Quaternion, Vector3 } from 'three'

  let {
    from,
    to,
    color = `#808080`,
    thickness = 0.1,
    offset = 0,
  }: {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
    offset?: number
  } = $props()

  const from_vec = new Vector3(...from)
  const to_vec = new Vector3(...to)
  const { position, rotation, height } = calc_bond(
    from_vec,
    to_vec,
    offset,
    thickness,
  )

  function calc_bond(
    from_vec: Vector3,
    to_vec: Vector3,
    offset: number,
    thickness: number,
  ): { position: Vec3; rotation: Vec3; height: number } {
    // find the axis of the box
    const delta_vec = to_vec.clone().sub(from_vec)
    // length of the bond
    const height = delta_vec.length()
    // calculate position
    let position: Vec3
    if (offset === 0) {
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).toArray()
    } else {
      const offset_vec = new Vector3()
        .crossVectors(delta_vec, new Vector3(1, 0, 0))
        .normalize()
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).add(
        offset_vec.multiplyScalar(offset * thickness * 2),
      ).toArray()
    }
    // calculate rotation
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta_vec.normalize(),
    )
    const euler = new Euler().setFromQuaternion(quaternion)
    const rotation: Vec3 = [euler.x, euler.y, euler.z]
    // return results
    return { height, position, rotation }
  }
</script>

<T.Mesh {position} {rotation} scale={[thickness, height, thickness]}>
  <T.CylinderGeometry args={[thickness, thickness, 1, 8]} />
  <T.MeshStandardMaterial {color} />
</T.Mesh>
