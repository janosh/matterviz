<script lang="ts">
  // Tooltip component for Fermi surface hover information
  // Displays band index, spin, k-coordinates, and optional property values
  import { format_num } from '$lib/labels'
  import { KCoords, TooltipContent } from '$lib/tooltip'
  import { SPIN_COLORS } from './constants'
  import type { FermiHoverData, FermiTooltipProp } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: FermiHoverData
    tooltip?: FermiTooltipProp
  } = $props()
</script>

<TooltipContent data={hover_data} snippet_arg={{ hover_data }} {tooltip}>
  <div class="tooltip-content" style="max-width: var(--tooltip-max-width, 250px)">
    <div class="tooltip-title">
      <strong>Band {hover_data.band_index}</strong>
      {#if hover_data.spin}
        <span class="spin-badge" style:background-color={SPIN_COLORS[hover_data.spin]}>
          {hover_data.spin}
        </span>
      {/if}
    </div>

    <KCoords
      cartesian={hover_data.position_cartesian}
      fractional={hover_data.position_fractional}
    />

    {#if hover_data.property_value != null}
      <div style="margin-top: 4px; font-size: 0.9em">
        {hover_data.property_name || `Property`}: {format_num(
          hover_data.property_value,
          `.4~`,
        )}
        <span class="nearest-note">(nearest)</span>
      </div>
    {/if}

    {#if hover_data.is_tiled && hover_data.symmetry_index != null && hover_data.symmetry_index > 0}
      <div class="tiling-info">
        Symmetry copy #{hover_data.symmetry_index + 1}{hover_data.n_symmetry_ops
          ? `/${hover_data.n_symmetry_ops}`
          : ``}
      </div>
    {/if}
  </div>
</TooltipContent>

<style>
  .tooltip-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .spin-badge {
    font-size: 0.75em;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 500;
    color: white;
  }
  .nearest-note {
    opacity: 0.6;
    font-size: 0.85em;
    margin-left: 3px;
  }
  .tiling-info {
    margin-top: 4px;
    font-size: 0.8em;
    opacity: 0.7;
    font-style: italic;
  }
</style>
