<script lang="ts">
  // One draw call per visual class; instanceId maps pointer events back to atoms.
  import { AtomInstances, atom_sphere_segments, type InstancedAtom } from './atom-instances'
  import { set_linear_css_color } from '$lib/scene/colors'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    Color,
    MeshStandardMaterial,
    PerspectiveCamera,
    SphereGeometry,
    Vector3,
  } from 'three/webgpu'

  let {
    atoms,
    sphere_segments = 20,
    ghost = false,
    ...pointer_props
  }: {
    atoms: InstancedAtom[]
    sphere_segments?: number
    // edit-mode PBC image atoms: desaturated + translucent
    ghost?: boolean
    // threlte interactivity handlers (onpointerenter, onclick, ...) forwarded to the mesh
    [key: string]: unknown
  } = $props()

  const { invalidate, camera, size, renderStage } = useThrelte()
  // svelte-ignore state_referenced_locally
  let detail_segments = $state(sphere_segments)

  // One material shared across mesh recreations; per-atom colors come from the
  // instanceColor buffer so the base color stays white.
  const material = new MeshStandardMaterial()

  let mesh = $state.raw<AtomInstances | null>(null)
  // Three's WebGPU geometry disposal also frees the mesh's instance attributes. Keep
  // detail geometries alive together with those shared buffers, and reuse them on zoom-out.
  const detail_geometries = new Map<number, SphereGeometry>()
  const colored_css: string[] = []
  $effect(() => {
    let current = untrack(() => mesh)
    if (!current && atoms.length === 0) return
    const segments = Math.min(detail_segments, sphere_segments)
    let geometry = detail_geometries.get(segments)
    if (!geometry) {
      geometry = new SphereGeometry(0.5, segments, segments)
      detail_geometries.set(segments, geometry)
    }
    const capacity = current?.instanceMatrix.count ?? 0
    // Grow geometrically (three caches TSL by mesh uuid); shrink via mesh.count.
    if (!current || atoms.length > capacity) {
      current?.dispose()
      current = new AtomInstances(
        geometry,
        material,
        Math.max(atoms.length, Math.ceil(capacity * 1.5)),
      )
      current.frustumCulled = false
      mesh = current
    }
    if (current.geometry !== geometry) {
      current.geometry = geometry
      // Detail changes can alter the sphere's exact float32 bounds, but not atom transforms.
      current.update_bounds()
    }
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

  const gray = new Color(0x999999)
  const scratch_color = new Color()
  $effect(() => {
    const is_ghost = ghost
    const ghost_changed = is_ghost !== material.transparent
    if (ghost_changed) {
      material.transparent = is_ghost
      material.opacity = is_ghost ? 0.5 : 1
      material.needsUpdate = true
      invalidate()
    }
    const current = mesh
    if (!current) return
    // Read through the component prop chain once, not twice per atom during recoloring.
    const instances = atoms
    const force_colors = ghost_changed || !current.instanceColor
    let first_changed = instances.length
    let last_changed = -1
    // set_linear_css_color caches the CSS parse per distinct color (a handful here, >10k atoms)
    for (let idx = 0; idx < instances.length; idx++) {
      const css_color = instances[idx].color ?? `#999999`
      if (!force_colors && css_color === colored_css[idx]) continue
      set_linear_css_color(css_color, scratch_color)
      if (is_ghost) scratch_color.lerp(gray, 0.4)
      current.setColorAt(idx, scratch_color)
      colored_css[idx] = css_color
      first_changed = Math.min(first_changed, idx)
      last_changed = idx
    }
    colored_css.length = instances.length
    if (last_changed < 0) return
    if (current.instanceColor) {
      // Preserve updates queued since the last GPU upload, including earlier changed slots.
      current.instanceColor.addUpdateRange(
        first_changed * 3,
        (last_changed - first_changed + 1) * 3,
      )
      current.instanceColor.needsUpdate = true
    }
    invalidate()
  })
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
