<script lang="ts">
  // Tooltip component for Fermi surface hover information
  // Displays band index, spin, k-coordinates, and optional property values
  import { format_num } from '#lib/labels.js'
  import { KCoords, TooltipContent, TooltipValue } from '#lib/tooltip/index.js'
  import { SPIN_COLORS } from './constants'
  import type { FermiHoverData, FermiTooltipProp } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: FermiHoverData
    tooltip?: FermiTooltipProp
  } = $props()

  // NaN marks a vertex without a value (e.g. outside the window a coupling was computed in)
  const format_property = (value: number): string =>
    Number.isFinite(value) ? format_num(value, `.4~`) : `n/a`
  // The remaining properties at the vertex, below the one the surface is coloured by
  let other_properties = $derived(
    Object.entries(hover_data.property_values ?? {}).filter(
      ([label]) => label !== hover_data.property_name,
    ),
  )
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
        <TooltipValue
          label={hover_data.property_name || `Property`}
          value={format_property(hover_data.property_value)}
        />
        <span class="nearest-note">(nearest)</span>
      </div>
    {/if}
    {#each other_properties as [label, value] (label)}
      <div style="font-size: 0.85em; opacity: 0.85">
        <TooltipValue {label} value={format_property(value)} />
      </div>
    {/each}

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
