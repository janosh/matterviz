<script lang="ts" module>
  // Draws every instance flattened onto the plane where scene `axis` equals `at`, at `scale`
  // times its radius, applied after the tween so moving the plane doesn't animate
  export type InstanceProjection = { axis: 0 | 1 | 2; at: number; scale: number }
  // Instance pointer events carry the hit `instanceId`, the instance's index
  export type InstanceEvent = { instanceId?: number; nativeEvent?: Event }
</script>

<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import { INSTANCE_STRIDE } from '#lib/plot/scatter-3d/instance-tween.svelte.js'
  import type { Material, SphereGeometry } from 'three/webgpu'
  import { SphereInstances } from '#lib/scene/picking.js'
  import { Color, InstancedBufferAttribute, Sphere, SRGBColorSpace } from 'three/webgpu'

  // One InstancedMesh for many spheres sharing a caller-owned geometry and material, picked by
  // an analytic ray-sphere pass before the per-instance triangle test. `packed` is what to draw
  // in instance-tween's layout, read reactively off the plot's clock, so the buffers rewrite on
  // every tween frame.
  let {
    packed,
    geometry,
    material,
    projection,
    ...pointer_props
  }: {
    packed: Float32Array
    geometry: SphereGeometry
    material: Material
    projection?: InstanceProjection
    onpointerenter?: (event: InstanceEvent) => void
    onpointerleave?: (event: InstanceEvent) => void
    onclick?: (event: InstanceEvent) => void
    onpointermissed?: () => void // a click that hit no instance
  } = $props()

  const { invalidate } = useThrelte()
  const scratch_color = new Color()
  const scratch_sphere = new Sphere()
  // A new mesh only when the instance count, geometry or material changes; buffers refill only
  // on a new frame, so an idle on-demand scene stops rendering
  const count = $derived(packed.length / INSTANCE_STRIDE)
  // The scene's pointer filter keeps one hit per object (front_hit, no clip plane), so picking
  // reports only the front-most marker
  const mesh = $derived(
    Object.assign(new SphereInstances(geometry, material, count), { nearest_only: true }),
  )
  $effect(() => {
    const current = mesh
    return () => current.dispose() // frees only the instance buffers
  })
  // Primitives, so a fresh projection naming the same plane (a display toggle, a camera
  // move along another axis) rewrites no buffers
  const {
    axis: flat_axis,
    at: flat_at,
    scale: flat_scale,
  } = $derived(projection ?? { axis: null, at: 0, scale: 1 })
  $effect(() => {
    // Locals, as each prop or derived read in the loop would be a signal read per instance
    const [values, instances, axis, at, scale] = [packed, mesh, flat_axis, flat_at, flat_scale]
    // Instance matrices are uniform scales plus translations: InstancedMesh starts every one
    // as the identity, so only the diagonal and the translation are ever written
    const matrices = instances.instanceMatrix.array
    instances.instanceColor ??= new InstancedBufferAttribute(
      new Float32Array(instances.count * 3),
      3,
    )
    const colors = instances.instanceColor.array
    // Exact bounds for frustum culling and raycasting, per frame rather than once over start
    // and end bounds as a custom easing may overshoot both: the union of the instances'
    // bounding spheres, as InstancedMesh.computeBoundingSphere builds it (same spheres, same
    // order) but without a matrix read and product per instance
    if (!instances.geometry.boundingSphere) instances.geometry.computeBoundingSphere()
    const { center: unit_center, radius: unit_radius } =
      instances.geometry.boundingSphere ?? new Sphere()
    const bounds = (instances.boundingSphere ??= new Sphere()).makeEmpty()
    for (let idx = 0; idx < instances.count; idx++) {
      const [offset, matrix_at, color_at] = [idx * INSTANCE_STRIDE, idx * 16, idx * 3]
      const scaled = values[offset + 3] * scale
      matrices[matrix_at] = scaled
      matrices[matrix_at + 5] = scaled
      matrices[matrix_at + 10] = scaled
      for (let dim = 0; dim < 3; dim++) {
        matrices[matrix_at + 12 + dim] = dim === axis ? at : values[offset + dim]
      }
      scratch_color
        .setRGB(values[offset + 4], values[offset + 5], values[offset + 6], SRGBColorSpace)
        .toArray(colors, color_at)
      // the instance's sphere from the stored (f32) matrix, as three reads it back
      const radius = matrices[matrix_at]
      scratch_sphere.center.set(
        radius * unit_center.x + matrices[matrix_at + 12],
        radius * unit_center.y + matrices[matrix_at + 13],
        radius * unit_center.z + matrices[matrix_at + 14],
      )
      scratch_sphere.radius = unit_radius * Math.abs(radius)
      bounds.union(scratch_sphere)
    }
    instances.instanceMatrix.needsUpdate = true
    instances.instanceColor.needsUpdate = true
    invalidate()
  })
</script>

{#if count > 0}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
