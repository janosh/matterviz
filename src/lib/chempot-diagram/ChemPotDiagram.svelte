<script lang="ts">
  import type { PhaseData } from '$lib/convex-hull/types'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { to_error } from '$lib/utils'
  import { compute_chempot_async } from './async-compute.svelte'
  import ChemPotDiagram2D from './ChemPotDiagram2D.svelte'
  import ChemPotDiagram3D from './ChemPotDiagram3D.svelte'
  import { get_ternary_combinations } from './compute'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

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
      ...new Set(
        entries.flatMap((entry) =>
          Object.entries(entry.composition)
            .filter(([, amount]) => amount > 0)
            .map(([element]) => element),
        ),
      ),
    ].toSorted(),
  )

  // How many display axes (2 = binary/2D, 3+ = ternary/3D)
  const display_elements = $derived(config.elements ?? all_elements)
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
      .then(() => {
        if (!cancelled) grid_cache_ready = true
      })
      .catch((err) => {
        if (cancelled) return
        console.error(`Grid precompute failed:`, err)
        grid_error = to_error(err).message
      })
    return () => {
      cancelled = true
    }
  })
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
        Chemical potential diagrams require at least 2 elements. Found {n_display}
        element{n_display === 1 ? `` : `s`}:
        {display_elements.join(`, `) || `none`}
      </p>
    </div>
  {:else if n_display === 2}
    <ChemPotDiagram2D
      {entries}
      {config}
      bind:width
      bind:height
      bind:temperature
      bind:hover_info
    />
  {:else if n_display === 3 || !show_grid}
    <ChemPotDiagram3D
      {entries}
      {config}
      bind:width
      bind:height
      bind:temperature
      bind:hover_info
    />
  {:else}
    <p class="projection-info">
      Showing all {ternary_combos.length} ternary projections of the
      {display_elements.length}-element system ({display_elements.join(`-`)})
    </p>
    {#if grid_error}
      <div class="chempot-error" role="alert">
        <h3>Grid computation failed</h3>
        <p>{grid_error}</p>
      </div>
    {:else if !grid_cache_ready}
      <Spinner
        text="Computing {display_elements.length}-element chemical potential domains..."
        style="--spinner-size: 1.2em"
      />
    {:else}
      <div class="projection-grid">
        {#each ternary_combos as combo (combo.join(`|`))}
          <div style="min-width: 0">
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
</div>

<style>
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
