<script lang="ts">
  import { extract_formula_elements } from '$lib/composition/parse'
  import type { PhaseData } from '$lib/convex-hull/types'
  import { format_num } from '$lib/labels'
  import { SvelteSet } from 'svelte/reactivity'
  import ChemPotDiagram2D from './ChemPotDiagram2D.svelte'
  import ChemPotDiagram3D from './ChemPotDiagram3D.svelte'
  import { CHEMPOT_DEFAULTS } from './types'
  import type {
    ChemPotDiagramConfig,
    ChemPotHoverInfo,
    ChemPotHoverInfo3D,
  } from './types'

  let {
    entries = [],
    config = {},
    width = $bindable(600),
    height = $bindable(600),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    hover_info?: ChemPotHoverInfo | null
  } = $props()

  // Extract unique elements from all entries
  const elements = $derived.by(() => {
    const elem_set = new SvelteSet<string>()
    for (const entry of entries) {
      for (const key of Object.keys(entry.composition)) {
        for (const elem of extract_formula_elements(key, { unique: false })) {
          elem_set.add(elem)
        }
      }
    }
    return Array.from(elem_set).sort()
  })

  // How many display axes (2 = binary/2D, 3+ = ternary/3D)

  const display_elements = $derived(config.elements ?? elements)
  const n_display = $derived(display_elements.length)
  const show_tooltip = $derived(
    config.show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip,
  )
  const tooltip_detail_level = $derived(
    config.tooltip_detail_level ?? CHEMPOT_DEFAULTS.tooltip_detail_level,
  )

  function is_hover_info_3d(
    value: ChemPotHoverInfo | null,
  ): value is ChemPotHoverInfo3D {
    return value?.view === `3d`
  }
</script>

<div class="chempot-diagram-wrapper">
  {#if n_display < 2}
    <div
      class="chempot-error"
      role="alert"
      aria-live="polite"
      style:width="{width}px"
      style:height="{height}px"
    >
      <div class="error-content">
        <h3>Unsupported Chemical System</h3>
        <p>
          Chemical potential diagrams require at least 2 elements. Found {n_display}
          element{n_display === 1 ? `` : `s`}:
          {display_elements.join(`, `) || `none`}
        </p>
      </div>
    </div>
  {:else if n_display === 2}
    <ChemPotDiagram2D
      {entries}
      {config}
      bind:width
      bind:height
      bind:hover_info
      render_local_tooltip={false}
    />
  {:else}
    <ChemPotDiagram3D
      {entries}
      {config}
      bind:width
      bind:height
      bind:hover_info
      render_local_tooltip={false}
    />
  {/if}
  {#if show_tooltip && hover_info}
    <aside
      class="chempot-tooltip"
      style:left="{hover_info.pointer?.x ?? 4}px"
      style:top="{hover_info.pointer?.y ?? 4}px"
    >
      <h4>{hover_info.formula}</h4>
      {#if hover_info.view === `2d`}
        <div class="meta-row">2D domain · Points: {hover_info.n_points}</div>
        {#if tooltip_detail_level === `detailed`}
          <div class="ranges-title">Axis ranges</div>
          {#each hover_info.axis_ranges as axis_range (axis_range.element)}
            <div class="range-row">
              {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
              {format_num(axis_range.max_val, `.4~g`)} eV
            </div>
          {/each}
        {/if}
      {:else if is_hover_info_3d(hover_info)}
        <div class="meta-row">
          {hover_info.is_elemental ? `Elemental phase` : `Compound phase`}
          {#if hover_info.is_draw_formula}
            <span> · Overlay target</span>
          {/if}
        </div>
        <div class="meta-row">
          Vertices: {hover_info.n_vertices} · Edges: {hover_info.n_edges} · Points:
          {hover_info.n_points}
        </div>
        <div class="meta-row">
          Entries: {hover_info.matching_entry_count}
          {#if hover_info.min_energy_per_atom !== null &&
          hover_info.max_energy_per_atom !== null}
            · E/atom: {format_num(hover_info.min_energy_per_atom, `.4~g`)}
            to {format_num(hover_info.max_energy_per_atom, `.4~g`)} eV
          {/if}
        </div>
        {#if tooltip_detail_level === `detailed`}
          <div class="ranges-title">Axis ranges</div>
          {#each hover_info.axis_ranges as axis_range (axis_range.element)}
            <div class="range-row">
              {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
              {format_num(axis_range.max_val, `.4~g`)} eV
            </div>
          {/each}
          <div class="meta-row">
            Centroid: ({
              hover_info.ann_loc.map((value) => format_num(value, `.3~g`)).join(
                `, `,
              )
            })
          </div>
          {#if hover_info.touches_limits.length > 0}
            <div class="ranges-title">Touches bounds</div>
            <div class="meta-row">{hover_info.touches_limits.join(`, `)}</div>
          {/if}
        {/if}
      {/if}
    </aside>
  {/if}
</div>

<style>
  .chempot-diagram-wrapper {
    position: relative;
  }
  .chempot-error {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    background: var(--bg-color, transparent);
  }
  .error-content {
    text-align: center;
    padding: 2em;
    color: var(--text-color, #666);
  }
  .error-content h3 {
    margin: 0 0 1em;
  }
  .error-content p {
    margin: 0;
  }
  .chempot-tooltip {
    position: absolute;
    max-width: min(32rem, 92vw);
    background: color-mix(in srgb, var(--bg-color, #fff) 94%, black 6%);
    color: var(--text-color, #222);
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.35;
    pointer-events: none;
    z-index: 40;
  }
  .chempot-tooltip h4 {
    margin: 0 0 4px;
    font-size: 13px;
  }
  .meta-row {
    margin: 1px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ranges-title {
    margin-top: 6px;
    font-weight: 600;
  }
  .range-row {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
