<script lang="ts">
  // Phase statistics + entry table for a convex hull (standalone or inside the info pane)
  import { get_electro_neg_formula, get_reduced_formula } from '$lib/composition'
  import { format_num } from '$lib/labels'
  import type { InfoPaneCard } from '$lib/overlays'
  import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
  import Histogram from '$lib/plot/histogram/Histogram.svelte'
  import type { Label, RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import { escape_html } from '$lib/utils'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import { get_arity, is_on_hull, visible_entries as filter_visible } from './helpers'
  import type {
    ConvexHullEntry,
    EntryCategoryConfig,
    PhaseArityField,
    PhaseStats,
  } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    show_stable = true,
    show_unstable = true,
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = [],
    layout = `toggle`,
    on_entry_click,
    highlighted_entry_id,
    min_n_elements = $bindable(1),
    entry_href,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    phase_stats: PhaseStats | null
    stable_entries: ConvexHullEntry[]
    unstable_entries: ConvexHullEntry[]
    show_stable?: boolean
    show_unstable?: boolean
    // Categorical classification + hidden values (excluded from shown counts/table)
    entry_category?: EntryCategoryConfig | null
    hidden_categories?: string[]
    // 'toggle' switches between stats and table; 'side-by-side' shows both
    layout?: `toggle` | `side-by-side`
    on_entry_click?: (entry: ConvexHullEntry) => void // table row click
    highlighted_entry_id?: string // row to highlight (e.g. current material on a detail page)
    min_n_elements?: number // table filter: minimum number of elements (bindable for URL sync)
    entry_href?: (entry: ConvexHullEntry) => string | null // makes the ID column a link
  } = $props()

  let view_mode = $state<`stats` | `table`>(`stats`)
  let formula_filter = $state(``) // table shows only this reduced formula when set
  const table_height = `var(--hull-stats-table-height, calc(var(--hull-stats-table-row-height, 2.35rem) * 10 + var(--hull-stats-table-header-height, 3.5rem)))`

  const all_entries = $derived([...stable_entries, ...unstable_entries])
  // show flags passed as true: the caller's stable/unstable partition is respected here and
  // filter_visible only applies the category filter on top
  const shown_entries = $derived(
    filter_visible(
      [...(show_stable ? stable_entries : []), ...(show_unstable ? unstable_entries : [])],
      true,
      true,
      entry_category,
      hidden_categories,
    ),
  )

  const arity_types: [string, PhaseArityField, number][] = [
    [`Unary`, `unary`, 1],
    [`Binary`, `binary`, 2],
    [`Ternary`, `ternary`, 3],
    [`Quaternary`, `quaternary`, 4],
    [`Quinary+`, `quinary_plus`, 5],
  ]

  const finite = (values: (number | undefined)[]): number[] =>
    values.filter((val): val is number => val !== undefined && Number.isFinite(val))
  // E_form only: an energy_per_atom fallback histograms two incomparable quantities as one
  const e_form_values = $derived(finite(all_entries.map((entry) => entry.e_form_per_atom)))
  const e_hull_values = $derived(finite(all_entries.map((entry) => entry.e_above_hull)))
  const histogram_props = {
    bins: 50,
    y_axis: { label: ``, ticks: 3 },
    show_legend: false,
    show_controls: false,
    padding: { t: 5, b: 22, l: 35, r: 5 },
    style: `height: 100px; --histogram-min-height: 100px`,
  } as const

  // Stat cards: phase counts, stability, then one per energy distribution (each followed
  // by its histogram in the markup)
  type StatCard = `counts` | `stability` | `e_form` | `e_hull`
  // e_form card is absent when no entry has a formation energy
  type StatCards = Omit<Record<StatCard, InfoPaneCard>, `e_form`> & { e_form?: InfoPaneCard }
  const stat_cards = $derived.by((): StatCards | null => {
    if (!phase_stats) return null
    const { total, chemical_system, max_arity, e_form_range, hull_distance } = phase_stats
    const count_row = (label: string, count: number, key: string) => ({
      label,
      value: `${format_num(count)} (${total > 0 ? format_num(count / total, `.1~%`) : `0%`})`,
      key: `pd-${key}`,
    })
    const energy_card = (title: string, label: string, values: number[], key: string) => ({
      title,
      rows: [{ label, value: values.map((val) => format_num(val, `.3f`)).join(` / `), key }],
    })
    return {
      counts: {
        title: ``,
        rows: [
          {
            label: `Total entries in ${chemical_system}`,
            value: format_num(total),
            key: `pd-total-entries`,
          },
          // Only arities that exist or fit the system dimensionality (respects zeroed counts)
          ...arity_types
            .filter(([, field, arity]) => phase_stats[field] > 0 || max_arity >= arity)
            .map(([display, field]) =>
              count_row(`${display} phases`, phase_stats[field], `${field}-phases`),
            ),
        ],
      },
      stability: {
        title: `Stability`,
        rows: [
          count_row(`Stable phases`, phase_stats.stable, `stable-phases`),
          count_row(`Unstable phases`, phase_stats.unstable, `unstable-phases`),
        ],
      },
      e_form: e_form_range
        ? energy_card(
            `E<sub>form</sub> distribution`,
            `Min / avg / max (eV/atom)`,
            [e_form_range.min, e_form_range.avg, e_form_range.max],
            `pd-formation-energy`,
          )
        : undefined,
      e_hull: energy_card(
        `E<sub>above hull</sub> distribution`,
        `Max / avg (eV/atom)`,
        [hull_distance.max, hull_distance.avg],
        `pd-hull-distance`,
      ),
    }
  })

  // Binary subsystem coverage: entries per element pair (ternary to 10-component systems)
  const subsystem_coverage = $derived.by(() => {
    if (!phase_stats) return null
    const elements = phase_stats.chemical_system.split(`-`)
    if (elements.length < 3 || elements.length > 10) return null
    const pair_counts = new SvelteMap<string, number>()
    for (const entry of all_entries) {
      const active = Object.keys(entry.composition).filter(
        (el) => (entry.composition[el as keyof typeof entry.composition] ?? 0) > 0,
      )
      for (const [idx_a, el_a] of active.entries()) {
        for (const el_b of active.slice(idx_a + 1)) {
          const key = [el_a, el_b].toSorted().join(`-`)
          pair_counts.set(key, (pair_counts.get(key) ?? 0) + 1)
        }
      }
    }
    return elements.flatMap((el_a, idx_a) =>
      elements.slice(idx_a + 1).map((el_b) => {
        const pair = [el_a, el_b].toSorted().join(`-`)
        return { pair, count: pair_counts.get(pair) ?? 0 }
      }),
    )
  })
  // === Table ===
  const composition_key = (comp: Record<string, number>): string =>
    get_electro_neg_formula(get_reduced_formula(comp), { plain_text: true, delim: `` })
  const polymorph_counts = $derived.by(() => {
    const counts = new SvelteMap<string, number>()
    for (const entry of all_entries) {
      const key = composition_key(entry.composition)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  })
  const poly_formulas = $derived(
    [...polymorph_counts.entries()]
      .filter(([, count]) => count > 1)
      .toSorted(([, count_a], [, count_b]) => count_b - count_a),
  )
  const has_polymorphs = $derived(poly_formulas.length > 0)
  // A filter value that no longer names a polymorph group (data changed) falls back to all
  const active_formula_filter = $derived(
    poly_formulas.some(([formula]) => formula === formula_filter) ? formula_filter : ``,
  )

  const table_entries = $derived(
    shown_entries.filter(
      (entry) =>
        (min_n_elements <= 1 || get_arity(entry) >= min_n_elements) &&
        (!active_formula_filter ||
          composition_key(entry.composition) === active_formula_filter),
    ),
  )
  const has_raw = $derived(table_entries.some((entry) => entry.energy_per_atom !== undefined))
  const has_ids = $derived(table_entries.some((entry) => entry.entry_id))
  const max_n_el = $derived(Math.max(1, ...all_entries.map(get_arity)))

  const is_highlighted = (entry: ConvexHullEntry): boolean => {
    if (!highlighted_entry_id) return false
    const data = entry.data as Record<string, unknown> | undefined
    return [entry.entry_id, data?.mat_id, data?.structure_id].includes(highlighted_entry_id)
  }

  // Table rows, index-aligned with table_entries (the `#` column is idx + 1, which is how
  // a clicked row maps back to its entry). Cell HTML is sanitized by HeatmapTable (unsafe
  // hrefs are dropped there).
  const table_data = $derived(
    table_entries.map((entry, idx): RowData => {
      const formula = get_electro_neg_formula(get_reduced_formula(entry.composition))
      const row: RowData = {
        '#': idx + 1,
        Formula: is_on_hull(entry) ? `<strong>${formula}</strong>` : formula,
        'E<sub>hull</sub>': entry.e_above_hull ?? null,
        'E<sub>form</sub>': entry.e_form_per_atom ?? entry.energy_per_atom ?? null,
      }
      if (has_raw) row[`E<sub>raw</sub>`] = entry.energy_per_atom
      if (has_ids) {
        const href = entry_href?.(entry)
        const safe_id = entry.entry_id ? escape_html(entry.entry_id) : undefined
        row.ID =
          href && safe_id
            ? `<a href="${escape_html(href)}" target="_blank" rel="noopener">${safe_id}</a>`
            : safe_id
      }
      if (has_polymorphs)
        row.Poly = polymorph_counts.get(composition_key(entry.composition)) ?? 1
      row[`N<sub>el</sub>`] = get_arity(entry)
      row[`N<sub>at</sub>`] = Object.values(entry.composition).reduce(
        (sum, amt) => sum + amt,
        0,
      )
      if (is_highlighted(entry)) {
        row.style = `background: color-mix(in srgb, var(--hull-stable-color, #22c55e) 15%, transparent)`
      }
      return row
    }),
  )

  function handle_row_click(_event: KeyboardEvent | MouseEvent, row: RowData): void {
    const entry = table_entries[Number(row[`#`]) - 1]
    if (entry) on_entry_click?.(entry)
  }

  const table_columns = $derived<Label[]>([
    { label: `#`, color_scale: null, format: `d`, description: `Row number` },
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
      ? [
          {
            label: `E<sub>raw</sub>`,
            color_scale: `interpolateCool` as const,
            format: `.4f`,
            description: `Raw energy per atom (eV/atom)`,
          },
        ]
      : []),
    ...(has_ids ? [{ label: `ID`, color_scale: null, description: `Entry identifier` }] : []),
    ...(has_polymorphs
      ? [
          {
            label: `Poly`,
            color_scale: null,
            description: `Number of polymorphs (same reduced formula)`,
          },
        ]
      : []),
    { label: `N<sub>el</sub>`, color_scale: null, description: `Number of elements` },
    {
      label: `N<sub>at</sub>`,
      color_scale: null,
      format: `d`,
      description: `Number of atoms in unit cell`,
    },
  ])

  // Filename for HeatmapTable's built-in CSV/JSON export
  const export_filename = $derived(
    phase_stats?.chemical_system?.toLowerCase().replaceAll(/\s+/g, `-`) ?? `convex-hull-stats`,
  )
  const cards_props = {
    show_filter: false,
    empty_label: `stats`,
    heading_level: 5,
    variant: `flat`,
  } as const
</script>

{#snippet stats_panel()}
  {#if stat_cards}
    <InfoPaneCards cards={[stat_cards.counts]} {...cards_props} />
    {#if subsystem_coverage}
      <div class="subsystem-coverage" data-testid="pd-binary-subsystem-coverage">
        <span class="subsystem-label">
          Binary subsystem coverage ({subsystem_coverage.length} pairs)
        </span>
        {#each subsystem_coverage as { pair, count } (pair)}
          <span class="subsystem-chip" class:has-entries={count > 0}>
            <span class="pair">{pair}</span>
            <span class="count">{count}</span>
          </span>
        {/each}
      </div>
    {/if}
    <hr />
    <InfoPaneCards cards={[stat_cards.stability]} {...cards_props} />
    <hr />
    {#if stat_cards.e_form}
      <InfoPaneCards cards={[stat_cards.e_form]} {...cards_props} />
    {/if}
    {#if e_form_values.length > 0}
      <Histogram
        {...histogram_props}
        series={[{ values: e_form_values, label: `Formation Energy` }]}
        x_axis={{ label: ``, format: `.2f` }}
        bar={{ color: `steelblue`, opacity: 0.7 }}
      />
    {/if}
    <hr />
    <InfoPaneCards cards={[stat_cards.e_hull]} {...cards_props} />
    {#if e_hull_values.length > 0}
      <Histogram
        {...histogram_props}
        series={[{ values: e_hull_values, label: `E above hull` }]}
        x_axis={{ label: ``, format: `.2f`, range: [0, null] }}
        bar={{ color: `coral`, opacity: 0.7 }}
      />
    {/if}
  {/if}
{/snippet}

{#snippet table_panel()}
  <div class="table-filters">
    {#if max_n_el > 2}
      <label>
        Min N<sub>el</sub>:
        <select bind:value={min_n_elements}>
          {#each Array.from({ length: max_n_el }, (_, idx) => idx + 1) as nel (nel)}
            <option value={nel}>{nel}{nel === 1 ? ` (all)` : ``}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if has_polymorphs}
      <label>
        Polymorphs:
        <select bind:value={formula_filter}>
          <option value="">all</option>
          {#each poly_formulas as [formula, count] (formula)}
            <option value={formula}>{formula} ({count})</option>
          {/each}
        </select>
      </label>
    {/if}
    <span class="filter-count">{table_entries.length} entries</span>
  </div>
  <HeatmapTable
    data={table_data}
    columns={table_columns}
    initial_sort={{ column: `E<sub>hull</sub>`, direction: `asc` }}
    virtual
    scroll_style="height: {table_height}; min-height: {table_height}; max-height: var(--hull-stats-max-height, 70vh); max-width: 100%; overflow: auto"
    style="width: 100%"
    root_style="min-width: 0; margin-inline: 0; flex: 1 1 0"
    on_row_click={on_entry_click ? handle_row_click : undefined}
    export_data={{ filename: export_filename }}
  />
{/snippet}

{#snippet view_panel(mode: `stats` | `table`, content: Snippet)}
  <div class="view-panel" aria-hidden={view_mode !== mode} inert={view_mode !== mode}>
    {@render content()}
  </div>
{/snippet}

<div {...rest} class={[`convex-hull-stats`, layout, rest.class]}>
  {#if layout === `side-by-side`}
    <div class="stats-pane">{@render stats_panel()}</div>
    <div class="table-pane">{@render table_panel()}</div>
  {:else}
    <div class="view-toggle">
      <button class:active={view_mode === `stats`} onclick={() => (view_mode = `stats`)}>
        Stats
      </button>
      <button class:active={view_mode === `table`} onclick={() => (view_mode = `table`)}>
        Table
      </button>
    </div>
    <div class="view-panels">
      {@render view_panel(`stats`, stats_panel)}
      {@render view_panel(`table`, table_panel)}
    </div>
  {/if}
</div>

<style>
  .convex-hull-stats {
    background: var(--hull-stats-bg, var(--hull-bg, var(--plot-bg)));
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
    box-sizing: border-box;
    max-width: 100%;
    overflow: hidden;
    padding: var(--hull-stats-padding, 1em);
    --info-card-padding: 3pt;
    --info-card-heading-gap: 6px;
    --info-row-padding: 1pt;
    --info-row-label-color: var(--text-color-muted, light-dark(#666, #bbb));
  }
  .convex-hull-stats.side-by-side {
    display: flex;
    /* the table drops below the stats once the host is too narrow for both */
    flex-wrap: wrap;
    gap: var(--hull-stats-gap, 1.5em);
    align-items: stretch;
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
  }
  .stats-pane {
    flex: 0 0 auto;
    width: fit-content;
    min-width: var(--hull-stats-pane-min-width, 200px);
    max-width: var(--hull-stats-pane-max-width, 320px);
  }
  .table-pane {
    flex: 1 1 var(--hull-stats-table-min-width, 300px);
    max-width: 100%;
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .convex-hull-stats :global(tbody tr[onclick]) {
    cursor: pointer;
  }
  .view-toggle {
    display: flex;
    margin-bottom: 8pt;
    max-width: 100%;
    min-width: 0;
  }
  .view-toggle button {
    flex: 1;
    min-width: 0;
    padding: 2pt 8pt;
    border: 1px solid
      var(--hull-stats-border-color, color-mix(in srgb, currentColor 20%, transparent));
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
    background: var(
      --hull-stats-toggle-active-bg,
      light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    );
    font-weight: 500;
  }
  .view-panels {
    display: grid;
    min-width: 0;
  }
  .view-panel {
    grid-area: 1 / 1;
    min-width: 0;
  }
  .view-panel[aria-hidden='true'] {
    pointer-events: none;
    visibility: hidden;
  }
  .table-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
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
      border: 1px solid
        var(--hull-stats-border-color, color-mix(in srgb, currentColor 20%, transparent));
      border-radius: 3pt;
      background: transparent;
      color: inherit;
      font-size: inherit;
    }
  }
  .filter-count,
  .subsystem-label {
    color: var(--text-color-muted, light-dark(#666, #bbb));
    font-size: 0.9em;
  }
  .subsystem-coverage {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4pt 1em;
    padding: 1pt 3pt;
  }
  .subsystem-chip {
    display: inline-flex;
    align-items: center;
    padding: 1pt 5pt;
    border-radius: 3pt;
    font-size: 0.78em;
    line-height: 1.2;
    background: color-mix(in srgb, currentColor 5%, transparent);
    color: var(--text-color-muted, light-dark(#666, #bbb));
    .pair {
      font-weight: 500;
    }
    .count {
      margin-left: 3pt;
      font-size: 0.9em;
      font-weight: 600;
    }
  }
  .subsystem-chip.has-entries {
    background: color-mix(in srgb, var(--hull-stable-color, #22c55e) 15%, transparent);
    color: inherit;
  }
</style>
