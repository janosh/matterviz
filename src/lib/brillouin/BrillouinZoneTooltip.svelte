<script lang="ts">
  // Tooltip component for Brillouin zone hover information
  // Displays k-coordinates, BZ order, volume, and IBZ-specific info
  import { format_num } from '$lib/labels'
  import { KCoords, TooltipContent } from '$lib/tooltip'
  import type { BZHoverData, BZTooltipProp } from './types'
  import { ordinal_label } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: BZHoverData
    tooltip?: BZTooltipProp
  } = $props()
</script>

<TooltipContent data={hover_data} snippet_arg={{ hover_data }} {tooltip}>
  <div style="max-width: var(--bz-tooltip-max-width, 250px)">
    {#if hover_data.is_ibz || hover_data.bz_order > 1}
      <div style="margin-bottom: 4px">
        {#if hover_data.is_ibz}<strong>Irreducible BZ</strong>{/if}
        {#if hover_data.bz_order > 1}
          <span class="bz-tooltip-badge">{ordinal_label(hover_data.bz_order)}</span>
        {/if}
      </div>
    {/if}
    <KCoords
      cartesian={hover_data.position_cartesian}
      fractional={hover_data.position_fractional}
    />
    <div style="display: flex; gap: 4px">
      <span style="opacity: 0.8; min-width: 75px">BZ Volume:</span>
      <span>{format_num(hover_data.bz_volume, `.4~`)} Å⁻³</span>
    </div>
    {#if hover_data.is_ibz && hover_data.ibz_volume != null}
      <div style="display: flex; gap: 4px">
        <span style="opacity: 0.8; min-width: 75px">IBZ Volume:</span>
        <span>{format_num(hover_data.ibz_volume, `.4~`)} Å⁻³</span>
      </div>
      {#if hover_data.symmetry_multiplicity != null}
        <div class="bz-tooltip-symmetry">
          Symmetry: 1/{Math.round(hover_data.symmetry_multiplicity)} of BZ
        </div>
      {/if}
    {/if}
  </div>
</TooltipContent>

<style>
  .bz-tooltip-badge {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 500;
    background: #666;
    color: white;
  }
  .bz-tooltip-badge:not(:first-child) {
    margin-left: 6px;
  }
  .bz-tooltip-symmetry {
    margin-top: 2px;
    opacity: 0.8;
    font-style: italic;
  }
</style>
