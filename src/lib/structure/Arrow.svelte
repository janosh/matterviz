<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { T } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { Euler, Quaternion, Vector3 } from 'three'

  let {
    position,
    vector,
    scale = DEFAULTS.structure.force_scale,
    color = DEFAULTS.structure.force_color,
    shaft_radius = DEFAULTS.structure.force_shaft_radius,
    arrow_head_radius = DEFAULTS.structure.force_arrow_head_radius,
    arrow_head_length = DEFAULTS.structure.force_arrow_head_length,
    ...rest
  }: ComponentProps<typeof T.Mesh> & {
    position: Vec3
    vector: Vec3
    scale?: number
    color?: string
    shaft_radius?: number // negative = relative to length
    arrow_head_radius?: number
    arrow_head_length?: number
  } = $props()

  const mag = $derived(Math.hypot(...vector))
  const dir = $derived(
    mag > math.EPS ? math.scale(vector, 1 / mag) : ([0, 1, 0] as Vec3),
  )
  const vec_len = $derived(mag * scale)

  const head_len = $derived(
    arrow_head_length < 0 ? vec_len * -arrow_head_length : arrow_head_length,
  )
  const shaft_len = $derived(Math.max(0, vec_len - head_len * 0.5))
  const shaft_r = $derived(
    shaft_radius < 0 ? shaft_len * -shaft_radius : shaft_radius,
  )
  const head_r = $derived(
    arrow_head_radius < 0 ? shaft_len * -arrow_head_radius : arrow_head_radius,
  )

  const shaft_pos = $derived(
    math.add(position, math.scale(dir, shaft_len * 0.5)) as Vec3,
  )
  const head_pos = $derived(
    math.add(position, math.scale(dir, shaft_len + head_len * 0.5)) as Vec3,
  )

  const rotation = $derived.by((): Vec3 => {
    if (mag < math.EPS) return [0, 0, 0]
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(...dir),
    )
    return new Euler().setFromQuaternion(quat).toArray().slice(0, 3) as Vec3
  })
</script>

{#if shaft_len > 0.01}
  <T.Mesh {...rest} position={shaft_pos} {rotation}>
    <T.CylinderGeometry args={[shaft_r, shaft_r, shaft_len, 12]} />
    <T.MeshStandardMaterial {color} />
  </T.Mesh>
{/if}

<T.Mesh {...rest} position={head_pos} {rotation}>
  <T.ConeGeometry args={[head_r, head_len, 12]} />
  <T.MeshStandardMaterial {color} />
</T.Mesh>
