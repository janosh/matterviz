<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { write_linear_color_to_buffer } from '$lib/scene/colors'
  import { T, useThrelte } from '@threlte/core'
  import { attribute, dot, mix, normalView, positionGeometry, uniform, vec3 } from 'three/tsl'
  import type { InstancedMesh } from 'three/webgpu'
  import { InstancedBufferAttribute, Matrix4, MeshBasicNodeMaterial } from 'three/webgpu'

  let {
    group,
    saturation = 0.5,
    brightness = 0.7,
  }: {
    group: BondGroupWithGradients
    saturation?: number
    brightness?: number
  } = $props()

  const { invalidate } = useThrelte()

  let mesh: InstancedMesh | undefined = $state()
  let allocated_mesh: InstancedMesh | undefined
  // Reusable buffers to avoid reallocation on every update
  let colors_start = new Float32Array(0)
  let colors_end = new Float32Array(0)

  // Grow-only: three caches TSL materials by mesh uuid, so recreating on shrink is expensive.
  // Derived, not state+effect: an effect would first render at capacity 0 and build twice.
  let peak_capacity = 0
  let capacity = $derived((peak_capacity = Math.max(peak_capacity, group.instances.length)))
  $effect(() => {
    if (!mesh || mesh === allocated_mesh) return
    allocated_mesh?.dispose()
    allocated_mesh = mesh
  })

  // Appearance knobs live in uniforms so tweaking them mutates the existing material rather
  // than rebuilding the node graph (a $derived would leak a material per lighting change).
  const ambient_intensity = uniform(0.7)
  const directional_intensity = uniform(0.3)
  const color_saturation = uniform(0.5)
  const color_brightness = uniform(0.7)

  // Blend atom colors along pre-transform cylinder Y via varyings. Instancing mutates
  // positionLocal, while positionGeometry stays in the cylinder's local [-0.5, 0.5] range.
  // Fragment InstancedBufferAttribute reads mid-mix under WebGPU. Lambert is fixed-dir.
  const color_start = attribute(`instanceColorStart`, `vec3`).toVarying(`vBondColorStart`)
  const color_end = attribute(`instanceColorEnd`, `vec3`).toVarying(`vBondColorEnd`)
  const cylinder_t = positionGeometry.y.add(0.5).toVarying(`vBondCylinderT`)
  // @ts-expect-error — toVarying typed as VaryingNode<string>; runtime keeps float/vec3
  const gradient = mix(color_start, color_end, cylinder_t)
  const luma = dot(gradient, vec3(0.299, 0.587, 0.114))
  const tinted = mix(vec3(luma), gradient, color_saturation).mul(color_brightness)
  const diffuse = dot(normalView, vec3(1, 1, 1).normalize()).max(0)
  const bond_color = tinted.mul(ambient_intensity.add(directional_intensity.mul(diffuse)))

  $effect(() => {
    if (!mesh) return

    const count = group.instances.length
    const matrix = new Matrix4()

    // Grow color buffers with mesh capacity; shrinking only lowers mesh.count.
    if (colors_start.length < capacity * 3) {
      colors_start = new Float32Array(capacity * 3)
      colors_end = new Float32Array(capacity * 3)
    }

    // Update instance matrices and colors
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]
      matrix.fromArray(instance.matrix)
      mesh.setMatrixAt(idx, matrix)
      write_linear_color_to_buffer(colors_start, idx, instance.color_start)
      write_linear_color_to_buffer(colors_end, idx, instance.color_end)
    }

    mesh.instanceMatrix.needsUpdate = true

    // Update geometry color attributes
    const { geometry } = mesh
    for (const [name, buffer] of [
      [`instanceColorStart`, colors_start],
      [`instanceColorEnd`, colors_end],
    ] as const) {
      const existing = geometry.getAttribute(name)
      if (existing?.array === buffer) existing.needsUpdate = true
      else geometry.setAttribute(name, new InstancedBufferAttribute(buffer, 3))
    }

    mesh.count = count
    invalidate() // on-demand rendering: nothing else requests a frame for these writes
  })

  // Colors are uploaded in linear space; the renderer applies tone mapping and sRGB output.
  // The old GLSL shader wrote gl_FragColor and so escaped tone mapping — node materials have
  // no per-material opt-out, so bonds are now tone-mapped like everything else in the scene.
  const bond_material = new MeshBasicNodeMaterial()
  bond_material.colorNode = bond_color

  $effect(() => {
    ambient_intensity.value = group.ambient_light ?? 0.7
    directional_intensity.value = group.directional_light ?? 0.3
    color_saturation.value = saturation
    color_brightness.value = brightness
    invalidate()
  })

  $effect(() => () => bond_material.dispose())
</script>

<T.InstancedMesh
  args={[undefined, bond_material, capacity]}
  bind:ref={mesh}
  frustumCulled={false}
>
  <T.CylinderGeometry args={[group.thickness, group.thickness, 1, 8]} />
</T.InstancedMesh>
