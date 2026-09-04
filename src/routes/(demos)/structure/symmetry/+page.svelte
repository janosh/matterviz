<script lang="ts">
  import EmptyState from '$lib/EmptyState.svelte'
  import FilePicker from '$lib/FilePicker.svelte'
  import {
    is_crystal,
    parse_supercell_scaling,
    Structure,
    type AnyStructure,
  } from '$lib/structure'
  import type {
    CellType,
    ShowSymmetryKinds,
    SymmetryDataset,
    SymmetrySettings,
    WyckoffPos,
  } from '$lib/symmetry'
  import {
    DEFAULT_SHOW_SYM_KINDS,
    default_sym_settings,
    ensure_moyo_wasm_ready,
    spacegroup_wyckoff_positions,
    symmetry_elements_from_ops,
    tile_symmetry_elements,
    SymmetryElementControls,
    SymmetryStats,
    WyckoffTable,
  } from '$lib/symmetry'
  import { structure_files } from '$site/structures'
  import { file_param, set_file_param } from '$site/state.svelte'
  import { onMount } from 'svelte'

  let wasm_ready = $state(false)
  let error = $state<string | null>(null)
  const default_filename = `Bi2Zr2O8-Fm3m.json`
  let source_filename = $state(default_filename)
  let display_filename = $state(default_filename)
  // Wyckoff rows already re-expressed onto whatever cell the viewer renders
  // (conventional/primitive/supercell), bound from the viewer
  let wyckoff_positions = $state<WyckoffPos[]>([])
  let hovered_wyckoff_sites = $state<number[]>([])
  let active_wyckoff_sites = $state<number[]>([])
  // Symmetry data for each example
  let top_ex_sym_data = $state<SymmetryDataset | null>(null)
  let two_col_sym_data = $state<SymmetryDataset | null>(null)
  let stacked_sym_data = $state<SymmetryDataset | null>(null)
  // Symmetry settings for layout examples (independent controls)
  let wide_example_symmetry_settings = $state<SymmetrySettings>(default_sym_settings)
  let two_col_sym_settings = $state<SymmetrySettings>(default_sym_settings)
  let stacked_sym_settings = $state<SymmetrySettings>(default_sym_settings)
  let show_sym_elements = $state(false)
  // List unoccupied Wyckoff positions of the space group in the table
  let show_unoccupied_wyckoff = $state(false)
  // Per-kind overlay visibility; starts with rotation axes only to avoid overplotting
  let show_sym_kinds = $state<ShowSymmetryKinds>({ ...DEFAULT_SHOW_SYM_KINDS })
  // Cell type of the top example viewer (bound to its controls). moyo operations live in
  // the input-cell (original) frame: the viewer only draws the overlay while that frame is
  // rendered, and the controls say so while a conventional/primitive cell is shown.
  let top_ex_cell_type = $state<CellType>(`original`)
  let top_ex_structure = $state<AnyStructure>()
  let top_ex_tiling = $state(`1x1x1`)
  const sym_elements = $derived(
    show_sym_elements && top_ex_sym_data
      ? symmetry_elements_from_ops(top_ex_sym_data.operations ?? [])
      : [],
  )

  const sym_tiling = $derived(parse_supercell_scaling(top_ex_tiling))
  const sym_lattice = $derived(
    is_crystal(top_ex_structure) ? top_ex_structure.lattice.matrix : undefined,
  )
  const sym_tiling_result = $derived(
    sym_lattice && top_ex_cell_type === `original`
      ? tile_symmetry_elements(
          sym_elements.filter((element) => show_sym_kinds[element.kind]),
          sym_tiling,
          sym_lattice,
        )
      : undefined,
  )

  onMount(() => {
    // Initialize WASM
    ensure_moyo_wasm_ready()
      .then(() => (wasm_ready = true))
      .catch((err) => (error = `WASM init failed: ${err}`))
  })

  // Update filename from URL
  $effect(() => {
    const file = file_param()
    if (file && file !== source_filename) {
      source_filename = file
      display_filename = file
    }
  })
  // Full Wyckoff-position database of the detected space-group setting: adds ITA
  // representative coordinates and lets the table list unoccupied positions
  const wyckoff_db = $derived(
    wasm_ready && top_ex_sym_data
      ? spacegroup_wyckoff_positions(top_ex_sym_data.hall_number)
      : [],
  )
</script>

<h1>Symmetry</h1>

<p class="demo-intro">
  Purely client-side interactive symmetry analysis. Powered by
  <a href="https://github.com/spglib/moyo">Moyo</a> WASM bindings.
</p>

<div class="symmetry-grid bleed-1400">
  <div>
    {#if !wasm_ready}
      <div class="loading-placeholder">
        <div class="loading-spinner"></div>
        <p>Loading symmetry analysis...</p>
      </div>
    {:else if error}
      <pre style="color: var(--error-color)">{error}</pre>
    {:else if top_ex_sym_data}
      <SymmetryStats
        sym_data={top_ex_sym_data}
        bind:settings={wide_example_symmetry_settings}
      />
      <WyckoffTable
        {wyckoff_positions}
        db_positions={wyckoff_db}
        show_unoccupied={show_unoccupied_wyckoff}
        on_hover={(site_indices) => (hovered_wyckoff_sites = site_indices ?? [])}
        on_click={(site_indices) => (active_wyckoff_sites = site_indices ?? [])}
      />
      {#if wyckoff_db.length > 0}
        <label style="display: flex; gap: 6pt; align-items: center; margin-top: 1em">
          <input type="checkbox" bind:checked={show_unoccupied_wyckoff} />
          Show unoccupied Wyckoff positions
        </label>
      {/if}
      <label style="display: flex; gap: 6pt; align-items: center; margin-top: 1em">
        <input type="checkbox" bind:checked={show_sym_elements} />
        Show symmetry elements
      </label>
      {#if sym_elements.length > 0}
        <SymmetryElementControls
          elements={sym_elements}
          bind:show_kinds={show_sym_kinds}
          in_input_frame={top_ex_cell_type === `original`}
          tiling={sym_tiling}
          lattice={sym_lattice}
          tiling_result={sym_tiling_result}
          style="margin: 0.5em 0 0 1.5em"
        />
      {/if}
    {:else}
      <EmptyState
        message="Load a structure to analyze its symmetry"
        style="min-height: 300px; padding: 2em; background: var(--surface-bg, #f5f5f5); border-radius: 8pt; color: var(--text-muted, #666)"
      />
    {/if}
  </div>

  <Structure
    data_url="/structures/{source_filename}"
    bind:wyckoff_positions
    bind:sym_data={top_ex_sym_data}
    bind:symmetry_settings={wide_example_symmetry_settings}
    bind:cell_type={top_ex_cell_type}
    bind:structure={top_ex_structure}
    bind:supercell_scaling={top_ex_tiling}
    scene_props={{
      active_sites: active_wyckoff_sites,
      selected_sites: hovered_wyckoff_sites,
      symmetry_elements: sym_elements,
      symmetry_elements_props: {
        show_kinds: show_sym_kinds,
        tiling_result: sym_tiling_result,
      },
    }}
    on_file_load={({ filename = ``, source_filename: loaded_source_filename }) => {
      display_filename = filename || source_filename
      source_filename = loaded_source_filename ?? source_filename
      set_file_param(source_filename)
    }}
    style="height: 100%; min-height: 500px"
  >
    <h2
      style="position: absolute; left: 1em; top: 1ex; margin: 0; font-family: monospace; font-size: 1em"
    >
      {display_filename}
    </h2>
  </Structure>
</div>

<p style="margin: 2em 0; text-align: center">Drag any structure onto the viewer:</p>

<FilePicker files={structure_files} show_category_filters style="margin-bottom: 3em" />

<!-- Layout Examples Section -->
<section style="margin: 4em 0">
  <h2 style="text-align: center; margin-bottom: 2em">Layout Examples</h2>

  {#if top_ex_sym_data}
    <!-- Example 3: Two Column - Stats Left, Structure Right -->
    <div class="example-section">
      <h3>Two Column - Stats + Structure</h3>
      <div class="two-column-layout">
        <SymmetryStats sym_data={two_col_sym_data} bind:settings={two_col_sym_settings} />
        <Structure
          data_url="/structures/{source_filename}"
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
        <SymmetryStats sym_data={stacked_sym_data} bind:settings={stacked_sym_settings} />
        <Structure
          data_url="/structures/{source_filename}"
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
    > * {
      min-width: 0;
    }
    @media (max-width: 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .loading-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .loading-placeholder p {
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
    @media (max-width: 900px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .stacked-layout {
    max-width: 900px;
    margin: 0 auto;
  }
</style>
