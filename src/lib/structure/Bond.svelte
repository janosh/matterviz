<script lang="ts">
  import { grow_capacity } from '$lib/math'
  import {
    prepare_bond_placements,
    BondFrame,
    type BondData,
  } from '$lib/structure/bond-rendering'
  import { T, useThrelte } from '@threlte/core'
  import { attribute, dot, mix, normalView, positionGeometry, uniform, vec3 } from 'three/tsl'
  import { BondMesh, set_bond_placement } from './bond-mesh'
  import { CylinderGeometry, MeshBasicNodeMaterial } from 'three/webgpu'

  let {
    bonds,
    site_colors,
    thickness,
    ambient_light,
    directional_light,
  }: {
    bonds: BondData
    site_colors: string[]
    thickness: number
    ambient_light: number
    directional_light: number
  } = $props()

  const { invalidate } = useThrelte()

  const cylinder_geometry = new CylinderGeometry(1, 1, 1, 8)
  const uniform_color = $derived.by(() => {
    const color = site_colors[0]
    for (let idx = 1; idx < site_colors.length; idx++)
      if (site_colors[idx] !== color) return undefined
    return color
  })

  // Grow-only: three caches TSL materials by mesh uuid, so recreating on shrink is expensive.
  // Derived, not state+effect: an effect would first render at capacity 0 and build twice.
  const placements = $derived(
    bonds instanceof BondFrame && bonds.placements
      ? bonds.placements
      : prepare_bond_placements(bonds),
  )
  let instance_count = $derived(placements.instance_count)
  let peak_capacity = 0
  let capacity = $derived((peak_capacity = grow_capacity(peak_capacity, instance_count)))

  // Appearance knobs live in uniforms so tweaking them mutates the existing material rather
  // than rebuilding the node graph (a $derived would leak a material per lighting change).
  const ambient_intensity = uniform(0.7)
  const directional_intensity = uniform(0.3)
  const radius_scale = uniform(1)

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
  // Colors are uploaded in linear space; the renderer applies tone mapping and sRGB output.
  const bond_material = new MeshBasicNodeMaterial()
  bond_material.colorNode = bond_color
  set_bond_placement(bond_material, radius_scale)
  let mesh = $derived(new BondMesh(cylinder_geometry, bond_material, capacity))

  $effect(() => {
    const current = mesh
    current.update(placements)
    invalidate()
  })
  $effect(() => {
    mesh.thickness = thickness
    radius_scale.value = thickness
    invalidate()
  })

  $effect(() => {
    if (mesh.update_colors(bonds, placements, site_colors, uniform_color)) invalidate()
  })

  $effect(() => {
    ambient_intensity.value = ambient_light
    directional_intensity.value = directional_light
    invalidate()
  })

  $effect(() => {
    const current = mesh
    return () => current.dispose()
  })
  $effect(() => () => {
    cylinder_geometry.dispose()
    bond_material.dispose()
  })
</script>

<T is={mesh} dispose={false} />
