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
  import { Color, InstancedMesh, Matrix4, SRGBColorSpace, Vector3 } from 'three/webgpu'

  // One InstancedMesh for many spheres sharing a caller-owned geometry and material. `packed`
  // is what to draw in instance-tween's layout, read reactively off the plot's clock, so the
  // buffers rewrite on every tween frame.
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
  } = $props()

  const { invalidate } = useThrelte()
  const scratch_matrix = new Matrix4()
  const scratch_position = new Vector3()
  const scratch_color = new Color()
  // A new mesh only when the instance count, geometry or material changes; buffers refill only
  // on a new frame, so an idle on-demand scene stops rendering
  const count = $derived(packed.length / INSTANCE_STRIDE)
  const mesh = $derived(new InstancedMesh(geometry, material, count))
  $effect(() => {
    const current = mesh
    return () => current.dispose() // frees only the instance buffers
  })
  $effect(() => {
    // Locals, as each prop or derived read in the loop would be a signal read per instance
    const [values, instances, flatten] = [packed, mesh, projection]
    const scale = flatten?.scale ?? 1
    for (let idx = 0; idx < instances.count; idx++) {
      const offset = idx * INSTANCE_STRIDE
      scratch_position.fromArray(values, offset)
      if (flatten) scratch_position.setComponent(flatten.axis, flatten.at)
      const radius = values[offset + 3] * scale
      scratch_matrix.makeScale(radius, radius, radius).setPosition(scratch_position)
      instances.setMatrixAt(idx, scratch_matrix)
      scratch_color.setRGB(
        values[offset + 4],
        values[offset + 5],
        values[offset + 6],
        SRGBColorSpace,
      )
      instances.setColorAt(idx, scratch_color)
    }
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    // per frame rather than once over start and end bounds: a custom easing may overshoot both
    instances.computeBoundingSphere() // exact bounds for frustum culling and raycasting
    invalidate()
  })
</script>

{#if count > 0}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
