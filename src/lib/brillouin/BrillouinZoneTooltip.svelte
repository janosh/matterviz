<script lang="ts">
  // Tooltip component for Brillouin zone hover information
  // Displays k-coordinates, BZ order, volume, and IBZ-specific info
  import { format_num } from '$lib/labels'
  import { KCoords, TooltipContent } from '$lib/tooltip'
  import type { BZHoverData, BZTooltipProp } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: BZHoverData
    tooltip?: BZTooltipProp
  } = $props()

  // Ordinal for BZ order (only 1-3 in practice)
  const ordinal = (num: number) => `${num}${[`th`, `st`, `nd`, `rd`][num] ?? `th`}`
</script>

<TooltipContent data={hover_data} snippet_arg={{ hover_data }} {tooltip}>
  <div class="bz-tooltip-content">
    {#if hover_data.is_ibz || hover_data.bz_order > 1}
      <div class="bz-tooltip-title">
        {#if hover_data.is_ibz}<strong>Irreducible BZ</strong>{/if}
        {#if hover_data.bz_order > 1}
          <span class="bz-tooltip-badge">{ordinal(hover_data.bz_order)}</span>
        {/if}
      </div>
    {/if}
    <KCoords
      cartesian={hover_data.position_cartesian}
      fractional={hover_data.position_fractional}
    />
    <div class="bz-tooltip-row">
      <span class="bz-tooltip-label">BZ Volume:</span>
      <span>{format_num(hover_data.bz_volume, `.4~`)} Å⁻³</span>
    </div>
    {#if hover_data.is_ibz && hover_data.ibz_volume != null}
      <div class="bz-tooltip-row">
        <span class="bz-tooltip-label">IBZ Volume:</span>
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
  .bz-tooltip-content {
    max-width: var(--bz-tooltip-max-width, 250px);
  }
  .bz-tooltip-title {
    margin-bottom: 4px;
  }
  .bz-tooltip-badge {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 500;
    background: #666;
    color: white;
    margin-left: 6px;
  }
  .bz-tooltip-row {
    display: flex;
    gap: 4px;
  }
  .bz-tooltip-label {
    opacity: 0.8;
    min-width: 75px;
  }
  .bz-tooltip-symmetry {
    margin-top: 2px;
    opacity: 0.8;
    font-style: italic;
  }
</style>
