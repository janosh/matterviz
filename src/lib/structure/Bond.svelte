<script lang="ts">
  import type { Vector } from '$lib'
  import { Instance } from '@threlte/extras'
  import { Euler, Quaternion, Vector3 } from 'three'

  interface Props {
    from?: Vector;
    to: Vector;
    offset?: number;
    radius?: number;
    color?: string;
  }

  let {
    from = [0, 0, 0],
    to,
    offset = 0,
    radius = 0.1,
    color = `white`
  }: Props = $props();

  const from_vec = new Vector3(...from)
  const to_vec = new Vector3(...to)

  const { position, rotation, height } = calc_bond(from_vec, to_vec, offset, radius)

  function calc_bond(from_vec: Vector3, to_vec: Vector3, offset: number, radius: number) {
    // find the axis of the the box
    const delta_vec = to_vec.clone().sub(from_vec)
    // length of the bond
    const height = delta_vec.length()
    // calculate position
    let position: Vector
    if (offset === 0) {
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).toArray()
    } else {
      const offset_vec = new Vector3()
        .crossVectors(delta_vec, new Vector3(1, 0, 0))
        .normalize()
      position = from_vec
        .clone()
        .add(delta_vec.multiplyScalar(0.5))
        .add(offset_vec.multiplyScalar(offset * radius * 2))
        .toArray()
    }
    // calculate rotation
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta_vec.normalize()
    )
    const rotation = new Euler().setFromQuaternion(quaternion).toArray()
    // return results
    return { height, position, rotation }
  }
</script>

<Instance {position} {rotation} scale={[1, height, 1]} {color} />
