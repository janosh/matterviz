<script lang="ts">
  // Edit-bonds raycast targets: one invisible target holding a hit cylinder per editable bond
  // (plus a translucent highlight on the hovered one) and one holding a hit sphere per selectable
  // atom. Each raycast tests its cylinders/spheres one by one and reports the hit's index as
  // instanceId, which Threlte tracks hover by as for instanced meshes. A Threlte mesh per bond
  // and atom took 9 s to enter edit mode on a 5k-atom cell (each registration scans an array of
  // all others) and ran out of memory at 48k. A press near a bond end picks that end's atom; in
  // delete mode a press removes the bond.
  import type { Vec3 } from '#lib/math.js'
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { HoverHandlers } from '#lib/scene/index.js'
  import type { BondEditMode, BondPair, Site } from '#lib/structure/index.js'
  import { T } from '@threlte/core'
  import {
    CylinderGeometry,
    type Intersection,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    type Object3D,
    Ray,
    type Raycaster,
    Sphere,
    Vector3,
  } from 'three/webgpu'
  import type { SiteAnchor } from './atom-groups'
  import { raycast_bond } from './bond-mesh'
  import { rendered_bond_key_for } from './bonding'
  import { write_bond_transform } from './bond-rendering'
  import { cutaway_excludes, cutaway_planes } from './cutaway'
  import {
    bond_endpoint_hit_site_idx,
    bond_menu_position,
    disable_raycast,
  } from './scene-picking.svelte'

  // Threlte wraps the DOM event and adds the intersection (hit object, world point, instance)
  type ThrelteEvent<DomEvent extends Event> = DomEvent & {
    nativeEvent?: DomEvent
    object?: Object3D
    point?: Vector3
    instanceId?: number
  }

  let {
    bonds,
    atom_targets,
    sites,
    mode,
    bond_thickness,
    hovered_bond_key = $bindable(null),
    atom_events,
    on_select_site,
    on_delete_bond,
    on_bond_menu,
  }: {
    bonds: readonly BondPair[] // editable bonds (no image endpoints)
    atom_targets: readonly SiteAnchor[] // selectable atoms (add mode only)
    sites: readonly Site[] | undefined // for resolving a bond end to the PBC image drawn there
    mode: BondEditMode
    bond_thickness: number
    hovered_bond_key?: string | null
    // the atom targets' hover and press, their events' instanceId indexing atom_targets
    atom_events: HoverHandlers
    on_select_site: (site_idx: number, event: Event) => void // a press near a bond end
    on_delete_bond: (bond: BondPair) => void
    on_bond_menu: (bond: BondPair, position: Vec3) => void
  } = $props()

  // Slightly larger than the drawn atom so a press at its rim still selects it
  const ATOM_HIT_RADIUS_SCALE = 1.15
  const is_delete_mode = $derived(mode === `delete`)
  const bond_hit_radius = $derived(bond_thickness * (is_delete_mode ? 5 : 1.25))
  // Each hovered key is matched against every bond, so key them once per bond list
  const bond_keys = $derived(bonds.map(rendered_bond_key_for))
  // Every copy of the hovered bond (a whole-atom cutaway draws a periodic bond at both ends)
  const highlighted = $derived(
    hovered_bond_key === null
      ? []
      : bonds.filter((_bond, idx) => bond_keys[idx] === hovered_bond_key),
  )

  const bond_hit_geometry = new CylinderGeometry(1, 1, 1, 6)
  const hit_material = new MeshBasicMaterial()
  const bond_target = new Mesh(bond_hit_geometry, hit_material)
  const atom_target = new Mesh(undefined, hit_material)
  $effect(() => () => {
    bond_hit_geometry.dispose()
    hit_material.dispose()
  })

  // Raycast scratch: one hit cylinder posed per bond, rays and spheres in the targets' space
  const bond_matrix = new Float32Array(16)
  const hit_cylinder = new Mesh(bond_hit_geometry, hit_material)
  const [local_matrix, inverse] = [new Matrix4(), new Matrix4()]
  const local_ray = new Ray()
  const [bond_center, sphere_point, world_center] = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ]
  const hit_sphere = new Sphere()
  const candidates: Intersection[] = []

  const set_bond_transform = (mesh: Mesh, bond: BondPair, radius: number): void => {
    write_bond_transform(bond_matrix, 0, bond.pos_1, bond.pos_2, radius)
    mesh.matrix.fromArray(bond_matrix)
    mesh.matrixWorldNeedsUpdate = true
  }
  // Highlights keep their meshes while the hovered bond moves (trajectory frames) or the
  // thickness changes, so their transforms are rewritten here rather than only on creation
  const highlight_meshes = new Map<number, Mesh>()
  $effect(() => {
    for (const [idx, bond] of highlighted.entries()) {
      const mesh = highlight_meshes.get(idx)
      if (mesh) set_bond_transform(mesh, bond, bond_thickness * 1.1)
    }
  })

  // Under a cutaway each bond is tested on its drawn strands (raycast_bond), else on its hit
  // cylinder; either way hits on the cut-away side are dropped, as in enable_cutaway_picking
  bond_target.raycast = (raycaster: Raycaster, hits: Intersection[]): void => {
    bond_target.updateWorldMatrix(true, false)
    const { matrixWorld } = bond_target
    const planes = cutaway_planes(bond_target)
    local_ray.copy(raycaster.ray).applyMatrix4(inverse.copy(matrixWorld).invert())
    const [radius, thickness] = [bond_hit_radius, bond_thickness]
    for (const [bond_idx, bond] of bonds.entries()) {
      // skip bonds the ray passes wide of: half the length plus a triple bond's outer strand
      // (2.35 radii off the axis)
      const [pos_1, pos_2] = [bond.pos_1, bond.pos_2]
      bond_center.set(
        (pos_1[0] + pos_2[0]) / 2,
        (pos_1[1] + pos_2[1]) / 2,
        (pos_1[2] + pos_2[2]) / 2,
      )
      const reach =
        Math.hypot(pos_2[0] - pos_1[0], pos_2[1] - pos_1[1], pos_2[2] - pos_1[2]) / 2 +
        2.5 * radius
      if (local_ray.distanceSqToPoint(bond_center) > reach * reach) continue
      const first = candidates.length
      if (planes.length)
        raycast_bond(bond_target, bond, thickness, raycaster, candidates, radius)
      else {
        write_bond_transform(bond_matrix, 0, pos_1, pos_2, radius)
        hit_cylinder.matrixWorld.multiplyMatrices(
          matrixWorld,
          local_matrix.fromArray(bond_matrix),
        )
        hit_cylinder.raycast(raycaster, candidates)
      }
      for (let idx = first; idx < candidates.length; idx++)
        candidates[idx] = { ...candidates[idx], object: bond_target, instanceId: bond_idx }
    }
    for (const hit of candidates) if (!cutaway_excludes(planes, hit.point)) hits.push(hit)
    candidates.length = 0
  }

  // Full analytic spheres (a triangle test can miss exactly at a pole). Under a cutaway a target
  // keeps its size but can't resurrect an atom the cutaway removes entirely.
  atom_target.raycast = (raycaster: Raycaster, hits: Intersection[]): void => {
    atom_target.updateWorldMatrix(true, false)
    const { matrixWorld } = atom_target
    const planes = cutaway_planes(atom_target)
    const world_scale = matrixWorld.getMaxScaleOnAxis()
    local_ray.copy(raycaster.ray).applyMatrix4(inverse.copy(matrixWorld).invert())
    for (const [atom_idx, { position, radius }] of atom_targets.entries()) {
      hit_sphere.center.fromArray(position)
      hit_sphere.radius = 0.5 * radius * ATOM_HIT_RADIUS_SCALE
      if (!local_ray.intersectSphere(hit_sphere, sphere_point)) continue
      world_center.fromArray(position).applyMatrix4(matrixWorld)
      if (cutaway_excludes(planes, world_center, 0.5 * radius * world_scale)) continue
      sphere_point.applyMatrix4(matrixWorld)
      if (cutaway_excludes(planes, sphere_point)) continue
      const distance = raycaster.ray.origin.distanceTo(sphere_point)
      if (distance < raycaster.near || distance > raycaster.far) continue
      hits.push({
        distance,
        point: sphere_point.clone(),
        object: atom_target,
        instanceId: atom_idx,
      })
    }
  }

  const event_bond = (event: { instanceId?: number }): BondPair | undefined =>
    bonds[event.instanceId ?? -1]

  function on_bond_press(event: ThrelteEvent<PointerEvent>): void {
    const bond = event_bond(event)
    if (!bond || event.nativeEvent?.button === 2) return
    if (is_delete_mode) {
      on_delete_bond(bond)
      hovered_bond_key = null
      return
    }
    const endpoint_site_idx = bond_endpoint_hit_site_idx(
      bond,
      event.point,
      event.object?.parent,
      sites,
    )
    if (endpoint_site_idx != null) on_select_site(endpoint_site_idx, event)
  }
  const hover_bond = (event: ThrelteEvent<PointerEvent>): void => {
    hovered_bond_key = bond_keys[event.instanceId ?? -1] ?? null
  }
</script>

<!-- delete mode: a bond under the cursor wins over atoms in front of it (pick_rank),
  which ignore clicks there, so it is the one highlighted and removed -->
{#if bonds.length > 0}
  <T
    is={bond_target}
    visible={false}
    dispose={false}
    onpointerdown={on_bond_press}
    oncontextmenu={(event: ThrelteEvent<MouseEvent>) => {
      const bond = event_bond(event)
      if (!bond) return
      event.nativeEvent?.preventDefault()
      on_bond_menu(bond, bond_menu_position(bond, event.point, event.object?.parent))
    }}
    onpointerenter={hover_bond}
    onpointermove={hover_bond}
    onpointerleave={() => (hovered_bond_key = null)}
    userData={{ pick_rank: is_delete_mode ? 1 : 0 }}
  />
{/if}
{#each highlighted as bond, idx (idx)}
  <T.Mesh
    geometry={bond_hit_geometry}
    matrixAutoUpdate={false}
    oncreate={(ref) => {
      set_bond_transform(ref, bond, bond_thickness * 1.1)
      disable_raycast(ref)
      highlight_meshes.set(idx, ref)
      return () => highlight_meshes.delete(idx)
    }}
  >
    <T.MeshBasicMaterial
      transparent
      opacity={0.25}
      color={is_delete_mode ? HIGHLIGHT.emphasis : HIGHLIGHT.select}
      depthWrite={false}
    />
  </T.Mesh>
{/each}

{#if atom_targets.length > 0}
  <T is={atom_target} visible={false} dispose={false} {...atom_events} />
{/if}
