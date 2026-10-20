<script lang="ts">
  // Hovered-atom tooltip: species with occupancies and oxidation states, fractional and
  // Cartesian coordinates, bonded neighbours, then any caller rows below the built-in info
  import type { ElementSymbol } from '#lib/element/index.js'
  import { element_by_symbol } from '#lib/element/index.js'
  import { format_num, format_vec3 } from '#lib/labels.js'
  import { CanvasTooltip } from '#lib/scene/index.js'
  import type { Site } from '#lib/structure/index.js'
  import type { Snippet } from 'svelte'

  let {
    site,
    site_idx,
    species,
    bg_color,
    bond_summary,
    anchor_radius,
    extra_rows,
  }: {
    site: Site
    site_idx: number
    species: Site[`species`] // as drawn: merged split partial sites list every element
    bg_color: string | null | undefined // see tooltip_fill
    bond_summary: string | null // see bond_neighbor_summary
    anchor_radius: number // scene-space radius of the hover shell, kept clear on screen
    extra_rows?: Snippet<[{ site: Site; site_idx: number }]>
  } = $props()
</script>

<CanvasTooltip position={site.xyz} {anchor_radius} {bg_color}>
  <!-- Element symbols with occupancies for disordered sites -->
  <div class="elements" style="margin-bottom: var(--canvas-tooltip-elements-margin)">
    {#each species as { element, occu, oxidation_state: oxi_state }, idx (`${element ?? ``}-${occu ?? ``}-${oxi_state ?? ``}-${idx}`)}
      {@const element_name = element_by_symbol.get(element as ElementSymbol)?.name ?? ``}
      <span class="species">
        {#if occu !== 1}<span class="occupancy">{format_num(occu, `.3~f`)}</span>{/if}
        <strong>
          {element}{#if oxi_state != null && oxi_state !== 0}<sup
              >{Math.abs(oxi_state)}{oxi_state > 0 ? `+` : `−`}</sup
            >{/if}
        </strong>
        {#if element_name}<span class="elem-name">{element_name}</span>{/if}
      </span>
    {/each}
  </div>
  <div class="coordinates">abc: {format_vec3(site.abc, `.3~f`)}</div>
  <div class="coordinates">xyz: {format_vec3(site.xyz, `.3~f`)} <small>Å</small></div>
  {#if bond_summary}
    <div class="coordinates">Bonds: {bond_summary}</div>
  {/if}
  {#if extra_rows}{@render extra_rows({ site, site_idx })}{/if}
</CanvasTooltip>

<style>
  .species {
    display: inline-block;
    white-space: nowrap;
    &:not(:first-child) {
      margin-left: var(--canvas-tooltip-species-gap, 0.5em);
    }
  }
  .occupancy {
    font-size: var(--canvas-tooltip-occu-font-size);
    opacity: var(--canvas-tooltip-occu-opacity);
    margin-right: var(--canvas-tooltip-occu-margin);
  }
  .elem-name {
    font-size: var(--canvas-tooltip-elem-name-font-size, 0.85em);
    opacity: var(--canvas-tooltip-elem-name-opacity, 0.7);
    margin: var(--canvas-tooltip-elem-name-margin, 0 0 0 0.3em);
    font-weight: var(--canvas-tooltip-elem-name-font-weight, normal);
  }
  .coordinates {
    font-size: var(--canvas-tooltip-coords-font-size);
    margin: var(--canvas-tooltip-coords-margin);
  }
</style>
