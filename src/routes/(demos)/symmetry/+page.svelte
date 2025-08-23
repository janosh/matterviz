<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { FilePicker, format_fractional } from '$lib'
  import type { AnyStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import {
    analyze_structure_symmetry,
    ensure_moyo_wasm_ready,
    generate_wyckoff_rows,
  } from '$lib/symmetry'
  import { structure_files } from '$site/structures'
  import type { MoyoDataset } from 'moyo-wasm'
  import { onMount } from 'svelte'
  import { tooltip } from 'svelte-multiselect'

  let wasm_ready = $state(false)
  let last_error = $state<string | null>(null)
  let sym_data = $state<MoyoDataset | null>(null)
  let symprec = $state(1e-4)
  let setting = $state<`Standard` | `Spglib`>(`Standard`)
  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)
  let current_structure = $state<AnyStructure | null>(null)

  $effect(() => {
    if (!browser) return
    const file = page.url.searchParams.get(`file`)
    if (file && file !== current_filename) current_filename = file
  })

  // Auto-analyze structure when WASM becomes ready
  $effect(() => {
    if (wasm_ready && current_structure) analyze_structure(current_structure)
  })

  onMount(() =>
    ensure_moyo_wasm_ready().then(() => {
      wasm_ready = true
      last_error = null
    }).catch((exc) => {
      last_error = `Failed to init WASM: ${String(exc)}`
    })
  )

  async function analyze_structure(struct_or_mol: AnyStructure) {
    last_error = null
    sym_data = null

    if (!(`lattice` in struct_or_mol)) {
      last_error = `Not a periodic structure (no lattice).`
      return
    }
    if (!wasm_ready) return

    try {
      sym_data = await analyze_structure_symmetry(
        struct_or_mol,
        symprec,
        setting,
      )
    } catch (exc) {
      last_error = `Analysis failed: ${String(exc)}`
    }
  }

  const wyckoff_rows = $derived(generate_wyckoff_rows(sym_data))

  // Helper functions for symmetry operation classification
  const is_identity3 = (mat: number[]) => String(mat) === `1,0,0,0,1,0,0,0,1`

  const operation_counts = $derived.by(() => { // Compute operation with single for loop
    if (!sym_data?.operations) {
      return { translations: 0, rotations: 0, roto_translations: 0 }
    }

    let [translations, rotations, roto_translations] = [0, 0, 0]

    for (const op of sym_data.operations) {
      const has_translation = !op.translation.every((x) => x === 0)
      const is_identity = is_identity3(op.rotation)

      if (is_identity && has_translation) translations++
      else if (!has_translation) rotations++
      else roto_translations++
    }

    return { translations, rotations, roto_translations }
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
    {#if last_error}
      <pre class="error" style="color: var(--error-color)">{last_error}</pre>
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
          title="Pearson symbol: describes crystal system and number of atoms per unit cell. Format: Crystal system + Number of atoms. Example: tP2 = tetragonal primitive with 2 atoms"
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
          Distinct orbits <strong>{wyckoff_rows.length}</strong>
        </div>
      </div>
      <table class="wyckoff-table" style="margin-top: 1em">
        <thead>
          <tr>
            {#each [`Wyckoff`, `Element`, `Fractional Coords`] as col (col)}
              <th
                title={col === `Wyckoff`
                ? `Wyckoff position: Multiplicity + Letter (e.g. 4a = 4 atoms at position 'a')`
                : col === `Element`
                ? `Chemical element symbol`
                : `Fractional coordinates within the unit cell (0-1 range)`}
                {@attach tooltip()}
              >
                {col}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each wyckoff_rows as { wyckoff, elem, abc } (`${wyckoff}-${elem}-${abc}`)}
            <tr>
              <td>{wyckoff}</td>
              <td>{elem}</td>
              <td>({abc?.map((x) => format_fractional(x)).join(` , `) ?? `N/A`})</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <Structure
    data_url="/structures/{current_filename}"
    on_file_load={({ structure, filename = `` }) => {
      current_filename = filename
      page.url.searchParams.set(`file`, current_filename)
      goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
        replaceState: true,
        keepFocus: true,
        noScroll: true,
      })
      current_structure = structure || null
      if (structure) analyze_structure(structure)
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
