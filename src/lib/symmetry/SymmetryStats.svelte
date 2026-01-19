<script lang="ts">
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SETTINGS_CONFIG } from '../settings'
  import type { SymmetrySettings } from './index'
  import { default_sym_settings, wyckoff_positions_from_moyo } from './index'
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

  const wyckoff_count = $derived(
    sym_data ? wyckoff_positions_from_moyo(sym_data).length : 0,
  )

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
    symprec:
      `Symmetry precision control in spglib/moyo. Lower values (e.g. 1e-4, the default) are more strict, higher values (e.g. 1e-1) are more tolerant of numerical errors in atomic positions.`,
    algo:
      `Symmetry detection algorithm: Moyo uses moyo's newer recommended settings, Spglib is useful if you need compatible results to an existing set of spglib-detected symmetries.`,
    space_group:
      `International Tables Space group number (1-230) - unique identifier for each space group. Higher numbers indicate more symmetries in the crystal.`,
    crystal_system:
      `Crystal system classification based on the unit cell symmetry. Seven systems: triclinic, monoclinic, orthorhombic, tetragonal, trigonal, hexagonal, and cubic.`,
    hermann_mauguin:
      `Hermann-Mauguin symbol describes symmetry operations. Format: Lattice type + Point group symmetry. Example: P4/mmm = Primitive + 4-fold rotation + mirror planes`,
    hall_number:
      `Hall number: alternative numbering system for space groups. Useful for crystallographic software compatibility.`,
    pearson_symbol:
      `Pearson symbol. Format: Crystal system + Number of atoms per unit cell. Example: tP2 = tetragonal primitive with 2 atoms`,
    symmetry_operations:
      `Total symmetry operations that map the crystal structure onto itself. Includes rotations, translations, and combinations.`,
    distinct_orbits:
      `Number of unique Wyckoff positions (symmetry-equivalent atomic sites) in the crystal structure.`,
    translations: `Number of translations in the crystal structure.`,
    rotations: `Number of rotations in the crystal structure.`,
    roto_translations: `Number of roto-translations in the crystal structure.`,
  }
  const tooltips: Record<string, string> = $derived(show_tooltips ? titles : {})
</script>

<div {...rest} class="symmetry-stats {rest.class ?? ``}">
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
        step="1e-5"
        value={settings.symprec}
        onchange={(evt) => {
          const { value } = evt.currentTarget
          const parsed = parseFloat(value)
          if (Number.isFinite(parsed)) {
            settings = { ...settings, symprec: parsed }
          }
        }}
      />
    </label>
    <label>
      <span {@attach tooltip()} title={tooltips?.algo}>Algorithm</span>

      <select
        value={settings.algo}
        onchange={(evt) =>
        settings = {
          ...settings,
          algo: evt.currentTarget.value as `Moyo` | `Spglib`,
        }}
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
        Space Group <strong>{sym_data.number} ({sym_data.hm_symbol ?? `?`})</strong>
      </div>
      <div title={tooltips?.crystal_system} {@attach tooltip()}>
        Crystal System <strong>{spg.spacegroup_to_crystal_sys(sym_data.number)}</strong>
      </div>
      <div title={tooltips?.hall_number} {@attach tooltip()}>
        Hall Number <strong>{sym_data.hall_number}</strong>
      </div>
      <div title={tooltips?.pearson_symbol} {@attach tooltip()}>
        Pearson <strong>{sym_data.pearson_symbol}</strong>
      </div>
      <div title={tooltips?.distinct_orbits} {@attach tooltip()}>
        Wyckoff Positions <strong>{wyckoff_count}</strong>
      </div>
      <div
        class="sym-ops-summary"
        title="{sym_ops_counts.translations} translations + {sym_ops_counts.rotations} rotations + {sym_ops_counts.roto_translations} roto-translations"
        {@attach tooltip()}
      >
        Total sym ops: <strong>{sym_data.operations.length}</strong>
        ({sym_ops_counts.translations}T + {sym_ops_counts.rotations}R + {
          sym_ops_counts.roto_translations
        }RT)
      </div>
    </div>
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
    background: var(--sym-stats-controls-bg, var(--surface-bg, #f5f5f5));
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
    grid-template-columns:
      var(--sym-stats-grid-columns, repeat(auto-fit, minmax(275px, 1fr)));
    gap: var(--sym-stats-grid-gap, 1ex 1em);
    margin-block: var(--sym-stats-grid-margin-block, 1ex);
    align-items: var(--sym-stats-grid-align, start);
  }
  .stats-grid strong {
    margin: var(--sym-stats-strong-margin, 0 0 0 3pt);
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
