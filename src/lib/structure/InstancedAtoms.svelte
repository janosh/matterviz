<script lang="ts">
  import { grow_capacity } from '$lib/math'
  // One draw call per visual class; instanceId maps pointer events back to atoms.
  import { AtomInstances, atom_sphere_segments, type InstancedAtom } from './atom-instances'
  import { AtomFieldMaterial, type AtomColorField } from './atom-color-field'
  import { attribute, normalView, positionGeometry } from 'three/tsl'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    MeshStandardNodeMaterial,
    PerspectiveCamera,
    SphereGeometry,
    Vector3,
  } from 'three/webgpu'

  let {
    atoms,
    sphere_segments = 20,
    ghost = false,
    opacity = 1,
    color_field,
    ...pointer_props
  }: {
    atoms: InstancedAtom[]
    sphere_segments?: number
    // edit-mode PBC image atoms: desaturated + translucent
    ghost?: boolean
    opacity?: number
    color_field?: AtomColorField
    // threlte interactivity handlers (onpointerenter, onclick, ...) forwarded to the mesh
    [key: string]: unknown
  } = $props()

  const { invalidate, camera, size, renderStage } = useThrelte()
  // svelte-ignore state_referenced_locally
  let detail_segments = $state(sphere_segments)

  // One material shared across mesh recreations; per-atom colors come from the
  // colors buffer so the base color stays white.
  const material = new MeshStandardNodeMaterial()
  const placement = attribute<`vec4`>(`atomPositionRadius`, `vec4`)
  material.positionNode = positionGeometry.mul(placement.w).add(placement.xyz)
  material.normalNode = normalView.mul(placement.w.sign())
  material.colorNode = attribute(`atomColor`, `vec3`)

  let field_material: AtomFieldMaterial | undefined
  $effect(() => {
    if (field_material) field_material.update(color_field)
    else if (color_field) field_material = new AtomFieldMaterial(material, color_field)
    invalidate()
  })

  let mesh = $state.raw<AtomInstances | null>(null)
  // Three's WebGPU geometry disposal also frees the mesh's instance attributes. Keep
  // detail geometries alive together with those shared buffers, and reuse them on zoom-out.
  const detail_geometries = new Map<number, SphereGeometry>()
  $effect(() => {
    let current = untrack(() => mesh)
    if (!current && atoms.length === 0) return
    const segments = Math.min(detail_segments, sphere_segments)
    let geometry = detail_geometries.get(segments)
    if (!geometry) {
      geometry = new SphereGeometry(0.5, segments, segments)
      detail_geometries.set(segments, geometry)
    }
    const capacity = current?.positions.count ?? 0
    // Grow geometrically (three caches TSL by mesh uuid); shrink via mesh.count.
    if (!current || atoms.length > capacity) {
      current?.dispose()
      current = new AtomInstances(geometry, material, grow_capacity(capacity, atoms.length))
      current.frustumCulled = false
      mesh = current
    }
    current.set_geometry(geometry)
    invalidate()
  })
  $effect(() => {
    if (!mesh) return
    mesh.update_atoms(atoms)
    invalidate()
  })
  // Dispose only on unmount, never on updates that reuse a resource.
  $effect(() => () => {
    mesh?.dispose()
    for (const geometry of detail_geometries.values()) geometry.dispose()
    detail_geometries.clear()
    material.dispose()
    field_material?.texture.dispose()
  })

  const view_center = new Vector3()
  const update_detail = () => {
    const current = mesh
    const cam = camera.current
    if (!current?.boundingSphere || !cam) return
    let desired = sphere_segments
    // Small scenes retain the requested tessellation. Large scenes recover it when zoomed in.
    if (current.count >= 2000) {
      current.updateWorldMatrix(true, false)
      const world_scale = current.matrixWorld.getMaxScaleOnAxis()
      let radius_px =
        (current.max_radius *
          world_scale *
          Math.abs(cam.projectionMatrix.elements[5]) *
          size.current.height) /
        2
      if (cam instanceof PerspectiveCamera) {
        view_center
          .copy(current.boundingSphere.center)
          .applyMatrix4(current.matrixWorld)
          .applyMatrix4(cam.matrixWorldInverse)
        const depth = -view_center.z - current.boundingSphere.radius * world_scale
        // Bound perspective magnification across the entire mesh, including off-axis views.
        const lateral =
          Math.hypot(view_center.x, view_center.y) +
          current.boundingSphere.radius * world_scale
        radius_px = depth > 0 ? (radius_px / depth) * Math.hypot(1, lateral / depth) : Infinity
      }
      desired = atom_sphere_segments(radius_px, sphere_segments)
    }
    // Raise detail immediately; leave room before lowering it to avoid zoom-boundary churn.
    if (desired > detail_segments || desired <= detail_segments * 0.75)
      detail_segments = desired
  }
  useTask(update_detail, { stage: renderStage, autoInvalidate: false })
  $effect(() => {
    void $size
    update_detail()
  })

  $effect(() => {
    const alpha = opacity * (ghost ? 0.5 : 1)
    const transparent = alpha < 1
    if (material.transparent !== transparent) {
      material.transparent = transparent
      material.needsUpdate = true
    }
    material.opacity = alpha
    material.visible = alpha > 0
    invalidate()
  })
  $effect(() => {
    if (mesh?.update_colors(atoms, ghost)) invalidate()
  })
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
