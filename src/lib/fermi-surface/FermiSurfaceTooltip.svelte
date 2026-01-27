<script lang="ts">
  // Tooltip component for Fermi surface hover information
  // Displays band index, spin, k-coordinates, and optional property values
  import { format_num, format_vec3 } from '$lib/labels'
  import { TooltipContent } from '$lib/tooltip'
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
  <div class="tooltip-content">
    <div class="tooltip-title">
      <strong>Band {hover_data.band_index}</strong>
      {#if hover_data.spin}
        <span class="spin-badge spin-{hover_data.spin}">{hover_data.spin}</span>
      {/if}
    </div>

    <div class="coords-section">
      <div class="coord-row">
        <span class="coord-label">k (Å⁻¹):</span>
        <span class="coord-values">{format_vec3(hover_data.position_cartesian)}</span>
      </div>
      {#if hover_data.position_fractional}
        <div class="coord-row">
          <span class="coord-label">k (frac):</span>
          <span class="coord-values">{format_vec3(hover_data.position_fractional)}</span>
        </div>
      {/if}
    </div>

    {#if hover_data.property_value != null}
      <div class="property-row">
        {hover_data.property_name || `Property`}: {
          format_num(hover_data.property_value, `.4~`)
        }
        <span class="nearest-note">(nearest)</span>
      </div>
    {/if}

    {#if hover_data.is_tiled && hover_data.symmetry_index != null &&
        hover_data.symmetry_index > 0}
      <div class="tiling-info">
        Symmetry copy #{hover_data.symmetry_index + 1}/48
      </div>
    {/if}
  </div>
</TooltipContent>

<style>
  .tooltip-content {
    max-width: var(--tooltip-max-width, 220px);
  }
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
  }
  .spin-badge.spin-up {
    background: #e41a1c;
    color: white;
  }
  .spin-badge.spin-down {
    background: #377eb8;
    color: white;
  }
  .coords-section {
    margin: 4px 0;
  }
  .coord-row {
    display: flex;
    gap: 4px;
    font-size: 0.9em;
  }
  .coord-label {
    opacity: 0.8;
    min-width: 55px;
  }
  .coord-values {
    font-family: monospace;
  }
  .property-row {
    margin-top: 4px;
    font-size: 0.9em;
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
