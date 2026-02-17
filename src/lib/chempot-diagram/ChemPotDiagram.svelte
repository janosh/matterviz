<script lang="ts">
  import { get_hill_formula } from '$lib/composition/format'
  import type { PhaseData } from '$lib/convex-hull/types'
  import { format_num } from '$lib/labels'
  import ChemPotDiagram2D from './ChemPotDiagram2D.svelte'
  import ChemPotDiagram3D from './ChemPotDiagram3D.svelte'
  import type {
    ChemPotDiagramConfig,
    ChemPotHoverInfo,
    ChemPotHoverInfo3D,
  } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  let {
    entries = [],
    config = {},
    width = $bindable(600),
    height = $bindable(600),
    temperature = $bindable<number | undefined>(undefined),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    hover_info?: ChemPotHoverInfo | null
  } = $props()

  // Extract unique elements from all entries (composition keys are element symbols)
  const all_elements = $derived(
    [
      ...new Set(entries.flatMap((entry) =>
        Object.entries(entry.composition)
          .filter(([, amount]) => amount > 0)
          .map(([element]) => element)
      )),
    ].sort(),
  )

  // How many display axes (2 = binary/2D, 3+ = ternary/3D)
  const display_elements = $derived(config.elements ?? all_elements)
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
      <div>
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
      bind:temperature
      bind:hover_info
      render_local_tooltip={false}
    />
  {:else}
    <ChemPotDiagram3D
      {entries}
      {config}
      bind:width
      bind:height
      bind:temperature
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
      <h4>{@html get_hill_formula(hover_info.formula, false, ``)}</h4>
      {#if hover_info.view === `2d`}
        <p>2D domain · Points: {hover_info.n_points}</p>
        {#if tooltip_detail_level === `detailed`}
          <h5>Axis ranges</h5>
          {#each hover_info.axis_ranges as axis_range (axis_range.element)}
            <p>
              {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
              {format_num(axis_range.max_val, `.4~g`)} eV
            </p>
          {/each}
        {/if}
      {:else if is_hover_info_3d(hover_info)}
        <p>
          {hover_info.is_elemental ? `Elemental phase` : `Compound phase`}
          {#if hover_info.is_draw_formula}
            <span> · Overlay target</span>
          {/if}
        </p>
        <p>
          Vertices: {hover_info.n_vertices} · Edges: {hover_info.n_edges} · Points:
          {hover_info.n_points}
        </p>
        <p>
          Entries: {hover_info.matching_entry_count}
          {#if hover_info.min_energy_per_atom !== null &&
          hover_info.max_energy_per_atom !== null}
            · E/atom: {format_num(hover_info.min_energy_per_atom, `.4~g`)}
            to {format_num(hover_info.max_energy_per_atom, `.4~g`)} eV
          {/if}
        </p>
        {#if tooltip_detail_level === `detailed`}
          <h5>Axis ranges</h5>
          {#each hover_info.axis_ranges as axis_range (axis_range.element)}
            <p>
              {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
              {format_num(axis_range.max_val, `.4~g`)} eV
            </p>
          {/each}
          <p>
            Centroid: ({
              hover_info.ann_loc.map((value) => format_num(value, `.3~g`)).join(
                `, `,
              )
            })
          </p>
          {#if hover_info.neighbors.length > 0}
            <h5>Neighbors ({hover_info.neighbors.length})</h5>
            <p>
              {
                hover_info.neighbors.map((f) => get_hill_formula(f, true, ``)).join(
                  `, `,
                )
              }
            </p>
          {/if}
          {#if hover_info.touches_limits.length > 0}
            <h5>Touches bounds</h5>
            <p>{hover_info.touches_limits.join(`, `)}</p>
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
  .chempot-error > div {
    text-align: center;
    padding: 2em;
    color: var(--text-color, #666);
  }
  .chempot-error h3 {
    margin: 0 0 1em;
  }
  .chempot-error p {
    margin: 0;
  }
  .chempot-tooltip {
    position: absolute;
    max-width: min(32rem, 92vw);
    background: var(
      --tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9))
    );
    color: var(--tooltip-text, var(--text-color, #222));
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
  .chempot-tooltip p {
    margin: 1px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chempot-tooltip h5 {
    margin-top: 6px;
    margin-bottom: 0;
    font-size: 12px;
    font-weight: 600;
  }
</style>
