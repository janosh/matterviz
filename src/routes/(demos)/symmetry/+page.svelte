<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { FilePicker, format_fractional, type Vec3 } from '$lib'
  import { atomic_number_to_symbol } from '$lib/composition/parse'
  import type { AnyStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { analyze_structure_symmetry, ensure_moyo_wasm_ready } from '$lib/symmetry'
  import { molecule_files } from '$site/molecules'
  import { structure_files } from '$site/structures'
  import type { MoyoDataset, MoyoOperation } from 'moyo-wasm'
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'

  let wasm_ready = $state(false)
  let last_error = $state<string | null>(null)
  let sym_data = $state<MoyoDataset | null>(null)
  let symprec = $state(1e-4)
  let setting = $state<`Standard` | `Spglib`>(`Standard`)
  let current_filename = $state(`Bi2Zr2O8-Fm3m.json`)

  $effect(() => {
    if (!browser) return
    const file = page.url.searchParams.get(`file`)
    if (file && file !== current_filename) current_filename = file
  })

  onMount(async () => {
    try {
      await ensure_moyo_wasm_ready()
      wasm_ready = true
    } catch (exc) {
      last_error = `Failed to init WASM: ${String(exc)}`
    }
  })

  async function analyze_structure(struct_or_mol: AnyStructure) {
    last_error = null
    sym_data = null
    if (!(`lattice` in struct_or_mol)) {
      last_error = `Not a periodic structure (no lattice).`
      return
    }
    if (!wasm_ready) {
      last_error = `WASM not ready yet.`
      return
    }
    try {
      sym_data = await analyze_structure_symmetry(
        struct_or_mol,
        symprec,
        setting,
      )
    } catch (exc) {
      last_error = `${exc}`
    }
  }

  const files = [...structure_files, ...molecule_files]

  // Build one row per Wyckoff site with element and fractional coords
  // Choose the "simplest" representative coordinates for a Wyckoff letter+element group
  function simplicity_score(vec: Vec3): number {
    const to_unit = (v: number) => v - Math.floor(v)
    const near_zero = (v: number) => Math.min(v, 1 - v)
    const near_half = (v: number) => Math.abs(v - 0.5)
    const [ax, ay, az] = vec?.map(to_unit) ?? []
    return (
      near_zero(ax) + near_zero(ay) + near_zero(az) +
      0.5 * (near_half(ax) + near_half(ay) + near_half(az))
    )
  }

  const wyckoff_rows = $derived.by<
    { wyckoff: string; elem: string; abc: Vec3 }[]
  >(() => {
    const info = sym_data
    if (!info) return []

    const { positions, numbers } = info.std_cell
    const { wyckoffs } = info

    // Count multiplicity per letter-element combination
    const letter_elem_counts: Record<string, number> = {}
    const best_by_key = new SvelteMap<
      string,
      { letter: string; elem: string; idx: number }
    >()

    // Process all sites, including those without Wyckoff letters
    wyckoffs.forEach((full, idx) => {
      const letter = (full?.match(/[a-z]+$/)?.[0] ?? full ?? ``).toString()
      const elem = atomic_number_to_symbol[numbers[idx]] ?? `?`

      if (letter) {
        // Symmetric site with Wyckoff letter
        const key = `${letter}|${elem}`
        letter_elem_counts[key] = (letter_elem_counts[key] ?? 0) + 1

        const prev = best_by_key.get(key)
        const better = !prev ||
          simplicity_score(positions[idx] as Vec3) <
            simplicity_score(positions[prev.idx] as Vec3)
        if (better) best_by_key.set(key, { letter, elem, idx })
      } else {
        // Non-symmetric site (no Wyckoff letter) - add directly
        best_by_key.set(`nosym|${elem}|${idx}`, { letter: ``, elem, idx })
      }
    })

    const rows = Array.from(best_by_key.values()).map(({ letter, elem, idx }) => {
      if (letter) {
        // For symmetric sites, show multiplicity for this specific letter-element combination
        const key = `${letter}|${elem}`
        return {
          wyckoff: `${letter_elem_counts[key]}${letter}`,
          elem,
          abc: positions[idx] as Vec3,
        }
      } else {
        // For non-symmetric sites, show multiplicity 1
        return {
          wyckoff: `1`,
          elem,
          abc: positions[idx] as Vec3,
        }
      }
    })

    rows.sort((w1, w2) => {
      const [w1_mult, w2_mult] = [parseInt(w1.wyckoff), parseInt(w2.wyckoff)]
      if (w1_mult !== w2_mult) return w1_mult - w2_mult
      return w1.wyckoff.localeCompare(w2.wyckoff)
    })

    return rows
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
          Symprec
          <input type="number" step="1e-5" bind:value={symprec} />
        </label>
        <label>
          Setting
          <select bind:value={setting}>
            <option value="Standard">Standard</option>
            <option value="Spglib">Spglib</option>
          </select>
        </label>
      </div>
    {:else}
      <span class="status warn">Loading WASM…</span>
    {/if}
    {#if last_error}
      <pre class="error" style="color: var(--error-color)">{last_error}</pre>
    {:else if sym_data}
      <div class="symmetry-stats">
        <div>Space group <strong>{sym_data.number}</strong></div>
        <div>Hermann-Mauguin <strong>{sym_data.hm_symbol ?? `N/A`}</strong></div>
        <div>Hall number <strong>{sym_data.hall_number}</strong></div>
        <div>Pearson <strong>{sym_data.pearson_symbol}</strong></div>
        <div>
          Symmetry operations <strong>{sym_data.operations.length}</strong>
          <ul>
            {#each [
              [`translations`, (op: MoyoOperation) =>
                op.rotation.every((r) => r === 0)],
              [`rotations`, (op: MoyoOperation) =>
                op.translation.every((t) =>
                  t === 0
                )],
              [`roto-translations`, (op: MoyoOperation) =>
                op.rotation.some((r) =>
                  r !== 0
                ) && op.translation.some((t) =>
                  t !== 0
                )],
            ] as const as
              [op_type, filter_func]
              (op_type)
            }
              <li>
                {op_type} <strong>{
                  sym_data.operations.filter(filter_func).length
                }</strong>
              </li>
            {/each}
          </ul>
        </div>
        <div>Distinct orbits <strong>{wyckoff_rows.length}</strong></div>
      </div>
      <table class="wyckoff-table" style="margin-top: 1em">
        <thead>
          <tr>
            {#each [`Wyckoff`, `Element`, `Fractional Coords`] as col (col)}
              <th>{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each wyckoff_rows as { wyckoff, elem, abc } (`${wyckoff}-${elem}-${abc}`)}
            <tr>
              <td>{wyckoff}</td>
              <td>{elem}</td>
              <td>({abc.map((x) => format_fractional(x)).join(` , `)})</td>
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
  Drag any of these structures onto the viewer:
</p>

<FilePicker
  {files}
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
