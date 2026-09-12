<script lang="ts">
  // Instanced arrows (shaft cylinders + head cones) for per-site vector layers
  // (forces, magnetic moments, ...). Replaces one <Arrow> component per site
  // (2 meshes + 2 geometries + 2 materials each) with 2 draw calls per layer.
  // Sizing math mirrors Arrow.svelte so the two render identically.
  import type { Vec3 } from '$lib/math'
  import { EPS } from '$lib/math'
  import { set_linear_css_color } from '$lib/scene/colors'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    Color,
    ConeGeometry,
    CylinderGeometry,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    Vector3,
  } from 'three/webgpu'

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
  const geometries = [new CylinderGeometry(1, 1, 1, 12), new ConeGeometry(1, 1, 12)]
  const material = new MeshStandardMaterial()

  // Grow-only capacity (three caches TSL by mesh uuid); shrink via mesh.count.
  let meshes = $state.raw<InstancedMesh[]>([])
  $effect(() => {
    const count = arrows.length
    let current = untrack(() => meshes)
    if (count > (current[0]?.instanceMatrix.count ?? 0)) {
      for (const mesh of current) mesh.dispose()
      current = geometries.map((geometry) => {
        const mesh = new InstancedMesh(geometry, material, count)
        mesh.frustumCulled = false
        mesh.raycast = () => undefined // arrows are display-only
        return mesh
      })
      meshes = current
    }
    for (const mesh of current) mesh.count = count
    invalidate()
  })
  // Unmount-only cleanup (a cleanup on the effect above would dispose meshes
  // on every re-run, including runs that keep them; cleanups run untracked)
  $effect(() => () => {
    for (const mesh of meshes) mesh.dispose()
    for (const geometry of geometries) geometry.dispose()
    material.dispose()
  })

  const up_axis = new Vector3(0, 1, 0)
  const scratch_dir = new Vector3()
  const scratch_quat = new Quaternion()
  const scratch_pos = new Vector3()
  const scratch_scale = new Vector3()
  const scratch_matrix = new Matrix4()
  const scratch_color = new Color()

  $effect(() => {
    const [shafts, heads] = meshes
    if (!shafts || !heads) return
    // Read reactive props once, not through the component spread chain for every arrow.
    const [instances, shaft_size, head_size, head_length] = [
      arrows,
      shaft_radius,
      arrow_head_radius,
      arrow_head_length,
    ]
    const limit = Math.min(instances.length, shafts.count)
    for (let idx = 0; idx < limit; idx++) {
      const { position, vector, scale, color } = instances[idx]
      const mag = Math.hypot(vector[0], vector[1], vector[2])
      const vec_len = mag * scale
      set_linear_css_color(color, scratch_color)
      shafts.setColorAt(idx, scratch_color)
      heads.setColorAt(idx, scratch_color)
      if (!Number.isFinite(vec_len) || vec_len <= EPS) {
        scratch_matrix.makeScale(0, 0, 0).setPosition(...position)
        shafts.setMatrixAt(idx, scratch_matrix)
        heads.setMatrixAt(idx, scratch_matrix)
        continue
      }
      scratch_dir.set(vector[0] / mag, vector[1] / mag, vector[2] / mag)
      scratch_quat.setFromUnitVectors(up_axis, scratch_dir)
      const head_len = head_length < 0 ? vec_len * -head_length : head_length
      const shaft_len = Math.max(0, vec_len - head_len * 0.5)
      const shaft_r = shaft_size < 0 ? shaft_len * -shaft_size : shaft_size
      const head_r = head_size < 0 ? shaft_len * -head_size : head_size

      // Shafts shorter than Arrow.svelte's 0.01 render threshold collapse to zero scale
      const draw_shaft = shaft_len > 0.01
      scratch_pos.fromArray(position).addScaledVector(scratch_dir, shaft_len * 0.5)
      if (draw_shaft) scratch_scale.set(shaft_r, shaft_len, shaft_r)
      else scratch_scale.setScalar(0)
      shafts.setMatrixAt(idx, scratch_matrix.compose(scratch_pos, scratch_quat, scratch_scale))

      const head_offset = shaft_len + head_len * 0.5
      scratch_pos.fromArray(position).addScaledVector(scratch_dir, head_offset)
      scratch_scale.set(head_len > 0 ? head_r : 0, head_len, head_len > 0 ? head_r : 0)
      heads.setMatrixAt(idx, scratch_matrix.compose(scratch_pos, scratch_quat, scratch_scale))
    }
    for (const mesh of [shafts, heads]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    invalidate()
  })
</script>

{#each meshes as mesh, idx (idx)}
  <T is={mesh} dispose={false} />
{/each}
