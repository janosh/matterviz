<script lang="ts">
  // Tooltip component for Brillouin zone hover information
  // Displays k-coordinates, BZ order, volume, and IBZ-specific info
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import type { Snippet } from 'svelte'
  import type { BZHoverData, BZTooltipConfig } from './types'

  let {
    hover_data,
    tooltip,
  }: {
    hover_data: BZHoverData
    tooltip?: Snippet<[{ hover_data: BZHoverData }]> | BZTooltipConfig
  } = $props()

  // Determine tooltip mode: snippet replaces content, config adds prefix/suffix
  const is_snippet = $derived(typeof tooltip === `function`)
  const config = $derived(
    !is_snippet && tooltip ? (tooltip as BZTooltipConfig) : null,
  )
  const prefix_html = $derived(
    typeof config?.prefix === `function` ? config.prefix(hover_data) : config?.prefix,
  )
  const suffix_html = $derived(
    typeof config?.suffix === `function` ? config.suffix(hover_data) : config?.suffix,
  )
  const tooltip_snippet = $derived(
    is_snippet ? (tooltip as Snippet<[{ hover_data: BZHoverData }]>) : null,
  )

  // Format coordinate for display
  const fmt = (val: number) => format_num(val, `.4~`)
  const fmt_vec = (vec: Vec3) => `(${fmt(vec[0])}, ${fmt(vec[1])}, ${fmt(vec[2])})`

  // Ordinal for BZ order (only 1-3 in practice)
  const ordinal = (num: number) => `${num}${[`th`, `st`, `nd`, `rd`][num] ?? `th`}`
</script>

{#if tooltip_snippet}
  {@render tooltip_snippet({ hover_data })}
{:else}
  <!-- Note: prefix/suffix use {@html} - ensure content is trusted -->
  {#if prefix_html}
    <div class="bz-tooltip-prefix">{@html prefix_html}</div>
  {/if}

  <div class="bz-tooltip-content">
    <div class="bz-tooltip-title">
      <strong>{
        hover_data.is_ibz ? `Irreducible BZ` : `Brillouin Zone`
      }</strong>{#if hover_data.bz_order > 1}<span class="bz-tooltip-badge">{
          ordinal(hover_data.bz_order)
        }</span>{/if}
    </div>
    <div class="bz-tooltip-row">
      <span class="bz-tooltip-label">k (Å⁻¹):</span>
      <span class="bz-tooltip-value">{fmt_vec(hover_data.position_cartesian)}</span>
    </div>
    {#if hover_data.position_fractional}
      <div class="bz-tooltip-row">
        <span class="bz-tooltip-label">k (frac):</span>
        <span class="bz-tooltip-value">{fmt_vec(hover_data.position_fractional)}</span>
      </div>
    {/if}
    <div class="bz-tooltip-row">
      <span class="bz-tooltip-label">BZ Volume:</span>
      <span class="bz-tooltip-value">{fmt(hover_data.bz_volume)} Å⁻³</span>
    </div>
    {#if hover_data.is_ibz && hover_data.ibz_volume != null}
      <div class="bz-tooltip-row">
        <span class="bz-tooltip-label">IBZ Volume:</span>
        <span class="bz-tooltip-value">{fmt(hover_data.ibz_volume)} Å⁻³</span>
      </div>
      {#if hover_data.symmetry_multiplicity != null}
        <div class="bz-tooltip-symmetry">
          Symmetry: 1/{Math.round(hover_data.symmetry_multiplicity)} of BZ
        </div>
      {/if}
    {/if}
  </div>

  {#if suffix_html}
    <div class="bz-tooltip-suffix">{@html suffix_html}</div>
  {/if}
{/if}

<style>
  .bz-tooltip-content {
    max-width: var(--bz-tooltip-max-width, 250px);
    text-align: left;
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
  .bz-tooltip-value {
    font-family: monospace;
  }
  .bz-tooltip-symmetry {
    margin-top: 2px;
    opacity: 0.8;
    font-style: italic;
  }
</style>
