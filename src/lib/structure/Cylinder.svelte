<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import { Euler, Quaternion, Vector3 } from 'three'

  let { from, to, color = `#808080`, thickness = 0.1 }: {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
  } = $props()

  let from_vec = $derived(new Vector3(...from))
  let to_vec = $derived(new Vector3(...to))
  let { position, rotation, height } = $derived(calc_bond(from_vec, to_vec))

  function calc_bond(
    start_vec: Vector3,
    end_vec: Vector3,
  ): { position: Vec3; rotation: Vec3; height: number } {
    // find the axis of the cylinder
    const delta_vec = end_vec.clone().sub(start_vec)
    // length of the cylinder
    const bond_height = delta_vec.length()
    // calculate position (midpoint between from and to)
    const bond_position = start_vec
      .clone()
      .add(delta_vec.multiplyScalar(0.5))
      .toArray() as Vec3
    // calculate rotation
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta_vec.normalize(),
    )
    const euler = new Euler().setFromQuaternion(quaternion)
    const bond_rotation: Vec3 = [euler.x, euler.y, euler.z]
    // return results
    return { height: bond_height, position: bond_position, rotation: bond_rotation }
  }
</script>

<T.Mesh {position} {rotation} scale={[thickness, height, thickness]}>
  <T.CylinderGeometry args={[thickness, thickness, 1, 8]} />
  <T.MeshStandardMaterial {color} />
</T.Mesh>
