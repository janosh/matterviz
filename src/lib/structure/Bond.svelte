<script lang="ts">
  import { write_linear_color_to_buffer } from '$lib/scene/colors'
  import type { BondPair } from '$lib/structure'
  import {
    count_bond_instances,
    get_bond_instance_count,
    write_bond_instance_matrices,
  } from '$lib/structure/bond-rendering'
  import { T, useThrelte } from '@threlte/core'
  import { attribute, dot, mix, normalView, positionGeometry, uniform, vec3 } from 'three/tsl'
  import type { InstancedMesh } from 'three/webgpu'
  import { InstancedBufferAttribute, MeshBasicNodeMaterial } from 'three/webgpu'

  let {
    bonds,
    site_colors,
    thickness,
    ambient_light,
    directional_light,
  }: {
    bonds: BondPair[]
    site_colors: string[]
    thickness: number
    ambient_light: number
    directional_light: number
  } = $props()

  const { invalidate } = useThrelte()

  let mesh: InstancedMesh | undefined = $state()
  let allocated_mesh: InstancedMesh | undefined
  // Reusable buffers to avoid reallocation on every update
  let colors_start = new Float32Array(0)
  let colors_end = new Float32Array(0)
  let previous_colors_start: string[] = []
  let previous_colors_end: string[] = []

  // Grow-only: three caches TSL materials by mesh uuid, so recreating on shrink is expensive.
  // Derived, not state+effect: an effect would first render at capacity 0 and build twice.
  let instance_count = $derived(count_bond_instances(bonds))
  let peak_capacity = 0
  let capacity = $derived((peak_capacity = Math.max(peak_capacity, instance_count)))
  $effect(() => {
    if (!mesh || mesh === allocated_mesh) return
    allocated_mesh?.dispose()
    allocated_mesh = mesh
  })

  // Appearance knobs live in uniforms so tweaking them mutates the existing material rather
  // than rebuilding the node graph (a $derived would leak a material per lighting change).
  const ambient_intensity = uniform(0.7)
  const directional_intensity = uniform(0.3)

  // Blend atom colors along pre-transform cylinder Y via varyings. Instancing mutates
  // positionLocal, while positionGeometry stays in the cylinder's local [-0.5, 0.5] range.
  // Fragment InstancedBufferAttribute reads mid-mix under WebGPU. Lambert is fixed-dir.
  const color_start = attribute(`instanceColorStart`, `vec3`).toVarying(`vBondColorStart`)
  const color_end = attribute(`instanceColorEnd`, `vec3`).toVarying(`vBondColorEnd`)
  const cylinder_t = positionGeometry.y.add(0.5).toVarying(`vBondCylinderT`)
  // @ts-expect-error — toVarying typed as VaryingNode<string>; runtime keeps float/vec3
  const gradient = mix(color_start, color_end, cylinder_t)
  const luma = dot(gradient, vec3(0.299, 0.587, 0.114))
  const tinted = mix(vec3(luma), gradient, uniform(0.5)).mul(uniform(0.7))
  const diffuse = dot(normalView, vec3(1, 1, 1).normalize()).max(0)
  const bond_color = tinted.mul(ambient_intensity.add(directional_intensity.mul(diffuse)))

  $effect(() => {
    if (!mesh) return

    const matrix_buffer = mesh.instanceMatrix.array
    // Capacity growth remounts the InstancedMesh. Hide the outgoing mesh during that same
    // flush instead of writing past its old buffer or briefly displaying stale bonds.
    if (matrix_buffer.length < instance_count * 16) {
      mesh.count = 0
      invalidate()
      return
    }
    mesh.count = write_bond_instance_matrices(matrix_buffer, bonds, thickness)
    mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16)
    mesh.instanceMatrix.needsUpdate = true
    invalidate()
  })

  $effect(() => {
    if (!mesh) return
    if (mesh.instanceMatrix.array.length < instance_count * 16) return

    // Grow color buffers with mesh capacity; shrinking only lowers mesh.count.
    let colors_reallocated = false
    if (colors_start.length < capacity * 3) {
      colors_start = new Float32Array(capacity * 3)
      colors_end = new Float32Array(capacity * 3)
      colors_reallocated = true
    }

    let first_changed_idx = instance_count
    let last_changed_idx = -1
    let instance_idx = 0
    for (const bond of bonds) {
      const instance_color_start = site_colors[bond.site_idx_1]
      const instance_color_end = site_colors[bond.site_idx_2]
      if (instance_color_start === undefined || instance_color_end === undefined) {
        throw new RangeError(
          `Missing bond endpoint color for site indices ${bond.site_idx_1}, ${bond.site_idx_2}`,
        )
      }
      const bond_instance_count = get_bond_instance_count(bond)
      for (let order_idx = 0; order_idx < bond_instance_count; order_idx++) {
        if (
          colors_reallocated ||
          previous_colors_start[instance_idx] !== instance_color_start
        ) {
          write_linear_color_to_buffer(colors_start, instance_idx, instance_color_start)
          previous_colors_start[instance_idx] = instance_color_start
          first_changed_idx = Math.min(first_changed_idx, instance_idx)
          last_changed_idx = instance_idx
        }
        if (colors_reallocated || previous_colors_end[instance_idx] !== instance_color_end) {
          write_linear_color_to_buffer(colors_end, instance_idx, instance_color_end)
          previous_colors_end[instance_idx] = instance_color_end
          first_changed_idx = Math.min(first_changed_idx, instance_idx)
          last_changed_idx = instance_idx
        }
        instance_idx += 1
      }
    }
    previous_colors_start.length = instance_count
    previous_colors_end.length = instance_count

    // Update geometry color attributes
    const { geometry } = mesh
    for (const [name, buffer] of [
      [`instanceColorStart`, colors_start],
      [`instanceColorEnd`, colors_end],
    ] as const) {
      const existing = geometry.getAttribute(name)
      if (existing instanceof InstancedBufferAttribute && existing.array === buffer) {
        if (last_changed_idx >= 0) {
          existing.clearUpdateRanges()
          existing.addUpdateRange(
            first_changed_idx * 3,
            (last_changed_idx - first_changed_idx + 1) * 3,
          )
          existing.needsUpdate = true
        }
      } else geometry.setAttribute(name, new InstancedBufferAttribute(buffer, 3))
    }
    if (colors_reallocated || last_changed_idx >= 0) invalidate()
  })

  // Colors are uploaded in linear space; the renderer applies tone mapping and sRGB output.
  // The old GLSL shader wrote gl_FragColor and so escaped tone mapping — node materials have
  // no per-material opt-out, so bonds are now tone-mapped like everything else in the scene.
  const bond_material = new MeshBasicNodeMaterial()
  bond_material.colorNode = bond_color

  $effect(() => {
    ambient_intensity.value = ambient_light
    directional_intensity.value = directional_light
    invalidate()
  })

  $effect(() => () => bond_material.dispose())
</script>

<T.InstancedMesh
  args={[undefined, bond_material, capacity]}
  bind:ref={mesh}
  frustumCulled={false}
>
  <T.CylinderGeometry args={[1, 1, 1, 8]} />
</T.InstancedMesh>
