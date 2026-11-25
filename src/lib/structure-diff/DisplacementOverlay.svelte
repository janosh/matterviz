<script lang="ts">
  // Scene overlay of a structure diff: translucent reference ghosts and thin arrows from each
  // ghost to its target atom. Render inside Structure's scene_children snippet.
  import { default_element_colors } from '#lib/colors/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { pack_arrows } from '#lib/structure/arrow-instances.js'
  import ArrowInstances from '#lib/structure/ArrowInstances.svelte'
  import { characteristic_atom_spacing } from '#lib/structure/density.js'
  import type { AnyStructure, Site } from '#lib/structure/index.js'
  import InstancedAtoms from '#lib/structure/InstancedAtoms.svelte'
  import { ghost_positions, type StructureDiffResult } from './compute'

  let {
    diff,
    target,
    site_radius,
    arrow_scale = 1,
    show_ghost = true,
    show_arrows = true,
  }: {
    diff: StructureDiffResult
    target: AnyStructure // where the atoms are drawn, in diff.displacements order
    site_radius: (site: Site, site_idx: number) => number // from scene_children
    arrow_scale?: number // exaggeration of arrows and ghost offsets, 1 = true length
    show_ghost?: boolean
    show_arrows?: boolean
  } = $props()

  const spacing = $derived(characteristic_atom_spacing(target))
  const ghosts = $derived(ghost_positions(diff, target, arrow_scale))
  // Zero-length arrows (unmoved atoms) draw nothing. Thin shaft; a blunt head of fixed size
  // (2.2x as long as its radius) at any exaggeration, its tip on the target atom's center.
  const arrows = $derived(
    pack_arrows(
      diff.displacements.map(({ vector, magnitude }, idx) => ({
        position: ghosts[idx],
        vector,
        magnitude,
        scale: arrow_scale,
        color: DEFAULTS.structure.displacement_arrow_color,
      })),
      0.012 * spacing,
      0.032 * spacing,
      0.07 * spacing,
    ),
  )
</script>

{#if show_ghost}
  <InstancedAtoms
    atoms={ghosts.map((position, idx) => ({
      position,
      radius: site_radius(target.sites[idx], idx),
      color: default_element_colors[target.sites[idx].species[0].element],
    }))}
    ghost
    opacity={0.5}
  />
{/if}
{#if show_arrows}
  <ArrowInstances {arrows} on_top />
{/if}
