<script lang="ts">
  import { get_electro_neg_formula } from '$lib/composition/format';
  import type { PhaseData } from '$lib/convex-hull/types';
  import Spinner from '$lib/feedback/Spinner.svelte';
  import { format_num } from '$lib/labels';
  import { constrain_tooltip_position } from '$lib/plot/layout';
  import { sanitize_html } from '$lib/sanitize';
  import { compute_chempot_async } from './async-compute.svelte';
  import ChemPotDiagram2D from './ChemPotDiagram2D.svelte';
  import ChemPotDiagram3D from './ChemPotDiagram3D.svelte';
  import { get_ternary_combinations } from './compute';
  import type {
      ChemPotDiagramConfig,
      ChemPotHoverInfo,
      ChemPotHoverInfo3D,
  } from './types';
  import { CHEMPOT_DEFAULTS } from './types';

  let {
    entries = [],
    config = {},
    width = $bindable(600),
    height = $bindable(600),
    // Bound temperature may be auto-corrected by 2D/3D child components.
    temperature = $bindable(),
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
    ].toSorted(),
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

  const projection_mode = $derived(
    config.projection_mode ?? CHEMPOT_DEFAULTS.projection_mode,
  )
  // For quaternary+ in grid mode, generate all C(n,3) ternary projections
  // Uses display_elements (not all_elements) so config.elements scopes the grid
  const ternary_combos = $derived(
    n_display > 3 && projection_mode === `grid`
      ? get_ternary_combinations(display_elements)
      : [],
  )
  const show_grid = $derived(ternary_combos.length > 0 && ternary_combos.length <= 12)
  // Scale down sub-diagrams in grid mode
  const grid_width = $derived(Math.max(280, Math.round(width * 0.48)))
  const grid_height = $derived(Math.max(240, Math.round(height * 0.48)))

  // Pre-warm the worker's N-D computation cache before mounting heavy 3D
  // children. Fires one async call with the first projection — subsequent
  // child calls for different element triples hit the cached N-D result.
  let grid_cache_ready = $state(false)
  let grid_error = $state<string | null>(null)
  $effect(() => {
    grid_cache_ready = false
    grid_error = null
    if (!show_grid) return
    let cancelled = false
    compute_chempot_async(entries, { ...config, elements: ternary_combos[0] })
      .then(() => { if (!cancelled) grid_cache_ready = true })
      .catch((err) => {
        if (cancelled) return
        console.error(`Grid precompute failed:`, err)
        grid_error = err instanceof Error ? err.message : String(err)
      })
    return () => { cancelled = true }
  })
const is_hover_info_3d = (value: ChemPotHoverInfo | null): value is ChemPotHoverInfo3D => value?.view === `3d`

  let tooltip_el = $state<HTMLElement>()
  const tooltip_pos = $derived.by(() => {
    const pointer = hover_info?.pointer
    if (!pointer) return { x: 4, y: 4 }
    return constrain_tooltip_position(
      pointer.x, pointer.y,
      tooltip_el?.offsetWidth ?? 200,
      tooltip_el?.offsetHeight ?? 100,
      width, height,
      { offset: 0 },
    )
  })
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
  {:else if n_display === 3 || !show_grid}
    <ChemPotDiagram3D
      {entries}
      {config}
      bind:width
      bind:height
      bind:temperature
      bind:hover_info
      render_local_tooltip={false}
    />
  {:else}
    <p class="projection-info">
      Showing all {ternary_combos.length} ternary projections of the
      {display_elements.length}-element system ({display_elements.join(`-`)})
    </p>
    {#if grid_error}
      <div class="chempot-error" role="alert">
        <div>
          <h3>Grid computation failed</h3>
          <p>{grid_error}</p>
        </div>
      </div>
    {:else if !grid_cache_ready}
      <Spinner
        text="Computing {display_elements.length}-element chemical potential domains..."
        style="--spinner-size: 1.2em"
      />
    {:else}
      <div class="projection-grid">
        {#each ternary_combos as combo (combo.join(`|`))}
          <div class="projection-cell">
            <h4 class="projection-label">{combo.join(`-`)} projection</h4>
            <ChemPotDiagram3D
              {entries}
              config={{ ...config, elements: combo }}
              width={grid_width}
              height={grid_height}
              bind:temperature
            />
          </div>
        {/each}
      </div>
    {/if}
  {/if}
  {#if show_tooltip && hover_info}
    <aside
      bind:this={tooltip_el}
      class="chempot-tooltip"
      style:left="{tooltip_pos.x}px"
      style:top="{tooltip_pos.y}px"
    >
      <h4>{@html sanitize_html(get_electro_neg_formula(hover_info.formula, false, ``, `.3~s`))}</h4>
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
                hover_info.neighbors.map((f) => get_electro_neg_formula(f, true, ``, `.3~s`)).join(
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
  .projection-info {
    margin: 0 0 0.5em;
    font-size: 0.9em;
    color: var(--text-color-secondary, #666);
  }
  .projection-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.4em;
  }
  .projection-cell {
    min-width: 0;
  }
  .projection-label {
    margin: 0 0 0.3em;
    font-size: 0.85em;
    font-weight: 400;
    text-align: center;
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
