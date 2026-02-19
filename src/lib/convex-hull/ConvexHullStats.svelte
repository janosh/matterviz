<script lang="ts">
  import {
    get_alphabetical_formula,
    get_electro_neg_formula,
    get_reduced_formula,
  } from '$lib/composition'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import Histogram from '$lib/plot/Histogram.svelte'
  import type { Label, RowData } from '$lib/table'
  import HeatmapTable from '$lib/table/HeatmapTable.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import type { ConvexHullEntry, PhaseArityField, PhaseStats } from './types'
  import { get_arity, is_on_hull } from './types'

  let {
    phase_stats,
    stable_entries,
    unstable_entries,
    layout = `toggle`,
    on_entry_click,
    highlighted_entry_id,
    min_n_elements = $bindable(1),
    entry_href,
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
      // Entry ID to highlight in the table (e.g. current material on detail page)
      highlighted_entry_id?: string
      // Minimum number of elements filter for table (bindable for URL sync)
      min_n_elements?: number
      // Generate URL for an entry (makes ID column a clickable link)
      entry_href?: (entry: ConvexHullEntry) => string | null
    } = $props()

  let copied_items = new SvelteSet<string>()
  let view_mode = $state<`stats` | `table`>(`stats`)
  // Formula filter: when set, table shows only entries with this reduced formula
  let formula_filter = $state(``)
  let show_export_dropdown = $state(false)

  async function copy_to_clipboard(label: string, value: string, key: string) {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`)
      copied_items.add(key)
      setTimeout(() => copied_items.delete(key), 1000)
    } catch (error) {
      console.error(`Failed to copy to clipboard:`, error)
    }
  }
  function handle_copy_keydown(
    event: KeyboardEvent,
    label: string,
    value: string,
    key: string,
  ): void {
    if (event.key !== `Enter` && event.key !== ` `) return
    event.preventDefault()
    copy_to_clipboard(label, value, key)
  }

  // Shared concatenation of stable + unstable for histograms
  let all_entries = $derived([...stable_entries, ...unstable_entries])

  // Static arity labels for phase breakdown display
  const arity_types: [string, PhaseArityField, number][] = [
    [`Unary`, `unary`, 1],
    [`Binary`, `binary`, 2],
    [`Ternary`, `ternary`, 3],
    [`Quaternary`, `quaternary`, 4],
    [`Quinary+`, `quinary_plus`, 5],
  ]

  const histogram_props = {
    bins: 50,
    y_axis: { label: ``, ticks: 3 },
    show_legend: false,
    show_controls: false,
    padding: { t: 5, b: 22, l: 35, r: 5 },
    style: `height: 100px; --histogram-min-height: 100px`,
  } as const

  // Prepare histogram data for formation energies and hull distances
  let e_form_data = $derived([{
    x: [] as number[],
    y: all_entries
      .map((entry) => entry.e_form_per_atom ?? entry.energy_per_atom)
      .filter((val): val is number => val !== undefined && isFinite(val)),
    label: `Formation Energy`,
  }])

  let hull_distance_data = $derived([{
    x: [] as number[],
    y: all_entries
      .map((entry) => entry.e_above_hull)
      .filter((val): val is number => val !== undefined && isFinite(val)),
    label: `E above hull`,
  }])

  let pane_data = $derived.by(() => {
    if (!phase_stats) return []

    const pct = (count: number) =>
      phase_stats.total > 0 ? format_num(count / phase_stats.total, `.1~%`) : `0%`

    return [
      {
        title: ``,
        items: [
          {
            label: `Total entries in ${phase_stats.chemical_system}`,
            value: format_num(phase_stats.total),
            key: `total-entries`,
          },
          // Only show phase types that exist or are within the max_arity
          // used when computing stats (respects zeroed-out counts)
          ...arity_types
            .filter(([, field, arity]) =>
              phase_stats[field] > 0 || phase_stats.max_arity >= arity
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
          value: [
            phase_stats.energy_range.min,
            phase_stats.energy_range.avg,
            phase_stats.energy_range.max,
          ]
            .map((val) => format_num(val, `.3f`)).join(` / `),
          key: `formation-energy`,
        }],
      },
      {
        title: `E<sub>above hull</sub> distribution`,
        items: [{
          label: `Max / avg (eV/atom)`,
          value: [phase_stats.hull_distance.max, phase_stats.hull_distance.avg]
            .map((val) => format_num(val, `.3f`)).join(` / `),
          key: `hull-distance`,
        }],
      },
    ]
  })

  // Subsystem coverage: count entries per element pair for the stats pane
  let subsystem_coverage = $derived.by(() => {
    if (!phase_stats) return null
    const elements = phase_stats.chemical_system.split(`-`)
    if (elements.length < 3 || elements.length > 10) return null
    // Count entries containing each pair
    const pair_counts = new SvelteMap<string, number>()
    for (const entry of all_entries) {
      const active =
        (Object.keys(entry.composition) as (keyof typeof entry.composition)[])
          .filter((el) => (entry.composition[el] ?? 0) > 0)
      // Count all pairs present in this entry
      for (let idx_a = 0; idx_a < active.length; idx_a++) {
        for (let idx_b = idx_a + 1; idx_b < active.length; idx_b++) {
          const key = [active[idx_a], active[idx_b]].sort().join(`-`)
          pair_counts.set(key, (pair_counts.get(key) ?? 0) + 1)
        }
      }
    }
    // Build pairs list sorted by element order in chemical_system
    return elements.flatMap((el_a, idx_a) =>
      elements.slice(idx_a + 1).map((el_b) => {
        const key = [el_a, el_b].sort().join(`-`)
        return { pair: key, count: pair_counts.get(key) ?? 0 }
      })
    )
  })
  let subsystem_coverage_summary = $derived(
    subsystem_coverage?.map(({ pair, count }) => `${pair}: ${count}`).join(` | `) ??
      null,
  )

  // Table view: visible entries filtered by min element count and formula
  let visible_entries = $derived(
    all_entries.filter((entry) => {
      if (!entry.visible) return false
      if (min_n_elements > 1 && get_arity(entry) < min_n_elements) return false
      if (
        active_formula_filter &&
        composition_key(entry.composition) !== active_formula_filter
      ) return false
      return true
    }),
  )
  let has_raw = $derived(
    visible_entries.some((entry) => entry.energy_per_atom !== undefined),
  )
  let has_ids = $derived(visible_entries.some((entry) => entry.entry_id))
  let max_n_el = $derived(
    all_entries.reduce((max, entry) => Math.max(max, get_arity(entry)), 1),
  )

  // Sortable HTML cell with a hidden data-sort-value for HeatmapTable sorting
  const sort_span = (sort_val: number | string, display: string, attrs = ``) =>
    `<span data-sort-value="${sort_val}"${attrs ? ` ${attrs}` : ``}>${display}</span>`

  // Escape HTML special chars to prevent XSS when rendering user-supplied strings via {@html}
  const escape_html = (str: string): string =>
    str
      .replace(/&/g, `&amp;`)
      .replace(/</g, `&lt;`)
      .replace(/>/g, `&gt;`)
      .replace(/"/g, `&quot;`)
      .replace(/'/g, `&#39;`)
  const unescape_html = (str: string, max_rounds = 5): string => {
    let decoded = str
    for (let round_idx = 0; round_idx < max_rounds; round_idx++) {
      const next_decoded = decoded
        .replace(/&amp;/g, `&`)
        .replace(/&lt;/g, `<`)
        .replace(/&gt;/g, `>`)
        .replace(/&quot;/g, `"`)
        .replace(/&#39;/g, `'`)
      if (next_decoded === decoded) break
      decoded = next_decoded
    }
    return decoded
  }
  // Convert legacy/html formula strings like Fe<sub>2</sub>O<sub>3</sub> back to plain
  // stoichiometric input before parsing/reordering.
  const normalize_formula_markup = (formula: string): string =>
    unescape_html(formula)
      .replaceAll(/<sub>\s*([^<]+?)\s*<\/sub>/gi, `$1`)
      .replaceAll(/<[^>]+>/g, ``)
      .replaceAll(/\s+/g, ``)
  const sanitize_href = (href: string | null | undefined): string | null => {
    const trimmed_href = href?.trim()
    if (!trimmed_href) return null
    const lower_href = trimmed_href.toLowerCase()
    const blocked_schemes = [`javascript:`, `data:`, `vbscript:`]
    if (blocked_schemes.some((scheme) => lower_href.startsWith(scheme))) return null
    return trimmed_href
  }
  // Serialize reduced composition to a stable string key for polymorph counting
  const composition_key = (comp: Record<string, number>): string =>
    get_alphabetical_formula(get_reduced_formula(comp), true, ``)

  // Count polymorphs per reduced formula across all entries
  let polymorph_counts = $derived.by(() => {
    const counts = new SvelteMap<string, number>()
    for (const entry of all_entries) {
      const key = composition_key(entry.composition)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  })
  let poly_formulas = $derived(
    [...polymorph_counts.entries()]
      .filter(([, count]) => count > 1)
      .sort(([, count_a], [, count_b]) => count_b - count_a),
  )
  let has_polymorphs = $derived(poly_formulas.length > 0)
  let active_formula_filter = $derived.by(() => {
    if (!formula_filter || !has_polymorphs) return ``
    return poly_formulas.some(([formula]) => formula === formula_filter)
      ? formula_filter
      : ``
  })
  $effect(() => {
    if (formula_filter && formula_filter !== active_formula_filter) {
      formula_filter = ``
    }
  })

  // Build table rows and a WeakMap from row→entry for the click handler
  let { table_data, entry_by_row } = $derived.by(() => {
    const map = new WeakMap<RowData, ConvexHullEntry>()
    const rows = visible_entries.map((entry, idx) => {
      const n_atoms = Object.values(entry.composition).reduce(
        (sum, count) => sum + count,
        0,
      )
      const on_hull = is_on_hull(entry)
      const formula_source = entry.reduced_formula ?? entry.name ??
        get_alphabetical_formula(entry.composition, true, ``)
      const normalized_formula = normalize_formula_markup(formula_source)
      const formatted_formula = get_electro_neg_formula(normalized_formula)
      const formula_html = formatted_formula || escape_html(normalized_formula)
      // Match by entry_id or common data fields (mat_id, structure_id)
      // since entry_id may be wrapped in HTML (e.g. <a> tags)
      const entry_data = entry.data as Record<string, unknown> | undefined
      const is_highlighted = !!(highlighted_entry_id && (
        entry.entry_id === highlighted_entry_id ||
        entry_data?.mat_id === highlighted_entry_id ||
        entry_data?.structure_id === highlighted_entry_id
      ))
      const row: RowData = {
        '#': sort_span(idx + 1, `${idx + 1}`),
        Formula: on_hull ? `<strong>${formula_html}</strong>` : formula_html,
        'E<sub>hull</sub>': entry.e_above_hull ?? null,
        'E<sub>form</sub>': entry.e_form_per_atom ?? entry.energy_per_atom ?? null,
      }
      if (has_raw) row[`E<sub>raw</sub>`] = entry.energy_per_atom
      if (has_ids) {
        const safe_href = sanitize_href(entry_href?.(entry))
        const safe_id = entry.entry_id ? escape_html(entry.entry_id) : undefined
        row.ID = safe_href && safe_id
          ? `<a href="${
            escape_html(safe_href)
          }" target="_blank" rel="noopener">${safe_id}</a>`
          : safe_id
      }
      if (has_polymorphs) {
        const comp_key = composition_key(entry.composition)
        const poly_count = polymorph_counts.get(comp_key) ?? 1
        row.Poly = poly_count
      }
      row[`N<sub>el</sub>`] = get_arity(entry)
      row[`N<sub>at</sub>`] = n_atoms
      // Highlight row for current material
      if (is_highlighted) {
        row.style =
          `background: color-mix(in srgb, var(--hull-stable-color, #22c55e) 15%, transparent)`
      }
      map.set(row, entry)
      return row
    })
    return { table_data: rows, entry_by_row: map }
  })

  function handle_row_click(_event: KeyboardEvent | MouseEvent, row: RowData): void {
    const entry = entry_by_row.get(row)
    if (entry) on_entry_click?.(entry)
  }

  let table_columns: Label[] = $derived(
    [
      { label: `#`, color_scale: null, description: `Row number` },
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
      ...(has_polymorphs
        ? [{
          label: `Poly`,
          color_scale: null,
          description: `Number of polymorphs (same reduced formula)`,
        }]
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

  const html_to_text = (val: unknown): string => {
    if (val == null) return ``
    if (typeof val !== `string`) return String(val)
    const temp_el = document.createElement(`div`)
    temp_el.innerHTML = val
    return temp_el.textContent?.trim() ?? ``
  }
  const csv_escape = (val: string): string =>
    /[",\n]/.test(val) ? `"${val.replaceAll(`"`, `""`)}"` : val
  const get_export_filename = (format: `csv` | `json`): string => {
    const system = (phase_stats?.chemical_system ?? `convex-hull-stats`)
      .toLowerCase()
      .replaceAll(/\s+/g, `-`)
    return `${system}.${format}`
  }
  const build_export_rows = () => {
    const column_labels = table_columns.map((col) => col.label)
    return table_data.map((row) =>
      Object.fromEntries(
        column_labels.map((label) => [html_to_text(label), html_to_text(row[label])]),
      )
    )
  }
  const download_file = (
    content: string,
    filename: string,
    mime_type: string,
  ): void => {
    const blob = new Blob([content], { type: mime_type })
    const object_url = URL.createObjectURL(blob)
    const link_el = document.createElement(`a`)
    link_el.href = object_url
    link_el.download = filename
    document.body.append(link_el)
    link_el.click()
    link_el.remove()
    URL.revokeObjectURL(object_url)
  }
  function export_table(format: `csv` | `json`): void {
    const rows = build_export_rows()
    if (format === `json`) {
      download_file(
        JSON.stringify(rows, null, 2),
        get_export_filename(`json`),
        `application/json;charset=utf-8`,
      )
      return
    }
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    const csv_lines = [
      headers.map(csv_escape).join(`,`),
      ...rows.map((row) =>
        headers.map((header) => csv_escape(row[header] ?? ``)).join(`,`)
      ),
    ]
    download_file(
      csv_lines.join(`\n`),
      get_export_filename(`csv`),
      `text/csv;charset=utf-8`,
    )
  }
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
          onkeydown={(event) =>
          handle_copy_keydown(
            event,
            item.label,
            String(item.value),
            key ?? item.label,
          )}
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

      {#if sec_idx === 0 && subsystem_coverage}
        <div
          class="clickable stat-item subsystem-coverage-row"
          data-testid="pd-binary-subsystem-coverage"
          title="Click to copy: Binary subsystem coverage: {subsystem_coverage_summary ?? ``}"
          onclick={() =>
          copy_to_clipboard(
            `Binary subsystem coverage`,
            subsystem_coverage_summary ?? ``,
            `binary-subsystem-coverage`,
          )}
          role="button"
          tabindex="0"
          onkeydown={(event) =>
          handle_copy_keydown(
            event,
            `Binary subsystem coverage`,
            subsystem_coverage_summary ?? ``,
            `binary-subsystem-coverage`,
          )}
        >
          <span class="subsystem-label"
          >Binary subsystem coverage ({subsystem_coverage.length} pairs)</span>
          <span class="subsystem-chips">
            {#each subsystem_coverage as { pair, count } (pair)}
              <span class="subsystem-chip" class:has-entries={count > 0}>
                <span class="pair">{pair}</span>
                <span class="count">{count}</span>
              </span>
            {/each}
          </span>
          {#if copied_items.has(`binary-subsystem-coverage`)}
            <Icon
              icon="Check"
              style="color: var(--success-color, #10b981); width: 12px; height: 12px"
              class="copy-checkmark"
            />
          {/if}
        </div>
      {/if}

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
    <span class="filter-count">{visible_entries.length} entries</span>
    <span class="filter-spacer"></span>
    <div class="export-actions">
      <button
        class="icon-btn"
        class:active={show_export_dropdown}
        title="Export"
        onclick={() => show_export_dropdown = !show_export_dropdown}
      >
        <Icon icon="Export" style="width: 14px" />
      </button>
      {#if show_export_dropdown}
        <div class="export-dropdown">
          <button
            class="dropdown-option"
            onclick={() => {
              export_table(`csv`)
              show_export_dropdown = false
            }}
          >
            <Icon icon="Download" style="width: 12px" /> CSV
          </button>
          <button
            class="dropdown-option"
            onclick={() => {
              export_table(`json`)
              show_export_dropdown = false
            }}
          >
            <Icon icon="Download" style="width: 12px" /> JSON
          </button>
        </div>
      {/if}
    </div>
  </div>
  <HeatmapTable
    data={table_data}
    columns={table_columns}
    initial_sort={{ column: `E<sub>hull</sub>`, direction: `asc` }}
    scroll_style={layout === `side-by-side`
    ? `flex: 1 1 0; max-width: 100%; overflow: auto`
    : `max-height: var(--hull-stats-max-height, 500px)`}
    style="width: 100%"
    root_style={layout === `side-by-side`
    ? `flex: 1 1 0; min-height: 0; margin-inline: 0`
    : undefined}
    onrowclick={on_entry_click ? handle_row_click : undefined}
    export_data={false}
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
    padding: var(--hull-stats-padding, 1em);
  }
  .convex-hull-stats.side-by-side {
    display: flex;
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
    flex: 1 1 0;
    max-width: 100%;
    min-width: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
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
    color: var(--text-color-muted, light-dark(#666, #bbb));
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
      sub {
        margin-left: -0.2em;
        font-size: 0.72em;
        line-height: 0;
        vertical-align: baseline;
        position: relative;
        top: 0.33em;
      }
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
  .filter-spacer {
    flex: 1 1 auto;
  }
  .export-actions {
    position: relative;
    .icon-btn {
      padding: 2pt 6pt;
      border: 1px solid
        var(--hull-stats-border-color, color-mix(in srgb, currentColor 20%, transparent));
      border-radius: 3pt;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover {
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    .icon-btn.active {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
  }
  .export-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    display: flex;
    flex-direction: column;
    min-width: 88px;
    padding: 3pt;
    border: 1px solid
      var(--hull-stats-border-color, color-mix(in srgb, currentColor 20%, transparent));
    border-radius: 4pt;
    background: var(--page-bg, Canvas);
    z-index: 4;
    box-shadow: 0 2px 8px color-mix(in srgb, black 20%, transparent);
    .dropdown-option {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      border-radius: 3pt;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      padding: 3pt 6pt;
    }
    .dropdown-option:hover {
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
  }
  .table-pane :global(.control-buttons) {
    display: none;
    margin: 0;
  }
  .filter-count {
    color: var(--text-color-muted, light-dark(#666, #bbb));
    font-size: 0.9em;
  }
  .subsystem-coverage-row {
    flex-wrap: wrap;
    gap: 4pt 1em;
    justify-content: flex-start;
    .subsystem-label {
      color: var(--text-color-muted, light-dark(#666, #bbb));
      font-size: 0.9em;
    }
    .subsystem-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4pt;
    }
  }
  .subsystem-chip {
    display: inline-flex;
    align-items: center;
    gap: 0;
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
      color: color-mix(in srgb, currentColor 70%, transparent);
    }
  }
  .subsystem-chip.has-entries {
    background: color-mix(in srgb, var(--hull-stable-color, #22c55e) 15%, transparent);
    color: inherit;
  }
</style>
