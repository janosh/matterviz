<script lang="ts">
  import { get_alphabetical_formula } from '$lib/composition/format'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import type { InfoItem } from '$lib/layout'
  import Histogram from '$lib/plot/Histogram.svelte'
  import type { Label, RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type { ConvexHullEntry, PhaseStats } from './types'

  let { phase_stats, stable_entries, unstable_entries, ...rest }:
    & HTMLAttributes<HTMLDivElement>
    & {
      phase_stats: PhaseStats | null
      stable_entries: ConvexHullEntry[]
      unstable_entries: ConvexHullEntry[]
    } = $props()

  let copied_items = new SvelteSet<string>()
  let view_mode = $state<`stats` | `table`>(`stats`)

  async function copy_to_clipboard(label: string, value: string, key: string) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => copied_items.delete(key), 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }

  // Prepare histogram data for formation energies and hull distances
  let e_form_data = $derived.by(() => {
    const all_entries = [...stable_entries, ...unstable_entries]
    const energies = all_entries
      .map((entry) => entry.e_form_per_atom ?? entry.energy_per_atom)
      .filter((val): val is number => val !== undefined && isFinite(val))
    return [{
      x: [],
      y: energies,
      label: `Formation Energy`,
      line_style: { stroke: `steelblue` },
    }]
  })

  let hull_distance_data = $derived.by(() => {
    const all_entries = [...stable_entries, ...unstable_entries]
    const distances = all_entries
      .map((entry) => entry.e_above_hull)
      .filter((val): val is number => val !== undefined && isFinite(val))
    return [{
      x: [],
      y: distances,
      label: `E above hull`,
      line_style: { stroke: `coral` },
    }]
  })

  let pane_data = $derived.by(() => {
    if (!phase_stats) return []
    const sections: { title: string; items: InfoItem[] }[] = []

    // Determine system dimensionality from chemical_system string (count elements)
    const num_elements = phase_stats.chemical_system.split(`-`).length
    const max_arity = Math.max(
      num_elements,
      phase_stats.quaternary > 0
        ? 4
        : phase_stats.ternary > 0
        ? 3
        : phase_stats.binary > 0
        ? 2
        : 1,
    )

    const phase_items: InfoItem[] = [
      {
        label: `Total entries in ${phase_stats.chemical_system}`,
        value: format_num(phase_stats.total),
        key: `total-entries`,
      },
    ]

    // Only show phase types that exist or are within expected dimensionality
    if (phase_stats.unary > 0 || max_arity >= 1) {
      phase_items.push({
        label: `Unary phases`,
        value: `${format_num(phase_stats.unary)} (${
          format_num(phase_stats.unary / phase_stats.total, `.1~%`)
        })`,
        key: `unary-phases`,
      })
    }
    if (phase_stats.binary > 0 || max_arity >= 2) {
      phase_items.push({
        label: `Binary phases`,
        value: `${format_num(phase_stats.binary)} (${
          format_num(phase_stats.binary / phase_stats.total, `.1~%`)
        })`,
        key: `binary-phases`,
      })
    }
    if (phase_stats.ternary > 0 || max_arity >= 3) {
      phase_items.push({
        label: `Ternary phases`,
        value: `${format_num(phase_stats.ternary)} (${
          format_num(phase_stats.ternary / phase_stats.total, `.1~%`)
        })`,
        key: `ternary-phases`,
      })
    }
    if (phase_stats.quaternary > 0 || max_arity >= 4) {
      phase_items.push({
        label: `Quaternary phases`,
        value: `${format_num(phase_stats.quaternary)} (${
          format_num(phase_stats.quaternary / phase_stats.total, `.1~%`)
        })`,
        key: `quaternary-phases`,
      })
    }

    sections.push({ title: ``, items: phase_items })

    // Stability
    const stable_item = {
      label: `Stable phases`,
      value: `${format_num(phase_stats.stable)} (${
        format_num(phase_stats.stable / phase_stats.total, `.1~%`)
      })`,
      key: `stable-phases`,
    }
    const unstable_item = {
      label: `Unstable phases`,
      value: `${format_num(phase_stats.unstable)} (${
        format_num(phase_stats.unstable / phase_stats.total, `.1~%`)
      })`,
      key: `unstable-phases`,
    }
    sections.push({ title: `Stability`, items: [stable_item, unstable_item] })

    // Energy Statistics
    const energy_item = {
      label: `Min / avg / max (eV/atom)`,
      value: `${format_num(phase_stats.energy_range.min, `.3f`)} / ${
        format_num(phase_stats.energy_range.avg, `.3f`)
      } / ${format_num(phase_stats.energy_range.max, `.3f`)}`,
      key: `formation-energy`,
    }
    sections.push({
      title: `E<sub>form</sub> distribution`,
      items: [energy_item],
    })

    // Hull Distance
    const hull_distance_item = {
      label: `Max / avg (eV/atom)`,
      value: `${format_num(phase_stats.hull_distance.max, `.3f`)} / ${
        format_num(phase_stats.hull_distance.avg, `.3f`)
      }`,
      key: `hull-distance`,
    }
    sections.push({
      title: `E<sub>above hull</sub> distribution`,
      items: [hull_distance_item],
    })

    return sections
  })

  // Extract spacegroup symbol from pymatgen structure dict
  function get_spacegroup(entry: ConvexHullEntry): string | undefined {
    const struct = entry.structure as Record<string, unknown> | undefined
    if (!struct) return undefined
    const lattice = struct.lattice as Record<string, unknown> | undefined
    const sg = struct.spacegroup ?? lattice?.spacegroup
    if (sg && typeof sg === `object`) {
      const sg_obj = sg as Record<string, unknown>
      return (sg_obj.symbol ?? sg_obj.Hermann_Mauguin ?? sg_obj.number) as
        | string
        | undefined
    }
    if (typeof sg === `string`) return sg
    if (typeof sg === `number`) return String(sg)
    return undefined
  }

  // Table view: shared derived for visible entries and feature flags
  let visible_entries = $derived(
    [...stable_entries, ...unstable_entries].filter((entry) => entry.visible),
  )
  let has_raw = $derived(
    visible_entries.some((entry) => entry.energy_per_atom !== undefined),
  )
  let has_ids = $derived(visible_entries.some((entry) => entry.entry_id))
  // Cache spacegroup lookups to avoid redundant parsing in both has_spacegroup and table_data
  let spacegroup_map = $derived(
    new Map(visible_entries.map((entry) => [entry, get_spacegroup(entry)])),
  )
  let has_spacegroup = $derived([...spacegroup_map.values()].some(Boolean))

  let table_data = $derived(visible_entries.map((entry) => {
    const counts = Object.values(entry.composition)
    const n_atoms = counts.reduce((sum, count) => sum + count, 0)
    const row: RowData = {
      Formula: entry.reduced_formula ?? entry.name ??
        get_alphabetical_formula(entry.composition, true),
      'E<sub>hull</sub>': entry.e_above_hull,
      'E<sub>form</sub>': entry.e_form_per_atom,
    }
    if (has_raw) row[`E<sub>raw</sub>`] = entry.energy_per_atom
    if (has_spacegroup) row.Spacegroup = spacegroup_map.get(entry)
    if (has_ids) row.ID = entry.entry_id
    row[`N<sub>el</sub>`] = counts.filter((count) => count > 0).length
    row[`N<sub>at</sub>`] = n_atoms
    return row
  }))

  let table_columns = $derived.by(() => {
    const cols: Label[] = [
      { label: `Formula`, color_scale: null },
      {
        label: `E<sub>hull</sub>`,
        better: `lower`,
        color_scale: `interpolateRdYlGn`,
        format: `.4f`,
        description: `Energy above convex hull (eV/atom)`,
      },
      {
        label: `E<sub>form</sub>`,
        better: `lower`,
        color_scale: `interpolateBlues`,
        format: `.4f`,
        description: `Formation energy (eV/atom)`,
      },
    ]
    if (has_raw) {
      cols.push({
        label: `E<sub>raw</sub>`,
        color_scale: `interpolateCool`,
        format: `.4f`,
        description: `Raw energy per atom (eV/atom)`,
      })
    }
    if (has_spacegroup) {
      cols.push({
        label: `Spacegroup`,
        color_scale: null,
        description: `Crystal spacegroup symbol`,
      })
    }
    if (has_ids) {
      cols.push({ label: `ID`, color_scale: null, description: `Entry identifier` })
    }
    cols.push(
      {
        label: `N<sub>el</sub>`,
        color_scale: null,
        description: `Number of elements`,
      },
      {
        label: `N<sub>at</sub>`,
        color_scale: null,
        format: `d`,
        description: `Number of atoms in unit cell`,
      },
    )
    return cols
  })
</script>

<div {...rest} class="convex-hull-stats {rest.class ?? ``}">
  <div class="view-toggle">
    <button class:active={view_mode === `stats`} onclick={() => view_mode = `stats`}>
      Stats
    </button>
    <button class:active={view_mode === `table`} onclick={() => view_mode = `table`}>
      Table
    </button>
  </div>
  {#if view_mode === `stats`}
    {#each pane_data as section, sec_idx (sec_idx)}
      {#if sec_idx > 0}<hr />{/if}
      <section>
        {#if section.title}
          <h5>{@html section.title}</h5>
        {/if}
        {#each section.items as item (item.key ?? item.label)}
          {@const { key, label, value } = item}
          <div
            class="clickable stat-item"
            data-testid={key ? `pd-${key}` : undefined}
            title="Click to copy: {label}: {value}"
            onclick={() => copy_to_clipboard(item.label, String(item.value), key ?? item.label)}
            role="button"
            tabindex="0"
            onkeydown={(event) => {
              if ([`Enter`, ` `].includes(event.key)) {
                event.preventDefault()
                copy_to_clipboard(item.label, String(item.value), key ?? item.label)
              }
            }}
          >
            <span>{@html label}:</span>
            <span>{@html value}</span>
            {#if key && copied_items.has(key)}
              <Icon
                icon="Check"
                style="color: var(--success-color, #10b981); width: 12px; height: 12px"
                class="copy-checkmark"
              />
            {/if}
          </div>
        {/each}

        {#if section.title === `E<sub>form</sub> distribution` &&
        e_form_data[0].y.length > 0}
          <Histogram
            series={e_form_data}
            bins={50}
            x_axis={{ label: ``, format: `.2f` }}
            y_axis={{ label: ``, ticks: 3 }}
            show_legend={false}
            show_controls={false}
            padding={{ t: 5, b: 22, l: 35, r: 5 }}
            style="height: 100px; --histogram-min-height: 100px"
            bar={{ color: `steelblue`, opacity: 0.7 }}
          />
        {/if}

        {#if section.title === `E<sub>above hull</sub> distribution` &&
        hull_distance_data[0].y.length > 0}
          <Histogram
            series={hull_distance_data}
            bins={50}
            x_axis={{ label: ``, format: `.2f`, range: [0, null] }}
            y_axis={{ label: ``, ticks: 3 }}
            show_legend={false}
            show_controls={false}
            padding={{ t: 5, b: 22, l: 35, r: 5 }}
            style="height: 100px; --histogram-min-height: 100px"
            bar={{ color: `coral`, opacity: 0.7 }}
          />
        {/if}
      </section>
    {/each}
  {:else}
    <HeatmapTable
      data={table_data}
      columns={table_columns}
      initial_sort={{ column: `E<sub>hull</sub>`, direction: `asc` }}
      scroll_style="max-height: var(--hull-stats-max-height, 500px)"
      style="width: 100%"
    />
  {/if}
</div>

<style>
  .convex-hull-stats {
    background: var(--hull-stats-bg, var(--hull-bg));
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
    padding: 1em;
  }
  section div {
    display: flex;
    justify-content: space-between;
    gap: 6pt;
    padding: 1pt;
    line-height: 1.5;
  }
  section div.clickable {
    cursor: pointer;
    position: relative;
    padding: 0 3pt;
  }
  section div:hover {
    background: var(--pane-bg-hover);
    border-radius: 3pt;
  }
  section :global(.copy-checkmark) {
    position: absolute;
    top: 50%;
    right: 3pt;
    transform: translateY(-50%);
    background: var(--pane-bg);
    border-radius: 50%;
    animation: fade-in 0.1s ease-out;
  }
  @keyframes fade-in {
    0% {
      opacity: 0;
    }
  }
  .stat-item span:first-child {
    color: var(--text-color-muted, #666);
  }
  section h5 {
    margin: 0 0 6px 0;
  }
  .view-toggle {
    display: flex;
    margin-bottom: 8pt;
  }
  .view-toggle button {
    flex: 1;
    padding: 4pt 8pt;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.85em;
  }
  .view-toggle button:first-child {
    border-radius: 4pt 0 0 4pt;
  }
  .view-toggle button:last-child {
    border-radius: 0 4pt 4pt 0;
    border-left: none;
  }
  .view-toggle button.active {
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15));
    font-weight: 500;
  }
</style>
