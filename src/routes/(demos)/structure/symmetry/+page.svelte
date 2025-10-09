<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { FilePicker } from '$lib'
  import type { AnyStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import {
    analyze_structure_symmetry,
    ensure_moyo_wasm_ready,
    map_wyckoff_to_all_atoms,
    wyckoff_positions_from_moyo,
    WyckoffTable,
  } from '$lib/symmetry'
  import { structure_files } from '$site/structures'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { onMount } from 'svelte'
  import { tooltip } from 'svelte-multiselect'

  let wasm_ready = $state(false)
  let error = $state<string | null>(null)
  let sym_data = $state<MoyoDataset | null>(null)
  let symprec = $state(1e-4)
  let setting = $state<`Standard` | `Spglib`>(`Standard`)
  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)
  let current_structure = $state<AnyStructure | null>(null)
  let displayed_structure = $state<AnyStructure | undefined>(undefined)
  let hovered_wyckoff_sites = $state<number[]>([])
  let active_wyckoff_sites = $state<number[]>([])

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

  // Analyze structure when dependencies change
  $effect(() => {
    if (!wasm_ready || !current_structure) return
    analyze_structure()
  })

  async function analyze_structure() {
    if (!current_structure || !(`lattice` in current_structure)) {
      error = `Not a periodic structure`
      return
    }

    error = null
    sym_data = null

    try {
      sym_data = await analyze_structure_symmetry(
        current_structure,
        symprec,
        setting,
      )
    } catch (exc) {
      error = `Analysis failed: ${exc}`
    }
  }

  // Derived values
  const base_wyckoff_positions = $derived(wyckoff_positions_from_moyo(sym_data))
  const wyckoff_positions = $derived.by(() => {
    if (
      !base_wyckoff_positions || !displayed_structure || !current_structure ||
      !sym_data
    ) return base_wyckoff_positions

    // Only apply mapping for periodic structures with lattice
    if (!(`lattice` in current_structure) || !(`lattice` in displayed_structure)) {
      return base_wyckoff_positions
    }

    return map_wyckoff_to_all_atoms(
      base_wyckoff_positions,
      displayed_structure,
      current_structure,
      sym_data,
    )
  })
  const operation_counts = $derived.by(() => {
    const EPS = 1e-10
    if (!sym_data?.operations) {
      return { translations: 0, rotations: 0, roto_translations: 0 }
    }

    return sym_data.operations.reduce((acc, op) => {
      const has_translation = op.translation.some((x) => Math.abs(x) > EPS)
      const is_identity = String(op.rotation) === `1,0,0,0,1,0,0,0,1`

      if (is_identity && has_translation) acc.translations++
      else if (!has_translation) acc.rotations++
      else acc.roto_translations++

      return acc
    }, { translations: 0, rotations: 0, roto_translations: 0 })
  })
</script>

<h1>Symmetry</h1>

<p style="text-align: center">
  Purely client-side interactive symmetry analysis. Powered by
  <a href="https://github.com/spglib/moyo">Moyo</a> WASM bindings.
</p>

<div class="symmetry-grid bleed-1400">
  <div class="symmetry-info">
    {#if wasm_ready}
      <div class="controls">
        <label>
          <span
            {@attach tooltip()}
            title="Symmetry precision control in spglib/moyo. Lower values (e.g. 1e-4, the default) are more strict, higher values (e.g. 1e-1) are more tolerant of numerical errors in atomic positions."
          >Symprec</span>
          <input type="number" step="1e-5" bind:value={symprec} />
        </label>
        <label>
          <span
            {@attach tooltip()}
            title="Symmetry detection algorithm: Standard uses moyo's newer recommended settings, spglib is useful if you need compatible results to an existing set of spglib-detected symmetries."
          >Setting</span>

          <select bind:value={setting}>
            <option value="Standard">Standard</option>
            <option value="Spglib">Spglib</option>
          </select>
        </label>
      </div>
    {:else}
      <span class="status warn">Loading WASM...</span>
    {/if}
    {#if error}
      <pre class="error" style="color: var(--error-color)">{error}</pre>
    {:else if sym_data}
      <div class="symmetry-stats">
        <div
          title="International Tables space group number (1-230) - unique identifier for each space group. Higher numbers indicate more symmetries in the crystal."
          {@attach tooltip()}
        >
          Space group <strong>{sym_data.number}</strong>
        </div>
        <div
          title="Hermann-Mauguin symbol describes symmetry operations. Format: Lattice type + Point group symmetry. Example: P4/mmm = Primitive + 4-fold rotation + mirror planes"
          {@attach tooltip()}
        >
          Hermann-Mauguin <strong>{sym_data.hm_symbol ?? `N/A`}</strong>
        </div>
        <div
          title="Hall number: alternative numbering system for space groups. Useful for crystallographic software compatibility."
          {@attach tooltip()}
        >
          Hall number <strong>{sym_data.hall_number}</strong>
        </div>
        <div
          title="Pearson symbol. Format: Crystal system + Number of atoms per unit cell. Example: tP2 = tetragonal primitive with 2 atoms"
          {@attach tooltip()}
        >
          Pearson <strong>{sym_data.pearson_symbol}</strong>
        </div>
        <div
          title="Total symmetry operations that map the crystal structure onto itself. Includes rotations, translations, and combinations."
          {@attach tooltip()}
        >
          Symmetry operations <strong>{sym_data.operations.length}</strong>
          <ul>
            <li>translations <strong>{operation_counts.translations}</strong></li>
            <li>rotations <strong>{operation_counts.rotations}</strong></li>
            <li>
              roto-translations <strong>{operation_counts.roto_translations}</strong>
            </li>
          </ul>
        </div>
        <div
          title="Number of unique Wyckoff positions (symmetry-equivalent atomic sites) in the crystal structure."
          {@attach tooltip()}
        >
          Distinct orbits <strong>{wyckoff_positions.length}</strong>
        </div>
      </div>
      <WyckoffTable
        {wyckoff_positions}
        on_hover={(site_indices) => hovered_wyckoff_sites = site_indices ?? []}
        on_click={(site_indices) => active_wyckoff_sites = site_indices ?? []}
      />
    {/if}
  </div>

  <Structure
    data_url="/structures/{current_filename}"
    bind:displayed_structure
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

<style>
  .status.warn {
    color: #b8860b;
  }
  .symmetry-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2em;
    margin-block: 2em;
  }
  .symmetry-info .symmetry-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1ex 1em;
    margin-block: 1ex;
    align-items: start;
  }
  .symmetry-info strong {
    margin: 0 0 0 3pt;
  }
  .symmetry-info .controls {
    display: flex;
    gap: 1em;
    background: var(--surface-bg);
    padding: 4pt 8pt;
    border-radius: 4pt;
    margin: 0 0 1em 0;
  }
  .symmetry-info .controls label {
    display: flex;
    gap: 6pt;
    place-items: center;
  }
  .symmetry-info .controls label input {
    padding: 2pt 4pt;
    max-width: 100px;
  }
  .symmetry-info ul {
    margin: 0;
  }
</style>
