<script lang="ts">
  import type { BondGroupWithGradients } from '$lib/structure'
  import { T } from '@threlte/core'
  import { attribute, dot, mix, normalView, positionLocal, uniform, vec3 } from 'three/tsl'
  import type { InstancedMesh } from 'three/webgpu'
  import {
    Color,
    InstancedBufferAttribute,
    Matrix4,
    MeshBasicNodeMaterial,
  } from 'three/webgpu'

  let {
    group,
    saturation = 0.5,
    brightness = 0.7,
  }: {
    group: BondGroupWithGradients
    saturation?: number
    brightness?: number
  } = $props()

  let mesh: InstancedMesh | undefined = $state()
  // Reusable buffers to avoid reallocation on every update
  let colors_start = new Float32Array(0)
  let colors_end = new Float32Array(0)

  // Appearance knobs live in uniforms so tweaking them mutates the existing material rather
  // than rebuilding the node graph (a $derived would leak a material per lighting change).
  const ambient_intensity = uniform(0.7)
  const directional_intensity = uniform(0.3)
  const color_saturation = uniform(0.5)
  const color_brightness = uniform(0.7)

  // Each instance carries the colors of the two atoms it connects; blend them along the
  // unit-height cylinder's local Y (-0.5..0.5 remapped to 0..1), then desaturate and darken to
  // keep bonds distinct from atoms. Lighting is a fixed-direction Lambert term rather than the
  // scene lights, so bond shading responds only to the explicit ambient/directional settings.
  const gradient = mix(
    attribute(`instanceColorStart`, `vec3`),
    attribute(`instanceColorEnd`, `vec3`),
    positionLocal.y.add(0.5),
  )
  const luma = dot(gradient, vec3(0.299, 0.587, 0.114))
  const tinted = mix(vec3(luma), gradient, color_saturation).mul(color_brightness)
  const diffuse = dot(normalView, vec3(1, 1, 1).normalize()).max(0)
  const bond_color = tinted.mul(ambient_intensity.add(directional_intensity.mul(diffuse)))

  function set_color_buffer(
    buffer: Float32Array,
    idx: number,
    color: string,
    temp_color: Color,
  ) {
    temp_color.set(color).convertSRGBToLinear()
    buffer[idx * 3] = temp_color.r
    buffer[idx * 3 + 1] = temp_color.g
    buffer[idx * 3 + 2] = temp_color.b
  }

  $effect(() => {
    if (!mesh) return

    const count = group.instances.length
    const matrix = new Matrix4()
    const temp_color = new Color()

    // Reallocate buffers if instance count changed
    if (colors_start.length !== count * 3) {
      colors_start = new Float32Array(count * 3)
      colors_end = new Float32Array(count * 3)
    }

    // Update instance matrices and colors
    for (let idx = 0; idx < count; idx++) {
      const instance = group.instances[idx]
      matrix.fromArray(instance.matrix)
      mesh.setMatrixAt(idx, matrix)
      set_color_buffer(colors_start, idx, instance.color_start, temp_color)
      set_color_buffer(colors_end, idx, instance.color_end, temp_color)
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
  })

  $effect(() => () => bond_material.dispose())
</script>

<T.InstancedMesh args={[undefined, bond_material, group.instances.length]} bind:ref={mesh}>
  <T.CylinderGeometry args={[group.thickness, group.thickness, 1, 8]} />
</T.InstancedMesh>
