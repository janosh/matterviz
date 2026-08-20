<script lang="ts">
  // All atoms of one visual class (base or ghosted PBC image) in a single
  // THREE.InstancedMesh: one draw call and zero per-atom Svelte components.
  // Per-atom colors live in the instanceColor buffer, per-atom position/radius
  // in the instanceMatrix buffer. Pointer handlers spread onto the mesh receive
  // threlte intersection events whose `instanceId` indexes into `atoms`.
  //
  // This replaces one <extras.Instance> component (plus one scene-graph Group and
  // one interactivity registration) per atom, which made structure changes on
  // supercells block the main thread for seconds and hover raycasts O(n²).
  import type { Vec3 } from '$lib/math'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    Color,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    SphereGeometry,
  } from 'three/webgpu'

  type InstancedAtom = {
    position: Vec3
    radius: number
    color?: string
  }

  let {
    atoms,
    sphere_segments = 20,
    ghost = false,
    positions_only = false,
    ...pointer_props
  }: {
    atoms: InstancedAtom[]
    sphere_segments?: number
    // edit-mode PBC image atoms: desaturated + translucent
    ghost?: boolean
    // Fast trajectory-scrub path: apply positions/radii but skip unchanged color uploads.
    positions_only?: boolean
    // threlte interactivity handlers (onpointerenter, onclick, ...) forwarded to the mesh
    [key: string]: unknown
  } = $props()

  const { invalidate } = useThrelte()

  // One material shared across mesh recreations; per-atom colors come from the
  // instanceColor buffer so the base color stays white.
  const material = new MeshStandardMaterial()
  $effect(() => () => material.dispose())

  $effect(() => {
    material.transparent = ghost
    material.opacity = ghost ? 0.5 : 1
    material.needsUpdate = true
    invalidate()
  })

  // Rebuilt only when the segment count really changes. The prop's signal fires on
  // unrelated scene updates (hiding an element, editing bonds, ...) with an unchanged
  // value, and an effect keyed on it alone would dispose + re-upload the sphere on every
  // one of them. Beyond the wasted uploads, disposing a geometry whose GPU buffer never
  // got created throws from inside the effect teardown, and that abandons the rest of
  // Svelte's flush: atom meshes keep the previous element's counts and bonds render
  // colorless. Software WebGPU hits exactly this by rejecting the sphere upload.
  // Both reads capture the initial value on purpose - the effect below owns every later
  // change, keyed on built_segments so an unchanged value is a no-op
  // svelte-ignore state_referenced_locally
  let geometry = $state.raw(new SphereGeometry(0.5, sphere_segments, sphere_segments))
  // svelte-ignore state_referenced_locally
  let built_segments = sphere_segments
  $effect(() => {
    if (sphere_segments === built_segments) return
    built_segments = sphere_segments
    const prev = untrack(() => geometry)
    geometry = new SphereGeometry(0.5, sphere_segments, sphere_segments)
    prev.dispose()
  })
  $effect(() => () => geometry.dispose()) // unmount-only, cleanups run untracked

  // Grow-only capacity (three caches TSL by mesh uuid); shrink via mesh.count.
  let mesh = $state.raw<InstancedMesh | null>(null)
  $effect(() => {
    const count = atoms.length
    const prev = untrack(() => mesh)
    if (prev && prev.instanceMatrix.count >= count) {
      prev.count = count
      invalidate()
      return
    }
    prev?.dispose()
    if (count === 0) {
      mesh = null
      return
    }
    const next = new InstancedMesh(
      untrack(() => geometry),
      material,
      count,
    )
    next.frustumCulled = false
    mesh = next
  })
  // Unmount-only cleanup (a cleanup on the effect above would dispose the mesh
  // on every re-run, including runs that keep it; cleanups run untracked)
  $effect(() => () => mesh?.dispose())
  $effect(() => {
    if (mesh && mesh.geometry !== geometry) {
      mesh.geometry = geometry
      invalidate()
    }
  })

  const scratch_matrix = new Matrix4()
  $effect(() => {
    const current = mesh
    if (!current) return
    const limit = Math.min(atoms.length, current.count)
    for (let idx = 0; idx < limit; idx++) {
      const { position, radius } = atoms[idx]
      scratch_matrix
        .makeScale(radius, radius, radius)
        .setPosition(position[0], position[1], position[2])
      current.setMatrixAt(idx, scratch_matrix)
    }
    current.instanceMatrix.needsUpdate = true
    // keep the whole-mesh bounding sphere in sync so raycasts can early-reject
    current.computeBoundingSphere()
    invalidate()
  })

  const gray = new Color(0x999999)
  let colored_mesh: InstancedMesh | null = null
  $effect(() => {
    const current = mesh
    if (!current || (positions_only && current === colored_mesh)) return
    const limit = Math.min(atoms.length, current.count)
    // Color.set(string) parses CSS with regexes. Atoms draw from a handful of distinct
    // colors, so resolve each one once per update instead of once per atom (>10k here).
    // Plain Map: a scratch cache scoped to this effect run, so reactive entries would only
    // add a signal per color.
    const resolved = new Map<string | undefined, Color>()
    const resolve_color = (color: string | undefined): Color => {
      let hit = resolved.get(color)
      if (!hit) {
        hit = color === undefined ? gray.clone() : new Color(color)
        resolved.set(color, ghost ? hit.lerp(gray, 0.4) : hit)
      }
      return hit
    }
    for (let idx = 0; idx < limit; idx++) {
      const { color } = atoms[idx]
      current.setColorAt(idx, resolve_color(color))
    }
    if (current.instanceColor) current.instanceColor.needsUpdate = true
    colored_mesh = current
    invalidate()
  })
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} />
{/if}
