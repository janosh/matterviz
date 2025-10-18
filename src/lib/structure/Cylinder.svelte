<script lang="ts">
  import type { Vec3 } from '$lib'
  import { T } from '@threlte/core'
  import { Euler, Quaternion, Vector3 } from 'three'

  let {
    from,
    to,
    color = `#808080`,
    thickness = 0.1,
  }: {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
  } = $props()

  let from_vec = $derived(new Vector3(...from))
  let to_vec = $derived(new Vector3(...to))
  let { position, rotation, height } = $derived(calc_bond(from_vec, to_vec))

  function calc_bond(
    from_vec: Vector3,
    to_vec: Vector3,
  ): { position: Vec3; rotation: Vec3; height: number } {
    // find the axis of the cylinder
    const delta_vec = to_vec.clone().sub(from_vec)
    // length of the cylinder
    const height = delta_vec.length()
    // calculate position (midpoint between from and to)
    const position = from_vec
      .clone()
      .add(delta_vec.multiplyScalar(0.5))
      .toArray() as Vec3
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
