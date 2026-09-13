<script lang="ts">
  // Instanced arrows (shaft cylinders + head cones) for per-site vector layers
  // (forces, magnetic moments, ...). Replaces one <Arrow> component per site
  // (2 meshes + 2 geometries + 2 materials each) with 2 draw calls per layer.
  // Sizing math mirrors Arrow.svelte so the two render identically.
  import type { VectorArrow } from './arrow-instances'
  import { EPS } from '$lib/math'
  import { css_to_linear_rgb } from '$lib/scene/colors'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    ConeGeometry,
    CylinderGeometry,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Quaternion,
    Vector3,
  } from 'three/webgpu'

  let {
    arrows,
    shaft_radius,
    arrow_head_radius,
    arrow_head_length,
  }: {
    arrows: VectorArrow[]
    shaft_radius: number // negative = relative to shaft length
    arrow_head_radius: number // negative = relative to shaft length
    arrow_head_length: number // negative = relative to arrow length
  } = $props()

  const { invalidate } = useThrelte()

  // Unit primitives scaled per instance: cylinder radius/length via (x=r, y=len, z=r)
  const geometries = [new CylinderGeometry(1, 1, 1, 12), new ConeGeometry(1, 1, 12)]
  const material = new MeshStandardMaterial()

  // Grow geometrically (three caches TSL by mesh uuid); shrink via mesh.count.
  let meshes = $state.raw<InstancedMesh[]>([])
  const colored_css: string[] = []
  // Geometry and material outlive retired meshes; dispose them only on unmount.
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

  $effect(() => {
    // Read reactive props once, not through the component spread chain for every arrow.
    const [instances, shaft_size, head_size, head_length] = [
      arrows,
      shaft_radius,
      arrow_head_radius,
      arrow_head_length,
    ]
    const count = instances.length
    let current = untrack(() => meshes)
    const capacity = current[0]?.instanceMatrix.count ?? 0
    if (count > capacity) {
      for (const mesh of current) mesh.dispose()
      colored_css.length = 0
      const next_capacity = Math.max(count, Math.ceil(capacity * 1.5))
      // Shafts and heads grow and retire together, so their identical colors share one buffer.
      const colors = new InstancedBufferAttribute(new Float32Array(next_capacity * 3), 3)
      current = geometries.map((geometry) => {
        const mesh = new InstancedMesh(geometry, material, next_capacity)
        mesh.instanceColor = colors
        mesh.frustumCulled = false
        mesh.raycast = () => undefined // arrows are display-only
        return mesh
      })
      meshes = current
    }
    const [shafts, heads] = current
    if (!shafts || !heads) return
    for (const mesh of current) mesh.count = count
    for (let idx = 0; idx < count; idx++) {
      const { position, vector, scale } = instances[idx]
      const mag = Math.hypot(vector[0], vector[1], vector[2])
      const vec_len = mag * scale
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
    for (const mesh of current) {
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(0, count * 16)
      mesh.instanceMatrix.needsUpdate = true
    }
    invalidate()
  })

  $effect(() => {
    const [mesh] = meshes
    if (!mesh?.instanceColor) return
    const instances = arrows
    const limit = Math.min(instances.length, mesh.count)
    const colors = mesh.instanceColor
    const { array } = colors
    let first_change = limit
    let last_change = -1
    for (let idx = 0; idx < limit; idx++) {
      const { color } = instances[idx]
      if (color === colored_css[idx]) continue
      const [red, green, blue] = css_to_linear_rgb(color)
      const offset = idx * 3
      array[offset] = red
      array[offset + 1] = green
      array[offset + 2] = blue
      colored_css[idx] = color
      first_change = Math.min(first_change, idx)
      last_change = idx
    }
    colored_css.length = limit
    if (last_change < 0) return
    // Preserve pending ranges when several updates happen before the next GPU upload.
    colors.addUpdateRange(first_change * 3, (last_change - first_change + 1) * 3)
    colors.needsUpdate = true
    invalidate()
  })
</script>

{#each meshes as mesh, idx (idx)}
  <T is={mesh} dispose={false} />
{/each}
