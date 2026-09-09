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

  $effect(() => {
    material.transparent = ghost
    material.opacity = ghost ? 0.5 : 1
    material.needsUpdate = true
    invalidate()
  })

  // Keep resources across updates: disposing/re-uploading unchanged geometry can also
  // abort Svelte's flush after a failed GPU upload, leaving stale atoms and bonds.
  let mesh = $state.raw<AtomInstances | null>(null)
  let colored_css: (string | undefined)[] = []
  let colored_ghost = false
  $effect(() => {
    let current = untrack(() => mesh)
    if (!current && atoms.length === 0) return
    const segments = Math.min(detail_segments, sphere_segments)
    const geometry =
      current?.geometry.parameters.widthSegments === segments
        ? current.geometry
        : new SphereGeometry(0.5, segments, segments)
    if (current && current.geometry !== geometry) current.geometry.dispose()
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
    // Detail changes can alter the sphere's exact float32 bounds.
    current.geometry = geometry
    current.update_atoms(atoms)
    invalidate()
  })
  // Dispose only on unmount, never on updates that reuse a resource.
  $effect(() => () => {
    mesh?.dispose()
    mesh?.geometry.dispose()
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
    const current = mesh
    if (!current) return
    // Slots can change element mid-scrub even when the grow-only mesh is reused.
    if (
      ghost === colored_ghost &&
      colored_css.length === atoms.length &&
      atoms.every(({ color }, idx) => color === colored_css[idx])
    )
      return
    // set_linear_css_color caches the CSS parse per distinct color (a handful here, >10k atoms)
    colored_css.length = atoms.length
    for (let idx = 0; idx < atoms.length; idx++) {
      const css_color = atoms[idx].color
      set_linear_css_color(css_color ?? `#999999`, scratch_color)
      if (ghost) scratch_color.lerp(gray, 0.4)
      current.setColorAt(idx, scratch_color)
      colored_css[idx] = css_color
    }
    if (current.instanceColor) current.instanceColor.needsUpdate = true
    colored_ghost = ghost
    invalidate()
  })
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} />
{/if}
