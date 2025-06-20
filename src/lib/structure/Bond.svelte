<script lang="ts">
  import type { Vector3 } from '$lib'
  import { T } from '@threlte/core'
  import { CanvasTexture, Euler, Quaternion } from 'three'

  interface Props {
    from?: Vector3 // position of atom 1
    to: Vector3 // position of atom 2
    offset?: number // offset of the bond from the center of the atoms
    thickness?: number // thickness/radius of the cylinder geometry and mesh scaling
    color?: string // color of the bond
    from_color?: string // color of atom 1
    to_color?: string // color of atom 2
  }
  let {
    from = [0, 0, 0],
    to,
    offset = 0,
    thickness = 0.5,
    color = `white`,
    from_color,
    to_color,
  }: Props = $props()

  const from_vec = new Vector3(...from)
  const to_vec = new Vector3(...to)

  const { position, rotation, height } = calc_bond(
    from_vec,
    to_vec,
    offset,
    thickness,
  )
  // Create gradient texture when both colors are provided
  let gradient_texture = $derived.by(() => {
    if (!from_color || !to_color) return null

    // Create a canvas for the gradient
    const canvas = document.createElement(`canvas`)
    canvas.width = 1
    canvas.height = 256
    const ctx = canvas.getContext(`2d`)!

    // Create linear gradient along Y axis (cylinder height)
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, to_color)
    gradient.addColorStop(1, from_color)

    // Fill the canvas with the gradient
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1, 256)

    // Create texture from canvas
    const texture = new CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  })

  function calc_bond(
    from_vec: Vector3,
    to_vec: Vector3,
    offset: number,
    thickness: number,
  ) {
    // find the axis of the the box
    const delta_vec = to_vec.clone().sub(from_vec)
    // length of the bond
    const height = delta_vec.length()
    // calculate position
    let position: Vector3
    if (offset === 0) {
      position = from_vec.clone().add(delta_vec.multiplyScalar(0.5)).toArray()
    } else {
      const offset_vec = new Vector3()
        .crossVectors(delta_vec, new Vector3(1, 0, 0))
        .normalize()
      position = from_vec
        .clone()
        .add(delta_vec.multiplyScalar(0.5))
        .add(offset_vec.multiplyScalar(offset * thickness * 2))
        .toArray()
    }
    // calculate rotation
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta_vec.normalize(),
    )
    const rotation = new Euler().setFromQuaternion(quaternion).toArray()
    // return results
    return { height, position, rotation }
  }
</script>

{#if gradient_texture}
  <!-- Use gradient material for bonds with two colors -->
  <T.Mesh {position} {rotation} scale={[thickness, height, thickness]}>
    <T.CylinderGeometry args={[thickness, thickness, 1, 16]} />
    <T.MeshStandardMaterial map={gradient_texture} />
  </T.Mesh>
{:else}
  <!-- Fallback to solid color -->
  <T.Mesh {position} {rotation} scale={[thickness, height, thickness]}>
    <T.CylinderGeometry args={[thickness, thickness, 1, 16]} />
    <T.MeshStandardMaterial {color} />
  </T.Mesh>
{/if}
