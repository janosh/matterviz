<script lang="ts">
  // Instanced arrows (shaft cylinders + head cones) for per-site vector layers
  // (forces, magnetic moments, ...). Replaces one <Arrow> component per site
  // (2 meshes + 2 geometries + 2 materials each) with 2 draw calls per layer.
  // Sizing math mirrors Arrow.svelte so the two render identically.
  import type { Vec3 } from '$lib/math'
  import { EPS } from '$lib/math'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import type { BufferGeometry } from 'three'
  import {
    Color,
    ConeGeometry,
    CylinderGeometry,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    Vector3,
  } from 'three'

  type ArrowInstance = {
    position: Vec3
    vector: Vec3
    scale: number
    color: string
  }

  let {
    arrows,
    shaft_radius,
    arrow_head_radius,
    arrow_head_length,
  }: {
    arrows: ArrowInstance[]
    shaft_radius: number // negative = relative to shaft length
    arrow_head_radius: number // negative = relative to shaft length
    arrow_head_length: number // negative = relative to arrow length
  } = $props()

  const { invalidate } = useThrelte()

  // Unit primitives scaled per instance: cylinder radius/length via (x=r, y=len, z=r)
  const shaft_geometry = new CylinderGeometry(1, 1, 1, 12)
  const head_geometry = new ConeGeometry(1, 1, 12)
  const shaft_material = new MeshStandardMaterial()
  const head_material = new MeshStandardMaterial()
  $effect(() => () => {
    shaft_geometry.dispose()
    head_geometry.dispose()
    shaft_material.dispose()
    head_material.dispose()
  })

  const make_mesh = (
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    count: number,
  ): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, count)
    mesh.frustumCulled = false
    mesh.raycast = () => undefined // arrows are display-only
    mesh.userData.per_instance_color = true
    return mesh
  }

  // Recreate meshes only when the arrow count changes (fixed buffer capacity)
  let shaft_mesh = $state.raw<InstancedMesh | null>(null)
  let head_mesh = $state.raw<InstancedMesh | null>(null)
  $effect(() => {
    const count = arrows.length
    const prev = untrack(() => shaft_mesh)
    if (prev && prev.count === count) return
    prev?.dispose()
    untrack(() => head_mesh)?.dispose()
    if (count === 0) {
      shaft_mesh = null
      head_mesh = null
      return
    }
    ;[shaft_mesh, head_mesh] = [
      make_mesh(shaft_geometry, shaft_material, count),
      make_mesh(head_geometry, head_material, count),
    ]
  })
  // Unmount-only cleanup (a cleanup on the effect above would dispose meshes
  // on every re-run, including runs that keep them)
  $effect(() => () => {
    untrack(() => shaft_mesh)?.dispose()
    untrack(() => head_mesh)?.dispose()
  })

  const up_axis = new Vector3(0, 1, 0)
  const scratch_dir = new Vector3()
  const scratch_quat = new Quaternion()
  const scratch_pos = new Vector3()
  const scratch_scale = new Vector3()
  const scratch_matrix = new Matrix4()
  const scratch_color = new Color()

  $effect(() => {
    const shafts = shaft_mesh
    const heads = head_mesh
    if (!shafts || !heads) return
    const limit = Math.min(arrows.length, shafts.count)
    for (let idx = 0; idx < limit; idx++) {
      const { position, vector, scale, color } = arrows[idx]
      const mag = Math.hypot(vector[0], vector[1], vector[2])
      if (mag > EPS) {
        scratch_dir.set(vector[0] / mag, vector[1] / mag, vector[2] / mag)
        scratch_quat.setFromUnitVectors(up_axis, scratch_dir)
      } else {
        scratch_dir.set(0, 1, 0)
        scratch_quat.identity()
      }
      const vec_len = mag * scale
      const head_len = arrow_head_length < 0 ? vec_len * -arrow_head_length : arrow_head_length
      const shaft_len = Math.max(0, vec_len - head_len * 0.5)
      const shaft_r = shaft_radius < 0 ? shaft_len * -shaft_radius : shaft_radius
      const head_r = arrow_head_radius < 0 ? shaft_len * -arrow_head_radius : arrow_head_radius

      // Shafts shorter than Arrow.svelte's 0.01 render threshold collapse to zero scale
      const draw_shaft = shaft_len > 0.01
      scratch_pos.set(
        position[0] + scratch_dir.x * shaft_len * 0.5,
        position[1] + scratch_dir.y * shaft_len * 0.5,
        position[2] + scratch_dir.z * shaft_len * 0.5,
      )
      scratch_scale.set(
        draw_shaft ? shaft_r : 0,
        draw_shaft ? shaft_len : 0,
        draw_shaft ? shaft_r : 0,
      )
      shafts.setMatrixAt(idx, scratch_matrix.compose(scratch_pos, scratch_quat, scratch_scale))

      const head_offset = shaft_len + head_len * 0.5
      scratch_pos.set(
        position[0] + scratch_dir.x * head_offset,
        position[1] + scratch_dir.y * head_offset,
        position[2] + scratch_dir.z * head_offset,
      )
      scratch_scale.set(head_r, head_len, head_r)
      heads.setMatrixAt(idx, scratch_matrix.compose(scratch_pos, scratch_quat, scratch_scale))

      scratch_color.set(color)
      shafts.setColorAt(idx, scratch_color)
      heads.setColorAt(idx, scratch_color)
    }
    for (const mesh of [shafts, heads]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    invalidate()
  })
</script>

{#if shaft_mesh}
  <T is={shaft_mesh} />
{/if}
{#if head_mesh}
  <T is={head_mesh} />
{/if}
