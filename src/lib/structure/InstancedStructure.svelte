<script lang="ts">
  // The structure's bulk geometry in a handful of draw calls regardless of site count:
  // instanced spheres for full-occupancy atoms (base and PBC images, which ghost in edit-atoms
  // mode), instanced wedges for partial occupancy, instanced bond cylinders, and coordination
  // polyhedra merged into one face mesh plus one edge LineSegments2. Owns the GPU resources
  // and their per-frame color/buffer updates; picking resolves hits through instanceId.
  import { element_from_atomic_number } from '#lib/element/helpers.js'
  import type { ElementSymbol } from '#lib/element/index.js'
  import type { HoverHandlers } from '#lib/scene/index.js'
  import type { AnyStructure } from '#lib/structure/index.js'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { type BufferGeometry, DoubleSide } from 'three/webgpu'
  import type { AtomColorField } from './atom-color-field'
  import type { AtomGroups, RenderAtom } from './atom-groups'
  import type { AtomPropertyColors } from './atom-properties'
  import Bond from './Bond.svelte'
  import type { BondData } from './bond-rendering'
  import { get_majority_element } from './bonding'
  import InstancedAtoms from './InstancedAtoms.svelte'
  import { PartialAtoms } from './partial-atoms'
  import { disable_raycast } from './scene-picking.svelte'
  import type { PolyhedraColorMode, Polyhedron } from './polyhedra'
  import {
    create_fat_segments,
    merge_polyhedra_buffers,
    update_fat_segments,
    update_polyhedra_faces,
  } from './polyhedra'
  import { numeric_sites, site_count, snapshot_topologies } from './site'

  let {
    structure,
    palette,
    property_colors,
    atom_groups,
    atom_opacity,
    atom_color_field,
    sphere_segments,
    ghost_images,
    atom_events,
    bonds,
    bond_color,
    bond_thickness,
    bonds_capped,
    ambient_light,
    directional_light,
    polyhedra,
    polyhedra_color_mode,
    polyhedra_color,
    polyhedra_opacity,
    polyhedra_show_edges,
  }: {
    structure: AnyStructure | undefined
    palette: Record<string, string> // element colors
    property_colors: AtomPropertyColors | null // per-site colors overriding the palette
    atom_groups: AtomGroups
    atom_opacity: number
    atom_color_field?: AtomColorField
    sphere_segments: number
    ghost_images: boolean // edit-atoms mode: image atoms ghost and take no pointer events
    atom_events: (atoms: RenderAtom[]) => HoverHandlers // pointer handlers for one mesh's records
    bonds: BondData
    bond_color: string // fallback for sites without an element color
    bond_thickness: number
    bonds_capped: boolean
    ambient_light: number
    directional_light: number
    polyhedra: Polyhedron[]
    polyhedra_color_mode: PolyhedraColorMode
    polyhedra_color: string // used when polyhedra_color_mode is 'uniform'
    polyhedra_opacity: number
    polyhedra_show_edges: boolean
  } = $props()

  const { invalidate } = useThrelte()

  // Majority element per site index, read from numeric columns (when present) without
  // decoding Site records. Looks the columns up once, not per site.
  const site_elements = (
    source: AnyStructure,
  ): ((site_idx: number) => ElementSymbol | null | undefined) => {
    const columns = numeric_sites.get(source)
    if (columns) return (site_idx) => element_from_atomic_number(columns.numbers[site_idx])
    const { sites } = source // once: on a $state proxy every read is a signal read
    return (site_idx) => get_majority_element(sites[site_idx])
  }

  // Partial-occupancy wedges: a few instanced meshes regardless of site count, picked per site
  const partial_atoms = new PartialAtoms()
  $effect(() => {
    partial_atoms.update(atom_groups.partial, ghost_images, sphere_segments, atom_color_field)
    invalidate()
  })
  $effect(() => {
    partial_atoms.set_opacity(atom_opacity)
    invalidate()
  })
  $effect(() => () => partial_atoms.dispose())

  let previous_bond_colors:
    | { topology: object; appearance: string; colors: string[] }
    | undefined
  const bond_appearance = $derived(JSON.stringify([palette, bond_color]))
  let bond_site_colors = $derived.by(() => {
    if (!structure || bonds.length === 0) return []

    const topology = snapshot_topologies.get(structure)
    const appearance = bond_appearance
    if (
      topology &&
      previous_bond_colors?.topology === topology &&
      previous_bond_colors.appearance === appearance
    )
      return previous_bond_colors.colors

    // Resolve once per site, not once per bond endpoint. Bond writes these values directly
    // into its persistent instance-color buffers without allocating per-cylinder objects.
    const [element_colors, fallback_color] = [palette, bond_color]
    const color_of = (element: ElementSymbol | null | undefined) =>
      (element && element_colors[element]) || fallback_color
    const element_of = site_elements(structure)
    const resolved_colors = Array.from(
      { length: site_count(structure) },
      (_unused, site_idx) => color_of(element_of(site_idx)),
    )
    previous_bond_colors = topology
      ? { topology, appearance, colors: resolved_colors }
      : undefined
    return resolved_colors
  })

  // Face opacity and edge visibility don't rebuild buffers; recoloring doesn't rebuild hulls.
  let polyhedra_buffers = $derived.by(() => {
    if (polyhedra.length === 0) return null
    const element_of = structure && site_elements(structure)
    const prop_colors = property_colors?.colors
    const element_colors = palette
    const mode = polyhedra_color_mode
    const site_color = (site_idx: number) => {
      const element = element_of?.(site_idx)
      return prop_colors?.[site_idx] ?? (element && element_colors?.[element]) ?? `#808080`
    }
    return merge_polyhedra_buffers(
      polyhedra,
      mode === `uniform` ? { mode, color: polyhedra_color } : { mode, site_color },
    )
  })

  // One face geometry rewritten in place across frames, replaced only when a frame outgrows it
  let polyhedra_faces: BufferGeometry | null = $state.raw(null)
  $effect(() => {
    if (!polyhedra_buffers?.triangle_count) return
    polyhedra_faces = update_polyhedra_faces(
      untrack(() => polyhedra_faces),
      polyhedra_buffers,
    )
    invalidate()
  })
  $effect(() => () => polyhedra_faces?.dispose())

  let polyhedra_edges: ReturnType<typeof create_fat_segments> | null = $state.raw(null)
  $effect(() => {
    if (!polyhedra_show_edges || !polyhedra_buffers?.edge_count) return
    const current = untrack(() => polyhedra_edges)
    const { edge_positions, edge_colors } = polyhedra_buffers
    if (current) update_fat_segments(current, edge_positions, edge_colors)
    else polyhedra_edges = create_fat_segments(edge_positions, edge_colors)
    invalidate()
  })
  $effect(() => () => {
    polyhedra_edges?.geometry.dispose()
    polyhedra_edges?.material.dispose()
  })
</script>

<!-- One InstancedMesh for base atoms and one for PBC image atoms (which ghost + lose
  interaction in edit-atoms mode). Pointer events are resolved via raycast instanceId. -->
{#each [`base`, `image`] as const as group (group)}
  {@const atoms = atom_groups[group]}
  {@const ghost = group === `image` && ghost_images}
  {#if atoms.length > 0}
    <InstancedAtoms
      {atoms}
      opacity={atom_opacity}
      color_field={atom_color_field}
      {sphere_segments}
      {ghost}
      {...ghost ? {} : atom_events(atoms)}
    />
  {/if}
{/each}

<!-- Partial-occupancy wedges and vacancy caps; instanceId is a site's first wedge -->
{#if atom_groups.partial.length > 0}
  <T is={partial_atoms} {...atom_events(atom_groups.partial)} dispose={false} />
{/if}

{#if bonds.length > 0}
  <Bond
    {bonds}
    site_colors={bond_site_colors}
    thickness={bond_thickness}
    capped={bonds_capped}
    {ambient_light}
    {directional_light}
  />
{/if}

<!-- Coordination polyhedra: all faces in one merged mesh, edges in one
  LineSegments2 (1-2 draw calls regardless of supercell size) -->
{#if polyhedra_faces && polyhedra_buffers?.triangle_count}
  <T.Mesh geometry={polyhedra_faces} frustumCulled={false} oncreate={disable_raycast}>
    <!-- depthWrite when mostly opaque: VESTA-like occlusion between polyhedra;
      fully translucent settings fall back to see-through blending -->
    <T.MeshStandardMaterial
      vertexColors
      transparent={polyhedra_opacity < 1}
      opacity={polyhedra_opacity}
      side={DoubleSide}
      depthWrite={polyhedra_opacity >= 0.65}
      flatShading
    />
  </T.Mesh>
  {#if polyhedra_edges}
    <T
      is={polyhedra_edges}
      visible={polyhedra_show_edges && Boolean(polyhedra_buffers?.edge_count)}
      dispose={false}
    />
  {/if}
{/if}
