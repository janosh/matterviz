<script lang="ts">
  import { grow_capacity } from '#lib/math.js'
  import type { BondData } from '#lib/structure/bond-rendering.js'
  import { prepare_bond_placements, BondFrame } from '#lib/structure/bond-rendering.js'
  import { T, useThrelte } from '@threlte/core'
  import { attribute, dot, mix, normalView, positionGeometry, uniform, vec3 } from 'three/tsl'
  import { BondMesh, set_bond_placement } from './bond-mesh'
  import { Color, CylinderGeometry, MeshBasicNodeMaterial } from 'three/webgpu'
  import { css_to_linear_rgb } from '#lib/scene/colors.js'

  let {
    bonds,
    site_colors,
    bond_colors,
    thickness,
    ambient_light,
    directional_light,
    capped = true,
  }: {
    bonds: BondData
    site_colors: string[]
    // per-bond colors (index-aligned with bonds) replacing the site gradient where defined,
    // drawn as given so they match a color bar (the site-colored rest stays muted)
    bond_colors?: readonly (string | undefined)[]
    thickness: number
    ambient_light: number
    directional_light: number
    capped?: boolean // end discs, needed only where no opaque atom covers a bond end
  } = $props()

  const { invalidate } = useThrelte()

  const cylinder_geometry = $derived(new CylinderGeometry(1, 1, 1, 8, 1, !capped))
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
  const gradient = mix(color_start, color_end, cylinder_t)
  const luma = dot(gradient, vec3(0.299, 0.587, 0.114))
  // Atom-colored bonds are muted (half saturation, 70% brightness) so atoms stand out. With
  // bond_colors the shader draws as given and mute() mutes site colors on the CPU (to 8-bit sRGB).
  const [muted_saturation, muted_brightness] = [0.5, 0.7]
  const saturation = uniform(muted_saturation)
  const brightness = uniform(muted_brightness)
  const tinted = mix(vec3(luma), gradient, saturation).mul(brightness)
  const scratch_color = new Color()
  const mute = (css: string): string => {
    const [red, green, blue] = css_to_linear_rgb(css)
    const luma_value = 0.299 * red + 0.587 * green + 0.114 * blue
    const tone = (val: number) =>
      muted_brightness * (luma_value + muted_saturation * (val - luma_value))
    return scratch_color.setRGB(tone(red), tone(green), tone(blue)).getStyle()
  }
  // a boolean, so per-hover override arrays don't re-mute every site color
  const overriding = $derived(bond_colors !== undefined)
  const drawn_site_colors = $derived(overriding ? site_colors.map(mute) : site_colors)
  // Linear RGB per site, resolved once per palette rather than per cylinder and frame
  const site_rgb = $derived(
    Float32Array.from(drawn_site_colors.flatMap((css) => css_to_linear_rgb(css))),
  )
  const diffuse = dot(normalView, vec3(1, 1, 1).normalize()).max(0)
  const bond_color = tinted.mul(ambient_intensity.add(directional_intensity.mul(diffuse)))
  // Colors are uploaded in linear space; the renderer applies tone mapping and sRGB output.
  const bond_material = new MeshBasicNodeMaterial()
  bond_material.colorNode = bond_color
  set_bond_placement(bond_material, radius_scale)
  let mesh = $derived(new BondMesh(cylinder_geometry, bond_material, capacity))

  $effect(() => {
    mesh.update(placements)
    invalidate()
  })
  $effect(() => {
    mesh.thickness = thickness
    radius_scale.value = thickness
    invalidate()
  })

  $effect(() => {
    if (mesh.update_colors(bonds, placements, site_rgb, uniform_color, bond_colors))
      invalidate()
  })

  $effect(() => {
    ambient_intensity.value = ambient_light
    directional_intensity.value = directional_light
    saturation.value = overriding ? 1 : muted_saturation
    brightness.value = overriding ? 1 : muted_brightness
    invalidate()
  })

  $effect(() => {
    const current = mesh
    return () => current.dispose()
  })
  $effect(() => {
    const current = cylinder_geometry
    return () => current.dispose()
  })
  $effect(() => () => bond_material.dispose())
</script>

<T is={mesh} dispose={false} />
