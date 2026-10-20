<script lang="ts">
  // Edit-bonds raycast targets: an invisible hit cylinder per editable bond (plus a translucent
  // highlight on the hovered one) and an invisible hit sphere per selectable atom. A press near
  // a bond end picks that end's atom; in delete mode a press removes the bond.
  import type { Vec3 } from '#lib/math.js'
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { HoverHandlers } from '#lib/scene/index.js'
  import type { BondEditMode, BondPair, Site } from '#lib/structure/index.js'
  import { T } from '@threlte/core'
  import {
    BufferGeometry,
    CylinderGeometry,
    MeshBasicMaterial,
    type Mesh,
    type Object3D,
    type Vector3,
  } from 'three/webgpu'
  import { enable_atom_sphere_picking } from './atom-instances'
  import type { SiteAnchor } from './atom-groups'
  import { raycast_bond } from './bond-mesh'
  import { rendered_bond_key_for } from './bonding'
  import { write_bond_transform } from './bond-rendering'
  import { enable_cutaway_picking } from './cutaway'
  import {
    bond_endpoint_hit_site_idx,
    bond_menu_position,
    disable_raycast,
  } from './scene-picking.svelte'

  // Threlte wraps the DOM event and adds the intersection (hit object and world point)
  type ThrelteEvent<DomEvent extends Event> = DomEvent & {
    nativeEvent?: DomEvent
    object?: Object3D
    point?: Vector3
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
    atom_events: (site_idx: number) => HoverHandlers // an atom target's hover and press
    on_select_site: (site_idx: number, event: Event) => void // a press near a bond end
    on_delete_bond: (bond: BondPair) => void
    on_bond_menu: (bond: BondPair, position: Vec3) => void
  } = $props()

  // Slightly larger than the drawn atom so a press at its rim still selects it
  const ATOM_HIT_RADIUS_SCALE = 1.15
  const is_delete_mode = $derived(mode === `delete`)
  const bond_hit_radius = $derived(bond_thickness * (is_delete_mode ? 5 : 1.25))
  const bond_matrix = new Float32Array(16)

  // Analytic atom hit targets need no vertices; share resources across all targets.
  const atom_hit_geometry = new BufferGeometry()
  const bond_hit_geometry = new CylinderGeometry(1, 1, 1, 6)
  const hit_material = new MeshBasicMaterial()
  $effect(() => () => {
    atom_hit_geometry.dispose()
    bond_hit_geometry.dispose()
    hit_material.dispose()
  })

  function apply_bond_transform(mesh: Mesh, bond: BondPair, radius: number): void {
    write_bond_transform(bond_matrix, 0, bond.pos_1, bond.pos_2, radius)
    mesh.matrix.fromArray(bond_matrix)
    mesh.matrixWorldNeedsUpdate = true
  }

  function on_bond_press(bond: BondPair, event: ThrelteEvent<PointerEvent>): void {
    if (event.nativeEvent?.button === 2) return
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
</script>

{#each bonds as bond (`bond-hit-${mode}-${rendered_bond_key_for(bond)}`)}
  {@const bond_key = rendered_bond_key_for(bond)}
  <!-- delete mode: a bond under the cursor wins over atoms in front of it (pick_rank),
  which ignore clicks there, so it is the one highlighted and removed -->
  <T.Mesh
    geometry={bond_hit_geometry}
    material={hit_material}
    visible={false}
    matrixAutoUpdate={false}
    oncreate={(ref) => {
      apply_bond_transform(ref, bond, bond_hit_radius)
      enable_cutaway_picking(ref, (raycaster, hits) =>
        raycast_bond(ref, bond, bond_thickness, raycaster, hits),
      )
    }}
    onpointerdown={(event: ThrelteEvent<PointerEvent>) => on_bond_press(bond, event)}
    oncontextmenu={(event: ThrelteEvent<MouseEvent>) => {
      event.nativeEvent?.preventDefault()
      on_bond_menu(bond, bond_menu_position(bond, event.point, event.object?.parent))
    }}
    onpointerenter={() => (hovered_bond_key = bond_key)}
    onpointermove={() => (hovered_bond_key = bond_key)}
    onpointerleave={() => (hovered_bond_key = null)}
    userData={{ pick_rank: is_delete_mode ? 1 : 0 }}
  />
  {#if hovered_bond_key === bond_key}
    <T.Mesh
      geometry={bond_hit_geometry}
      matrixAutoUpdate={false}
      oncreate={(ref) => {
        apply_bond_transform(ref, bond, bond_thickness * 1.1)
        disable_raycast(ref)
      }}
    >
      <T.MeshBasicMaterial
        transparent
        opacity={0.25}
        color={is_delete_mode ? HIGHLIGHT.emphasis : HIGHLIGHT.select}
        depthWrite={false}
      />
    </T.Mesh>
  {/if}
{/each}

{#each atom_targets as atom_hit (atom_hit.site_idx)}
  <T.Mesh
    geometry={atom_hit_geometry}
    oncreate={(ref) => enable_atom_sphere_picking(ref, 1 / ATOM_HIT_RADIUS_SCALE)}
    material={hit_material}
    visible={false}
    position={atom_hit.position}
    scale={atom_hit.radius * ATOM_HIT_RADIUS_SCALE}
    {...atom_events(atom_hit.site_idx)}
  />
{/each}
