<script lang="ts">
  // Tooltip component for Fermi surface hover information
  // Displays band index, spin, k-coordinates, and optional property values
  import { format_num } from '$lib/labels'
  import type { Snippet } from 'svelte'
  import type { FermiHoverData, FermiTooltipConfig } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: FermiHoverData
    tooltip?: Snippet<[{ hover_data: FermiHoverData }]> | FermiTooltipConfig
  } = $props()

  // Determine tooltip mode: snippet replaces content, config adds prefix/suffix
  const is_snippet = $derived(typeof tooltip === `function`)
  const config = $derived(
    !is_snippet && tooltip ? (tooltip as FermiTooltipConfig) : null,
  )
  const prefix_html = $derived(
    typeof config?.prefix === `function` ? config.prefix(hover_data) : config?.prefix,
  )
  const suffix_html = $derived(
    typeof config?.suffix === `function` ? config.suffix(hover_data) : config?.suffix,
  )
  const tooltip_snippet = $derived(
    is_snippet ? (tooltip as Snippet<[{ hover_data: FermiHoverData }]>) : null,
  )

  // Format coordinate for display
  const fmt = (val: number) => format_num(val, `.4~`)
</script>

{#if tooltip_snippet}
  {@render tooltip_snippet({ hover_data })}
{:else}
  {#if prefix_html}
    <div class="tooltip-prefix">{@html prefix_html}</div>
  {/if}

  <div class="tooltip-content">
    <div class="tooltip-title">
      <strong>Band {hover_data.band_index}</strong>
      {#if hover_data.spin}
        <span class="spin-label spin-{hover_data.spin}">
          Spin {hover_data.spin === `up` ? `↑` : `↓`}
        </span>
      {/if}
    </div>

    <div class="coords-section">
      <div class="coord-row">
        <span class="coord-label">k (Å⁻¹):</span>
        <span class="coord-values">
          ({fmt(hover_data.position_cartesian[0])},
          {fmt(hover_data.position_cartesian[1])},
          {fmt(hover_data.position_cartesian[2])})
        </span>
      </div>
      <div class="coord-row">
        <span class="coord-label">k (frac):</span>
        <span class="coord-values">
          ({fmt(hover_data.position_fractional[0])},
          {fmt(hover_data.position_fractional[1])},
          {fmt(hover_data.position_fractional[2])})
        </span>
      </div>
    </div>

    {#if hover_data.property_value != null}
      <div class="property-row">
        {hover_data.property_name || `Property`}: {fmt(hover_data.property_value)}
      </div>
    {/if}

    {#if hover_data.is_tiled && hover_data.symmetry_index != null &&
      hover_data.symmetry_index > 0}
      <div class="tiling-info">
        Symmetry copy #{hover_data.symmetry_index + 1}/48
      </div>
    {/if}
  </div>

  {#if suffix_html}
    <div class="tooltip-suffix">{@html suffix_html}</div>
  {/if}
{/if}

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
  .spin-label {
    font-size: 0.85em;
    font-weight: 500;
  }
  .spin-label.spin-up {
    color: #e41a1c;
  }
  .spin-label.spin-down {
    color: #377eb8;
  }
  .coords-section {
    margin: 4px 0;
  }
  .coord-row {
    display: flex;
    align-items: center;
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
  .tiling-info {
    margin-top: 4px;
    font-size: 0.8em;
    opacity: 0.7;
    font-style: italic;
  }
</style>
