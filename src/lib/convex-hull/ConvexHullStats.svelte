<script lang="ts">
  import { get_alphabetical_formula } from '$lib/composition/format'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import Histogram from '$lib/plot/Histogram.svelte'
  import type { Label, RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    type ConvexHullEntry,
    get_arity,
    is_on_hull,
    type PhaseArityField,
    type PhaseStats,
  } from './types'

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    layout = `toggle`,
    on_entry_click,
    ...rest
  }:
    & HTMLAttributes<HTMLDivElement>
    & {
      phase_stats: PhaseStats | null
      stable_entries: ConvexHullEntry[]
      unstable_entries: ConvexHullEntry[]
      // 'toggle' shows stats/table with toggle buttons (default)
      // 'side-by-side' shows both stats and table next to each other without toggle
      layout?: `toggle` | `side-by-side`
      // Called when a table row is clicked, with the corresponding entry
      on_entry_click?: (entry: ConvexHullEntry) => void
    } = $props()

  let copied_items = new SvelteSet<string>()
  let view_mode = $state<`stats` | `table`>(`stats`)
  let min_n_elements = $state(1)

  async function copy_to_clipboard(label: string, value: string, key: string) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => copied_items.delete(key), 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }

  // Shared concatenation of stable + unstable for histograms
  let all_entries = $derived([...stable_entries, ...unstable_entries])

  const histogram_props = {
    bins: 50,
    y_axis: { label: ``, ticks: 3 },
    show_legend: false,
    show_controls: false,
    padding: { t: 5, b: 22, l: 35, r: 5 },
    style: `height: 100px; --histogram-min-height: 100px`,
  } as const

  // Prepare histogram data for formation energies and hull distances
  let e_form_data = $derived.by(() => {
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

    const pct = (count: number) =>
      phase_stats.total > 0 ? format_num(count / phase_stats.total, `.1~%`) : `0%`

    // Determine system dimensionality from chemical_system string
    const num_elements = phase_stats.chemical_system.split(`-`).length
    const arity_types: [string, PhaseArityField, number][] = [
      [`Unary`, `unary`, 1],
      [`Binary`, `binary`, 2],
      [`Ternary`, `ternary`, 3],
      [`Quaternary`, `quaternary`, 4],
      [`Quinary+`, `quinary_plus`, 5],
    ]
    // max arity from data or system dimensionality
    const max_arity = arity_types.reduce(
      (max, [, field, arity]) => phase_stats[field] > 0 ? Math.max(max, arity) : max,
      num_elements,
    )

    return [
      {
        title: ``,
        items: [
          {
            label: `Total entries in ${phase_stats.chemical_system}`,
            value: format_num(phase_stats.total),
            key: `total-entries`,
          },
          // Only show phase types that exist or are within system dimensionality
          ...arity_types
            .filter(([, field, arity]) =>
              phase_stats[field] > 0 || max_arity >= arity
            )
            .map(([display, field]) => ({
              label: `${display} phases`,
              value: `${format_num(phase_stats[field])} (${pct(phase_stats[field])})`,
              key: `${field}-phases`,
            })),
        ],
      },
      {
        title: `Stability`,
        items: [
          {
            label: `Stable phases`,
            value: `${format_num(phase_stats.stable)} (${pct(phase_stats.stable)})`,
            key: `stable-phases`,
          },
          {
            label: `Unstable phases`,
            value: `${format_num(phase_stats.unstable)} (${
              pct(phase_stats.unstable)
            })`,
            key: `unstable-phases`,
          },
        ],
      },
      {
        title: `E<sub>form</sub> distribution`,
        items: [{
          label: `Min / avg / max (eV/atom)`,
          value: `${format_num(phase_stats.energy_range.min, `.3f`)} / ${
            format_num(phase_stats.energy_range.avg, `.3f`)
          } / ${format_num(phase_stats.energy_range.max, `.3f`)}`,
          key: `formation-energy`,
        }],
      },
      {
        title: `E<sub>above hull</sub> distribution`,
        items: [{
          label: `Max / avg (eV/atom)`,
          value: `${format_num(phase_stats.hull_distance.max, `.3f`)} / ${
            format_num(phase_stats.hull_distance.avg, `.3f`)
          }`,
          key: `hull-distance`,
        }],
      },
    ]
  })

  // Table view: visible entries filtered by min element count
  let visible_entries = $derived(
    all_entries.filter((entry) =>
      entry.visible && (min_n_elements <= 1 || get_arity(entry) >= min_n_elements)
    ),
  )
  let has_raw = $derived(
    visible_entries.some((entry) => entry.energy_per_atom !== undefined),
  )
  let has_ids = $derived(visible_entries.some((entry) => entry.entry_id))
  let max_n_el = $derived(
    all_entries.reduce((max, entry) => Math.max(max, get_arity(entry)), 1),
  )

  // Build table rows and a WeakMap from row→entry for the click handler
  let { table_data, entry_by_row } = $derived.by(() => {
    const map = new WeakMap<RowData, ConvexHullEntry>()
    const rows = visible_entries.map((entry, idx) => {
      const n_atoms = Object.values(entry.composition).reduce(
        (sum, count) => sum + count,
        0,
      )
      const on_hull = is_on_hull(entry)
      const formula = entry.reduced_formula ?? entry.name ??
        get_alphabetical_formula(entry.composition, true, ``)
      const row: RowData = {
        '#': idx + 1,
        Stable: on_hull
          ? `<span style="color: var(--hull-stable-color, #22c55e)" title="On hull">●</span>`
          : `<span style="color: var(--hull-unstable-color, #666); opacity: 0.4" title="Above hull">●</span>`,
        Formula: on_hull ? `<strong>${formula}</strong>` : formula,
        'E<sub>hull</sub>': entry.e_above_hull ?? null,
        'E<sub>form</sub>': entry.e_form_per_atom ?? entry.energy_per_atom ?? null,
      }
      if (has_raw) row[`E<sub>raw</sub>`] = entry.energy_per_atom
      if (has_ids) row.ID = entry.entry_id
      row[`N<sub>el</sub>`] = get_arity(entry)
      row[`N<sub>at</sub>`] = n_atoms
      map.set(row, entry)
      return row
    })
    return { table_data: rows, entry_by_row: map }
  })

  function handle_row_click(_event: MouseEvent, row: RowData): void {
    const entry = entry_by_row.get(row)
    if (entry) on_entry_click?.(entry)
  }

  let table_width = $derived(layout === `side-by-side` ? `fit-content` : `100%`)

  let table_columns: Label[] = $derived(
    [
      { label: `#`, color_scale: null, description: `Row number` },
      {
        label: `Stable`,
        color_scale: null,
        description: `On convex hull (E above hull ≈ 0)`,
      },
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
      ...(has_raw
        ? [{
          label: `E<sub>raw</sub>`,
          color_scale: `interpolateCool` as const,
          format: `.4f`,
          description: `Raw energy per atom (eV/atom)`,
        }]
        : []),
      ...(has_ids
        ? [{ label: `ID`, color_scale: null, description: `Entry identifier` }]
        : []),
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
    ] satisfies Label[],
  )
</script>

{#snippet stats_panel()}
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
            if (event.key === `Enter` || event.key === ` `) {
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
          {...histogram_props}
          series={e_form_data}
          x_axis={{ label: ``, format: `.2f` }}
          bar={{ color: `steelblue`, opacity: 0.7 }}
        />
      {/if}

      {#if section.title === `E<sub>above hull</sub> distribution` &&
      hull_distance_data[0].y.length > 0}
        <Histogram
          {...histogram_props}
          series={hull_distance_data}
          x_axis={{ label: ``, format: `.2f`, range: [0, null] }}
          bar={{ color: `coral`, opacity: 0.7 }}
        />
      {/if}
    </section>
  {/each}
{/snippet}

{#snippet table_panel()}
  {#if max_n_el > 2}
    <div class="nel-filter">
      <label>
        Min N<sub>el</sub>:
        <select bind:value={min_n_elements}>
          {#each Array.from({ length: max_n_el }, (_, idx) => idx + 1) as nel (nel)}
            <option value={nel}>{nel}{nel === 1 ? ` (all)` : ``}</option>
          {/each}
        </select>
      </label>
      <span style="color: var(--text-color-muted, #666); font-size: 0.9em">{
          visible_entries.length
        } entries</span>
    </div>
  {/if}
  <HeatmapTable
    data={table_data}
    columns={table_columns}
    initial_sort={{ column: `E<sub>hull</sub>`, direction: `asc` }}
    scroll_style={layout === `side-by-side`
    ? `flex: 1 1 0; overflow: auto`
    : `max-height: var(--hull-stats-max-height, 500px)`}
    style={`width: ${table_width}`}
    onrowclick={on_entry_click ? handle_row_click : undefined}
  />
{/snippet}

{#if layout === `side-by-side`}
  <div {...rest} class="convex-hull-stats side-by-side {rest.class ?? ``}">
    <div class="stats-pane">
      {@render stats_panel()}
    </div>
    <div class="table-pane">
      {@render table_panel()}
    </div>
  </div>
{:else}
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
      {@render stats_panel()}
    {:else}
      {@render table_panel()}
    {/if}
  </div>
{/if}

<style>
  .convex-hull-stats {
    background: var(--hull-stats-bg, var(--hull-bg));
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
    padding: 1em;
  }
  .convex-hull-stats.side-by-side {
    display: flex;
    gap: 1.5em;
    align-items: stretch;
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
  }
  .stats-pane {
    flex: 0 0 auto;
    min-width: 250px;
  }
  .table-pane {
    flex: 0 1 auto;
    overflow: auto;
    display: flex;
    flex-direction: column;
    :global(.table-container) {
      flex: 1 1 0;
      min-height: 0;
    }
  }
  .convex-hull-stats :global(tbody tr[onclick]) {
    cursor: pointer;
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
  .nel-filter {
    display: flex;
    align-items: center;
    gap: 0.75em;
    margin-bottom: 6pt;
    font-size: 0.85em;
    label {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }
    select {
      padding: 2pt 4pt;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 3pt;
      background: transparent;
      color: inherit;
      font-size: inherit;
    }
  }
</style>
