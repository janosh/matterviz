<script lang="ts">
  import type { PhaseData } from '#lib/convex-hull/types.js'
  import { plural } from '#lib/labels.js'
  import ChemPotDiagram2D from './ChemPotDiagram2D.svelte'
  import ChemPotDiagram3D from './ChemPotDiagram3D.svelte'
  import { entry_elements, get_ternary_combinations } from './compute'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  let {
    entries = [],
    config = {},
    width = 600,
    height = 600,
    // Bound temperature may be auto-corrected by 2D/3D child components.
    temperature = $bindable(),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
    // Phase to highlight in every view while none is hovered, in any formula spelling
    highlighted_formula = null,
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    hover_info?: ChemPotHoverInfo | null
    highlighted_formula?: string | null
  } = $props()

  const all_elements = $derived(entry_elements(entries))

  // How many display axes (2 = binary/2D, 3+ = ternary/3D)
  const display_elements = $derived(config.elements?.length ? config.elements : all_elements)
  const n_display = $derived(display_elements.length)

  const projection_mode = $derived(config.projection_mode ?? CHEMPOT_DEFAULTS.projection_mode)
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

  // Each grid pane keeps its own hover, so only the hovered pane shows a tooltip. The grid's
  // hover is the latest pane's (else one still pinned): its formula highlights that phase in
  // every pane and it is what hover_info reports. Reset with the projections so removed panes
  // leave no stale hover, keyed by a string so an update with the same projections keeps them.
  const grid_key = $derived(ternary_combos.map((combo) => combo.join(`|`)).join(`,`))
  let pane_hovers = $derived(grid_key.split(`,`).map((): ChemPotHoverInfo | null => null))
  let last_hovered_pane = $state(0)
  const grid_hover = $derived(
    pane_hovers[last_hovered_pane] ?? pane_hovers.find(Boolean) ?? null,
  )
  const set_pane_hover = (pane_idx: number, info: ChemPotHoverInfo | null): void => {
    pane_hovers = pane_hovers.with(pane_idx, info)
    if (info) last_hovered_pane = pane_idx
    hover_info = grid_hover
  }
</script>

<div>
  {#if n_display < 2}
    <div
      class="chempot-error"
      role="alert"
      aria-live="polite"
      style="width: {width}px; height: {height}px"
    >
      <h3>Unsupported Chemical System</h3>
      <p>
        Chemical potential diagrams require at least 2 elements. Found {plural(
          n_display,
          `element`,
        )}:
        {display_elements.join(`, `) || `none`}
      </p>
    </div>
  {:else if n_display === 2}
    <ChemPotDiagram2D
      {entries}
      {config}
      {width}
      {height}
      {highlighted_formula}
      bind:temperature
      bind:hover_info
    />
  {:else if n_display === 3 || !show_grid}
    <ChemPotDiagram3D
      {entries}
      {config}
      {width}
      {height}
      {highlighted_formula}
      bind:temperature
      bind:hover_info
    />
  {:else}
    <p class="projection-info">
      Showing all {ternary_combos.length} ternary projections of the
      {display_elements.length}-element system ({display_elements.join(`-`)})
    </p>
    <div class="projection-grid">
      {#each ternary_combos as combo, pane_idx (combo.join(`|`))}
        <div style="min-width: 0">
          <h4 class="projection-label">{combo.join(`-`)} projection</h4>
          <ChemPotDiagram3D
            {entries}
            config={{ ...config, elements: combo }}
            width={grid_width}
            height={grid_height}
            highlighted_formula={grid_hover?.formula ?? highlighted_formula}
            bind:temperature
            bind:hover_info={
              () => pane_hovers[pane_idx], (info) => set_pane_hover(pane_idx, info)
            }
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .projection-info {
    margin: 0 0 0.5em;
    font-size: 0.9em;
    color: var(--text-color-secondary, #666);
  }
  .projection-grid {
    display: grid;
    /* two 280px sub-diagrams per row when the component's own width allows (a 500px diagram
       inside a desktop layout stacks), never more: each track is at least half the row */
    grid-template-columns: repeat(auto-fit, minmax(max(min(280px, 100%), 50% - 0.2em), 1fr));
    gap: 0.4em;
  }
  .projection-label {
    margin: 0 0 0.3em;
    font-size: 0.85em;
    font-weight: 400;
    text-align: center;
  }
  .chempot-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 2em;
    text-align: center;
    color: var(--text-color, #666);
    border: 1px solid var(--border-color, #ccc);
    border-radius: var(--border-radius, 3pt);
    background: var(--bg-color, transparent);
  }
  .chempot-error h3 {
    margin: 0 0 1em;
  }
  .chempot-error p {
    margin: 0;
  }
</style>
