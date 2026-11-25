<script lang="ts">
  import { display_idx, trajectory_property_config } from '#lib/labels.js'
  import type { AtomColorConfig } from '#lib/structure/atom-properties.js'
  import type { AnyStructure } from '#lib/structure/index.js'
  import { normalize_fractional_coords } from '#lib/structure/parse.js'
  import { PROP_PREFIX } from '#lib/structure/site-table.js'
  import Structure from '#lib/structure/Structure.svelte'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { format_num } from 'svelte-widgets/format'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { Reset } from 'svelte-widgets/icons'
  import NumberRangeInput from 'svelte-widgets/NumberRangeInput.svelte'
  import SettingsGroup from 'svelte-widgets/SettingsGroup.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import Tag from 'svelte-widgets/Tag.svelte'
  import { to_error } from 'svelte-widgets/utils'
  import {
    compute_structure_diff,
    format_drift,
    LATTICE_KEYS,
    type SiteMatching,
    type StructureDiffResult,
  } from './compute'
  import DisplacementOverlay from './DisplacementOverlay.svelte'

  // Site property the viewer colors atoms by and its site table lists (|Δr| and x/y/z)
  const DISPLACEMENT_KEY = `displacement`
  // Lattice changes below this (in %) are round-off, not worth a row
  const LATTICE_CHANGE_MIN_PERCENT = 1e-3

  let {
    reference,
    target,
    matching = $bindable(`auto`),
    remove_drift = $bindable(true),
    show_ghost = $bindable(true),
    show_arrows = $bindable(true),
    arrow_scale = $bindable(1),
    hovered_site_idx = $bindable(null),
    structure_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    // Geometry the displacements start from, e.g. the unrelaxed input or a DFT reference
    reference: AnyStructure
    // Geometry the displacements end at, drawn as atoms. Same composition and site count as
    // `reference`.
    target: AnyStructure
    // How sites pair up (see SiteMatching): by index, by species-aware nearest neighbor, or
    // `auto` (index unless that pairing is implausible and nearest is shorter)
    matching?: SiteMatching
    // Subtract the mean displacement (and for molecules the best-fit rotation) so rigid drift
    // doesn't inflate the RMSD or point every arrow the same way
    remove_drift?: boolean
    show_ghost?: boolean // translucent reference atoms
    show_arrows?: boolean // arrows from each reference atom to its target atom
    // Exaggeration of arrows and ghost offsets: 1 draws true displacements
    arrow_scale?: number
    // Target site index under the pointer (site table row or 3D atom), null when none
    hovered_site_idx?: number | null
    // Extra props for the inner Structure viewer, e.g. `{ style: 'height: 500px' }`
    structure_props?: ComponentProps<typeof Structure>
  } = $props()

  // Wrapped into the cell as the viewer draws them, so the overlay lands on the drawn atoms
  const ref_wrapped = $derived(normalize_fractional_coords(reference))
  const target_wrapped = $derived(normalize_fractional_coords(target))
  // the diff, or the message of the input error that prevents one
  const result = $derived.by((): StructureDiffResult | string => {
    try {
      return compute_structure_diff(ref_wrapped, target_wrapped, { matching, remove_drift })
    } catch (exc) {
      return to_error(exc).message
    }
  })
  const diff = $derived(typeof result === `string` ? null : result)

  // The target with its displacements as the only site property: the viewer colors atoms by
  // it and its docked site table lists it, so other per-site data (forces) stays out of the way
  const shown_structure = $derived(
    diff && {
      ...target_wrapped,
      sites: target_wrapped.sites.map((site, idx) => ({
        ...site,
        properties: { [DISPLACEMENT_KEY]: diff.displacements[idx].vector },
      })),
    },
  )
  // atoms colored by |Δr|, arrows (one color) show direction
  let atom_color_config = $state<AtomColorConfig>({
    mode: `property`,
    property_key: DISPLACEMENT_KEY,
    color_scale: `interpolateViridis`,
    scale_type: `continuous`,
  })
  // The docked site table leads with |Δr|, largest first, then its components; coordinates
  // stay one column-toggle away
  const displacement_column = (axis: string) => `${PROP_PREFIX}${DISPLACEMENT_KEY}_${axis}`
  const site_table_props = {
    sort: [{ column: displacement_column(`norm`), dir: `desc` as const }],
    column_order: [`site`, `element`, ...[`norm`, `x`, `y`, `z`].map(displacement_column)],
    hidden_columns: [`frac_a`, `frac_b`, `frac_c`, `cart_x`, `cart_y`, `cart_z`],
  }
  const scene_props = $derived({
    show_bonds: `never` as const,
    atom_radius: 0.45,
    ...structure_props.scene_props,
  })

  const changed_lattice_keys = $derived(
    LATTICE_KEYS.filter(
      (key) => Math.abs(diff?.lattice?.percent[key] ?? 0) >= LATTICE_CHANGE_MIN_PERCENT,
    ),
  )
  const lattice_label = (key: (typeof LATTICE_KEYS)[number]): string => {
    const { label, unit } = trajectory_property_config[key]
    return `${key === `volume` ? `V` : label} (${unit})`
  }
</script>

<div {...rest} class={[`structure-diff`, rest.class]}>
  {#if typeof result === `string`}
    <StatusMessage message={result} type="error" />
  {:else if diff && shown_structure}
    {@const {
      rmsd,
      max_displacement,
      max_site_idx,
      displacements,
      drift,
      lattice,
      reordered,
    } = diff}
    <div class="headline">
      <span title="Root-mean-square displacement over all sites"
        >RMSD <strong>{format_num(rmsd, `.3~f`)} Å</strong></span
      >
      <span title="Largest displacement and the target site it belongs to"
        >max |Δr| <strong>{format_num(max_displacement, `.3~f`)} Å</strong>
        <small>site {display_idx(max_site_idx)} ({displacements[max_site_idx].species})</small
        ></span
      >
      {#if lattice}
        <span title="Cell volume change, target vs reference"
          >ΔV <strong>{format_num(lattice.percent.volume, `+.3~f`)}%</strong></span
        >
      {/if}
      {#if drift}
        <span
          title="Rigid motion subtracted from every displacement: the mean shift (length shown), for molecules also the best-fit rotation"
          >{format_drift(drift)}</span
        >
      {/if}
      {#if reordered}
        <Tag
          label="sites reordered"
          title="The files list these atoms in different orders: sites were paired by species-aware nearest-neighbor matching"
        />
      {/if}
      {#if lattice && changed_lattice_keys.length > 0}
        <!-- display: contents puts the summary in this row and wraps the table below it -->
        <details class="lattice">
          <summary>Lattice</summary>
          <table>
            <thead>
              <tr>
                <th></th>
                {#each changed_lattice_keys as key (key)}<th>{lattice_label(key)}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each [[`Reference`, lattice.reference, `.4~f`, ``], [`Target`, lattice.target, `.4~f`, ``], [`Δ`, lattice.percent, `+.3~f`, `%`]] as const as [row_label, values, fmt, suffix] (row_label)}
                <tr>
                  <th>{row_label}</th>
                  {#each changed_lattice_keys as key (key)}<td
                      >{format_num(values[key], fmt)}{suffix}</td
                    >{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
    </div>

    <Structure
      site_sidebar
      {...structure_props}
      site_table_props={{ ...site_table_props, ...structure_props.site_table_props }}
      show_image_atoms={false}
      {scene_props}
      structure={shown_structure}
      bind:atom_color_config
      bind:hovered_site_idx
    >
      {#snippet scene_children({ site_radius })}
        <DisplacementOverlay
          {diff}
          target={target_wrapped}
          {site_radius}
          {arrow_scale}
          {show_ghost}
          {show_arrows}
        />
      {/snippet}
      {#snippet controls_extra()}
        <SettingsGroup title="Structure diff" open>
          <div class="diff-settings">
            <label
              title="How sites pair up: index keeps the file order, nearest pairs each atom with the closest one of its species, auto picks"
            >
              Site matching
              <select bind:value={matching}>
                <option value="auto">auto</option>
                <option value="index">index</option>
                <option value="nearest">nearest</option>
              </select>
            </label>
            <label
              title="Subtract the mean displacement (and for molecules the best-fit rotation) from every site"
            >
              <input type="checkbox" bind:checked={remove_drift} /> Remove rigid drift
            </label>
            <label>
              <input type="checkbox" bind:checked={show_ghost} /> Reference ghosts
            </label>
            <label>
              <input type="checkbox" bind:checked={show_arrows} /> Displacement arrows
            </label>
            <div class="exaggeration">
              <NumberRangeInput
                min={1}
                max={100}
                step="any"
                scale="log"
                title="Multiplies arrow lengths and ghost offsets; 1 shows the true displacements"
                bind:value={() => arrow_scale, (value) => (arrow_scale = value ?? 1)}
                >Exaggeration</NumberRangeInput
              >
              <!-- hidden, not removed, at ×1 so the slider keeps its width -->
              <button
                type="button"
                class="icon-btn"
                style:visibility={arrow_scale === 1 ? `hidden` : null}
                onclick={() => (arrow_scale = 1)}
                title="Reset exaggeration to true size (×1)"
              >
                <Icon icon={Reset} />
              </button>
            </div>
          </div>
        </SettingsGroup>
      {/snippet}
    </Structure>
  {/if}
</div>

<style>
  /* A host with a height (style, custom element, widget cell) holds the headline and gives the
     viewer the rest; without one the viewer keeps its own height */
  .structure-diff {
    display: flex;
    flex-direction: column;
    height: 100%;
    :global(.structure-site-layout.docked-sidebar-row),
    :global(.structure-site-layout:not(.docked-sidebar-row) > .structure) {
      flex: 1 1 auto;
      min-height: 0;
    }
  }
  .headline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4em 1.4em;
    margin-bottom: 0.6em;
    font-variant-numeric: tabular-nums;
    details.lattice {
      display: contents;
      &::details-content {
        flex-basis: 100%;
      }
      summary {
        cursor: pointer;
      }
      table {
        border-collapse: collapse;
        th,
        td {
          padding: 1px 8px;
          text-align: right;
        }
        tbody th {
          text-align: left;
        }
      }
    }
  }
  .diff-settings {
    display: grid;
    gap: 4pt;
    label {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }
  }
  .exaggeration {
    display: flex;
    align-items: center;
    gap: 0.4em;
    > :global(label) {
      flex: 1;
    }
  }
  /* a circle, never taller than wide, shaded only faintly on hover (as WulffFacetEditor's) */
  .icon-btn {
    display: grid;
    place-items: center;
    width: 1em;
    height: 1em;
    padding: 0;
    --icon-size: 0.85em;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    &:hover {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
  }
</style>
