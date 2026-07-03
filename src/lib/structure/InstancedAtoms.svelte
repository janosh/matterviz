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
  import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, SphereGeometry } from 'three'

  type InstancedAtom = {
    position: Vec3
    radius: number
    color?: string
  }

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

  let geometry = $state.raw<SphereGeometry | null>(null)
  $effect(() => {
    const geo = new SphereGeometry(0.5, sphere_segments, sphere_segments)
    geometry = geo
    return () => geo.dispose()
  })

  // Recreate the mesh only when capacity must change (instanceMatrix buffer size
  // is fixed at construction); data updates just rewrite the buffers below.
  let mesh = $state.raw<InstancedMesh | null>(null)
  $effect(() => {
    const count = atoms.length
    const prev = untrack(() => mesh)
    if (prev && prev.count === count) return
    prev?.dispose()
    if (count === 0) {
      mesh = null
      return
    }
    const next = new InstancedMesh(untrack(() => geometry) ?? undefined, material, count)
    next.frustumCulled = false
    // export.ts reads per-instance colors (instead of the material color) when set
    next.userData.per_instance_color = true
    mesh = next
  })
  // Unmount-only cleanup (a cleanup on the effect above would dispose the mesh
  // on every re-run, including runs that keep it)
  $effect(() => () => untrack(() => mesh)?.dispose())

  $effect(() => {
    if (mesh && geometry && mesh.geometry !== geometry) {
      mesh.geometry = geometry
      invalidate()
    }
  })

  const scratch_matrix = new Matrix4()
  const scratch_color = new Color()
  const gray = new Color(0x999999)

  $effect(() => {
    const current = mesh
    if (!current) return
    const limit = Math.min(atoms.length, current.count)
    for (let idx = 0; idx < limit; idx++) {
      const { position, radius, color } = atoms[idx]
      scratch_matrix
        .makeScale(radius, radius, radius)
        .setPosition(position[0], position[1], position[2])
      current.setMatrixAt(idx, scratch_matrix)
      scratch_color.set(color ?? `#999999`)
      if (ghost) scratch_color.lerp(gray, 0.4)
      current.setColorAt(idx, scratch_color)
    }
    current.instanceMatrix.needsUpdate = true
    if (current.instanceColor) current.instanceColor.needsUpdate = true
    // keep the whole-mesh bounding sphere in sync so raycasts can early-reject
    current.computeBoundingSphere()
    invalidate()
  })
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} />
{/if}
