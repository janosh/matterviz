<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { FilePicker } from '$lib'
  import type { AnyStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import {
    default_sym_settings,
    ensure_moyo_wasm_ready,
    map_wyckoff_to_all_atoms,
    type SymmetrySettings,
    SymmetryStats,
    wyckoff_positions_from_moyo,
    WyckoffTable,
  } from '$lib/symmetry'
  import { structure_files } from '$site/structures'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { onMount } from 'svelte'

  let wasm_ready = $state(false)
  let error = $state<string | null>(null)
  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)
  let current_structure = $state<AnyStructure | null>(null)
  let displayed_structure = $state<AnyStructure | undefined>(undefined)
  let hovered_wyckoff_sites = $state<number[]>([])
  let active_wyckoff_sites = $state<number[]>([])
  // Symmetry data for each example
  let top_ex_sym_data = $state<MoyoDataset | null>(null)
  let two_col_sym_data = $state<MoyoDataset | null>(null)
  let stacked_sym_data = $state<MoyoDataset | null>(null)
  // Symmetry settings for layout examples (independent controls)
  let wide_example_symmetry_settings = $state<SymmetrySettings>(default_sym_settings)
  let two_col_sym_settings = $state<SymmetrySettings>(default_sym_settings)
  let stacked_sym_settings = $state<SymmetrySettings>(default_sym_settings)

  onMount(() => { // Initialize WASM
    ensure_moyo_wasm_ready()
      .then(() => wasm_ready = true)
      .catch((exc) => error = `WASM init failed: ${exc}`)
  })

  // Update filename from URL
  $effect(() => {
    if (!browser) return
    const file = page.url.searchParams.get(`file`)
    if (file && file !== current_filename) current_filename = file
  })

  // Derived values for wyckoff positions
  const base_wyckoff_positions = $derived(
    wyckoff_positions_from_moyo(top_ex_sym_data ?? null),
  )
  const wyckoff_positions = $derived.by(() => {
    if (
      !base_wyckoff_positions || !displayed_structure || !current_structure ||
      !top_ex_sym_data
    ) return base_wyckoff_positions

    // Only apply mapping for periodic structures with lattice
    if (!(`lattice` in current_structure) || !(`lattice` in displayed_structure)) {
      return base_wyckoff_positions
    }

    return map_wyckoff_to_all_atoms(
      base_wyckoff_positions,
      displayed_structure,
      current_structure,
      top_ex_sym_data,
    )
  })
</script>

<h1>Symmetry</h1>

<p style="text-align: center">
  Purely client-side interactive symmetry analysis. Powered by
  <a href="https://github.com/spglib/moyo">Moyo</a> WASM bindings.
</p>

<div class="symmetry-grid bleed-1400">
  <div class="symmetry-info">
    {#if !wasm_ready}
      <div class="loading-placeholder">
        <div class="loading-spinner"></div>
        <p>Loading symmetry analysis...</p>
      </div>
    {:else if error}
      <pre class="error" style="color: var(--error-color)">{error}</pre>
    {:else if top_ex_sym_data}
      <SymmetryStats
        sym_data={top_ex_sym_data}
        bind:settings={wide_example_symmetry_settings}
      />
      <WyckoffTable
        {wyckoff_positions}
        on_hover={(site_indices) => hovered_wyckoff_sites = site_indices ?? []}
        on_click={(site_indices) => active_wyckoff_sites = site_indices ?? []}
      />
    {:else}
      <div class="empty-state">
        <p>Load a structure to analyze its symmetry</p>
      </div>
    {/if}
  </div>

  <Structure
    data_url="/structures/{current_filename}"
    bind:displayed_structure
    bind:sym_data={top_ex_sym_data}
    bind:symmetry_settings={wide_example_symmetry_settings}
    scene_props={{
      active_sites: active_wyckoff_sites,
      selected_sites: hovered_wyckoff_sites,
    }}
    on_file_load={({ structure, filename = `` }) => {
      current_filename = filename
      page.url.searchParams.set(`file`, current_filename)
      goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
        replaceState: true,
        keepFocus: true,
        noScroll: true,
      })
      current_structure = structure || null
    }}
    style="height: 100%; min-height: 500px"
  >
    <h3
      style="position: absolute; left: 1em; top: 1ex; margin: 0; font-family: monospace"
    >
      {current_filename}
    </h3>
  </Structure>
</div>

<p style="margin: 2em 0; text-align: center">
  Drag any structure onto the viewer:
</p>

<FilePicker
  files={structure_files}
  show_category_filters
  on_drag_end={() => {/* noop to avoid TS complaining */}}
  style="margin-bottom: 3em"
/>

<!-- Layout Examples Section -->
<section style="margin: 4em 0">
  <h2 style="text-align: center; margin-bottom: 2em">Layout Examples</h2>

  {#if top_ex_sym_data}
    <!-- Example 3: Two Column - Stats Left, Structure Right -->
    <div class="example-section">
      <h3>Two Column - Stats + Structure</h3>
      <div class="two-column-layout">
        <div>
          <SymmetryStats
            sym_data={two_col_sym_data}
            bind:settings={two_col_sym_settings}
          />
        </div>
        <Structure
          data_url="/structures/{current_filename}"
          show_controls={true}
          bind:sym_data={two_col_sym_data}
          bind:symmetry_settings={two_col_sym_settings}
          style="height: 300px; border-radius: 8pt"
        />
      </div>
    </div>

    <!-- Example 5: Grid Layout - Stats Above, Structure Below -->
    <div class="example-section">
      <h3>Stacked Layout - Stats Above Structure</h3>
      <div class="stacked-layout">
        <SymmetryStats
          sym_data={stacked_sym_data}
          bind:settings={stacked_sym_settings}
        />
        <Structure
          data_url="/structures/{current_filename}"
          show_controls={true}
          bind:sym_data={stacked_sym_data}
          bind:symmetry_settings={stacked_sym_settings}
          style="height: 400px; border-radius: 8pt; margin-top: 1em"
        />
      </div>
    </div>
  {:else}
    <p style="text-align: center; color: var(--text-muted, #666)">
      Load a structure above to see layout examples
    </p>
  {/if}
</section>

<style>
  .symmetry-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2em;
    margin-block: 2em;
  }
  .loading-placeholder,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    padding: 2em;
    background: var(--surface-bg, #f5f5f5);
    border-radius: 8pt;
    color: var(--text-muted, #666);
  }
  .loading-placeholder p,
  .empty-state p {
    margin: 1em 0 0;
    font-size: 0.95em;
  }
  .loading-spinner {
    box-sizing: border-box;
    width: 40px;
    height: 40px;
    border: 4px solid var(--surface-bg-darker, #e0e0e0);
    border-top-color: var(--accent-color, #0066cc);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* layout example CSS */
  .example-section {
    margin: 3em 0;
  }
  .two-column-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2em;
  }
  .stacked-layout {
    max-width: 900px;
    margin: 0 auto;
  }
</style>
