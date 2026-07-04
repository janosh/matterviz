<script lang="ts">
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import type { SymmetrySettings } from './index'
  import {
    count_structure_free_params,
    default_sym_settings,
    enrich_wyckoff_rows,
    spacegroup_settings,
    spacegroup_wyckoff_positions,
    wyckoff_positions_from_moyo,
    wyckoff_sequence,
  } from './index'
  import * as spg from './spacegroups'

  type SymmetrySnippet = Snippet<
    [{ sym_data?: MoyoDataset | null; settings: SymmetrySettings }]
  >

  let {
    sym_data,
    settings = $bindable(default_sym_settings),
    show_tooltips = true,
    children,
    label = `Symmetry`,
    header,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    sym_data?: MoyoDataset | null
    settings?: SymmetrySettings
    show_tooltips?: boolean
    children?: SymmetrySnippet
    label?: SymmetrySnippet | string
    header?: SymmetrySnippet
  } = $props()

  // Space-group Wyckoff database + all settings (empty when WASM is not initialized,
  // e.g. SSR or unit tests — the stats below degrade gracefully)
  const wyckoff_db = $derived(
    sym_data ? spacegroup_wyckoff_positions(sym_data.hall_number) : [],
  )
  const settings_entries = $derived(sym_data ? spacegroup_settings(sym_data.number) : [])
  const current_setting = $derived(
    settings_entries.find((entry) => entry.hall_number === sym_data?.hall_number),
  )
  const occupied_rows = $derived(
    sym_data ? enrich_wyckoff_rows(wyckoff_positions_from_moyo(sym_data), wyckoff_db) : [],
  )
  const wyckoff_count = $derived(occupied_rows.length)
  const wyckoff_seq = $derived(wyckoff_sequence(occupied_rows))
  // Internal degrees of freedom (null when ITA coordinates are unavailable)
  const free_params = $derived(count_structure_free_params(occupied_rows))
  const display_hm_symbol = $derived(sym_data?.hm_symbol?.replaceAll(/\s+/g, ``) ?? `?`)
  // Crystal system, plus the lattice system in parens when it differs (e.g. trigonal
  // space groups split into rhombohedral R-centered and hexagonal P lattices)
  const crystal_system_label = $derived.by(() => {
    if (!sym_data) return `?`
    const crystal_sys = spg.spacegroup_to_crystal_sys(sym_data.number)
    const lattice_sys = spg.spacegroup_num_to_lattice_system(sym_data.number)
    if (!crystal_sys) return `?`
    const suffix =
      lattice_sys && lattice_sys !== crystal_sys ? ` (${lattice_sys} lattice)` : ``
    return `${crystal_sys}${suffix}`
  })

  const sym_ops_counts = $derived.by(() => {
    const EPS = 1e-10
    if (!sym_data?.operations) {
      return { translations: 0, rotations: 0, roto_translations: 0 }
    }

    return sym_data.operations.reduce(
      (acc, op) => {
        const has_translation = op.translation.some((coord) => Math.abs(coord) > EPS)
        const is_identity = String(op.rotation) === `1,0,0,0,1,0,0,0,1`

        if (is_identity && has_translation) acc.translations++
        else if (!has_translation) acc.rotations++
        else acc.roto_translations++

        return acc
      },
      { translations: 0, rotations: 0, roto_translations: 0 },
    )
  })

  const titles = {
    symprec: `Symmetry precision control in spglib/moyo. Lower values (e.g. 1e-4, the default) are more strict, higher values (e.g. 1e-1) are more tolerant of numerical errors in atomic positions.`,
    algo: `Symmetry detection algorithm: Moyo uses moyo's newer recommended settings, Spglib is useful if you need compatible results to an existing set of spglib-detected symmetries.`,
    space_group: `International Tables Space group number (1-230) - unique identifier for each space group. Higher numbers indicate more symmetries in the crystal.`,
    crystal_system: `Crystal system classification based on the unit cell symmetry. Seven systems: triclinic, monoclinic, orthorhombic, tetragonal, trigonal, hexagonal, and cubic. For trigonal space groups, the lattice system (rhombohedral for R-centered groups, hexagonal otherwise) is shown in parentheses when it differs from the crystal system.`,
    hermann_mauguin: `Hermann-Mauguin symbol describes symmetry operations. Format: Lattice type + Point group symmetry. Example: P4/mmm = Primitive + 4-fold rotation + mirror planes`,
    hall_number: `Hall number: alternative numbering system for space groups. Useful for crystallographic software compatibility.`,
    pearson_symbol: `Pearson symbol. Format: Crystal system + Number of atoms per unit cell. Example: tP2 = tetragonal primitive with 2 atoms`,
    symmetry_operations: `Total symmetry operations that map the crystal structure onto itself. Includes rotations, translations, and combinations.`,
    distinct_orbits: `Number of unique Wyckoff positions (symmetry-equivalent atomic sites) in the crystal structure.`,
    wyckoff_sequence: `Wyckoff sequence: letters of all occupied Wyckoff positions in descending alphabetical order, with superscript counts for letters occupied by multiple orbits. A standard structure-type fingerprint (complements the Pearson symbol).`,
    free_params: `Internal degrees of freedom: number of free fractional-coordinate parameters (x, y, z in the ITA representative coordinates) summed over occupied Wyckoff orbits. 0 means all atomic positions are fully fixed by symmetry.`,
    settings: `All settings of this space group in the International Tables (origin choices, unique axes, cell choices, hexagonal vs rhombohedral axes). The setting detected for this structure is highlighted.`,
    translations: `Number of translations in the crystal structure.`,
    rotations: `Number of rotations in the crystal structure.`,
    roto_translations: `Number of roto-translations in the crystal structure.`,
  }
  const tooltips: Record<string, string> = $derived(show_tooltips ? titles : {})

  function get_step_from_order_of_magnitude(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1e-5
    const exponent = Math.floor(Math.log10(value))
    return 10 ** exponent
  }

  const symprec_step = $derived(get_step_from_order_of_magnitude(settings.symprec))
</script>

<div {...rest} class={[`symmetry-stats`, rest.class]}>
  {#if sym_data}
    {@render header?.({ sym_data, settings })}
  {/if}

  <!-- Always show controls so users can adjust settings even after errors -->
  <div class="controls">
    {#if typeof label === `string`}
      <strong>{label}</strong>
    {:else if label}
      {@render label?.({ sym_data, settings })}
    {/if}

    <label>
      <span {@attach tooltip()} title={tooltips?.symprec}>Precision</span>
      <input
        type="number"
        step={symprec_step}
        value={settings.symprec}
        oninput={(evt) => {
          const { value } = evt.currentTarget
          if (value === ``) return
          const parsed = Number(value)
          if (Number.isFinite(parsed)) {
            settings = { ...settings, symprec: parsed }
          }
        }}
        onkeydown={(evt) => {
          if (evt.key === `Escape`) {
            evt.currentTarget.blur()
          }
        }}
      />
    </label>
    <label>
      <span {@attach tooltip()} title={tooltips?.algo}>Algorithm</span>

      <select
        value={settings.algo}
        onchange={(evt) =>
          (settings = {
            ...settings,
            algo: evt.currentTarget.value as `Moyo` | `Spglib`,
          })}
      >
        {#each Object.keys(SETTINGS_CONFIG.symmetry.algo.enum ?? {}) as value (value)}
          <option {value}>{value}</option>
        {/each}
      </select>
    </label>
  </div>

  {@render children?.({ sym_data, settings })}
  {#if sym_data}
    <div class="stats-grid">
      <div
        title="{tooltips?.space_group} at {settings.symprec} (using {settings.algo} algo). {tooltips?.hermann_mauguin}"
        {@attach tooltip()}
      >
        Space Group <strong>{sym_data.number} ({display_hm_symbol})</strong>
      </div>
      <div title={tooltips?.crystal_system} {@attach tooltip()}>
        Crystal System <strong>{crystal_system_label}</strong>
      </div>
      <div title={tooltips?.hall_number} {@attach tooltip()}>
        Hall Number <strong>
          {sym_data.hall_number}{current_setting ? ` (${current_setting.hall_symbol})` : ``}
        </strong>
      </div>
      <div title={tooltips?.pearson_symbol} {@attach tooltip()}>
        Pearson <strong>{sym_data.pearson_symbol}</strong>
      </div>
      <div title={tooltips?.distinct_orbits} {@attach tooltip()}>
        Wyckoff Positions <strong>{wyckoff_count}</strong>
      </div>
      {#if wyckoff_seq}
        <div title={tooltips?.wyckoff_sequence} {@attach tooltip()}>
          Wyckoff Sequence <strong>{wyckoff_seq}</strong>
        </div>
      {/if}
      {#if free_params !== null}
        <div title={tooltips?.free_params} {@attach tooltip()}>
          Free Parameters <strong>{free_params}</strong>
        </div>
      {/if}
      <div
        class="sym-ops-summary"
        title="{sym_ops_counts.translations} translations + {sym_ops_counts.rotations} rotations + {sym_ops_counts.roto_translations} roto-translations"
        {@attach tooltip()}
      >
        Total sym ops: <strong>{sym_data.operations.length}</strong>
        ({sym_ops_counts.translations}T + {sym_ops_counts.rotations}R + {sym_ops_counts.roto_translations}RT)
      </div>
    </div>
    {#if settings_entries.length > 1}
      <details class="settings-explorer">
        <summary title={tooltips?.settings} {@attach tooltip()}>
          {settings_entries.length} settings of space group {sym_data.number}
        </summary>
        <table>
          <thead>
            <tr>
              <th>Hall #</th>
              <th>H-M full</th>
              <th>Hall symbol</th>
              <th>Setting</th>
              <th>Centering</th>
            </tr>
          </thead>
          <tbody>
            {#each settings_entries as entry (entry.hall_number)}
              {@const is_current = entry.hall_number === sym_data.hall_number}
              <tr
                class:current={is_current}
                title={is_current ? `Setting detected for this structure` : null}
              >
                <td>{entry.hall_number}</td>
                <td>{entry.hm_full}</td>
                <td>{entry.hall_symbol}</td>
                <td>{entry.setting || `—`}</td>
                <td>{entry.centering}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
    {/if}
  {:else}
    <div class="no-data">
      <p>No symmetry data available</p>
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    gap: var(--sym-stats-controls-gap, 1em);
    background: var(--sym-stats-controls-bg, var(--surface-bg));
    padding: var(--sym-stats-controls-padding, 4pt 6pt);
    border-radius: var(--sym-stats-controls-border-radius, 4pt);
    margin-inline: var(--sym-stats-controls-margin-inline, -6pt);
  }
  .controls label {
    display: flex;
    gap: var(--sym-stats-label-gap, 6pt);
    place-items: center;
  }
  .controls label input {
    padding: var(--sym-stats-input-padding, 2pt 5pt);
    width: var(--sym-stats-input-width, 5.5em);
    box-sizing: border-box;
  }
  .stats-grid {
    display: var(--sym-stats-display, grid);
    grid-template-columns: var(--sym-stats-grid-columns, repeat(auto-fit, minmax(275px, 1fr)));
    gap: var(--sym-stats-grid-gap, 1ex 1em);
    margin-block: var(--sym-stats-grid-margin-block, 1ex);
    align-items: var(--sym-stats-grid-align, start);
  }
  .stats-grid strong {
    margin: var(--sym-stats-strong-margin, 0 0 0 3pt);
  }
  .settings-explorer {
    margin-block: var(--sym-stats-grid-margin-block, 1ex);
  }
  .settings-explorer summary {
    cursor: pointer;
    color: var(--text-muted, #666);
  }
  .settings-explorer table {
    margin-top: 1ex;
    border-collapse: collapse;
  }
  .settings-explorer :is(th, td) {
    padding: 1px 8px;
    text-align: left;
  }
  .settings-explorer tr.current {
    background: color-mix(in srgb, var(--accent-color, #0066cc) 18%, transparent);
    font-weight: bold;
  }
  .no-data {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--sym-stats-no-data-min-height, 100px);
    padding: var(--sym-stats-no-data-padding, 2em);
    background: var(--sym-stats-no-data-bg, var(--surface-bg, #f5f5f5));
    border-radius: var(--sym-stats-no-data-border-radius, 4pt);
    color: var(--sym-stats-no-data-color, var(--text-muted, #666));
  }
  .no-data p {
    margin: 0;
  }
</style>
