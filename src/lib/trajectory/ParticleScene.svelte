<script lang="ts">
  import { T } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    BufferAttribute,
    BufferGeometry,
    DataTexture,
    FloatType,
    PointsNodeMaterial,
    RGBAFormat,
  } from 'three/webgpu'
  import {
    attribute,
    clamp,
    div,
    greaterThanEqual,
    select,
    texture,
    uniform,
    vec2,
  } from 'three/tsl'
  import { get_d3_interpolator } from '$lib/colors'
  import { css_to_linear_rgb } from '$lib/scene/colors'
  import { SceneCamera, bind_renderer, build_orbit_props } from '$lib/scene'
  import type { Vec3 } from '$lib/math'

  let {
    positions,
    scalars,
    mean = 1,
    threshold = 1.25,
    only_hot = false,
  }: {
    positions: Float64Array
    scalars: Float32Array
    mean?: number
    threshold?: number
    only_hot?: boolean
  } = $props()
  const { invalidate, size, camera } = bind_renderer(() => {})
  const material = new PointsNodeMaterial({
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const scale = uniform(1)
  const limit = uniform(0)
  const heat = attribute(`heat`, `float` as const)
  const palette = new Float32Array(256 * 4)
  const interpolate = get_d3_interpolator(`interpolateInferno`)
  for (let idx = 0; idx < 256; idx++) {
    palette.set(css_to_linear_rgb(interpolate(idx / 255)), idx * 4)
    palette[idx * 4 + 3] = 1
  }
  const palette_texture = new DataTexture(palette, 256, 1, RGBAFormat, FloatType)
  palette_texture.needsUpdate = true
  const palette_coord = clamp(div(heat, scale), 0, 1).mul(255).add(0.5).div(256)
  material.colorNode = texture(palette_texture, vec2(palette_coord, 0.5)).rgb
  material.opacityNode = select(
    greaterThanEqual(heat, 0),
    select(greaterThanEqual(heat, limit), 1, 0.04),
    0,
  )
  let geometry = $state.raw<BufferGeometry>()
  let center = $state<Vec3>([0, 0, 0])
  $effect(() => {
    $camera.lookAt(...center)
  })
  let radius = $state(1)
  let fitted = false
  let render_origin: Vec3 | undefined
  $effect(() => {
    const previous = untrack(() => geometry)
    const same_size = previous?.getAttribute(`position`).array.length === positions.length
    const next = same_size ? previous : new BufferGeometry()
    if (!same_size)
      next.setAttribute(`position`, new BufferAttribute(new Float32Array(positions.length), 3))
    const position_buffer = next.getAttribute(`position`)
    // Keep a stable render origin across frames; subtract in Float64 so a distant device
    // does not lose interatomic separations when uploaded as Float32 coordinates.
    render_origin ??= [positions[0], positions[1], positions[2]]
    for (let idx = 0; idx < positions.length; idx++)
      position_buffer.array[idx] = positions[idx] - render_origin[idx % 3]
    position_buffer.needsUpdate = true
    next.computeBoundingSphere()
    if (next.boundingSphere && !fitted) {
      center = next.boundingSphere.center.toArray() as Vec3
      radius = Math.max(next.boundingSphere.radius, 1e-3)
      fitted = true
    }
    if (!same_size) {
      previous?.dispose()
      geometry = next
    }
    invalidate()
  })
  $effect(() => {
    if (!geometry) return
    const current = geometry.getAttribute(`heat`)
    if (current && current.count === scalars.length) {
      current.array.set(scalars)
      current.needsUpdate = true
    } else geometry.setAttribute(`heat`, new BufferAttribute(scalars, 1))
    invalidate()
  })
  $effect(() => {
    scale.value = Math.max(mean * 2, Number.EPSILON)
    limit.value = only_hot ? mean * threshold : -1
    invalidate()
  })
  $effect(() => () => {
    geometry?.dispose()
    material.dispose()
    palette_texture.dispose()
  })
  const orbit_props = $derived(
    build_orbit_props({
      camera_projection: `perspective`,
      target: center,
      rotate_speed: 1,
      zoom_speed: 1,
      zoom_to_cursor: true,
      pan_speed: 1,
      max_zoom: undefined,
      min_zoom: undefined,
      auto_rotate: 0,
      rotation_damping: 0.1,
    }),
  )
</script>

{#if geometry}<SceneCamera
    position={[
      center[0],
      center[1],
      center[2] +
        (radius * 3) / Math.min(1, Math.max(0.1, $size.width / Math.max(1, $size.height))),
    ]}
    fov={45}
    near={radius / 10000}
    far={radius * 100}
    {orbit_props}
  />
  <T.Points {geometry} {material} dispose={false} frustumCulled={true} />{/if}
