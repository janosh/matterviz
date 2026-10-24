<script lang="ts">
  import { format_num } from '#lib/labels.js'
  import { KCoords, TooltipContent } from '#lib/tooltip/index.js'
  import type { BZHoverData, BZTooltipProp } from './types'
  import { ordinal_label } from './types'

  let { hover_data, tooltip }: { hover_data: BZHoverData; tooltip?: BZTooltipProp } = $props()
</script>

<TooltipContent data={hover_data} snippet_arg={{ hover_data }} {tooltip}>
  <div>
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
    {#snippet volume_row(label: string, volume: number)}
      <div style="display: flex; gap: 4px">
        <span style="opacity: 0.8; min-width: 75px">{label} Volume:</span>
        <span>{format_num(volume, `.4~`)} <small>Å<sup>−3</sup></small></span>
      </div>
    {/snippet}
    {@render volume_row(`BZ`, hover_data.bz_volume)}
    {#if hover_data.is_ibz && hover_data.ibz_volume != null}
      {@render volume_row(`IBZ`, hover_data.ibz_volume)}
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
